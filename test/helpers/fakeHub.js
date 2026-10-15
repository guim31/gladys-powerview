// -----------------------------------------------------------------------------
// Simulated PowerView hubs (Generation 1, 2 and 3) behind a `fetch` stand-in,
// answering with the real hub answers of test/fixtures/powerview. Moves,
// stops, jogs and scenes are recorded; a move updates the shade the way the
// hub does (its memory holds the new target). No network involved.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/powerview/', import.meta.url);

export const fixture = (path) => JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8'));

// The three fixture sets share one serial number: each simulated generation
// gets its own, so they can sit on the same network.
export const SERIALS = { 1: 'PVGEN1TEST0001', 2: 'PVGEN2TEST0002', 3: 'A1B2C3D4E5G6H7' };
export const SECONDARY_SERIAL = 'Z9Y8X7W6V5U4T3';

/**
 * @param {object} options
 * @param {1|2|3} options.generation
 * @param {string} options.host
 * @param {boolean} [options.secondary] a secondary Gen 3 gateway
 * @param {string} [options.serial]
 */
export function createHub({ generation, host, secondary = false, serial }) {
  const hub = {
    generation,
    host,
    secondary,
    serial: serial ?? (secondary ? SECONDARY_SERIAL : SERIALS[generation]),
    up: true,
    maintenance: false,
    requests: [],
    /** Radio operations, in order: { kind, id, body } */
    radio: [],
  };
  if (generation === 3) {
    hub.shades = fixture('gen3/home/shades.json');
    hub.scenes = fixture('gen3/home/scenes.json');
    hub.rooms = fixture('gen3/home/rooms.json');
    hub.home = fixture('gen3/home/home.json');
    hub.gateway = fixture(secondary ? 'gen3/gateway/secondary.json' : 'gen3/gateway/primary.json');
    hub.gateway.config.serialNumber = hub.serial;
    hub.info = { ...fixture('gen3/gateway/info.json'), serialNumber: hub.serial };
  } else {
    const dir = `gen${generation}`;
    hub.shades = fixture(`${dir}/shades.json`).shadeData;
    hub.scenes = fixture(`${dir}/scenes.json`).sceneData;
    hub.rooms = fixture(`${dir}/rooms.json`).roomData;
    hub.members = fixture(`${dir}/scenemembers.json`).sceneMemberData;
    hub.fwversion = fixture(`${dir}/fwversion.json`);
    hub.userdata = fixture(`${dir}/userdata.json`);
    hub.userdata.userData.serialNumber = hub.serial;
  }
  return hub;
}

/** The shade entry of a simulated hub. */
export const shadeOf = (hub, id) => hub.shades.find((shade) => shade.id === id);

const json = (body, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function route(hub, method, url, body) {
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams);
  const legacy = hub.generation < 3;
  const segments = path.split('/').filter(Boolean);

  if (legacy && segments[0] === 'api') {
    if (method === 'GET' && path === '/api/fwversion') return json(hub.fwversion);
    if (method === 'GET' && path === '/api/userdata') return json(hub.userdata);
    if (method === 'GET' && path === '/api/rooms') return json({ roomData: hub.rooms });
    if (method === 'GET' && path === '/api/shades') {
      return json({ shadeIds: hub.shades.map((s) => s.id), shadeData: hub.shades });
    }
    if (method === 'GET' && path === '/api/scenes') {
      if (query.sceneId !== undefined) {
        const sceneId = Number(query.sceneId);
        hub.radio.push({ kind: 'scene', id: sceneId });
        const shadeIds = hub.members.filter((m) => m.sceneId === sceneId).map((m) => m.shadeId);
        return json({ shadeIds });
      }
      return json({ sceneIds: hub.scenes.map((s) => s.id), sceneData: hub.scenes });
    }
    if (segments[1] === 'shades' && segments.length === 3) {
      const shade = shadeOf(hub, Number(segments[2]));
      if (!shade) return json({ errMsg: 'not found' }, 404);
      if (method === 'GET') {
        if (query.refresh === 'true') hub.radio.push({ kind: 'refresh', id: shade.id });
        return json({ shade });
      }
      if (method === 'PUT') {
        if (body?.shade?.motion) {
          hub.radio.push({ kind: body.shade.motion, id: shade.id, body });
        } else if (body?.shade?.positions) {
          hub.radio.push({ kind: 'move', id: shade.id, body });
          shade.positions = { ...body.shade.positions };
        }
        return json({ shade });
      }
    }
    return json({ errMsg: 'not found' }, 404);
  }

  if (!legacy) {
    if (method === 'GET' && path === '/gateway/info') return json(hub.info);
    if (method === 'GET' && path === '/gateway') return json(hub.gateway);
    if (method === 'GET' && path === '/home') return json(hub.home);
    if (method === 'GET' && path === '/home/shades') return json(hub.shades);
    if (method === 'GET' && path === '/home/scenes') return json(hub.scenes);
    if (method === 'GET' && path === '/home/rooms') return json(hub.rooms);
    if (method === 'PUT' && path === '/home/shades/positions') {
      const shade = shadeOf(hub, Number(query.ids));
      if (!shade) return json({ errMsg: 'not found' }, 404);
      hub.radio.push({ kind: 'move', id: shade.id, body });
      shade.positions = { ...shade.positions, ...body.positions };
      return json({ responses: [{ id: shade.id, err: 0 }] });
    }
    if (method === 'PUT' && path === '/home/shades/stop') {
      hub.radio.push({ kind: 'stop', id: Number(query.ids) });
      return json({ responses: [{ id: Number(query.ids), err: 0 }] });
    }
    if (segments[0] === 'home' && segments[1] === 'shades' && segments.length >= 3) {
      const shade = shadeOf(hub, Number(segments[2]));
      if (!shade) return json({ errMsg: 'not found' }, 404);
      if (method === 'GET' && segments.length === 3) {
        if (query.refresh === 'true') hub.radio.push({ kind: 'refresh', id: shade.id });
        return json(shade);
      }
      if (method === 'PUT' && segments[3] === 'motion') {
        hub.radio.push({ kind: body.motion, id: shade.id, body });
        return json({});
      }
    }
    if (method === 'PUT' && segments[1] === 'scenes' && segments[3] === 'activate') {
      const scene = hub.scenes.find((s) => s.id === Number(segments[2]));
      if (!scene) return json({ errMsg: 'not found' }, 404);
      hub.radio.push({ kind: 'scene', id: scene.id });
      return json(scene.shadeIds);
    }
  }
  return json({ errMsg: 'not found' }, 404);
}

/**
 * A network of simulated hubs, and the `fetch` that reaches them. An address
 * with no hub refuses the connection, like a real one.
 * @param {Array} hubs from createHub
 */
export function createNetwork(hubs = []) {
  const network = {
    hubs,
    requests: [],
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
      network.requests.push({ host, method, path: url.pathname, query: url.search, body });
      const hub = network.hubs.find((candidate) => candidate.host === host);
      if (!hub || !hub.up) {
        const error = new TypeError('fetch failed');
        error.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        throw error;
      }
      hub.requests.push({ method, path: url.pathname, query: url.search, body });
      if (hub.maintenance) {
        return json({ errMsg: 'maintenance' }, 423);
      }
      return route(hub, method, url, body);
    },
    /** The raw mDNS results the core would relay for these hubs. */
    mdnsResults() {
      return network.hubs.map((hub) => ({
        name: `${hub.serial}.${hub.generation === 3 ? '_powerview-g3' : '_powerview'}._tcp.local`,
        host: `powerview-${hub.serial}.local`,
        addresses: [hub.host],
        port: 80,
        txt: [],
      }));
    },
  };
  return network;
}
