// -----------------------------------------------------------------------------
// Configuration normalization: defaults, typed addresses, bounds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    hub_addresses: '',
    hosts: [],
    invalidHosts: [],
    language: 'fr',
    refresh_interval: 60,
  });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('typed addresses: separators, scheme, path, port, duplicates', () => {
  assert.deepEqual(
    parseHosts(' 192.0.2.10, http://192.0.2.11/api/shades ;192.0.2.12:8080 192.0.2.10'),
    {
      hosts: ['192.0.2.10', '192.0.2.11', '192.0.2.12:8080'],
      invalid: [],
    },
  );
  assert.deepEqual(parseHosts('PowerView-Hub.local'), {
    hosts: ['powerview-hub.local'],
    invalid: [],
  });
  assert.deepEqual(parseHosts('300.1.1.1, a b!, '), { hosts: ['a'], invalid: ['300.1.1.1', 'b!'] });
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('the refresh interval stays between 30 and 600 seconds', () => {
  assert.equal(normalizeConfig({ refresh_interval: 5 }).refresh_interval, 30);
  assert.equal(normalizeConfig({ refresh_interval: '120' }).refresh_interval, 120);
  assert.equal(normalizeConfig({ refresh_interval: 9999 }).refresh_interval, 600);
  assert.equal(normalizeConfig({ refresh_interval: 'soon' }).refresh_interval, 60);
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
});
