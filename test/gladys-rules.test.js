// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// hub answers: the twelve kinds of shade of Gen 2 and Gen 3 hubs, the Gen 1
// blinds, the scenes — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHub } from './helpers/fakeHub.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const allHubs = () => [
  createHub({ generation: 1, host: '192.0.2.11' }),
  createHub({ generation: 2, host: '192.0.2.10' }),
  createHub({ generation: 3, host: '192.0.2.20' }),
];

for (const language of ['fr', 'en', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language})`, async () => {
    const { gladys, app } = await createWorld({ hubs: allHubs(), config: { language } });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.ok(
        devices.length >= 80,
        `expected the fixture shades and scenes, got ${devices.length}`,
      );
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(
          typeof device.name === 'string' && device.name.trim() !== '',
          'device without name',
        );
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }
        for (const param of device.params ?? []) {
          assert.ok(!/^GLADYS_/i.test(param.name), `${where}: reserved param ${param.name}`);
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: external_id`);
          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(typeof feature.name === 'string' && feature.name !== '', `${at}: no name`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      app.stop();
    }
  });
}

test('every kind of shade is among the checked devices', async () => {
  const { gladys, app } = await createWorld({ hubs: allHubs() });
  try {
    const kinds = new Set(
      gladys.fake.discoveredDevices.flatMap((device) =>
        (device.params ?? []).filter((p) => p.name === 'SHADE_KIND').map((p) => p.value),
      ),
    );
    assert.equal(kinds.size, 13);
  } finally {
    app.stop();
  }
});
