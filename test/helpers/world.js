// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, simulated PowerView hubs, a
// temporary /data, a manual clock and manual timers, and the integration
// wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { createHub, createNetwork } from './fakeHub.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

/**
 * Timers run by hand: `advance(ms)` moves the clock and runs what is due,
 * in order, waiting for each callback.
 */
export function createClock(start = Date.UTC(2026, 9, 15, 8, 0, 0)) {
  let now = start;
  let nextId = 1;
  const due = new Map();
  const clock = {
    now: () => now,
    timers: {
      set(callback, ms) {
        const id = nextId;
        nextId += 1;
        due.set(id, { at: now + ms, callback });
        return id;
      },
      clear(id) {
        due.delete(id);
      },
    },
    /** The delays of the timers waiting, from now. */
    pending() {
      return [...due.values()].map((timer) => timer.at - now).sort((a, b) => a - b);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) {
          break;
        }
        const [id, timer] = next;
        due.delete(id);
        now = Math.max(now, timer.at);
        await timer.callback();
      }
      now = end;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Array} [options.hubs] from createHub (default: one Gen 2 and one Gen 3 hub)
 * @param {object} [options.config] raw integration config
 * @param {boolean} [options.mdns] the core relays the mDNS announcements
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 */
export async function createWorld({
  hubs = [
    createHub({ generation: 2, host: '192.0.2.10' }),
    createHub({ generation: 3, host: '192.0.2.20' }),
  ],
  config = {},
  mdns = true,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-powerview-')),
  clock = createClock(),
} = {}) {
  const network = createNetwork(hubs);
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults: { mdns: mdns ? network.mdnsResults() : [] },
  });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: network.fetch,
    timers: clock.timers,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, network, app, hub: app.hub, clock, store, dataDir };
}

/** External id of the device of a simulated shade. */
export const shadeId = (gladys, hub, id) =>
  gladys.externalIds('shade', `${hub.serial}-${id}`).device;

/** External id of the device of a simulated scene. */
export const sceneId = (gladys, hub, id) =>
  gladys.externalIds('scene', `${hub.serial}-${id}`).device;

/** The discovered device with this external id. */
export const discovered = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((device) => device.external_id === externalId);

/** Create devices in Gladys, as the user would from the Discovery tab. */
export async function create(world, externalIds) {
  for (const externalId of externalIds) {
    const device = discovered(world.gladys, externalId);
    if (!device) {
      throw new Error(`${externalId} was not discovered`);
    }
    await world.gladys.fake.deviceCreated(device);
  }
}

/** Create every discovered device. */
export async function createAll(world) {
  await create(
    world,
    world.gladys.fake.discoveredDevices.map((device) => device.external_id),
  );
}

/** The feature of a discovered device, by key. */
export function featureOf(gladys, deviceExternalId, key) {
  return discovered(gladys, deviceExternalId).features.find(
    (feature) => feature.external_id === `${deviceExternalId}:${key}`,
  );
}
