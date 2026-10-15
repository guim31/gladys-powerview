// -----------------------------------------------------------------------------
// The PowerView runtime: the hubs, their shades and scenes, the refresh timer
// and the commands.
//
// Refresh. The core cannot be trusted to call onPoll (GladysAssistant/Gladys
// #3198: a device created without `should_poll` is never polled, and the
// polling fields stay those of the creation), so the container reads the hubs
// itself, every `refresh_interval` seconds, and onPoll stays as a fallback:
// it reads a hub only when the timer has not done so for 90 % of a period.
// A read is `GET /api/shades` (Gen 1-2) or `GET /home/shades` (Gen 3): the hub
// answers from its memory, without waking the shades. Only the hubs with a
// shade added to Gladys are read. On top of that, like Home Assistant:
//   - a mains-powered shade is asked its real position over the radio
//     (`?refresh=true`) every 10 minutes, one shade per hub and per cycle (a
//     battery shade is never asked on a timer: it would drain its batteries);
//   - after a move, the shade is asked once its motor should have stopped
//     (1 s + 40 s for a full course, Home Assistant's estimate), and its
//     target position is shown in the meantime.
//
// Radio. A hub handles one radio operation at a time (moves, stops, jogs,
// scenes, `?refresh=true`): Home Assistant saw hubs crash otherwise. They are
// queued per hub.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  DEVICE_TYPE,
  buildSceneDevice,
  buildShadeDevice,
  commandToMove,
  parseExternalId,
  shadeStates,
  uniqueNames,
} from './devices.js';
import { MDNS_TIMEOUT_SECONDS, mapLimit, mdnsHosts } from './discovery.js';
import { SEARCH_TEXT, TEXT, localize } from './i18n.js';
import { createIssueLog } from './issues.js';
import { PowerViewError, createClient } from './powerview/client.js';
import { entryName, isHardwired, moveBody, readPositions } from './powerview/shade.js';

const logger = createLogger({ name: 'powerview' });

// Re-send an unchanged value this often, so Gladys never shows it as stale
// ("no recent value" past 48 h).
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
// A mains-powered shade is asked its real position this often.
export const RADIO_REFRESH_MS = 10 * 60 * 1000;
// Home Assistant's estimate of a full course, and the margin before asking.
export const FULL_COURSE_MS = 40 * 1000;
const MOVE_MARGIN_MS = 1000;
// The time to read a stopped shade, and the shades of a scene that ran.
export const STOP_SETTLE_MS = 2000;
export const SCENE_SETTLE_MS = 45 * 1000;
// A hub that stays silent this long is looked for again (it may have
// changed its address), at most this often.
const RELOCATE_AFTER_MS = 5 * 60 * 1000;
const RELOCATE_EVERY_MS = 15 * 60 * 1000;

const defaultTimers = {
  set(callback, ms) {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle);
  },
};

/** The hub answered "busy with my maintenance" (HTTP 423). */
const isMaintenance = (err) => err instanceof PowerViewError && err.maintenance;

export class PowerViewHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {import('./store.js').Store} options.store
   * @param {typeof fetch} [options.fetch] the HTTP client (tests: a fake hub)
   * @param {object} [options.timers] `{ set(callback, ms), clear(handle) }`
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch, timers = defaultTimers, now = () => Date.now() }) {
    this.gladys = gladys;
    this.store = store;
    this.client = createClient({ fetch });
    this.timers = timers;
    this.now = now;
    this.config = null;
    /** serial → hub (see #hubFromRecord) */
    this.hubs = new Map();
    this.issues = createIssueLog(logger);
    this.pollTimer = null;
    /** Pending one-shot timers (end of a move, a scene), to clear on stop. */
    this.pending = new Set();
    this.stopped = false;
    this.lastStatus = null;
    this.lastDiscovery = { mdns: 'unknown', secondaries: [], unreachable: [], invalidHosts: [] };
    this.lastRelocateAt = 0;
    /** `serial@host` of the hubs already announced in the logs. */
    this.announced = new Set();
  }

  // --- Lifecycle --------------------------------------------------------------

  /** First start: the stored hubs, a discovery, the devices, a first read. */
  async start(config) {
    this.config = config;
    this.stopped = false;
    const saved = await this.store.load();
    for (const [serial, record] of Object.entries(saved.hubs ?? {})) {
      if (record && typeof record === 'object' && typeof record.host === 'string') {
        this.hubs.set(serial, this.#hubFromRecord(serial, record));
      }
    }
    await this.discover();
    await this.publishDevices();
    await this.pollAll({ force: true });
    this.#schedulePoll();
  }

  /** A new configuration: look for the hubs again, start the polling over. */
  async reconfigure(config) {
    this.config = config;
    await this.discover();
    await this.publishDevices();
    await this.pollAll({ force: true });
    this.#schedulePoll();
  }

  /** A reconnection (Gladys restarted): re-send what Gladys may have lost. */
  async resync(config) {
    this.config = config;
    this.lastStatus = null;
    this.gladys.forgetPublishedStates();
    await this.publishDevices();
    await this.pollAll({ force: true });
    this.#schedulePoll();
  }

  stop() {
    this.stopped = true;
    this.timers.clear(this.pollTimer);
    this.pollTimer = null;
    for (const handle of this.pending) {
      this.timers.clear(handle);
    }
    this.pending.clear();
  }

  // --- Discovery --------------------------------------------------------------

  /**
   * Probe every candidate address, keep the primary hubs by serial number,
   * and read their shades, scenes and rooms.
   */
  async discover() {
    const config = this.config;
    const fromMdns = await this.#scanMdns();
    const candidates = [
      ...new Set([
        ...config.hosts,
        ...(fromMdns ?? []),
        ...[...this.hubs.values()].map((hub) => hub.host),
      ]),
    ];
    const secondaries = [];
    const unreachable = [];
    const results = await mapLimit(candidates, 4, (host) => this.client.detectHub(host));
    results.forEach(({ value: info, error }, index) => {
      const host = candidates[index];
      if (error || !info) {
        if (config.hosts.includes(host)) {
          unreachable.push(host);
        }
        if (error && !isMaintenance(error)) {
          logger.debug(`${host}: no PowerView hub (${error.message})`);
        }
        return;
      }
      if (!info.primary) {
        secondaries.push(host);
        logger.debug(`${host}: secondary Gen 3 gateway, driven through the primary one`);
        return;
      }
      const known = this.hubs.get(info.serial);
      const hub = known ?? this.#hubFromRecord(info.serial, info);
      Object.assign(hub, {
        host: info.host,
        apiVersion: info.apiVersion,
        generation: info.generation,
        name: info.name || hub.name,
        firmware: info.firmware || hub.firmware,
      });
      this.hubs.set(info.serial, hub);
    });
    this.lastDiscovery = {
      mdns: fromMdns === null ? 'unavailable' : 'ok',
      secondaries,
      unreachable,
      invalidHosts: config.invalidHosts,
    };
    await Promise.all([...this.hubs.values()].map((hub) => this.#loadCatalog(hub)));
    this.#save();
    await this.#updateStatus();
  }

  /** The mDNS hosts, or null when the core cannot scan (an older Gladys). */
  async #scanMdns() {
    try {
      const results = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: MDNS_TIMEOUT_SECONDS,
      });
      return mdnsHosts(results);
    } catch (err) {
      logger.debug(`mDNS discovery unavailable (${err.message})`);
      return null;
    }
  }

  /** Shades, scenes and rooms of a hub; the last known ones when it fails. */
  async #loadCatalog(hub) {
    try {
      const [shades, scenes, rooms] = await Promise.all([
        this.client.getShades(hub),
        this.client.getScenes(hub),
        this.client.getRooms(hub).catch(() => null),
      ]);
      hub.shades = new Map(shades.filter(validEntry).map((raw) => [raw.id, raw]));
      hub.scenes = new Map(scenes.filter(validEntry).map((raw) => [raw.id, raw]));
      if (rooms) {
        hub.rooms = new Map(rooms.filter(validEntry).map((raw) => [raw.id, entryName(raw)]));
      }
      hub.lastReadAt = this.now();
      this.#hubAnswered(hub);
      const key = `${hub.serial}@${hub.host}`;
      if (!this.announced.has(key)) {
        this.announced.add(key);
        logger.info(
          `PowerView hub "${hub.name || hub.serial}" (Gen ${hub.generation}, ${hub.host}): ` +
            `${hub.shades.size} shade(s), ${hub.scenes.size} scene(s)`,
        );
      }
    } catch (err) {
      this.#hubFailed(hub, err);
    }
  }

  /** Look again for the hubs silent for a while: they may have a new address. */
  async #relocateSilentHubs() {
    const now = this.now();
    const silent = [...this.hubs.values()].some(
      (hub) => hub.failingSince !== null && now - hub.failingSince >= RELOCATE_AFTER_MS,
    );
    if (!silent || now - this.lastRelocateAt < RELOCATE_EVERY_MS) {
      return;
    }
    this.lastRelocateAt = now;
    logger.debug('A hub stays silent: looking for the hubs again');
    await this.discover();
  }

  /** Publish every shade and scene of every hub to the Discovery tab. */
  async publishDevices() {
    const language = this.config.language;
    const devices = [];
    for (const hub of this.hubs.values()) {
      const shades = [...hub.shades.values()];
      const names = uniqueNames(
        shades.map((raw) => ({
          key: String(raw.id),
          name: entryName(raw),
          room: hub.rooms.get(raw.roomId) ?? '',
        })),
      );
      for (const raw of shades) {
        devices.push(
          buildShadeDevice(this.gladys, hub, raw, {
            language,
            name: names.get(String(raw.id)),
            room: hub.rooms.get(raw.roomId),
          }),
        );
      }
      for (const raw of hub.scenes.values()) {
        devices.push(buildSceneDevice(this.gladys, hub, raw, { language }));
      }
    }
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** Discover, publish, read: the "Search for hubs" action and Gladys' scan. */
  async rediscover() {
    await this.discover();
    await this.publishDevices();
    await this.pollAll({ force: true });
  }

  /** What the last discovery found, for the "Search for hubs" report. */
  summary() {
    return {
      hubs: [...this.hubs.values()].map((hub) => ({
        name: hub.name || hub.serial,
        generation: hub.generation,
        host: hub.host,
        reachable: hub.failingSince === null,
        shades: hub.shades.size,
        scenes: hub.scenes.size,
      })),
      ...this.lastDiscovery,
    };
  }

  // --- Polling ----------------------------------------------------------------

  #periodMs() {
    return this.config.refresh_interval * 1000;
  }

  #schedulePoll() {
    this.timers.clear(this.pollTimer);
    this.pollTimer = null;
    if (this.stopped) {
      return;
    }
    this.pollTimer = this.timers.set(async () => {
      this.pollTimer = null;
      try {
        await this.pollAll();
        await this.#relocateSilentHubs();
      } catch (err) {
        logger.error(`Polling cycle failed (${err.message})`);
      } finally {
        this.#schedulePoll();
      }
    }, this.#periodMs());
  }

  /**
   * Read every hub with a shade added to Gladys, and publish what changed.
   * Errors are logged once per outage, never thrown.
   */
  async pollAll({ force = false } = {}) {
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: poll skipped');
      return;
    }
    const hubs = [...this.hubs.values()].filter((hub) => this.#createdShades(hub).length > 0);
    await Promise.all(hubs.map((hub) => this.readHub(hub, { force })));
    await this.#updateStatus();
  }

  /**
   * Read one hub (unless it was read less than `minGap` periods ago) and
   * publish the states of its shades added to Gladys.
   */
  async readHub(hub, { force = false, minGap = 0.5 } = {}) {
    if (hub.reading) {
      return hub.reading;
    }
    if (
      !force &&
      hub.lastReadAt !== null &&
      this.now() - hub.lastReadAt < this.#periodMs() * minGap
    ) {
      logger.debug(`${hub.serial}: read ${this.now() - hub.lastReadAt} ms ago, skipped`);
      return undefined;
    }
    hub.reading = (async () => {
      try {
        const shades = await this.client.getShades(hub);
        for (const raw of shades.filter(validEntry)) {
          hub.shades.set(raw.id, raw);
        }
        hub.lastReadAt = this.now();
        this.#hubAnswered(hub);
        await this.#publishShades(hub);
        await this.#radioRefreshOneHardwired(hub);
      } catch (err) {
        this.#hubFailed(hub, err);
      } finally {
        hub.reading = null;
      }
    })();
    return hub.reading;
  }

  /** The ids of the shades of a hub the user added to Gladys. */
  #createdShades(hub) {
    const ids = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseExternalId(device.external_id);
      if (parsed?.type === DEVICE_TYPE.SHADE && parsed.hubSerial === hub.serial) {
        ids.push(parsed.id);
      }
    }
    return ids;
  }

  async #publishShades(hub, ids = this.#createdShades(hub)) {
    const states = [];
    for (const id of ids) {
      const raw = hub.shades.get(id);
      if (!raw) {
        continue;
      }
      const move = hub.moves.get(id);
      // While a move runs, the hub's answer lags behind: the target stays shown.
      states.push(...shadeStates(this.gladys, hub, raw, move ? { positions: move.positions } : {}));
    }
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    }
  }

  /** Ask one mains-powered shade its real position, the least recently asked. */
  async #radioRefreshOneHardwired(hub) {
    const now = this.now();
    const due = this.#createdShades(hub)
      .filter((id) => hub.shades.has(id) && !hub.moves.has(id))
      .filter((id) => isHardwired(hub.shades.get(id), hub.apiVersion))
      .filter((id) => now - (hub.radioRefreshedAt.get(id) ?? 0) >= RADIO_REFRESH_MS)
      .sort((a, b) => (hub.radioRefreshedAt.get(a) ?? 0) - (hub.radioRefreshedAt.get(b) ?? 0));
    if (due.length > 0) {
      await this.#radioRefresh(hub, due[0]);
    }
  }

  /** Ask a shade its position over the radio, then publish it. Never throws. */
  async #radioRefresh(hub, shadeId) {
    hub.radioRefreshedAt.set(shadeId, this.now());
    try {
      const raw = await this.#radio(hub, () => this.client.refreshShade(hub, shadeId));
      // A battery shade asleep answers late or not at all: nothing to read then.
      if (validEntry(raw) && !raw.timedOut) {
        hub.shades.set(shadeId, { ...hub.shades.get(shadeId), ...raw });
      }
    } catch (err) {
      logger.debug(`${hub.serial}: shade ${shadeId} did not answer (${err.message})`);
    }
    await this.#publishShades(hub, [shadeId]).catch((err) =>
      logger.debug(`Publishing shade ${shadeId} failed (${err.message})`),
    );
  }

  /** The core's onPoll (fallback): reads the hub unless the timer just did. */
  async pollFromCore(device) {
    const hub = this.#hubOfDevice(device.external_id);
    if (!hub) {
      logger.debug(`onPoll ignored for ${device.external_id}`);
      return;
    }
    await this.readHub(hub, { minGap: 0.9 });
  }

  /** A device was just added to Gladys: send its states now. */
  async onDeviceCreated(device) {
    const parsed = parseExternalId(device.external_id);
    const hub = parsed ? this.hubs.get(parsed.hubSerial) : null;
    if (!hub || parsed.type !== DEVICE_TYPE.SHADE) {
      return;
    }
    await this.readHub(hub, { force: true });
    // A hub read just before (a poll in progress) has not published the new
    // device: the SDK forgot its states when it was created.
    await this.#publishShades(hub, [parsed.id]).catch(() => {});
  }

  // --- Commands ---------------------------------------------------------------

  /** onSetValue: move, stop, tilt a shade, or run a scene. */
  async setValue(device, feature, value) {
    const parsed = parseExternalId(device.external_id);
    if (parsed?.type === DEVICE_TYPE.SCENE) {
      await this.activateScene(device.external_id);
      return;
    }
    const { hub, raw } = await this.#shade(device.external_id);
    const featureKey = String(feature.external_id).split(':').pop();
    const name = entryName(raw) || raw.id;
    const move = hub.moves.get(raw.id);
    const order = commandToMove(raw, hub.apiVersion, featureKey, value, move?.positions);
    if (order.stop) {
      if (hub.apiVersion < 2) {
        throw new Error(TEXT.noStop.en);
      }
      logger.info(`Shade "${name}": stop`);
      await this.#radio(hub, () => this.client.stopShade(hub, raw.id));
      this.#endMove(hub, raw.id);
      this.#later(STOP_SETTLE_MS, () => this.#radioRefresh(hub, raw.id));
      return;
    }
    logger.info(`Shade "${name}": ${featureKey} ${value}`);
    await this.#radio(hub, () =>
      this.client.moveShade(hub, raw.id, moveBody(raw, hub.apiVersion, order.target)),
    );
    // Show the target at once, and ask the shade once it should have arrived.
    const positions = {
      ...(move?.positions ?? readPositions(raw, hub.apiVersion)),
      ...order.target,
    };
    this.#endMove(hub, raw.id);
    const handle = this.#later(MOVE_MARGIN_MS + (FULL_COURSE_MS * order.steps) / 100, async () => {
      if (hub.moves.get(raw.id)?.handle === handle) {
        hub.moves.delete(raw.id);
        await this.#radioRefresh(hub, raw.id);
      }
    });
    hub.moves.set(raw.id, { positions, handle });
    await this.#publishShades(hub, [raw.id]);
  }

  /** Make a shade jog, for the "Identify a shade" action. */
  async identify(externalId) {
    const parsed = parseExternalId(externalId);
    if (parsed?.type !== DEVICE_TYPE.SHADE) {
      return TEXT.notAShade;
    }
    const { hub, raw } = await this.#shade(externalId);
    logger.info(`Shade "${entryName(raw) || raw.id}": jog`);
    await this.#radio(hub, () => this.client.jogShade(hub, raw.id));
    return TEXT.jogged;
  }

  /**
   * Run a PowerView scene. Resolves the number of shades the hub moves.
   * @param {string} externalId the scene device external_id
   */
  async activateScene(externalId) {
    const parsed = parseExternalId(externalId);
    if (parsed?.type !== DEVICE_TYPE.SCENE) {
      throw new Error(TEXT.notAScene.en);
    }
    const hub = this.hubs.get(parsed.hubSerial);
    if (!hub) {
      throw new Error(TEXT.hubUnreachable.en);
    }
    const scene = hub.scenes.get(parsed.id);
    if (!scene) {
      throw new Error(TEXT.unknownScene.en);
    }
    logger.info(`Scene "${entryName(scene) || scene.id}": run`);
    const shadeIds = await this.#radio(hub, () => this.client.activateScene(hub, scene.id));
    // The shades move for a while: read their hub once they have arrived.
    this.#later(SCENE_SETTLE_MS, () => this.readHub(hub, { force: true }));
    return shadeIds.length;
  }

  /** The hub and the entry of a shade device; throws a clear error otherwise. */
  async #shade(externalId) {
    const parsed = parseExternalId(externalId);
    if (parsed?.type !== DEVICE_TYPE.SHADE) {
      throw new Error(TEXT.notAShade.en);
    }
    const hub = this.hubs.get(parsed.hubSerial);
    if (!hub) {
      throw new Error(TEXT.hubUnreachable.en);
    }
    if (!hub.shades.has(parsed.id)) {
      // A shade paired since the last read: read the hub once.
      await this.readHub(hub, { force: true });
    }
    const raw = hub.shades.get(parsed.id);
    if (!raw) {
      throw new Error(hub.failingSince !== null ? TEXT.hubUnreachable.en : TEXT.unknownShade.en);
    }
    return { hub, raw };
  }

  #hubOfDevice(externalId) {
    const parsed = parseExternalId(externalId);
    return parsed ? (this.hubs.get(parsed.hubSerial) ?? null) : null;
  }

  /** Queue a radio operation on the hub: one at a time. */
  #radio(hub, operation) {
    const run = hub.radio.then(operation);
    hub.radio = run.catch(() => {});
    return run;
  }

  #endMove(hub, shadeId) {
    const move = hub.moves.get(shadeId);
    if (move) {
      this.timers.clear(move.handle);
      this.pending.delete(move.handle);
      hub.moves.delete(shadeId);
    }
  }

  /** Run `task` once, `ms` from now, unless the integration stops first. */
  #later(ms, task) {
    const handle = this.timers.set(async () => {
      this.pending.delete(handle);
      if (this.stopped) {
        return;
      }
      try {
        await task();
      } catch (err) {
        logger.debug(`Deferred task failed (${err.message})`);
      }
    }, ms);
    this.pending.add(handle);
    return handle;
  }

  // --- Health -----------------------------------------------------------------

  #hubAnswered(hub) {
    hub.failingSince = null;
    this.issues.ok(hub.serial, `PowerView hub "${hub.name || hub.serial}" answers again`);
  }

  #hubFailed(hub, err) {
    if (isMaintenance(err)) {
      // The nightly reboot of a Gen 2 hub: expected, and over in minutes.
      logger.debug(`${hub.serial}: ${err.message}`);
      return;
    }
    hub.failingSince ??= this.now();
    this.issues.fail(hub.serial, `PowerView hub "${hub.name || hub.serial}": ${err.message}`);
  }

  /** The connection status of the Configuration screen, sent on change only. */
  async #updateStatus() {
    let status;
    if (this.hubs.size === 0) {
      status = { connected: false, message: TEXT.noHub };
    } else if ([...this.hubs.values()].every((hub) => hub.failingSince !== null)) {
      status = { connected: false, message: TEXT.hubsUnreachable };
    } else {
      status = { connected: true };
    }
    const key = JSON.stringify(status);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(status.connected, status.message)
      .catch((err) => logger.debug(`Connection status not sent (${err.message})`));
  }

  // --- Persistence ------------------------------------------------------------

  #hubFromRecord(serial, record) {
    return {
      serial,
      host: record.host,
      apiVersion: Number(record.apiVersion) || 2,
      generation: Number(record.generation) || Number(record.apiVersion) || 2,
      name: typeof record.name === 'string' ? record.name : '',
      firmware: typeof record.firmware === 'string' ? record.firmware : '',
      shades: new Map((record.shades ?? []).filter(validEntry).map((raw) => [raw.id, raw])),
      scenes: new Map((record.scenes ?? []).filter(validEntry).map((raw) => [raw.id, raw])),
      rooms: new Map(Object.entries(record.rooms ?? {}).map(([id, name]) => [Number(id), name])),
      lastReadAt: null,
      failingSince: null,
      reading: null,
      radio: Promise.resolve(),
      radioRefreshedAt: new Map(),
      moves: new Map(),
    };
  }

  #save() {
    const hubs = {};
    for (const hub of this.hubs.values()) {
      hubs[hub.serial] = {
        host: hub.host,
        apiVersion: hub.apiVersion,
        generation: hub.generation,
        name: hub.name,
        firmware: hub.firmware,
        shades: [...hub.shades.values()],
        scenes: [...hub.scenes.values()],
        rooms: Object.fromEntries(hub.rooms),
      };
    }
    this.store.save({ version: 1, hubs });
  }
}

/** A hub entry with a numeric id: a shade, a scene or a room. */
function validEntry(raw) {
  return Boolean(raw) && typeof raw === 'object' && Number.isInteger(raw.id);
}

/** The report of the "Search for hubs" action, in every language. */
export function searchMessage(summary) {
  return localize(SEARCH_TEXT, (text) => {
    const lines = [];
    if (summary.hubs.length === 0) {
      lines.push(text.none);
    }
    for (const hub of summary.hubs) {
      lines.push(hub.reachable ? text.hub(hub) : text.unreachable(hub.host));
    }
    for (const host of summary.secondaries) {
      lines.push(text.secondary(host));
    }
    for (const host of summary.unreachable) {
      if (!summary.hubs.some((hub) => hub.host === host)) {
        lines.push(text.unreachable(host));
      }
    }
    if (summary.mdns === 'unavailable') {
      lines.push(text.noMdns);
    }
    if (summary.invalidHosts.length > 0) {
      lines.push(text.ignored(summary.invalidHosts.join(', ')));
    }
    if (summary.hubs.some((hub) => hub.reachable)) {
      lines.push(text.next);
    }
    return lines.join(' ');
  });
}
