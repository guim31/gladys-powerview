// -----------------------------------------------------------------------------
// The HTTP client against simulated hubs: generation detection, the requests
// of each dialect, and the errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, PowerViewError } from '../src/powerview/client.js';
import { MAX_RAW_V2, moveBody } from '../src/powerview/shade.js';
import { SECONDARY_SERIAL, SERIALS, createHub, createNetwork } from './helpers/fakeHub.js';

function setup(hubs) {
  const network = createNetwork(hubs);
  return { network, client: createClient({ fetch: network.fetch }) };
}

test('detects a Gen 2 hub: serial, name, firmware', async () => {
  const { client } = setup([createHub({ generation: 2, host: '192.0.2.10' })]);
  assert.deepEqual(await client.detectHub('192.0.2.10'), {
    host: '192.0.2.10',
    apiVersion: 2,
    generation: 2,
    serial: SERIALS[2],
    name: 'Powerview Generation 2',
    firmware: '2.0.1056',
    primary: true,
  });
});

test('detects a Gen 1 hub (no stop in its API)', async () => {
  const { client } = setup([createHub({ generation: 1, host: '192.0.2.11' })]);
  const hub = await client.detectHub('192.0.2.11');
  assert.equal(hub.apiVersion, 1);
  assert.equal(hub.serial, SERIALS[1]);
  assert.equal(hub.name, 'Powerview Generation 1');
});

test('detects a Gen 3 gateway, primary or secondary', async () => {
  const { client, network } = setup([
    createHub({ generation: 3, host: '192.0.2.20' }),
    createHub({ generation: 3, host: '192.0.2.21', secondary: true }),
  ]);
  const primary = await client.detectHub('192.0.2.20');
  assert.deepEqual(primary, {
    host: '192.0.2.20',
    apiVersion: 3,
    generation: 3,
    serial: SERIALS[3],
    // The gateway has no name of its own: the one of the home.
    name: 'Powerview Generation 3',
    firmware: '3.1.472',
    primary: true,
  });
  // Gen 1-2 first (404 on a Gen 3 gateway), then Gen 3: like aiopvapi.
  assert.deepEqual(
    network.requests.filter((r) => r.host === '192.0.2.20').map((r) => r.path),
    ['/api/fwversion', '/gateway/info', '/gateway', '/home'],
  );
  const secondary = await client.detectHub('192.0.2.21');
  assert.equal(secondary.serial, SECONDARY_SERIAL);
  assert.equal(secondary.primary, false);
});

test('an address without a hub: unreachable, or not a hub', async () => {
  const { client, network } = setup([]);
  await assert.rejects(client.detectHub('192.0.2.99'), (err) => {
    assert.ok(err instanceof PowerViewError);
    assert.match(err.message, /192\.0\.2\.99 unreachable \(ECONNREFUSED\)/);
    return true;
  });
  // A host down is not asked twice.
  assert.equal(network.requests.length, 1);

  const web = createClient({
    fetch: async () => new Response('<html>router</html>', { status: 200 }),
  });
  assert.equal(await web.detectHub('192.0.2.1'), null);
});

test('a hub in maintenance answers 423: a maintenance error', async () => {
  const hub = createHub({ generation: 2, host: '192.0.2.10' });
  hub.maintenance = true;
  const { client } = setup([hub]);
  await assert.rejects(
    client.detectHub('192.0.2.10'),
    (err) => err.maintenance === true && err.status === 423,
  );
});

test('no answer within the timeout: unreachable', async () => {
  const client = createClient({
    timeoutMs: 20,
    // The timeout timer does not hold the event loop: this one does.
    fetch: (url, { signal }) =>
      new Promise((_, reject) => {
        const hold = setTimeout(() => {}, 1000);
        signal.addEventListener('abort', () => {
          clearTimeout(hold);
          reject(signal.reason);
        });
      }),
  });
  await assert.rejects(
    client.getShades({ host: '192.0.2.10', apiVersion: 3 }),
    /unreachable \(no answer\)/,
  );
});

test('Gen 2 requests: shades, refresh, move, stop, jog, scene', async () => {
  const hub = createHub({ generation: 2, host: '192.0.2.10' });
  const { client } = setup([hub]);
  const target = { host: '192.0.2.10', apiVersion: 2 };
  assert.equal((await client.getShades(target)).length, 12);
  assert.equal((await client.getScenes(target)).length, 18);
  assert.equal((await client.getRooms(target)).length, 14);
  assert.equal((await client.refreshShade(target, 13542)).id, 13542);
  await client.moveShade(target, 13542, moveBody({ id: 13542, type: 6 }, 2, { primary: 100 }));
  await client.stopShade(target, 13542);
  await client.jogShade(target, 13542);
  const shadeIds = await client.activateScene(target, 61648);
  assert.ok(shadeIds.includes(26355));
  assert.deepEqual(
    hub.requests.slice(-4).map(({ method, path, query, body }) => ({ method, path, query, body })),
    [
      {
        method: 'PUT',
        path: '/api/shades/13542',
        query: '',
        body: { shade: { id: 13542, positions: { posKind1: 1, position1: MAX_RAW_V2 } } },
      },
      { method: 'PUT', path: '/api/shades/13542', query: '', body: { shade: { motion: 'stop' } } },
      { method: 'PUT', path: '/api/shades/13542', query: '', body: { shade: { motion: 'jog' } } },
      { method: 'GET', path: '/api/scenes', query: '?sceneId=61648', body: undefined },
    ],
  );
});

test('Gen 3 requests: shades, refresh, move, stop, jog, scene', async () => {
  const hub = createHub({ generation: 3, host: '192.0.2.20' });
  const { client } = setup([hub]);
  const target = { host: '192.0.2.20', apiVersion: 3 };
  assert.equal((await client.getShades(target)).length, 13);
  assert.equal((await client.getScenes(target)).length, hub.scenes.length);
  assert.equal((await client.refreshShade(target, 413)).id, 413);
  await client.moveShade(target, 413, moveBody({ id: 413, type: 6 }, 3, { primary: 50 }));
  await client.stopShade(target, 413);
  await client.jogShade(target, 413);
  assert.deepEqual(await client.activateScene(target, 253), [413, 22, 6539]);
  assert.deepEqual(
    hub.requests.slice(-5).map(({ method, path, query, body }) => ({ method, path, query, body })),
    [
      { method: 'GET', path: '/home/shades/413', query: '?refresh=true', body: undefined },
      {
        method: 'PUT',
        path: '/home/shades/positions',
        query: '?ids=413',
        body: { positions: { primary: 0.5 } },
      },
      { method: 'PUT', path: '/home/shades/stop', query: '?ids=413', body: undefined },
      { method: 'PUT', path: '/home/shades/413/motion', query: '', body: { motion: 'jog' } },
      { method: 'PUT', path: '/home/scenes/253/activate', query: '', body: undefined },
    ],
  );
});

test('an HTTP error says the status, never the body', async () => {
  const client = createClient({ fetch: async () => new Response('{}', { status: 500 }) });
  await assert.rejects(
    client.getShades({ host: '192.0.2.10', apiVersion: 2 }),
    /192\.0\.2\.10 answered HTTP 500 to GET \/api\/shades/,
  );
  const empty = createClient({ fetch: async () => new Response(null, { status: 204 }) });
  assert.deepEqual(await empty.getShades({ host: '192.0.2.10', apiVersion: 3 }), []);
});
