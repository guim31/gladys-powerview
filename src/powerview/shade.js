// -----------------------------------------------------------------------------
// The PowerView shade model: which kind of shade a hub entry is, and how its
// positions read and write, for every hub generation.
//
// Ported from aiopvapi (sander76/aio-powerview-api, BSD 3-Clause), the library
// of the Home Assistant `hunterdouglas_powerview` integration: the type and
// capability tables, the position conversions and their quirks
// (aiopvapi/resources/shade.py), and the way Home Assistant drives the
// two-rail and dual shades (homeassistant/components/hunterdouglas_powerview/
// cover.py, Apache 2.0).
//
// Positions are percentages everywhere in this module: 0 = closed, 100 =
// open, as Gladys expects (its shutter position is an "open percent"). The
// hubs speak another scale:
//   - Generation 1 and 2 (`/api`): integers 0..65535, in up to two slots
//     (`posKind1`/`position1`, `posKind2`/`position2`), the kind telling
//     which rail the slot holds (1 = primary, 2 = secondary, 3 = tilt);
//   - Generation 3 (`/home`): fractions 0..1 under named keys
//     (`primary`, `secondary`, `tilt`, `velocity`).
// -----------------------------------------------------------------------------

export const MAX_RAW_V2 = 65535;

// A Generation 2 shade reporting less than this percentage (but not 0) is
// closed: Duette shades stop a few units above 0 (aiopvapi CLOSED_POSITION_V2).
const CLOSED_THRESHOLD_V2 = 0.75;

const POSKIND = { primary: 1, secondary: 2, tilt: 3 };
const POSKIND_NAMES = { 1: 'primary', 2: 'secondary', 3: 'tilt' };

/**
 * The kinds of shade, keyed like the aiopvapi classes they come from. Each
 * one says which positions the shade has:
 *   - `primary`: the main rail (bottom rail, or the front sheer of a dual shade);
 *   - `secondary`: the top rail of a top-down/bottom-up shade, or the rear
 *     blackout of a dual shade;
 *   - `tilt`: the slats (vanes), with `tilt90` when they only turn 90°
 *     (the Generation 1 and 2 hubs then use half of the raw range);
 *   - `vertical`: the shade moves sideways (curtain, vertical slats);
 *   - `layout`: how the Gladys features map to the rails (see src/devices.js).
 */
export const SHADE_KINDS = {
  bottom_up: { capability: 0, primary: true, layout: 'single' },
  tilt_on_closed_90: { capability: 1, primary: true, tilt: true, tilt90: true, layout: 'single' },
  // Type 44 (Twist) reports capability 0 but tilts 180° when closed: aiopvapi
  // matches it on its type only.
  tilt_on_closed_180: { capability: 1, primary: true, tilt: true, layout: 'single' },
  tilt_anywhere: { capability: 2, primary: true, tilt: true, tiltAnywhere: true, layout: 'single' },
  vertical: { capability: 3, primary: true, vertical: true, layout: 'single' },
  vertical_tilt_anywhere: {
    capability: 4,
    primary: true,
    tilt: true,
    tiltAnywhere: true,
    vertical: true,
    layout: 'single',
  },
  tilt_only: { capability: 5, tilt: true, layout: 'tilt_only' },
  top_down: { capability: 6, primary: true, inverted: true, layout: 'single' },
  top_down_bottom_up: { capability: 7, primary: true, secondary: true, layout: 'two_rails' },
  dual_overlapped: { capability: 8, primary: true, secondary: true, layout: 'dual' },
  dual_overlapped_tilt_90: {
    capability: 9,
    primary: true,
    secondary: true,
    tilt: true,
    tilt90: true,
    layout: 'dual',
  },
  dual_overlapped_tilt_180: {
    capability: 10,
    primary: true,
    secondary: true,
    tilt: true,
    layout: 'dual',
  },
  // The embedded light of the Aura shades is not driven (aiopvapi does not
  // either): the shade part works like a dual shade.
  dual_overlapped_illuminated: { capability: 11, primary: true, secondary: true, layout: 'dual' },
};

// Shade type → kind, from the `shade_types` of the aiopvapi classes. The
// type wins over the capability the hub reports (type 44 above).
const TYPE_KINDS = {
  bottom_up: [1, 4, 5, 6, 10, 19, 31, 32, 42, 49, 52, 53, 57, 84],
  tilt_on_closed_90: [18, 23, 43, 72],
  tilt_on_closed_180: [44],
  tilt_anywhere: [51, 62],
  vertical: [26, 27, 28, 69, 70, 71],
  vertical_tilt_anywhere: [54, 55, 56],
  tilt_only: [40, 66],
  top_down: [7],
  top_down_bottom_up: [8, 9, 33, 47],
  dual_overlapped: [65, 79],
  dual_overlapped_tilt_90: [38],
  dual_overlapped_illuminated: [95],
};

const KIND_BY_TYPE = new Map(
  Object.entries(TYPE_KINDS).flatMap(([kind, types]) => types.map((type) => [type, kind])),
);

// Capability → kind, for the types the tables above do not know yet (a new
// shade model): the capability says what it can do. Capability 1 is the 90°
// tilt, the only shades of that capability with a type known.
const KIND_BY_CAPABILITY = new Map(
  Object.entries(SHADE_KINDS)
    .filter(([kind]) => kind !== 'tilt_on_closed_180')
    .map(([kind, { capability }]) => [capability, kind]),
);

/**
 * The kind of a shade entry of the hub: by type, else by capability, else a
 * plain bottom-up shade (what aiopvapi falls back to).
 * @param {{ type?: number, capabilities?: number }} raw
 * @returns {string} a key of SHADE_KINDS
 */
export function shadeKind(raw) {
  return KIND_BY_TYPE.get(raw?.type) ?? KIND_BY_CAPABILITY.get(raw?.capabilities) ?? 'bottom_up';
}

/** The share of the raw range that 100 % stands for, per position. */
function maxPercent(kind, apiVersion, position) {
  if (position === 'tilt' && SHADE_KINDS[kind].tilt90 && apiVersion < 3) {
    // A 90° tilt is the first half of the Generation 1-2 range (32767 = 90°).
    return 50;
  }
  return 100;
}

const clampPercent = (value) => Math.min(100, Math.max(0, value));

/** One raw hub value → a percentage (aiopvapi api_to_percent). */
function rawToPercent(value, kind, apiVersion, position) {
  const scale = maxPercent(kind, apiVersion, position) / 100;
  const full = apiVersion >= 3 ? scale : MAX_RAW_V2 * scale;
  let percent = (Number(value) / full) * 100;
  if (!Number.isFinite(percent)) {
    return null;
  }
  if (apiVersion < 3 && percent !== 0 && percent < CLOSED_THRESHOLD_V2) {
    percent = 0;
  }
  return Math.round(clampPercent(percent));
}

/** One percentage → a raw hub value (aiopvapi percent_to_api). */
function percentToRaw(percent, kind, apiVersion, position) {
  const scale = maxPercent(kind, apiVersion, position) / 100;
  const value = clampPercent(percent);
  if (apiVersion >= 3) {
    return Math.round((value / 100) * scale * 100) / 100;
  }
  return Math.trunc((value / 100) * scale * MAX_RAW_V2);
}

/**
 * The positions of a shade entry, in percent, completed the way aiopvapi
 * does (`get_additional_positions`): the rail the hub left out of its answer
 * is at rest. A position the shade does not have is null; all of them are
 * null when the hub knows nothing yet (a shade just paired, an Aura shade).
 * @param {object} raw the shade entry of the hub
 * @param {number} apiVersion 1, 2 or 3
 * @returns {{ primary: number|null, secondary: number|null, tilt: number|null }}
 */
export function readPositions(raw, apiVersion) {
  const kind = shadeKind(raw);
  const found = { primary: null, secondary: null, tilt: null };
  const positions = raw?.positions;
  if (!positions || typeof positions !== 'object') {
    return found;
  }
  if (apiVersion >= 3) {
    for (const position of ['primary', 'secondary', 'tilt']) {
      const value = positions[position];
      if (value !== null && value !== undefined) {
        found[position] = rawToPercent(value, kind, apiVersion, position);
      }
    }
  } else {
    for (const slot of [1, 2]) {
      const position = POSKIND_NAMES[positions[`posKind${slot}`]];
      const value = positions[`position${slot}`];
      if (position && value !== null && value !== undefined) {
        found[position] = rawToPercent(value, kind, apiVersion, position);
      }
    }
  }
  return complete(kind, found);
}

function complete(kind, found) {
  const known = (value) => value !== null;
  const { primary, secondary, tilt } = found;
  if (!known(primary) && !known(secondary) && !known(tilt)) {
    return found;
  }
  switch (SHADE_KINDS[kind].layout) {
    case 'tilt_only':
      // The hubs report the slats of these shades as the primary rail
      // (home-assistant/core#115257): aiopvapi reads them from there.
      return { primary: null, secondary: null, tilt: known(primary) ? primary : tilt };
    case 'two_rails':
      return { primary: primary ?? 0, secondary: secondary ?? 0, tilt: null };
    case 'dual': {
      // Front sheer (primary) and rear blackout (secondary) share one motor:
      // the front only opens once the rear is fully up.
      const hasTilt = SHADE_KINDS[kind].tilt;
      if (known(primary)) {
        return { primary, secondary: secondary ?? 100, tilt: hasTilt ? (tilt ?? 0) : null };
      }
      if (known(secondary)) {
        return { primary: 0, secondary, tilt: hasTilt ? (tilt ?? 0) : null };
      }
      return { primary: 0, secondary: 100, tilt: hasTilt ? tilt : null };
    }
    default: {
      if (!SHADE_KINDS[kind].tilt) {
        return { primary: primary ?? 0, secondary: null, tilt: null };
      }
      return { primary: primary ?? 0, secondary: null, tilt: tilt ?? 0 };
    }
  }
}

/**
 * The request body that moves a shade to the given positions (percent).
 * Only the positions given are sent: the others keep moving with the motor
 * logic of the shade.
 * @param {object} raw the shade entry of the hub (its id and type)
 * @param {number} apiVersion
 * @param {{ primary?: number, secondary?: number, tilt?: number }} target
 */
export function moveBody(raw, apiVersion, target) {
  const kind = shadeKind(raw);
  const given = (position) => target[position] !== undefined && target[position] !== null;
  if (apiVersion >= 3) {
    const positions = {};
    for (const position of ['primary', 'secondary', 'tilt']) {
      if (given(position)) {
        positions[position] = percentToRaw(target[position], kind, apiVersion, position);
      }
    }
    return { positions };
  }
  // Generation 1-2: two slots at most. The primary rail always takes the
  // first; a lone secondary or tilt takes it otherwise (aiopvapi
  // structured_to_raw).
  const slots = [];
  for (const position of ['primary', 'secondary', 'tilt']) {
    if (given(position) && slots.length < 2) {
      slots.push(position);
    }
  }
  const positions = {};
  slots.forEach((position, index) => {
    positions[`posKind${index + 1}`] = POSKIND[position];
    positions[`position${index + 1}`] = percentToRaw(target[position], kind, apiVersion, position);
  });
  return { shade: { id: raw.id, positions } };
}

/**
 * Where "open" and "close" send a shade (aiopvapi open_position and
 * close_position; the slats of a tilt-only shade open at mid-course, 90° of
 * their 180°).
 * @returns {{ open: object, close: object }}
 */
export function openClosePositions(raw, apiVersion) {
  const kind = shadeKind(raw);
  switch (kind) {
    case 'tilt_only':
      return { open: { tilt: 50 }, close: { tilt: 0 } };
    case 'top_down':
      return { open: { primary: 0 }, close: { primary: 100 } };
    case 'top_down_bottom_up':
      return { open: { primary: 100, secondary: 0 }, close: { primary: 0, secondary: 0 } };
    case 'tilt_anywhere':
    case 'vertical_tilt_anywhere':
      return apiVersion >= 3
        ? { open: { primary: 100, tilt: 100 }, close: { primary: 0, tilt: 100 } }
        : { open: { primary: 100, tilt: 50 }, close: { primary: 0, tilt: 0 } };
    default:
      if (SHADE_KINDS[kind].layout === 'dual') {
        return { open: { primary: 100 }, close: { secondary: 0 } };
      }
      return { open: { primary: 100 }, close: { primary: 0 } };
  }
}

// Gen 1-2 `batteryKind` and Gen 3 `powerType` values of a mains-powered shade
// (aiopvapi POWER_SOURCE_HARDWIRED).
const HARDWIRED = [1, 12];
const BATTERY_KINDS = [2, 3, 11];
// Gen 3 `batteryStatus` → percentage (aiopvapi get_battery_strength): 4 is
// hardwired, 3 is 51-100 %, 2 is 21-50 %, 1 is 20 % or less.
const BATTERY_STATUS_PERCENT = { 4: 100, 3: 100, 2: 50, 1: 20, 0: 0 };
// Gen 1-2 `batteryStrength` is in tenths of a volt; 18 V is a full pack.
const FULL_BATTERY_DECIVOLTS = 180;

/**
 * Whether the shade runs on batteries, and their charge when the hub knows it.
 * Gen 1-2 hubs report `batteryKind: "unassigned"` for many shades, with a
 * strength of 0 when nothing is known: such a shade only counts as
 * battery-powered once the hub reports a strength.
 * @returns {{ powered: boolean, percent: number|null }}
 */
export function battery(raw, apiVersion) {
  if (apiVersion >= 3) {
    const powered = raw?.powerType !== undefined && !HARDWIRED.includes(raw.powerType);
    const percent = BATTERY_STATUS_PERCENT[raw?.batteryStatus];
    return { powered, percent: powered && percent !== undefined ? percent : null };
  }
  const strength = Number(raw?.batteryStrength);
  const hasStrength = Number.isFinite(strength) && strength > 0;
  const kind = raw?.batteryKind;
  const powered = BATTERY_KINDS.includes(kind) || (!HARDWIRED.includes(kind) && hasStrength);
  return {
    powered,
    percent:
      powered && hasStrength
        ? Math.min(100, Math.round((strength / FULL_BATTERY_DECIVOLTS) * 100))
        : null,
  };
}

/** Whether the shade is mains-powered: its hub can ask it its position often. */
export function isHardwired(raw, apiVersion) {
  return HARDWIRED.includes(apiVersion >= 3 ? raw?.powerType : raw?.batteryKind);
}

/** Decode the base64 name of the Gen 1-2 API (Gen 3 also sends `ptName`, in clear). */
export function decodeName(value) {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  // A name that was not base64 decodes to garbage: keep it as it came.
  if (decoded.includes('�') || Buffer.from(decoded, 'utf8').toString('base64') !== value) {
    return value;
  }
  return decoded;
}

/** The display name of a shade, scene or room entry. */
export function entryName(raw) {
  const plain = typeof raw?.ptName === 'string' ? raw.ptName.trim() : '';
  return plain || decodeName(raw?.name).trim();
}
