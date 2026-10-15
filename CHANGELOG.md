# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Hunter Douglas / Luxaflex PowerView motorized shades in Gladys, locally
  through the hub: Generation 2 hubs, Generation 3 gateways, and Generation 1
  hubs (without stop). No account, no internet connection.
- Hubs found automatically through Gladys (mDNS), or by their IP address; a
  secondary Generation 3 gateway is left to the primary one, and a hub that
  changes its address is found again.
- One device per shade: open, close and stop, position (0 % closed, 100 %
  open, top-down shades included), slat tilt for the shades with slats, both
  rails of the top-down/bottom-up shades, combined, front and rear positions of
  the dual shades (Duolite), battery level and low battery for the shades on
  batteries. Curtains and vertical slats show as curtains.
- One device per PowerView scene, with a button that runs it, and the "Run a
  PowerView scene" scene action, which returns the number of shades moved.
- "Search for hubs" and "Identify a shade" actions in the Configuration screen.
- The positions refresh by themselves (every 60 seconds by default) without
  waking the shades on batteries; mains-powered shades are asked their real
  position every 10 minutes; after a command, the target shows at once and the
  shade is asked once it has arrived. Radio commands reach a hub one at a time.
- English, French, German and Spanish, for the configuration, the messages,
  the feature names and the documentation.

[Unreleased]: https://github.com/guim31/gladys-powerview/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-powerview/releases/tag/v1.0.1
