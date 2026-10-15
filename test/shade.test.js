// -----------------------------------------------------------------------------
// The shade model against the real hub answers of aiopvapi's fixtures: the
// kind of every shade, the position conversions of each generation and their
// quirks, open/close targets, batteries.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RAW_V2,
  SHADE_KINDS,
  battery,
  decodeName,
  entryName,
  isHardwired,
  moveBody,
  openClosePositions,
  readPositions,
  shadeKind,
} from '../src/powerview/shade.js';
import { fixture } from './helpers/fakeHub.js';

const gen2 = fixture('gen2/shades.json').shadeData;
const gen3 = fixture('gen3/home/shades.json');
const gen1 = fixture('gen1/shades.json').shadeData;

// aiopvapi class → kind of src/powerview/shade.js
const CLASS_KINDS = {
  ShadeBottomUp: 'bottom_up',
  ShadeBottomUpTiltOnClosed90: 'tilt_on_closed_90',
  ShadeBottomUpTiltOnClosed180: 'tilt_on_closed_180',
  ShadeBottomUpTiltAnywhere: 'tilt_anywhere',
  ShadeVertical: 'vertical',
  ShadeVerticalTiltAnywhere: 'vertical_tilt_anywhere',
  ShadeTiltOnly: 'tilt_only',
  ShadeTopDown: 'top_down',
  ShadeTopDownBottomUp: 'top_down_bottom_up',
  ShadeDualOverlapped: 'dual_overlapped',
  ShadeDualOverlappedTilt90: 'dual_overlapped_tilt_90',
  ShadeDualOverlappedTilt180: 'dual_overlapped_tilt_180',
  ShadeDualOverlappedIlluminated: 'dual_overlapped_illuminated',
};

const v2 = (fraction) => Math.trunc(fraction * MAX_RAW_V2);

test('every fixture shade gets the kind aiopvapi gives it', () => {
  for (const raw of [...gen2, ...gen3]) {
    assert.equal(
      shadeKind(raw),
      CLASS_KINDS[raw.shade_api_class],
      `${raw.ptName ?? raw.name_unicode}`,
    );
  }
  // Every kind is covered by the fixtures.
  const seen = new Set([...gen2, ...gen3].map(shadeKind));
  assert.deepEqual([...seen].sort(), Object.keys(SHADE_KINDS).sort());
});

test('the type wins over the capability, the capability names an unknown type', () => {
  // Type 44 (Twist) reports capability 0 but tilts.
  assert.equal(shadeKind({ type: 44, capabilities: 0 }), 'tilt_on_closed_180');
  // A type no table knows: its capability decides.
  assert.equal(shadeKind({ type: 999, capabilities: 7 }), 'top_down_bottom_up');
  assert.equal(shadeKind({ type: 999, capabilities: 1 }), 'tilt_on_closed_90');
  // Nothing known: a plain bottom-up shade, like aiopvapi.
  assert.equal(shadeKind({ type: 999 }), 'bottom_up');
  assert.equal(shadeKind({ type: 40 }), 'tilt_only'); // Gen 1 entries have no capability
});

test('Gen 2 positions: 0..65535 in two slots, completed like aiopvapi', () => {
  const bottomUp = { type: 6, positions: { posKind1: 1, position1: v2(0.5) } };
  assert.deepEqual(readPositions(bottomUp, 2), { primary: 50, secondary: null, tilt: null });

  const tdbu = {
    type: 8,
    positions: { posKind1: 1, position1: MAX_RAW_V2, posKind2: 2, position2: 0 },
  };
  assert.deepEqual(readPositions(tdbu, 2), { primary: 100, secondary: 0, tilt: null });
  // The rail the hub left out is at rest.
  assert.deepEqual(readPositions({ type: 8, positions: { posKind1: 2, position1: v2(0.3) } }, 2), {
    primary: 0,
    secondary: 30,
    tilt: null,
  });

  const anywhere = {
    type: 51,
    positions: { posKind1: 1, position1: v2(0.2), posKind2: 3, position2: v2(0.5) },
  };
  assert.deepEqual(readPositions(anywhere, 2), { primary: 20, secondary: null, tilt: 50 });
});

test('Gen 2 quirk: a Duette a few units above 0 is closed', () => {
  // 491 / 65535 = 0.749 %, under aiopvapi's 0.75 % threshold.
  assert.equal(
    readPositions({ type: 6, positions: { posKind1: 1, position1: 491 } }, 2).primary,
    0,
  );
  assert.equal(
    readPositions({ type: 6, positions: { posKind1: 1, position1: 1000 } }, 2).primary,
    2,
  );
});

test('Gen 2 quirk: a 90° tilt is the first half of the raw range', () => {
  const silhouette = {
    type: 23,
    positions: { posKind1: 1, position1: 0, posKind2: 3, position2: 32767 },
  };
  assert.equal(readPositions(silhouette, 2).tilt, 100);
  assert.deepEqual(moveBody({ id: 1, type: 23 }, 2, { tilt: 100 }), {
    shade: { id: 1, positions: { posKind1: 3, position1: 32767 } },
  });
  // Gen 3 uses the whole 0..1 range.
  assert.deepEqual(moveBody({ id: 1, type: 23 }, 3, { tilt: 100 }), { positions: { tilt: 1 } });
  // A 180° tilt uses the whole Gen 2 range.
  assert.deepEqual(moveBody({ id: 1, type: 51 }, 2, { tilt: 100 }), {
    shade: { id: 1, positions: { posKind1: 3, position1: MAX_RAW_V2 } },
  });
});

test('tilt-only shades are read from the primary slot the hubs report (HA #115257)', () => {
  assert.equal(
    readPositions({ type: 66, positions: { posKind1: 1, position1: v2(0.5) } }, 2).tilt,
    50,
  );
  assert.equal(
    readPositions({ type: 66, positions: { posKind1: 3, position1: v2(0.25) } }, 2).tilt,
    25,
  );
  const gen3TiltOnly = gen3.find((raw) => raw.shade_api_class === 'ShadeTiltOnly');
  assert.deepEqual(readPositions(gen3TiltOnly, 3), { primary: null, secondary: null, tilt: 100 });
});

test('Gen 3 positions: fractions under named keys, the unused ones ignored', () => {
  const raw = { type: 6, positions: { primary: 0.42, secondary: 0, tilt: 0, velocity: 0 } };
  assert.deepEqual(readPositions(raw, 3), { primary: 42, secondary: null, tilt: null });
  // The Aura shade before its first report: nothing known.
  const aura = gen3.find((shade) => shade.type === 95);
  assert.deepEqual(readPositions(aura, 3), { primary: null, secondary: null, tilt: null });
});

test('dual shades: the rear is up whenever the front moves', () => {
  const front = { type: 79, positions: { posKind1: 1, position1: v2(0.4) } };
  assert.deepEqual(readPositions(front, 2), { primary: 40, secondary: 100, tilt: null });
  const rear = { type: 79, positions: { posKind1: 2, position1: v2(0.6) } };
  assert.deepEqual(readPositions(rear, 2), { primary: 0, secondary: 60, tilt: null });
  const withTilt = { type: 38, positions: { posKind1: 2, position1: 0 } };
  assert.deepEqual(readPositions(withTilt, 2), { primary: 0, secondary: 0, tilt: 0 });
});

test('move bodies follow each dialect', () => {
  const raw = { id: 13542, type: 8 };
  assert.deepEqual(moveBody(raw, 2, { primary: 100, secondary: 25 }), {
    shade: {
      id: 13542,
      positions: { posKind1: 1, position1: MAX_RAW_V2, posKind2: 2, position2: v2(0.25) },
    },
  });
  // A lone secondary takes the first slot.
  assert.deepEqual(moveBody(raw, 2, { secondary: 50 }), {
    shade: { id: 13542, positions: { posKind1: 2, position1: v2(0.5) } },
  });
  assert.deepEqual(moveBody(raw, 3, { primary: 33, secondary: 0 }), {
    positions: { primary: 0.33, secondary: 0 },
  });
  // Out of range values are clamped.
  assert.deepEqual(moveBody({ id: 1, type: 6 }, 3, { primary: 140 }), {
    positions: { primary: 1 },
  });
});

test('open and close targets per kind (aiopvapi open_position / close_position)', () => {
  assert.deepEqual(openClosePositions({ type: 6 }, 2), {
    open: { primary: 100 },
    close: { primary: 0 },
  });
  assert.deepEqual(openClosePositions({ type: 7 }, 3), {
    open: { primary: 0 },
    close: { primary: 100 },
  });
  assert.deepEqual(openClosePositions({ type: 8 }, 2), {
    open: { primary: 100, secondary: 0 },
    close: { primary: 0, secondary: 0 },
  });
  assert.deepEqual(openClosePositions({ type: 79 }, 3), {
    open: { primary: 100 },
    close: { secondary: 0 },
  });
  assert.deepEqual(openClosePositions({ type: 66 }, 2), { open: { tilt: 50 }, close: { tilt: 0 } });
  assert.deepEqual(openClosePositions({ type: 51 }, 2), {
    open: { primary: 100, tilt: 50 },
    close: { primary: 0, tilt: 0 },
  });
  assert.deepEqual(openClosePositions({ type: 51 }, 3), {
    open: { primary: 100, tilt: 100 },
    close: { primary: 0, tilt: 100 },
  });
});

test('batteries: Gen 2 voltage, Gen 3 levels, mains-powered shades left out', () => {
  const byId = (list, id) => list.find((raw) => raw.id === id);
  // batteryKind 2, 169 tenths of a volt → 94 %.
  assert.deepEqual(battery(byId(gen2, 37688), 2), { powered: true, percent: 94 });
  // batteryKind 1: mains-powered, whatever the strength says.
  assert.deepEqual(battery(byId(gen2, 65396), 2), { powered: false, percent: null });
  assert.equal(isHardwired(byId(gen2, 65396), 2), true);
  // "unassigned" with a strength: on batteries.
  assert.deepEqual(battery(byId(gen2, 26355), 2), { powered: true, percent: 93 });
  // "unassigned" with nothing known: no battery feature.
  assert.deepEqual(battery(byId(gen2, 13542), 2), { powered: false, percent: null });
  assert.equal(isHardwired(byId(gen2, 13542), 2), false);
  // On batteries, but no reading yet.
  assert.deepEqual(battery(byId(gen2, 40458), 2), { powered: true, percent: null });
  // Gen 3: powerType 2 (rechargeable), batteryStatus 3 → 100 %, 2 → 50 %.
  assert.deepEqual(battery(byId(gen3, 413), 3), { powered: true, percent: 100 });
  assert.deepEqual(battery(byId(gen3, 13), 3), { powered: true, percent: 50 });
  assert.deepEqual(battery({ powerType: 0, batteryStatus: 1 }, 3), { powered: true, percent: 20 });
  // powerType 12: mains-powered.
  assert.deepEqual(battery(byId(gen3, 109), 3), { powered: false, percent: null });
  assert.equal(isHardwired(byId(gen3, 109), 3), true);
  // Gen 1 entries have no batteryKind: the strength says it.
  assert.deepEqual(battery(gen1[0], 1), { powered: true, percent: 64 });
});

test('names: base64 for Gen 1-2, ptName for Gen 3', () => {
  assert.equal(entryName(gen2[0]), 'Family Left');
  assert.equal(entryName(gen3[0]), 'Family Left');
  assert.equal(decodeName('QmVkIDI='), 'Bed 2');
  assert.equal(decodeName('Not base64!'), 'Not base64!');
  assert.equal(entryName({ id: 1 }), '');
});
