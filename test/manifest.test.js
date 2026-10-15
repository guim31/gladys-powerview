// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  REFRESH_MAX_SECONDS,
  REFRESH_MIN_SECONDS,
} from '../src/config.js';
import { MDNS_SERVICES } from '../src/discovery.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[...(manifest.actions ?? []), ...(manifest.scene_actions ?? [])].flatMap(
    (item) => item.fields ?? [],
  ),
];

// The integration on the SDK's fake Gladys, with no hub around.
const world = await createWorld({ hubs: [] });
world.app.stop();
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, category, mDNS capture', () => {
  assert.equal(manifest.name, 'PowerView');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-powerview:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-powerview/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  // "Lighting, plugs & covers" in the store.
  assert.deepEqual(manifest.categories, ['lighting']);
  assert.deepEqual(
    manifest.network_discovery,
    MDNS_SERVICES.map((service) => ({ type: 'mdns', service })),
  );
  for (const { service } of manifest.network_discovery) {
    // The core's schema only accepts lowercase service types.
    assert.match(service, /^_[a-z0-9-]+\._(tcp|udp)$/);
  }
});

test('every manifest action has a handler', async () => {
  for (const action of manifest.actions) {
    const ack = await world.gladys.fake.action(action.key, {});
    assert.equal(ack.success, true, `action "${action.key}": ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.actions), ['search', 'identify']);
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions), Object.keys(SCENE_ACTIONS));
  // Each output the handler resolves is declared.
  assert.deepEqual(keysOf(manifest.scene_actions[0].outputs), ['shade_count']);
});

test('no widget and no scene trigger: a shade state is a device feature', () => {
  assert.equal(manifest.widgets, undefined);
  assert.equal(manifest.scene_triggers, undefined);
});

test('scene actions and catalog categories require their Gladys version', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  const stored = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(stored.map((field) => field.key).sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of stored) {
    assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
  }
  const interval = manifest.config_schema.find((field) => field.key === 'refresh_interval');
  assert.deepEqual([interval.min, interval.max], [REFRESH_MIN_SECONDS, REFRESH_MAX_SECONDS]);
  // Number fields are rendered without `step`: integer min and default only.
  assert.ok(Number.isInteger(interval.min) && Number.isInteger(interval.default));
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(
    language.options.map((option) => option.value),
    LANGUAGES,
  );
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamic = allFields.filter((f) => f.source !== undefined);
  assert.deepEqual(
    dynamic.map((f) => f.key),
    ['device', 'scene'],
  );
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('no secret anywhere: the PowerView local API has no password', () => {
  assert.ok(allFields.every((field) => field.type !== 'secret'));
});

test('an action applies no default and refuses secrets (Gladys#3154, #3155)', () => {
  for (const field of [...manifest.actions, ...manifest.scene_actions].flatMap(
    (a) => a.fields ?? [],
  )) {
    if (field.required) {
      assert.equal(field.default, undefined, `${field.key}: a required field with a default`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object');
    assert.ok(field.placeholder.en);
  }
});
