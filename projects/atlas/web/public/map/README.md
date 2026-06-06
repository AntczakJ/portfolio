# Keyless basemap — self-hosted Protomaps `.pmtiles`

The map renders **keyless** (ADR-006): the default basemap is a self-hosted
Protomaps `.pmtiles` vector extract of the demo-city bbox, served **same-origin**
from this directory at `/map/porto.pmtiles` and read by MapLibre via the
`pmtiles://` protocol. No paid secret, no third-party tile host — the CSP stays
`connect-src 'self'`.

## What is committed vs generated

- The `.pmtiles` extract itself is **gitignored** (it is a large binary). It is
  generated from the demo-city bbox (`src/lib/fleet/demo-city.ts`
  `DEMO_CITY_BBOX`, Porto downtown core) and placed here at deploy time.
- A fresh checkout with **no** `.pmtiles` still renders a **keyless, CSP-clean,
  populated map**: the basemap style falls back to its painted background +
  graticule, and the fleet / routes / zones render on top (the fleet is the wow,
  keyless either way). The `style.load` path tolerates a missing source — the app
  layers are added regardless, so the map is never blank or broken without it.

## Generating the extract (deploy follow-up — Phase 9)

Use the Protomaps CLI / `pmtiles` tooling to extract the demo bbox from a global
Protomaps basemap build, e.g.:

```sh
# bbox = DEMO_CITY_BBOX (minLng,minLat,maxLng,maxLat) from demo-city.ts
pmtiles extract <source.pmtiles or url> porto.pmtiles \
  --bbox=-8.645,41.135,-8.585,41.165
```

Place the result here as `porto.pmtiles`. It is served with HTTP range support
by the Next static server (the `Cache-Control: immutable` header is set for
`/map/*` in `next.config.ts`). Verify the keyless render under a **prod build**
(`pnpm --filter atlas-web build && pnpm --filter atlas-web start`).

## Optional richer style (still no committed secret)

If a deploy supplies `NEXT_PUBLIC_MAP_TILE_KEY` + `NEXT_PUBLIC_MAP_TILE_HOST`
(see `.env.example`), the tile host is appended to the CSP and a richer keyed
style can be used. This is purely additive — the keyless self-hosted basemap is
the committed default and the hard gate.
