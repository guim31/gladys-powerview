// -----------------------------------------------------------------------------
// Where to look for PowerView hubs: the mDNS announcements relayed by the
// Gladys core (declared in the manifest `network_discovery`), the addresses
// typed in the configuration, and the addresses already known.
//
// The integration container sits on a bridge network: it never sees mDNS
// itself, the core browses for it (mediated network discovery). Each address
// is then probed over HTTP, and the serial number the hub reports identifies
// it whatever address it answers on.
// -----------------------------------------------------------------------------

// Gen 2 hubs announce `_powerview._tcp`, Gen 3 gateways `_PowerView-G3._tcp`
// (the services Home Assistant listens to). The manifest only accepts
// lowercase service types; see CLAUDE.md about the case of the Gen 3 one.
export const MDNS_SERVICES = ['_powerview._tcp', '_powerview-g3._tcp'];
export const MDNS_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Candidate addresses from the raw mDNS results of `scanNetwork('mdns')`
 * (`[{ name, host, addresses, port, txt }]`): IPv4 only (a link-local IPv6
 * address cannot be reached from the container), the port when it is not 80.
 * @param {unknown} results
 * @returns {string[]}
 */
export function mdnsHosts(results) {
  const hosts = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || typeof result !== 'object') {
      continue;
    }
    const addresses = Array.isArray(result.addresses) ? result.addresses : [];
    const ipv4 = addresses.find((address) => typeof address === 'string' && IPV4.test(address));
    if (!ipv4) {
      continue;
    }
    const port = Number.isInteger(result.port) && result.port !== 80 ? `:${result.port}` : '';
    const host = `${ipv4}${port}`;
    if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
