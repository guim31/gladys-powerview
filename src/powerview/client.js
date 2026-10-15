// -----------------------------------------------------------------------------
// HTTP client of the PowerView hubs (local API, no account, no token).
//
// Two dialects, chosen by the generation of the hub:
//   - Generation 1 and 2 (`/api/...`): `GET /api/fwversion`, `/api/userdata`,
//     `/api/shades`, `/api/scenes`, `/api/rooms`; a shade moves with
//     `PUT /api/shades/<id>` and a scene runs with `GET /api/scenes?sceneId=`;
//   - Generation 3 (`/home/...`, `/gateway`): `GET /gateway/info`,
//     `/gateway`, `/home/shades`, `/home/scenes`, `/home/rooms`; a shade
//     moves with `PUT /home/shades/positions?ids=<id>` and a scene runs with
//     `PUT /home/scenes/<id>/activate`.
// The endpoints and payloads are those of aiopvapi (BSD 3-Clause), used by
// the Home Assistant integration.
//
// Reading `/api/shades` or `/home/shades` answers from the hub's memory: no
// radio traffic, cheap. Moving, stopping, jogging, running a scene and
// `?refresh=true` go through the radio to the shades: the hub handles one
// at a time (src/hub.js queues them).
// -----------------------------------------------------------------------------

export const REQUEST_TIMEOUT_MS = 15000;

export class PowerViewError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, maintenance?: boolean, cause?: Error }} [details]
   */
  constructor(message, { status, maintenance = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PowerViewError';
    this.status = status;
    // HTTP 423: the hub is busy with its own maintenance (the nightly reboot
    // of the Gen 2 hubs, a firmware update). Expected, and short.
    this.maintenance = maintenance;
  }
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 */
export function createClient({ fetch = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  /**
   * One request to a hub. Resolves the JSON answer, null for an empty one.
   * @param {string} host `192.0.2.10` or `192.0.2.10:8080`
   * @param {'GET'|'PUT'} method
   * @param {string} path
   * @param {{ query?: Record<string, string|number>, body?: object }} [options]
   */
  async function request(host, method, path, { query, body } = {}) {
    const url = new URL(`http://${host}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'no answer' : (err?.cause?.code ?? err.message);
      throw new PowerViewError(`${host} unreachable (${reason})`, { cause: err });
    }
    if (response.status === 423) {
      throw new PowerViewError(`${host} is busy with its maintenance (HTTP 423)`, {
        status: 423,
        maintenance: true,
      });
    }
    if (response.status === 204) {
      return null;
    }
    if (!response.ok) {
      throw new PowerViewError(`${host} answered HTTP ${response.status} to ${method} ${path}`, {
        status: response.status,
      });
    }
    const text = await response.text();
    if (text.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      // An answer, but not the JSON of a hub: the status says it was reached.
      throw new PowerViewError(`${host} sent an invalid answer to ${method} ${path}`, {
        status: response.status,
        cause: err,
      });
    }
  }

  const get = (host, path, query) => request(host, 'GET', path, { query });
  const put = (host, path, body, query) => request(host, 'PUT', path, { body, query });

  /** `{ apiVersion }` from a Gen 1-2 firmware block, null when it is not one. */
  function versionFrom(firmware) {
    const revision = Number(firmware?.mainProcessor?.revision);
    return Number.isInteger(revision) && revision > 0 ? revision : null;
  }

  async function detectLegacy(host) {
    const fwversion = await get(host, '/api/fwversion');
    let userData = null;
    try {
      userData = (await get(host, '/api/userdata'))?.userData ?? null;
    } catch (err) {
      if (err.maintenance) {
        throw err;
      }
    }
    // The oldest Gen 1 firmwares answer without a firmware block.
    const apiVersion =
      versionFrom(userData?.firmware) ?? versionFrom(fwversion?.firmware) ?? (fwversion ? 1 : null);
    if (apiVersion === null || apiVersion >= 3) {
      return null;
    }
    const main = userData?.firmware?.mainProcessor ?? fwversion?.firmware?.mainProcessor;
    return {
      host,
      apiVersion,
      generation: apiVersion,
      serial: cleanId(userData?.serialNumber) || cleanId(userData?.macAddress),
      name: decodeHubName(userData?.hubName),
      firmware: firmwareString(main),
      primary: true,
    };
  }

  async function detectGen3(host) {
    const info = await get(host, '/gateway/info');
    if (!info || typeof info !== 'object') {
      return null;
    }
    const config = (await get(host, '/gateway'))?.config ?? {};
    const serial = cleanId(config.serialNumber ?? info.serialNumber);
    const mac = config.networkStatus?.primaryMacAddress;
    // A secondary gateway of a multi-gateway home only repeats the primary
    // one: the shades and scenes are driven through the primary.
    const multiGateway = config.mgwStatus?.running === true;
    const primary = !multiGateway || config.mgwConfig?.primary === true;
    let name = typeof config.hubName === 'string' ? config.hubName : '';
    if (!name) {
      try {
        const home = await get(host, '/home');
        const gateway = (home?.gateways ?? []).find(
          (entry) => cleanId(entry?.serial) === serial || (mac && entry?.mac === mac),
        );
        name = typeof gateway?.name === 'string' ? gateway.name : '';
      } catch {
        // The name is a nicety: the hub works without it.
      }
    }
    return {
      host,
      apiVersion: 3,
      generation: 3,
      serial: serial || cleanId(mac),
      name,
      firmware: firmwareString(config.firmware?.mainProcessor) || String(info.fwVersion ?? ''),
      primary,
    };
  }

  return {
    request,

    /**
     * Find out which hub answers at `host`: its generation, serial number,
     * name and firmware. Tries the Gen 1-2 API first, then the Gen 3 one
     * (the order of aiopvapi). Resolves null when neither answers like a hub.
     * @param {string} host
     */
    async detectHub(host) {
      for (const detect of [detectLegacy, detectGen3]) {
        try {
          const hub = await detect(host);
          if (hub?.serial) {
            return hub;
          }
        } catch (err) {
          // An HTTP error status means "not this dialect": try the next one.
          // No answer at all, or a hub in maintenance, ends the detection.
          if (err.maintenance || err.status === undefined) {
            throw err;
          }
        }
      }
      return null;
    },

    /** Every shade entry of the hub, from its memory (no radio). */
    async getShades(hub) {
      if (hub.apiVersion >= 3) {
        const shades = await get(hub.host, '/home/shades');
        return Array.isArray(shades) ? shades : [];
      }
      const answer = await get(hub.host, '/api/shades');
      return Array.isArray(answer?.shadeData) ? answer.shadeData : [];
    },

    /**
     * One shade entry, asking the shade itself over the radio (`refresh`):
     * how Home Assistant catches a move made with a remote.
     */
    async refreshShade(hub, shadeId) {
      if (hub.apiVersion >= 3) {
        return get(hub.host, `/home/shades/${shadeId}`, { refresh: 'true' });
      }
      return (await get(hub.host, `/api/shades/${shadeId}`, { refresh: 'true' }))?.shade ?? null;
    },

    /** Every scene of the hub: `[{ id, name, roomIds }]` as the hub sends them. */
    async getScenes(hub) {
      if (hub.apiVersion >= 3) {
        const scenes = await get(hub.host, '/home/scenes');
        return Array.isArray(scenes) ? scenes : [];
      }
      const answer = await get(hub.host, '/api/scenes');
      return Array.isArray(answer?.sceneData) ? answer.sceneData : [];
    },

    /** Every room of the hub. */
    async getRooms(hub) {
      if (hub.apiVersion >= 3) {
        const rooms = await get(hub.host, '/home/rooms');
        return Array.isArray(rooms) ? rooms : [];
      }
      const answer = await get(hub.host, '/api/rooms');
      return Array.isArray(answer?.roomData) ? answer.roomData : [];
    },

    /**
     * Move a shade. `body` comes from moveBody (src/powerview/shade.js).
     * @param {object} hub
     * @param {number} shadeId
     * @param {object} body
     */
    async moveShade(hub, shadeId, body) {
      if (hub.apiVersion >= 3) {
        return put(hub.host, '/home/shades/positions', body, { ids: shadeId });
      }
      return put(hub.host, `/api/shades/${shadeId}`, body);
    },

    /** Stop a moving shade. The Gen 1 API has no stop (callers check first). */
    async stopShade(hub, shadeId) {
      if (hub.apiVersion >= 3) {
        return put(hub.host, '/home/shades/stop', undefined, { ids: shadeId });
      }
      return put(hub.host, `/api/shades/${shadeId}`, { shade: { motion: 'stop' } });
    },

    /** Make a shade jog (a short up and down move) so the user can spot it. */
    async jogShade(hub, shadeId) {
      if (hub.apiVersion >= 3) {
        return put(hub.host, `/home/shades/${shadeId}/motion`, { motion: 'jog' });
      }
      return put(hub.host, `/api/shades/${shadeId}`, { shade: { motion: 'jog' } });
    },

    /**
     * Run a scene of the hub. Resolves the ids of the shades it moves, when
     * the hub says (an empty list otherwise).
     */
    async activateScene(hub, sceneId) {
      const answer =
        hub.apiVersion >= 3
          ? await put(hub.host, `/home/scenes/${sceneId}/activate`)
          : await get(hub.host, '/api/scenes', { sceneId });
      const ids = Array.isArray(answer) ? answer : answer?.shadeIds;
      return Array.isArray(ids) ? ids : [];
    },
  };
}

/** A serial number or MAC address, reduced to letters and digits (a stable id). */
function cleanId(value) {
  return typeof value === 'string' ? value.replace(/[^0-9A-Za-z]/g, '') : '';
}

function decodeHubName(value) {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  return decoded.includes('�') ? value : decoded.trim();
}

function firmwareString(main) {
  if (!main || main.revision === undefined) {
    return '';
  }
  return `${main.revision}.${main.subRevision ?? 0}.${main.build ?? 0}`;
}
