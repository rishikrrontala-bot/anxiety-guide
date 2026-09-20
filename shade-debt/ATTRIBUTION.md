# Attribution

## Imagery

Every image on this site is real Earth observation data, fetched from NASA at
runtime. **No stock photography, no illustration, and no gradient standing in
for a photograph.** If NASA cannot be reached, the panels stay empty and say so
rather than showing something invented.

| Where | What | Source |
|---|---|---|
| Hero globe texture | Blue Marble, shaded relief and bathymetry — stitched live from EPSG:4326 tiles | [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) |
| Method panels | MODIS land surface temperature, MODIS NDVI, SEDAC gridded population — real tiles, decoded in the page | NASA GIBS / [NASA SEDAC](https://sedac.ciesin.columbia.edu/data/collection/gpw-v4) |
| Analysis map overlay | The same MODIS and SEDAC layers, sampled over the study area | NASA GIBS / NASA SEDAC |
| Climate record | Four decades of temperature by coordinate | [NASA POWER](https://power.larc.nasa.gov/) |
| Street basemap | Dark cartography under the analysis grid | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions) |

NASA does not endorse this project. Its data is used under NASA's open data
policy, which places most of it in the public domain.

The scatter demonstration in the *Calibrated here* section uses **synthetic
points**, labelled as such in the interface. It demonstrates the behaviour of
the estimator; it is not a measurement of anywhere.

## Typefaces

Both self-hosted as woff2 in `fonts/`. Nothing is requested from a font CDN.

| Family | Use | Licence |
|---|---|---|
| **Instrument Serif** — Rodrigo Fuenzalida, Jordan Egstad | Display | SIL Open Font License 1.1 |
| **Schibsted Grotesk** — Schibsted / Bakken & Bæck | Text and UI | SIL Open Font License 1.1 |

## Libraries

All vendored into `vendor/`. The site makes **no third-party CDN requests**.

| Library | Version | Use | Licence |
|---|---|---|---|
| [Three.js](https://threejs.org/) | 0.186.0 | The globe. Tree-shaken to only the classes used, then minified — 528 KB, ~132 KB over the wire | MIT |
| [GSAP](https://gsap.com/) + ScrollTrigger | 3.15.0 | Reveals, the pinned section, page transitions | GSAP Standard "no charge" licence |
| [Lenis](https://lenis.darkroom.engineering/) | 1.3.26 | Scroll smoothing | MIT |
| [Leaflet](https://leafletjs.com/) | 1.9.4 | The analysis map | BSD-2-Clause |

## Test fixtures

`test/fixtures/` contains two unmodified GIBS ColorMap documents copied from NASA's
[`nasa-gibs/onearth`](https://github.com/nasa-gibs/onearth) repository (Apache-2.0; the
documents themselves are NASA-produced). They are there so the palette parser is tested
against the format NASA actually publishes rather than against a fixture written to
match the parser — which is how the cross-block no-data bug was found. Provenance is
recorded in `test/fixtures/README.md`.

## Method references

- Carlson, T.N. & Ripley, D.A. (1997). *On the relation between NDVI, fractional
  vegetation cover, and leaf area index.* Remote Sensing of Environment, 62(3),
  241–252. — the fractional vegetation cover formula behind the tree counts.
- Sen, P.K. (1968). *Estimates of the regression coefficient based on Kendall's
  tau.* Journal of the American Statistical Association, 63(324), 1379–1389. —
  the robust estimator used for the cooling slope.

## Design reference

The site's temperament — type-led motion, deliberate pacing, restraint over
decoration — is a deliberate study of [Unseen Studio](https://unseen.co/),
Awwwards Design Studio of the Year. Nothing was copied: no asset, no markup, no
stylesheet. The palette, typefaces, layout, copy and motion here are original
work for this project.
