// -----------------------------------------------------------------------------
// Quiet logs: nothing at info level for a normal refresh cycle, one line when
// a hub is lost and one when it is back, one line per user action, and never
// a value of the configuration dumped as a whole.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub, shadeOf } from './helpers/fakeHub.js';
import { create, createWorld, discovered, featureOf, shadeId } from './helpers/world.js';

/** Capture the log lines (the SDK logger writes to console.log / console.error). */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  return lines;
}

const SENTINEL = 'sentinel-0c4f9e';

test('a normal refresh cycle writes nothing at info level', async (t) => {
  const world = await createWorld({
    hubs: [createHub({ generation: 2, host: '192.0.2.10' })],
    // A key the integration does not know, standing for any secret a future
    // field would hold: it must never reach the logs.
    config: { hub_addresses: '192.0.2.10', api_key: SENTINEL },
  });
  try {
    const lines = captureLogs(t);
    const hub2 = world.network.hubs[0];
    await create(world, [shadeId(world.gladys, hub2, 13542), shadeId(world.gladys, hub2, 65396)]);
    shadeOf(hub2, 13542).positions = { posKind1: 1, position1: 30000 };
    for (let i = 0; i < 12; i += 1) {
      await world.clock.advance(60 * 1000);
    }
    assert.deepEqual(lines, []);
  } finally {
    world.app.stop();
  }
});

test('the startup says which hubs it found, once', async (t) => {
  const lines = captureLogs(t);
  const world = await createWorld({ hubs: [createHub({ generation: 3, host: '192.0.2.20' })] });
  try {
    await world.hub.rediscover();
    const found = lines.filter((line) => line.includes('PowerView hub'));
    assert.equal(found.length, 1, lines.join('\n'));
    assert.match(
      found[0],
      /\[INFO\].*"Powerview Generation 3" \(Gen 3, 192\.0\.2\.20\): 13 shade\(s\)/,
    );
  } finally {
    world.app.stop();
  }
});

test('a lost hub: one warning, then one line when it is back', async (t) => {
  const world = await createWorld({ hubs: [createHub({ generation: 2, host: '192.0.2.10' })] });
  try {
    const hub2 = world.network.hubs[0];
    await create(world, [shadeId(world.gladys, hub2, 13542)]);
    const lines = captureLogs(t);
    hub2.up = false;
    for (let i = 0; i < 5; i += 1) {
      await world.clock.advance(60 * 1000);
    }
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(
      lines[0],
      /\[WARN\].*PowerView hub "Powerview Generation 2": 192\.0\.2\.10 unreachable/,
    );
    hub2.up = true;
    await world.clock.advance(60 * 1000);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[1], /\[INFO\].*answers again/);
  } finally {
    world.app.stop();
  }
});

test('the nightly maintenance of a hub (HTTP 423) stays out of the logs', async (t) => {
  const world = await createWorld({ hubs: [createHub({ generation: 2, host: '192.0.2.10' })] });
  try {
    const hub2 = world.network.hubs[0];
    await create(world, [shadeId(world.gladys, hub2, 13542)]);
    const lines = captureLogs(t);
    hub2.maintenance = true;
    await world.clock.advance(3 * 60 * 1000);
    hub2.maintenance = false;
    await world.clock.advance(60 * 1000);
    assert.deepEqual(lines, []);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    world.app.stop();
  }
});

test('one info line per user action, with the shade name', async (t) => {
  const world = await createWorld({ hubs: [createHub({ generation: 2, host: '192.0.2.10' })] });
  try {
    const { gladys } = world;
    const hub2 = world.network.hubs[0];
    const left = shadeId(gladys, hub2, 13542);
    await create(world, [left]);
    const lines = captureLogs(t);
    await gladys.fake.setValue(discovered(gladys, left), featureOf(gladys, left, 'position'), 40);
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(lines[0], /\[INFO\].*Shade "Family Left": position 40/);
  } finally {
    world.app.stop();
  }
});

test('debug level shows the cycles, still without the configuration', async (t) => {
  const world = await createWorld({
    hubs: [createHub({ generation: 2, host: '192.0.2.10' })],
    config: { api_key: SENTINEL },
  });
  try {
    const hub2 = world.network.hubs[0];
    await create(world, [shadeId(world.gladys, hub2, 13542)]);
    const lines = captureLogs(t, 'debug');
    await world.clock.advance(60 * 1000);
    await world.gladys.fake.configUpdated({ api_key: SENTINEL, hub_addresses: 'nonsense!' });
    hub2.up = false;
    await world.clock.advance(60 * 1000);
    assert.ok(lines.length > 0);
    assert.ok(
      lines.every((line) => !line.includes(SENTINEL)),
      lines.join('\n'),
    );
  } finally {
    world.app.stop();
  }
});
