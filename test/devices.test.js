// -----------------------------------------------------------------------------
// From hub entries to Gladys devices, states and moves: the features each kind
// of shade gets, the values they show, and what a command sends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  COVER_STATE,
  FEATURE,
  buildSceneDevice,
  buildShadeDevice,
  commandToMove,
  parseExternalId,
  shadeFeatureKeys,
  shadeValues,
  uniqueNames,
} from '../src/devices.js';
import { MAX_RAW_V2 } from '../src/powerview/shade.js';
import { fixture } from './helpers/fakeHub.js';

const gladys = createFakeGladys();
const gen2 = fixture('gen2/shades.json').shadeData;
const gen3 = fixture('gen3/home/shades.json');
const hub2 = { serial: 'PVGEN2TEST0002', apiVersion: 2 };
const hub3 = { serial: 'A1B2C3D4E5G6H7', apiVersion: 3 };
const byType = (list, type) => list.find((raw) => raw.type === type);
const v2 = (fraction) => Math.trunc(fraction * MAX_RAW_V2);
const at = (raw, positions) => ({ ...raw, positions });

test('the features follow the kind of shade', () => {
  const keys = (list, type, apiVersion) => shadeFeatureKeys(byType(list, type), apiVersion);
  // Bottom up, on batteries (Gen 3 powerType 2).
  assert.deepEqual(keys(gen3, 6, 3), ['state', 'position', 'battery', 'battery_low']);
  // Gen 2 "unassigned" with no reading: no battery feature.
  assert.deepEqual(keys(gen2, 6, 2), ['state', 'position']);
  // Tilt when closed (90°), mains-powered.
  assert.deepEqual(keys(gen2, 18, 2), ['state', 'position', 'tilt']);
  assert.deepEqual(keys(gen2, 51, 2), ['state', 'position', 'tilt', 'battery', 'battery_low']);
  // Tilt only: the slats are the whole shade.
  assert.deepEqual(keys(gen2, 66, 2), ['state', 'tilt', 'battery', 'battery_low']);
  // Top down / bottom up: two rails.
  assert.deepEqual(keys(gen2, 8, 2), [
    'state',
    'position',
    'top_position',
    'battery',
    'battery_low',
  ]);
  // Dual: combined, front, rear (and the slats of the Silhouette Duolite).
  assert.deepEqual(keys(gen2, 79, 2), [
    'state',
    'position',
    'front_position',
    'rear_position',
    'battery',
    'battery_low',
  ]);
  assert.deepEqual(keys(gen2, 38, 2), [
    'state',
    'position',
    'front_position',
    'rear_position',
    'tilt',
    'battery',
    'battery_low',
  ]);
});

test('a shade device: shutter features, curtain for the shades moving sideways', () => {
  const device = buildShadeDevice(gladys, hub3, byType(gen3, 56), {
    language: 'en',
    room: 'Bedroom 4',
  });
  assert.equal(device.name, 'Bed 4');
  assert.equal(device.external_id, 'ext:test-integration:shade:A1B2C3D4E5G6H7-173');
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, 60000);
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.equal(byKey.state.category, 'curtain');
  assert.equal(byKey.state.type, 'state');
  assert.deepEqual([byKey.state.min, byKey.state.max], [-1, 1]);
  assert.equal(byKey.position.category, 'curtain');
  assert.equal(byKey.position.type, 'position');
  assert.equal(byKey.position.unit, 'percent');
  assert.equal(byKey.tilt.name, 'Slat tilt');
  assert.equal(byKey.battery.category, 'battery');
  assert.equal(byKey.battery_low.category, 'battery-low');
  assert.ok(device.params.some((p) => p.name === 'ROOM' && p.value === 'Bedroom 4'));

  const roller = buildShadeDevice(gladys, hub2, byType(gen2, 6), { language: 'fr' });
  assert.ok(roller.features.every((f) => f.category === 'shutter'));
  assert.equal(roller.features[0].name, 'Ouvrir / fermer');
  // No name on the hub: "Store <id>".
  assert.equal(
    buildShadeDevice(gladys, hub2, { id: 7, type: 6 }, { language: 'fr' }).name,
    'Store 7',
  );
});

test('two rails and dual shades name their positions', () => {
  const names = (raw, language) =>
    buildShadeDevice(gladys, hub2, raw, { language }).features.map((f) => f.name);
  assert.deepEqual(names(byType(gen2, 8), 'fr').slice(0, 3), [
    'Ouvrir / fermer',
    'Position du rail bas',
    'Position du rail haut',
  ]);
  assert.deepEqual(names(byType(gen2, 79), 'de').slice(1, 4), [
    'Kombinierte Position',
    'Position des Voiles (vorne)',
    'Position der Verdunkelung (hinten)',
  ]);
});

test('a scene device: one push button', () => {
  const scene = fixture('gen3/home/scenes.json')[0];
  const device = buildSceneDevice(gladys, hub3, scene, { language: 'fr' });
  assert.equal(device.name, 'Close Lounge Room (scène PowerView)');
  assert.equal(device.external_id, 'ext:test-integration:scene:A1B2C3D4E5G6H7-218');
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.equal(device.features.length, 1);
  assert.equal(device.features[0].category, 'button');
  assert.equal(device.features[0].type, 'push');
  assert.equal(device.features[0].name, 'Lancer la scène');
});

test('external ids parse back', () => {
  assert.deepEqual(parseExternalId('ext:test-integration:shade:A1B2C3D4E5G6H7-173'), {
    type: 'shade',
    hubSerial: 'A1B2C3D4E5G6H7',
    id: 173,
  });
  assert.deepEqual(parseExternalId('ext:x:scene:PV1-218:activate'), null);
  assert.equal(parseExternalId('ext:other:light:abc'), null);
  assert.equal(parseExternalId(undefined), null);
});

test('values: open percent, closed state, inverted top-down, combined dual', () => {
  const roller = { type: 6, positions: { posKind1: 1, position1: v2(0.6) } };
  assert.deepEqual(shadeValues(roller, 2), { state: COVER_STATE.OPEN, position: 60 });
  assert.deepEqual(shadeValues(at(roller, { posKind1: 1, position1: 0 }), 2), {
    state: COVER_STATE.CLOSE,
    position: 0,
  });
  // Top down: primary 0 = open.
  const topDown = { type: 7, positions: { primary: 0 } };
  assert.deepEqual(shadeValues(topDown, 3), { state: COVER_STATE.OPEN, position: 100 });
  assert.deepEqual(shadeValues(at(topDown, { primary: 1 }), 3), {
    state: COVER_STATE.CLOSE,
    position: 0,
  });
  // Two rails: closed only with both rails at rest.
  const tdbu = { type: 8, positions: { primary: 0, secondary: 0.3 } };
  assert.deepEqual(shadeValues(tdbu, 3), {
    state: COVER_STATE.OPEN,
    position: 0,
    top_position: 30,
  });
  // Dual: 0-50 the rear, 51-100 the front.
  const rearHalf = { type: 79, positions: { primary: 0, secondary: 0.4 } };
  assert.deepEqual(shadeValues(rearHalf, 3), {
    state: COVER_STATE.OPEN,
    position: 20,
    front_position: 0,
    rear_position: 40,
  });
  const frontHalf = { type: 79, positions: { primary: 0.5, secondary: 1 } };
  assert.equal(shadeValues(frontHalf, 3).position, 75);
  assert.equal(shadeValues({ type: 79, positions: { primary: 0, secondary: 0 } }, 3).state, -1);
  // Tilt only: open while the slats are.
  assert.deepEqual(shadeValues({ type: 66, positions: { posKind1: 3, position1: v2(0.5) } }, 2), {
    state: COVER_STATE.OPEN,
    tilt: 50,
  });
  // Nothing known: no position value at all (the battery stays).
  assert.deepEqual(shadeValues({ type: 6, powerType: 2, batteryStatus: 3, positions: {} }, 3), {
    battery: 100,
    battery_low: 0,
  });
  assert.deepEqual(shadeValues({ type: 6, powerType: 0, batteryStatus: 1 }, 3), {
    battery: 20,
    battery_low: 1,
  });
});

test('commands: state open, close and stop', () => {
  const roller = { id: 1, type: 6, positions: { primary: 0.25 } };
  assert.deepEqual(commandToMove(roller, 3, FEATURE.STATE, 1), {
    target: { primary: 100 },
    steps: 75,
  });
  assert.deepEqual(commandToMove(roller, 3, FEATURE.STATE, -1), {
    target: { primary: 0 },
    steps: 25,
  });
  assert.deepEqual(commandToMove(roller, 3, FEATURE.STATE, 0), { stop: true });
  assert.throws(() => commandToMove(roller, 3, FEATURE.STATE, 'up'), /Invalid value/);
  assert.throws(() => commandToMove(roller, 3, FEATURE.BATTERY, 50), /cannot be set/);
});

test('commands: positions per kind, clamped, rails never crossing', () => {
  const move = (raw, key, value, apiVersion = 3) =>
    commandToMove(raw, apiVersion, key, value).target;
  assert.deepEqual(move({ type: 6, positions: { primary: 0 } }, FEATURE.POSITION, 130), {
    primary: 100,
  });
  // Top down: inverted.
  assert.deepEqual(move({ type: 7, positions: { primary: 1 } }, FEATURE.POSITION, 30), {
    primary: 70,
  });
  // Tilt anywhere: moving the rail keeps the slats, tilting keeps the rail.
  const venetian = { type: 51, positions: { primary: 0.4, tilt: 0.7 } };
  assert.deepEqual(move(venetian, FEATURE.POSITION, 90), { primary: 90, tilt: 70 });
  assert.deepEqual(move(venetian, FEATURE.TILT, 10), { primary: 40, tilt: 10 });
  // Tilt when closed: the slats alone.
  assert.deepEqual(move({ type: 18, positions: { primary: 0, tilt: 0 } }, FEATURE.TILT, 60), {
    tilt: 60,
  });
  // Two rails: the bottom rail stops at the top one, and the other way round.
  const tdbu = { type: 8, positions: { primary: 0.2, secondary: 0.3 } };
  assert.deepEqual(move(tdbu, FEATURE.POSITION, 90), { primary: 70, secondary: 30 });
  assert.deepEqual(move(tdbu, FEATURE.TOP_POSITION, 95), { primary: 20, secondary: 80 });
  // Dual: the combined slider drives the rear, then the front.
  const dual = { type: 79, positions: { primary: 0, secondary: 1 } };
  assert.deepEqual(move(dual, FEATURE.POSITION, 25), { secondary: 50 });
  assert.deepEqual(move(dual, FEATURE.POSITION, 80), { primary: 60 });
  assert.deepEqual(move(dual, FEATURE.FRONT_POSITION, 10), { primary: 10 });
  assert.deepEqual(move(dual, FEATURE.REAR_POSITION, 10), { secondary: 10 });
  // A move in progress: its target is the starting point.
  assert.deepEqual(
    commandToMove(tdbu, 3, FEATURE.TOP_POSITION, 50, { primary: 60, secondary: 0, tilt: null })
      .target,
    { primary: 60, secondary: 40 },
  );
});

test('two shades named alike get their room in their name', () => {
  const names = uniqueNames([
    { key: '1', name: 'Left', room: 'Kitchen' },
    { key: '2', name: 'Left', room: 'Study' },
    { key: '3', name: 'Right', room: 'Study' },
  ]);
  assert.deepEqual([...names.values()], ['Left (Kitchen)', 'Left (Study)', 'Right']);
});
