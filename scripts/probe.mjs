#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real PowerView hub, through the integration's own client
// and model: run it from a machine on the hub's network.
//
//   node scripts/probe.mjs 192.168.1.40
//   node scripts/probe.mjs 192.168.1.40 --raw   # also print the raw shade entries
//
// It only sends GET requests the hub answers from its memory (no `?refresh`,
// no move, no scene): no shade moves, no battery is used. The serial number
// and the MAC address are masked; the shade and scene names are printed (they
// are the user's own), the raw entries only with --raw.
// -----------------------------------------------------------------------------

import { createClient } from '../src/powerview/client.js';
import { shadeFeatureKeys, shadeValues } from '../src/devices.js';
import {
  SHADE_KINDS,
  battery,
  entryName,
  isHardwired,
  readPositions,
  shadeKind,
} from '../src/powerview/shade.js';

const [host, flag] = process.argv.slice(2);
if (!host || host.startsWith('-')) {
  console.error('Usage: node scripts/probe.mjs <hub IP address> [--raw]');
  process.exit(2);
}

const mask = (value) => (value ? `…${String(value).slice(-4)}` : '(none)');
const client = createClient();

try {
  const hub = await client.detectHub(host);
  if (!hub) {
    console.log(`${host} answers, but not like a PowerView hub (neither /api nor /gateway).`);
    process.exit(1);
  }
  console.log(
    `Hub: Gen ${hub.generation} (API v${hub.apiVersion}), firmware ${hub.firmware || '?'}, ` +
      `name "${hub.name}", serial ${mask(hub.serial)}, ` +
      `${hub.primary ? 'primary' : 'SECONDARY gateway (drive the primary one)'}`,
  );

  const [shades, scenes, rooms] = await Promise.all([
    client.getShades(hub),
    client.getScenes(hub),
    client.getRooms(hub).catch((err) => {
      console.log(`Rooms: not read (${err.message})`);
      return [];
    }),
  ]);
  const roomNames = new Map(rooms.map((room) => [room.id, entryName(room)]));
  console.log(`\n${shades.length} shade(s):`);
  for (const raw of shades) {
    const kind = shadeKind(raw);
    const known = SHADE_KINDS[kind];
    const power = isHardwired(raw, hub.apiVersion)
      ? 'mains'
      : battery(raw, hub.apiVersion).powered
        ? 'battery'
        : 'unknown power';
    console.log(
      `- #${raw.id} "${entryName(raw)}" (${roomNames.get(raw.roomId) ?? 'no room'}): ` +
        `type ${raw.type}, capabilities ${raw.capabilities ?? '?'} → ${kind}` +
        `${known.vertical ? ' (curtain)' : ''}, ${power}`,
    );
    console.log(`    positions (%): ${JSON.stringify(readPositions(raw, hub.apiVersion))}`);
    console.log(`    features: ${shadeFeatureKeys(raw, hub.apiVersion).join(', ')}`);
    console.log(`    Gladys values: ${JSON.stringify(shadeValues(raw, hub.apiVersion))}`);
    if (flag === '--raw') {
      const { name, ...rest } = raw;
      console.log(`    raw: ${JSON.stringify({ ...rest, name: name ? '(base64)' : undefined })}`);
    }
  }
  console.log(`\n${scenes.length} scene(s):`);
  for (const raw of scenes) {
    console.log(`- #${raw.id} "${entryName(raw)}"`);
  }
} catch (err) {
  console.error(`Probe failed: ${err.message}`);
  process.exit(1);
}
