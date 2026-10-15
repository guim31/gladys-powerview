// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, for the texts the container writes. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Bounds of the refresh interval, in seconds. Reading the shade list answers
// from the hub's memory (no radio): once a minute is what Home Assistant does,
// 30 s keeps a hub comfortable.
export const REFRESH_MIN_SECONDS = 30;
export const REFRESH_MAX_SECONDS = 600;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  // Hub addresses typed by the user, for the hubs mDNS does not find.
  hub_addresses: '',
  // Language of the device and feature names the integration creates.
  language: 'fr',
  // Seconds between two reads of the shade positions.
  refresh_interval: 60,
};

// An IPv4 address or a host name, with an optional port.
const HOST =
  /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9-]{1,63})*)(?::\d{1,5})?$/i;

/**
 * Split the typed addresses: commas, semicolons or spaces between them; a
 * scheme or a trailing path (pasted from a browser) is dropped.
 * @param {unknown} value
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(value) {
  const hosts = [];
  const invalid = [];
  for (const part of String(value ?? '').split(/[\s,;]+/)) {
    const host = part
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (host === '') {
      continue;
    }
    const octetsOk =
      !/^\d+(\.\d+){3}/.test(host) || host.split(/[.:]/, 4).every((n) => Number(n) <= 255);
    if (HOST.test(host) && octetsOk) {
      if (!hosts.includes(host)) {
        hosts.push(host);
      }
    } else {
      invalid.push(part.trim());
    }
  }
  return { hosts, invalid };
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const { hosts, invalid } = parseHosts(raw.hub_addresses);
  const interval = Math.round(Number(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval));
  return {
    hub_addresses: String(raw.hub_addresses ?? DEFAULT_CONFIG.hub_addresses),
    hosts,
    invalidHosts: invalid,
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language,
    refresh_interval: Number.isFinite(interval)
      ? Math.min(REFRESH_MAX_SECONDS, Math.max(REFRESH_MIN_SECONDS, interval))
      : DEFAULT_CONFIG.refresh_interval,
  };
}
