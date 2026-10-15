// -----------------------------------------------------------------------------
// From PowerView entries to Gladys devices, states and moves.
//
// One device per shade, with the shutter features of the core (the curtain
// ones for the shades that move sideways):
//   - `state` (shutter/state): open, close, stop — the core's buttons send
//     1, -1 and 0 (COVER_STATE). Published as 1 when the shade is open (even
//     partly), -1 when it is closed;
//   - `position` (shutter/position, 0 = closed, 100 = open): the main rail;
//     the bottom rail of a top-down/bottom-up shade, the combined position of
//     a dual shade (0-50 the rear blackout, 51-100 the front sheer, as Home
//     Assistant does);
//   - `top_position`: the top rail of a top-down/bottom-up shade;
//   - `front_position`, `rear_position`: each fabric of a dual shade;
//   - `tilt`: the slats, a second shutter/position feature (the core has no
//     tilt feature); for 180° slats, 50 is open and 0 or 100 closed;
//   - `battery` (battery/integer, %) and `battery_low` (battery-low/binary,
//     20 % or less), for the shades on batteries.
// And one device per PowerView scene, with a push button that runs it.
//
// External ids: `shade:<hub serial>-<shade id>` and `scene:<hub
// serial>-<scene id>`, the ids the hub gives. They never change: the feature
// keys above are forever too.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES } from './i18n.js';
import {
  SHADE_KINDS,
  battery,
  entryName,
  openClosePositions,
  readPositions,
  shadeKind,
} from './powerview/shade.js';

export const DEVICE_TYPE = { SHADE: 'shade', SCENE: 'scene' };

export const FEATURE = {
  STATE: 'state',
  POSITION: 'position',
  TOP_POSITION: 'top_position',
  FRONT_POSITION: 'front_position',
  REAR_POSITION: 'rear_position',
  TILT: 'tilt',
  BATTERY: 'battery',
  BATTERY_LOW: 'battery_low',
  ACTIVATE: 'activate',
};

// The core's COVER_STATE: the values of the open / stop / close buttons.
export const COVER_STATE = { OPEN: 1, STOP: 0, CLOSE: -1 };

// 20 % or less: the lowest step a Gen 3 hub reports before "empty".
export const BATTERY_LOW_PERCENT = 20;

// The core polls the shades once a minute, as a fallback of the container's
// own timer (src/hub.js): GladysAssistant/Gladys#3198.
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

/** The platform id of a shade or scene: unique across the hubs. */
export const platformId = (hubSerial, id) => `${hubSerial}-${id}`;

/**
 * `{ type, hubSerial, id }` from a device external_id of this integration,
 * null for anything else.
 */
export function parseExternalId(externalId) {
  const match = /:(shade|scene):([0-9A-Za-z]+)-(\d+)$/.exec(String(externalId ?? ''));
  return match ? { type: match[1], hubSerial: match[2], id: Number(match[3]) } : null;
}

/** Which Gladys features a shade gets, by key, in order. */
export function shadeFeatureKeys(raw, apiVersion) {
  const kind = SHADE_KINDS[shadeKind(raw)];
  const keys = [FEATURE.STATE];
  if (kind.layout !== 'tilt_only') {
    keys.push(FEATURE.POSITION);
  }
  if (kind.layout === 'two_rails') {
    keys.push(FEATURE.TOP_POSITION);
  }
  if (kind.layout === 'dual') {
    keys.push(FEATURE.FRONT_POSITION, FEATURE.REAR_POSITION);
  }
  if (kind.tilt) {
    keys.push(FEATURE.TILT);
  }
  if (battery(raw, apiVersion).powered) {
    keys.push(FEATURE.BATTERY, FEATURE.BATTERY_LOW);
  }
  return keys;
}

function featureName(key, layout, names) {
  if (key === FEATURE.POSITION && layout === 'two_rails') {
    return names.bottomPosition;
  }
  if (key === FEATURE.POSITION && layout === 'dual') {
    return names.combinedPosition;
  }
  return {
    [FEATURE.STATE]: names.state,
    [FEATURE.POSITION]: names.position,
    [FEATURE.TOP_POSITION]: names.topPosition,
    [FEATURE.FRONT_POSITION]: names.frontPosition,
    [FEATURE.REAR_POSITION]: names.rearPosition,
    [FEATURE.TILT]: names.tilt,
    [FEATURE.BATTERY]: names.battery,
    [FEATURE.BATTERY_LOW]: names.batteryLow,
  }[key];
}

/**
 * The discovery payload of a shade.
 * @param {object} gladys GladysIntegration
 * @param {object} hub `{ serial, apiVersion }`
 * @param {object} raw the shade entry of the hub
 * @param {object} options
 * @param {string} options.language
 * @param {string} [options.name] the device name (a unique one, see uniqueNames)
 * @param {string} [options.room]
 */
export function buildShadeDevice(gladys, hub, raw, { language, name, room }) {
  const names = NAMES[language] ?? NAMES.fr;
  const kindKey = shadeKind(raw);
  const kind = SHADE_KINDS[kindKey];
  const ids = gladys.externalIds(DEVICE_TYPE.SHADE, platformId(hub.serial, raw.id));
  const category = kind.vertical ? CATEGORIES.CURTAIN : CATEGORIES.SHUTTER;
  const features = shadeFeatureKeys(raw, hub.apiVersion).map((key) => {
    const base = {
      name: featureName(key, kind.layout, names),
      external_id: ids.feature(key),
      read_only: false,
      has_feedback: true,
      keep_history: true,
    };
    switch (key) {
      case FEATURE.STATE:
        return {
          ...base,
          category,
          type: TYPES.SHUTTER.STATE,
          min: COVER_STATE.CLOSE,
          max: COVER_STATE.OPEN,
          keep_history: false,
        };
      case FEATURE.BATTERY:
        return {
          ...base,
          category: CATEGORIES.BATTERY,
          type: TYPES.BATTERY.INTEGER,
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
          read_only: true,
          has_feedback: false,
        };
      case FEATURE.BATTERY_LOW:
        return {
          ...base,
          category: CATEGORIES.BATTERY_LOW,
          type: TYPES.BATTERY_LOW.BINARY,
          min: 0,
          max: 1,
          read_only: true,
          has_feedback: false,
        };
      default:
        // Every position: a percentage, open at 100.
        return {
          ...base,
          category,
          type: TYPES.SHUTTER.POSITION,
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
        };
    }
  });
  const params = [
    { name: 'HUB_SERIAL', value: hub.serial },
    { name: 'SHADE_ID', value: String(raw.id) },
    { name: 'SHADE_TYPE', value: String(raw.type ?? '') },
    { name: 'SHADE_KIND', value: kindKey },
  ];
  if (room) {
    params.push({ name: 'ROOM', value: room });
  }
  return {
    name: name || entryName(raw) || `${names.shade} ${raw.id}`,
    external_id: ids.device,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    features,
    params,
  };
}

/** The discovery payload of a PowerView scene: a push button. */
export function buildSceneDevice(gladys, hub, raw, { language }) {
  const names = NAMES[language] ?? NAMES.fr;
  const ids = gladys.externalIds(DEVICE_TYPE.SCENE, platformId(hub.serial, raw.id));
  const sceneName = entryName(raw) || String(raw.id);
  return {
    name: `${sceneName} (${names.scene})`,
    external_id: ids.device,
    should_poll: false,
    features: [
      {
        name: names.activate,
        external_id: ids.feature(FEATURE.ACTIVATE),
        category: CATEGORIES.BUTTON,
        type: TYPES.BUTTON.PUSH,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
    ],
    params: [
      { name: 'HUB_SERIAL', value: hub.serial },
      { name: 'SCENE_ID', value: String(raw.id) },
    ],
  };
}

/**
 * Device names unique across the shades: the hub name of a shade, followed by
 * its room when two shades share a name ("Left", "Left").
 * @param {Array<{ key: string, name: string, room: string }>} entries
 * @returns {Map<string, string>} key → name
 */
export function uniqueNames(entries) {
  const count = new Map();
  for (const { name } of entries) {
    count.set(name, (count.get(name) ?? 0) + 1);
  }
  return new Map(
    entries.map(({ key, name, room }) => [
      key,
      count.get(name) > 1 && room ? `${name} (${room})` : name,
    ]),
  );
}

/** Whether a shade is closed, from its positions (Home Assistant's is_closed). */
function isClosed(kind, positions) {
  switch (SHADE_KINDS[kind].layout) {
    case 'tilt_only':
      return positions.tilt <= 0;
    case 'two_rails':
      return positions.primary <= 0 && positions.secondary <= 0;
    case 'dual':
      return positions.secondary <= 0;
    default:
      return SHADE_KINDS[kind].inverted ? positions.primary >= 100 : positions.primary <= 0;
  }
}

/** The combined position of a dual shade: 0-50 the rear, 51-100 the front. */
function combinedPosition(positions) {
  if (positions.primary === 0) {
    return Math.ceil(positions.secondary / 2);
  }
  return Math.ceil(positions.primary / 2 + 50);
}

/**
 * The Gladys value of every position feature of a shade, from its hub
 * entry: `{ [featureKey]: value }`, empty when the hub does not know the
 * positions yet.
 */
export function shadeValues(raw, apiVersion, positions = readPositions(raw, apiVersion)) {
  const kindKey = shadeKind(raw);
  const kind = SHADE_KINDS[kindKey];
  const values = {};
  const known = kind.layout === 'tilt_only' ? positions.tilt !== null : positions.primary !== null;
  if (known) {
    values[FEATURE.STATE] = isClosed(kindKey, positions) ? COVER_STATE.CLOSE : COVER_STATE.OPEN;
    switch (kind.layout) {
      case 'two_rails':
        values[FEATURE.POSITION] = positions.primary;
        values[FEATURE.TOP_POSITION] = positions.secondary;
        break;
      case 'dual':
        values[FEATURE.POSITION] = combinedPosition(positions);
        values[FEATURE.FRONT_POSITION] = positions.primary;
        values[FEATURE.REAR_POSITION] = positions.secondary;
        break;
      case 'tilt_only':
        break;
      default:
        values[FEATURE.POSITION] = kind.inverted ? 100 - positions.primary : positions.primary;
    }
    if (kind.tilt && positions.tilt !== null) {
      values[FEATURE.TILT] = positions.tilt;
    }
  }
  const { powered, percent } = battery(raw, apiVersion);
  if (powered && percent !== null) {
    values[FEATURE.BATTERY] = percent;
    values[FEATURE.BATTERY_LOW] = percent <= BATTERY_LOW_PERCENT ? 1 : 0;
  }
  return values;
}

/**
 * The states of a shade, in the publishStates format.
 * @param {object} gladys
 * @param {object} hub `{ serial, apiVersion }`
 * @param {object} raw the shade entry of the hub
 * @param {object} [options]
 * @param {object} [options.positions] positions to show instead of the hub's
 *   (the target of a move in progress)
 * @param {boolean} [options.skipPositions] battery only (a move in progress)
 */
export function shadeStates(gladys, hub, raw, { positions, skipPositions = false } = {}) {
  const ids = gladys.externalIds(DEVICE_TYPE.SHADE, platformId(hub.serial, raw.id));
  const keys = new Set(shadeFeatureKeys(raw, hub.apiVersion));
  const values = positions
    ? shadeValues(raw, hub.apiVersion, positions)
    : shadeValues(raw, hub.apiVersion);
  return Object.entries(values)
    .filter(([key]) => keys.has(key))
    .filter(([key]) => !skipPositions || key === FEATURE.BATTERY || key === FEATURE.BATTERY_LOW)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}

const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * The target positions (percent) of a command on a feature, or `{ stop:
 * true }`. Follows Home Assistant: moving one rail keeps the other where it
 * is, and a rail never crosses the other one.
 * @param {object} raw the shade entry of the hub (current positions)
 * @param {number} apiVersion
 * @param {string} featureKey
 * @param {number} value the value Gladys sent
 * @param {object} [current] the current positions (percent), when a move in
 *   progress makes them differ from the hub's
 * @returns {{ stop: true } | { target: object, steps: number }}
 *   `steps`: how far the motor goes, in percent, to estimate the move time
 */
export function commandToMove(
  raw,
  apiVersion,
  featureKey,
  value,
  current = readPositions(raw, apiVersion),
) {
  const kind = SHADE_KINDS[shadeKind(raw)];
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid value ${value}`);
  }
  if (featureKey === FEATURE.STATE) {
    if (number === COVER_STATE.STOP) {
      return { stop: true };
    }
    const { open, close } = openClosePositions(raw, apiVersion);
    const target = number > 0 ? open : close;
    return { target, steps: distance(current, target) };
  }
  const percent = clampPercent(number);
  let target;
  switch (featureKey) {
    case FEATURE.POSITION:
      if (kind.layout === 'two_rails') {
        target = {
          primary: Math.min(percent, 100 - (current.secondary ?? 0)),
          secondary: current.secondary ?? 0,
        };
      } else if (kind.layout === 'dual') {
        target = percent <= 50 ? { secondary: percent * 2 } : { primary: (percent - 50) * 2 };
      } else if (kind.inverted) {
        target = { primary: 100 - percent };
      } else if (kind.tiltAnywhere) {
        target = { primary: percent, tilt: current.tilt ?? 0 };
      } else {
        target = { primary: percent };
      }
      break;
    case FEATURE.TOP_POSITION:
      target = {
        primary: current.primary ?? 0,
        secondary: Math.min(percent, 100 - (current.primary ?? 0)),
      };
      break;
    case FEATURE.FRONT_POSITION:
      target = { primary: percent };
      break;
    case FEATURE.REAR_POSITION:
      target = { secondary: percent };
      break;
    case FEATURE.TILT:
      target = kind.tiltAnywhere
        ? { primary: current.primary ?? 0, tilt: percent }
        : { tilt: percent };
      break;
    default:
      throw new Error(`The ${featureKey} feature cannot be set`);
  }
  if (!kind.tilt && target.tilt !== undefined) {
    delete target.tilt;
  }
  return { target, steps: distance(current, target) };
}

function distance(current, target) {
  let steps = 0;
  for (const position of ['primary', 'secondary', 'tilt']) {
    if (target[position] !== undefined) {
      steps += Math.abs(target[position] - (current[position] ?? 0));
    }
  }
  return Math.min(100, steps);
}
