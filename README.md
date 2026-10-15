# PowerView for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
controls **Hunter Douglas / Luxaflex PowerView** motorized shades through the
local API of the PowerView hub. No cloud, no account, no internet connection.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against real answers of PowerView hubs (Generation 1, 2 and
> 3, collected by the `aiopvapi` project and used by the Home Assistant tests),
> not against physical shades. Please report what works and what does not in
> the [issues](https://github.com/guim31/gladys-powerview/issues), with your hub
> generation and shade model.

## Features

- **Automatic discovery**: Generation 2 hubs announce `_powerview._tcp` and
  Generation 3 gateways `_PowerView-G3._tcp` in mDNS; the Gladys core browses
  for the integration (mediated network discovery). IP addresses can be typed
  for the hubs it does not see. The generation is detected from the API the hub
  answers; a secondary Gen 3 gateway is left to the primary one.
- **One device per shade**, with the shutter features of Gladys (curtain for the
  shades that move sideways): open / close / stop, position (0 % closed, 100 %
  open, top-down shades included), **slat tilt** for the shades with slats or
  vanes, both rails of the **top-down / bottom-up** shades, combined, front and
  rear positions of the **dual** shades (Duolite), **battery** level and **low
  battery** for the shades on batteries.
- **PowerView scenes**: one device per scene with a _Run the scene_ button, and
  the **Run a PowerView scene** scene action (it returns the number of shades
  moved).
- **Actions** in the Configuration screen: _Search for hubs_ (a report of what
  each hub has) and _Identify a shade_ (it jogs).
- **Refresh without draining batteries**: the positions are read from the hub's
  memory every 60 s by default; mains-powered shades are asked over the radio
  every 10 minutes; after a command the target shows at once and the shade is
  asked once it has arrived. Radio commands reach a hub one at a time.
- English, French, German and Spanish everywhere (configuration, messages,
  feature names, documentation).

No dashboard widget: the shades and scenes are devices, shown by the Gladys
_Devices_ box with their buttons and sliders.

## Requirements

- Gladys Assistant **5.1.0** or later (scene actions, mediated mDNS discovery).
- A PowerView **Generation 2 hub** or **Generation 3 gateway** (the Generation 1
  hub works, without stop) on the same local network as Gladys, with the shades
  already paired in the PowerView app.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `guim31/gladys-powerview` (or install **PowerView** from the store). The
   install screen shows the mDNS discovery request.
2. Open the **Discover** tab: the shades and scenes of the hubs found appear
   there. Add them.
3. A hub is missing? In **Configuration**, enter its IP address, save, and run
   **Search for hubs**. Give the hub a fixed address in your router if you can.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

```
Gladys core ──mDNS (_powerview._tcp, _powerview-g3._tcp)──▶ LAN   (the core browses)
     ▲
     │ SDK (WebSocket + host API)
Integration container ──HTTP GET /api/shades or /home/shades (hub memory, every 60 s)──▶ hub
                      ──HTTP PUT moves, stop, jog, scenes (one at a time, radio)──────▶ hub ~~▶ shades
```

| Generation | Detection            | Shades / scenes                    | Move                                     | Stop                                |
| ---------- | -------------------- | ---------------------------------- | ---------------------------------------- | ----------------------------------- |
| 1 and 2    | `GET /api/fwversion` | `GET /api/shades`, `/api/scenes`   | `PUT /api/shades/<id>` (0..65535)        | `PUT /api/shades/<id>` (Gen 2 only) |
| 3          | `GET /gateway/info`  | `GET /home/shades`, `/home/scenes` | `PUT /home/shades/positions?ids=` (0..1) | `PUT /home/shades/stop?ids=`        |

- A hub is identified by its **serial number**: a hub that changes IP address
  keeps its devices, and a hub silent for 5 minutes is looked for again.
- A shade's kind (bottom-up, tilt on closed 90° or 180°, tilt anywhere,
  vertical, tilt only, top-down, top-down/bottom-up, dual, dual with tilt) is
  read from its type, then its capability, like `aiopvapi`; it decides the
  features and how a position is sent.
- Only the **changes** are published to Gladys, with a heartbeat every 6 hours.
- The core cannot be trusted to poll external devices (GladysAssistant/Gladys
  #3198): the container refreshes by itself, and the core's `onPoll` is only a
  fallback.
- What the integration knows of the hubs is kept in
  `/data/powerview-state.json`, so the devices stay in the Discover list while a
  hub is off. No dependency beside the Gladys SDK.

## Limitations

- **Developed without the hardware**: see above.
- Gladys has no tilt feature: the slats are a second shutter position (0-100 %;
  for 180° slats, 50 % is open). Voice assistants only see the main position.
- A battery shade moved with a remote shows its new position once the hub
  learns it: battery shades are never woken on a timer.
- The light of the Aura illuminated shades and the PowerView schedules are not
  driven.
- The core can only browse lowercase mDNS service types: a Gen 3 gateway
  announcing `_PowerView-G3._tcp` may not be found automatically (enter its
  address).
- The Generation 1 hub cannot stop a shade.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + simulated hubs on the SDK's fake Gladys
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
node scripts/probe.mjs <hub IP>                   # read-only probe of a real hub
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/app.js                handlers, actions, scene actions
src/hub.js                discovery, refresh timer, radio queue, commands
src/devices.js            shade / scene -> Gladys devices, states and moves
src/powerview/client.js   HTTP client of the Gen 1-2 and Gen 3 APIs
src/powerview/shade.js    shade kinds, position conversions, batteries
src/discovery.js          mDNS results
src/store.js              /data persistence
src/i18n.js               texts in four languages
scripts/probe.mjs         read-only probe of a real hub
test/                     node --test; SDK fake Gladys, simulated hubs
test/fixtures/powerview/  real hub answers (aiopvapi), anonymized
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="powerview" \
POWERVIEW_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [`aiopvapi`](https://github.com/sander76/aio-powerview-api) by Sander
  Teunissen and contributors (BSD 3-Clause): the shade types and capabilities,
  the position conversions and their quirks, the Gen 1-2 and Gen 3 endpoints;
  the test fixtures in `test/fixtures/powerview/` are real hub answers from its
  test suite (anonymized, license in that folder).
- Home Assistant's
  [`hunterdouglas_powerview`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/hunterdouglas_powerview)
  integration (Apache-2.0): how the two-rail and dual shades are driven, the
  move-time estimate, the radio lock and the battery-safe refresh.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Hunter Douglas or
Luxaflex. "PowerView", "Hunter Douglas" and "Luxaflex" are trademarks of their
owners.

## License

Apache-2.0
