// -----------------------------------------------------------------------------
// End to end: the integration on the SDK's fake Gladys, in front of simulated
// Gen 1, 2 and 3 hubs, with a manual clock. Discovery, refresh without the
// core's onPoll, commands, scenes, actions, outages, restarts.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HEARTBEAT_MS, RADIO_REFRESH_MS, SCENE_SETTLE_MS, STOP_SETTLE_MS } from '../src/hub.js';
import { MAX_RAW_V2 } from '../src/powerview/shade.js';
import { SERIALS, createHub, shadeOf } from './helpers/fakeHub.js';
import {
  create,
  createAll,
  createWorld,
  discovered,
  featureOf,
  sceneId,
  shadeId,
} from './helpers/world.js';

const v2 = (fraction) => Math.trunc(fraction * MAX_RAW_V2);
const gen2Hub = () => createHub({ generation: 2, host: '192.0.2.10' });
const gen3Hub = () => createHub({ generation: 3, host: '192.0.2.20' });
const reads = (hub) =>
  hub.requests.filter((r) => r.method === 'GET' && /\/shades$/.test(r.path)).length;
const last = (gladys, deviceId, key) => gladys.fake.lastState(`${deviceId}:${key}`);

test('finds the hubs through mDNS and publishes every shade and scene', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [hub2, hub3] = network.hubs;
    assert.deepEqual(gladys.fake.scans, [{ type: 'mdns', timeout_seconds: 5 }]);
    const devices = gladys.fake.discoveredDevices;
    const count = (type, hub) =>
      devices.filter((d) => d.external_id.includes(`:${type}:${hub.serial}-`)).length;
    assert.equal(count('shade', hub2), 12);
    assert.equal(count('scene', hub2), 18);
    assert.equal(count('shade', hub3), 13);
    assert.equal(count('scene', hub3), hub3.scenes.length);
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
    // Nothing added to Gladys yet: no state, and no reading beyond the catalog.
    assert.equal(gladys.fake.states.length, 0);
    assert.equal(reads(hub2), 1);
  } finally {
    world.app.stop();
  }
});

test('typed addresses work without mDNS; bad ones are reported', async () => {
  const world = await createWorld({
    hubs: [gen2Hub(), gen3Hub()],
    mdns: false,
    config: { hub_addresses: 'http://192.0.2.10/, 300.1.1.1' },
  });
  try {
    const summary = world.hub.summary();
    assert.deepEqual(
      summary.hubs.map((hub) => [hub.generation, hub.host]),
      [[2, '192.0.2.10']],
    );
    assert.deepEqual(summary.invalidHosts, ['300.1.1.1']);
  } finally {
    world.app.stop();
  }
});

test('a secondary Gen 3 gateway is left to the primary one', async () => {
  const world = await createWorld({
    hubs: [gen3Hub(), createHub({ generation: 3, host: '192.0.2.21', secondary: true })],
  });
  try {
    const summary = world.hub.summary();
    assert.deepEqual(
      summary.hubs.map((hub) => hub.host),
      ['192.0.2.20'],
    );
    assert.deepEqual(summary.secondaries, ['192.0.2.21']);
  } finally {
    world.app.stop();
  }
});

test('no hub at all: the status says to type its address', async () => {
  const world = await createWorld({ hubs: [] });
  try {
    const status = world.gladys.fake.connectionStatus;
    assert.equal(status.connected, false);
    assert.match(status.message.fr, /saisissez son adresse IP/);
    assert.deepEqual(world.gladys.fake.discoveredDevices, []);
  } finally {
    world.app.stop();
  }
});

test('a shade added to Gladys gets its states at once', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const hub2 = network.hubs[0];
    const bed2 = shadeId(gladys, hub2, 37688); // tilt anywhere, on batteries
    shadeOf(hub2, 37688).positions = {
      posKind1: 1,
      position1: v2(0.4),
      posKind2: 3,
      position2: v2(0.5),
    };
    await create(world, [bed2]);
    assert.equal(last(gladys, bed2, 'state'), 1);
    assert.equal(last(gladys, bed2, 'position'), 40);
    assert.equal(last(gladys, bed2, 'tilt'), 50);
    assert.equal(last(gladys, bed2, 'battery'), 94);
    assert.equal(last(gladys, bed2, 'battery_low'), 0);
  } finally {
    world.app.stop();
  }
});

test('the states refresh on the container timer, without the core polling', async (t) => {
  // The SDK dates its heartbeat with Date.now().
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 15, 8, 0, 0) });
  const world = await createWorld();
  try {
    const { gladys, network, clock } = world;
    const [hub2, hub3] = network.hubs;
    const left = shadeId(gladys, hub2, 13542);
    await create(world, [left]);
    const gen3Reads = reads(hub3);
    assert.equal(last(gladys, left, 'position'), 0);

    shadeOf(hub2, 13542).positions = { posKind1: 1, position1: v2(0.7) };
    await clock.advance(60 * 1000);
    assert.equal(last(gladys, left, 'position'), 70);
    assert.equal(last(gladys, left, 'state'), 1);
    // Only the hubs with a shade in Gladys are read.
    assert.equal(reads(hub3), gen3Reads);
    // No onPoll involved.
    assert.equal(gladys.fake.requests.filter((r) => r.path === '/poll').length, 0);

    // Unchanged values are not sent again...
    const count = gladys.fake.states.length;
    await clock.advance(60 * 1000);
    assert.equal(gladys.fake.states.length, count);
    // ...except the heartbeat, so Gladys never shows them as stale.
    t.mock.timers.setTime(Date.now() + HEARTBEAT_MS);
    await clock.advance(60 * 1000);
    assert.ok(gladys.fake.states.length > count);
  } finally {
    world.app.stop();
  }
});

test("the core's onPoll is a fallback: skipped right after the timer", async () => {
  const world = await createWorld();
  try {
    const { gladys, network, clock, app } = world;
    const hub2 = network.hubs[0];
    const left = shadeId(gladys, hub2, 13542);
    await create(world, [left]);
    await clock.advance(60 * 1000);
    const before = reads(hub2);
    assert.deepEqual(await gladys.fake.poll(discovered(gladys, left)), { success: true });
    assert.equal(reads(hub2), before);

    // The timer stalls: the core's poll reads the hub.
    app.stop();
    await clock.advance(60 * 1000);
    shadeOf(hub2, 13542).positions = { posKind1: 1, position1: v2(0.3) };
    await gladys.fake.poll(discovered(gladys, left));
    assert.equal(reads(hub2), before + 1);
    assert.equal(last(gladys, left, 'position'), 30);
  } finally {
    world.app.stop();
  }
});

test('a position command moves the shade, shows the target, then asks the shade', async () => {
  const world = await createWorld({ config: { refresh_interval: 30 } });
  try {
    const { gladys, network, clock } = world;
    const hub2 = network.hubs[0];
    const left = shadeId(gladys, hub2, 13542);
    await create(world, [left]);
    const device = discovered(gladys, left);
    const ack = await gladys.fake.setValue(device, featureOf(gladys, left, 'position'), 100);
    assert.deepEqual(ack, { success: true });
    assert.deepEqual(hub2.radio.at(-1), {
      kind: 'move',
      id: 13542,
      body: { shade: { id: 13542, positions: { posKind1: 1, position1: MAX_RAW_V2 } } },
    });
    // The target at once.
    assert.equal(last(gladys, left, 'position'), 100);
    assert.equal(last(gladys, left, 'state'), 1);

    // The hub lags behind (it still says closed): the target stays shown.
    shadeOf(hub2, 13542).positions = { posKind1: 1, position1: 0 };
    await clock.advance(30 * 1000);
    assert.equal(last(gladys, left, 'position'), 100);

    // A full course takes 1 + 40 s: then the shade is asked, and believed.
    shadeOf(hub2, 13542).positions = { posKind1: 1, position1: v2(0.98) };
    await clock.advance(11 * 1000);
    assert.deepEqual(hub2.radio.at(-1), { kind: 'refresh', id: 13542 });
    assert.equal(last(gladys, left, 'position'), 98);
  } finally {
    world.app.stop();
  }
});

test('open, close and stop through the state feature (Gen 3)', async () => {
  const world = await createWorld();
  try {
    const { gladys, network, clock } = world;
    const hub3 = network.hubs[1];
    const bed2 = shadeId(gladys, hub3, 10); // tilt anywhere
    await create(world, [bed2]);
    const device = discovered(gladys, bed2);
    const state = featureOf(gladys, bed2, 'state');

    await gladys.fake.setValue(device, state, -1);
    assert.deepEqual(hub3.radio.at(-1).body, { positions: { primary: 0, tilt: 1 } });
    assert.equal(last(gladys, bed2, 'state'), -1);

    await gladys.fake.setValue(device, state, 1);
    assert.deepEqual(hub3.radio.at(-1).body, { positions: { primary: 1, tilt: 1 } });

    await gladys.fake.setValue(device, state, 0);
    assert.deepEqual(hub3.radio.at(-1), { kind: 'stop', id: 10 });
    // Where it stopped is read shortly after.
    shadeOf(hub3, 10).positions = { primary: 0.55, secondary: 0, tilt: 1, velocity: 0 };
    await clock.advance(STOP_SETTLE_MS);
    assert.deepEqual(hub3.radio.at(-1), { kind: 'refresh', id: 10 });
    assert.equal(last(gladys, bed2, 'position'), 55);
    // The move timer of the open command was cancelled by the stop.
    assert.deepEqual(clock.pending(), [60 * 1000 - STOP_SETTLE_MS]);
  } finally {
    world.app.stop();
  }
});

test('a Gen 1 hub cannot stop a shade: the command fails with a reason', async () => {
  const world = await createWorld({ hubs: [createHub({ generation: 1, host: '192.0.2.11' })] });
  try {
    const { gladys, network } = world;
    const hub1 = network.hubs[0];
    const blind = shadeId(gladys, hub1, hub1.shades[0].id);
    await create(world, [blind]);
    const ack = await gladys.fake.setValue(
      discovered(gladys, blind),
      featureOf(gladys, blind, 'state'),
      0,
    );
    assert.equal(ack.success, false);
    assert.match(ack.error, /Generation 1 hub cannot stop/);
    assert.equal(hub1.radio.length, 0);
  } finally {
    world.app.stop();
  }
});

test('two rails: the top rail moves alone and never crosses the bottom one', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const hub2 = network.hubs[0];
    const master = shadeId(gladys, hub2, 49782); // top down / bottom up
    shadeOf(hub2, 49782).positions = { posKind1: 1, position1: v2(0.6), posKind2: 2, position2: 0 };
    await create(world, [master]);
    const device = discovered(gladys, master);
    await gladys.fake.setValue(device, featureOf(gladys, master, 'top_position'), 70);
    assert.deepEqual(hub2.radio.at(-1).body, {
      shade: {
        id: 49782,
        positions: { posKind1: 1, position1: v2(0.6), posKind2: 2, position2: v2(0.4) },
      },
    });
    assert.equal(last(gladys, master, 'top_position'), 40);
    assert.equal(last(gladys, master, 'position'), 60);
  } finally {
    world.app.stop();
  }
});

test('radio operations reach a hub one at a time', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const hub3 = network.hubs[1];
    const ids = [413, 22, 6539].map((id) => shadeId(gladys, hub3, id));
    await create(world, ids);
    let inFlight = 0;
    let most = 0;
    const fetch = network.fetch;
    network.fetch = async (...args) => {
      const put = args[1]?.method === 'PUT';
      inFlight += put ? 1 : 0;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      try {
        return await fetch(...args);
      } finally {
        inFlight -= put ? 1 : 0;
      }
    };
    world.hub.client = (await import('../src/powerview/client.js')).createClient({
      fetch: network.fetch,
    });
    await Promise.all(
      ids.map((id) =>
        gladys.fake.setValue(discovered(gladys, id), featureOf(gladys, id, 'position'), 50),
      ),
    );
    assert.equal(most, 1);
    assert.equal(hub3.radio.filter((op) => op.kind === 'move').length, 3);
  } finally {
    world.app.stop();
  }
});

test('mains-powered shades are asked over the radio every 10 minutes, never battery ones', async () => {
  const world = await createWorld();
  try {
    const { gladys, network, clock } = world;
    const hub2 = network.hubs[0];
    // 65396 is mains-powered (batteryKind 1), 37688 on batteries.
    await create(world, [shadeId(gladys, hub2, 65396), shadeId(gladys, hub2, 37688)]);
    const refreshes = () => hub2.radio.filter((op) => op.kind === 'refresh').map((op) => op.id);
    assert.deepEqual(refreshes(), [65396]);
    await clock.advance(5 * 60 * 1000);
    assert.deepEqual(refreshes(), [65396]);
    await clock.advance(RADIO_REFRESH_MS - 5 * 60 * 1000);
    assert.deepEqual(refreshes(), [65396, 65396]);
  } finally {
    world.app.stop();
  }
});

test('a scene device runs its scene; the shades are read once they arrived', async () => {
  const world = await createWorld();
  try {
    const { gladys, network, clock } = world;
    const hub3 = network.hubs[1];
    const scene = sceneId(gladys, hub3, 253);
    await create(world, [scene, shadeId(gladys, hub3, 413)]);
    const ack = await gladys.fake.setValue(
      discovered(gladys, scene),
      featureOf(gladys, scene, 'activate'),
      1,
    );
    assert.deepEqual(ack, { success: true });
    assert.deepEqual(hub3.radio.at(-1), { kind: 'scene', id: 253 });
    const before = reads(hub3);
    await clock.advance(SCENE_SETTLE_MS);
    assert.equal(reads(hub3), before + 1);
  } finally {
    world.app.stop();
  }
});

test('the "Run a PowerView scene" scene action, with its output', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const [hub2, hub3] = network.hubs;
    const ok = await gladys.fake.sceneAction('activate_scene', {
      scene: sceneId(gladys, hub3, 253),
    });
    assert.deepEqual(ok, { success: true, data: { outputs: { shade_count: 3 } } });
    assert.deepEqual(hub3.radio.at(-1), { kind: 'scene', id: 253 });

    const gen2 = await gladys.fake.sceneAction('activate_scene', {
      scene: sceneId(gladys, hub2, 61648),
    });
    assert.equal(gen2.success, true);
    assert.ok(gen2.data.outputs.shade_count > 0);

    const shade = await gladys.fake.sceneAction('activate_scene', {
      scene: shadeId(gladys, hub3, 413),
    });
    assert.equal(shade.success, false);
    assert.match(shade.error, /Pick a PowerView scene/);
    const gone = await gladys.fake.sceneAction('activate_scene', {
      scene: sceneId(gladys, hub3, 9999),
    });
    assert.match(gone.error, /no longer knows this scene/);
  } finally {
    world.app.stop();
  }
});

test('the "Identify a shade" action jogs the shade', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const hub2 = network.hubs[0];
    const ack = await gladys.fake.action('identify', { device: shadeId(gladys, hub2, 13542) });
    assert.match(ack.data.message.fr, /le store monte et descend/);
    assert.equal(hub2.radio.at(-1).kind, 'jog');
    const scene = await gladys.fake.action('identify', { device: sceneId(gladys, hub2, 61648) });
    assert.match(scene.data.message.en, /not a PowerView shade/);
  } finally {
    world.app.stop();
  }
});

test('the "Search for hubs" action reports in four languages', async () => {
  const world = await createWorld({
    hubs: [gen2Hub(), gen3Hub(), createHub({ generation: 3, host: '192.0.2.21', secondary: true })],
    config: { hub_addresses: '192.0.2.99, nonsense!' },
  });
  try {
    const ack = await world.gladys.fake.action('search');
    const { message } = ack.data;
    assert.match(
      message.en,
      /Powerview Generation 2 \(Gen 2, 192\.0\.2\.10\): 12 shade\(s\), 18 scene\(s\)\./,
    );
    assert.match(message.en, /192\.0\.2\.21 is a secondary Gen 3 gateway/);
    assert.match(message.en, /192\.0\.2\.99 does not answer\./);
    assert.match(message.en, /Ignored addresses: nonsense!\./);
    assert.match(message.fr, /génération 3, 192\.0\.2\.20\) : 13 store\(s\)/);
    assert.match(message.de, /Öffne den Tab „Entdecken“/);
    assert.match(message.es, /Abra la pestaña Descubrir/);
  } finally {
    world.app.stop();
  }
});

test('mDNS refused by the core (an older Gladys): the report says to type the addresses', async () => {
  const world = await createWorld({ connect: false });
  try {
    world.gladys.scanNetwork = async () => {
      throw new Error('403 network_discovery not declared');
    };
    await world.gladys.connect();
    await world.app.ready;
    const ack = await world.gladys.fake.action('search');
    assert.match(ack.data.message.en, /mDNS\) through Gladys is unavailable/);
  } finally {
    world.app.stop();
  }
});

test('a hub that stops answering: the status says so, until it is back', async () => {
  const world = await createWorld({ hubs: [gen2Hub()] });
  try {
    const { gladys, network, clock } = world;
    const hub2 = network.hubs[0];
    const left = shadeId(gladys, hub2, 13542);
    await create(world, [left]);
    hub2.up = false;
    await clock.advance(60 * 1000);
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.match(gladys.fake.connectionStatus.message.en, /does not answer/);
    // A command says why it fails.
    const ack = await gladys.fake.setValue(
      discovered(gladys, left),
      featureOf(gladys, left, 'position'),
      50,
    );
    assert.equal(ack.success, false);
    assert.match(ack.error, /unreachable/);

    hub2.up = true;
    await clock.advance(60 * 1000);
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  } finally {
    world.app.stop();
  }
});

test('a hub silent for a while is looked for again, and found at its new address', async () => {
  const world = await createWorld({ hubs: [gen2Hub()] });
  try {
    const { gladys, network, clock } = world;
    const hub2 = network.hubs[0];
    const left = shadeId(gladys, hub2, 13542);
    await create(world, [left]);
    // The DHCP lease changed.
    hub2.host = '192.0.2.50';
    gladys.fake.scanResults = { mdns: network.mdnsResults() };
    await clock.advance(6 * 60 * 1000);
    assert.equal(world.hub.summary().hubs[0].host, '192.0.2.50');
    // Same serial number: the same devices.
    assert.ok(discovered(gladys, left));
    shadeOf(hub2, 13542).positions = { posKind1: 1, position1: v2(0.2) };
    await clock.advance(60 * 1000);
    assert.equal(last(gladys, left, 'position'), 20);
  } finally {
    world.app.stop();
  }
});

test('a restart with the hub off keeps its devices, from /data', async () => {
  const first = await createWorld({ hubs: [gen2Hub()] });
  first.app.stop();
  await first.store.flush();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'powerview-state.json'), 'utf8'));
  assert.equal(saved.hubs[SERIALS[2]].host, '192.0.2.10');
  assert.equal(saved.hubs[SERIALS[2]].shades.length, 12);

  const offline = gen2Hub();
  offline.up = false;
  const second = await createWorld({ hubs: [offline], dataDir: first.dataDir, mdns: false });
  try {
    assert.equal(second.gladys.fake.discoveredDevices.length, 30);
    assert.equal(second.gladys.fake.connectionStatus.connected, false);
  } finally {
    second.app.stop();
  }
});

test('Gladys restarted: the devices and states are sent again', async () => {
  const world = await createWorld();
  try {
    const { gladys, network } = world;
    const left = shadeId(gladys, network.hubs[0], 13542);
    await create(world, [left]);
    const publications = gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
    const states = gladys.fake.states.length;
    await gladys.disconnect();
    await gladys.connect();
    assert.equal(
      gladys.fake.requests.filter((r) => r.path === '/discovered_device').length,
      publications + 1,
    );
    assert.ok(gladys.fake.states.length > states);
  } finally {
    world.app.stop();
  }
});

test('a new language names the next devices in it', async () => {
  const world = await createWorld({ hubs: [gen2Hub()] });
  try {
    const { gladys, network } = world;
    const left = shadeId(gladys, network.hubs[0], 13542);
    assert.equal(featureOf(gladys, left, 'state').name, 'Ouvrir / fermer');
    await gladys.fake.configUpdated({ language: 'es' });
    assert.equal(featureOf(gladys, left, 'state').name, 'Abrir / cerrar');
  } finally {
    world.app.stop();
  }
});

test('every discovered device can be added, and gets a state for each feature it can show', async () => {
  const world = await createWorld();
  try {
    const { gladys } = world;
    await createAll(world);
    for (const device of gladys.fake.discoveredDevices.filter((d) =>
      d.external_id.includes(':shade:'),
    )) {
      for (const feature of device.features) {
        const value = gladys.fake.lastState(feature.external_id);
        // The Aura shade has no position yet; a battery without reading has no value.
        if (value === undefined) {
          assert.ok(
            /-(109|40458):|:(battery|battery_low)$/.test(feature.external_id),
            `${feature.external_id} has no state`,
          );
          continue;
        }
        assert.ok(
          value >= feature.min && value <= feature.max,
          `${feature.external_id} = ${value}`,
        );
      }
    }
  } finally {
    world.app.stop();
  }
});
