# Shade Debt

**The heat a neighbourhood owes to its missing trees — measured from orbit, in your browser.**

Shade Debt reads NASA satellite imagery directly in the browser, recovers physical
temperatures from it, and answers a question a city can act on: *of all the places we
could plant trees, which ones remove the most heat from the most people?*

It ends with a ranked list of coordinates, a GeoJSON file a city GIS office can open,
and a letter filled with the measured numbers, ready to send.

Built for **NextStep Hacks 2026** — theme *Earth Forward*.

---

## The idea

Urban heat is the deadliest climate hazard most people will personally meet, and it is
not distributed evenly. Within a single city, surface temperature routinely varies by
more than 10 °C, and the pattern tracks tree canopy almost everywhere it has been
studied.

Most heat maps stop at showing you that. Shade Debt goes one step further and asks how
much of each neighbourhood's heat is *avoidable* — the portion attributable to missing
vegetation — then weights that by the people who live there.

> **Shade debt**: the degrees Celsius of surface heat a cell carries because its
> vegetation falls short of the local target, using a cooling rate measured from that
> city's own satellite record.
>
> **Priority = shade debt × people in the cell**, giving **degree-persons**: avoidable
> heat multiplied by who benefits from removing it. No arbitrary weights.

## What it actually does

1. **Probes NASA GIBS** for the best available layers. Each product is tried across
   candidate tile matrix sets until one answers, so a renamed or retired layer degrades
   to the next best source instead of breaking the page.
2. **Fetches each layer's published colormap** and builds a reverse RGB → value lookup.
3. **Stitches tiles into a canvas and reads the pixels back**, inverting each one through
   that palette to recover a physical value. Units come from NASA's metadata, not from a
   hardcoded assumption.
4. **Composites across several dates** from the area's hottest season, hemisphere-aware,
   taking the per-cell median. Palette entries marked transparent or no-data decode to
   nothing, so **the cloud mask falls out of the method for free**.
5. **Calibrates the local cooling slope** by regressing surface temperature against NDVI
   across every valid cell, using the Theil–Sen estimator.
6. **Ranks cells** by degree-persons and renders the result.
7. **Cross-checks itself** against NASA POWER, an independent record built from different
   instruments, and reports the gap honestly rather than hiding it.

## Data sources — all free, all keyless

| Source | Used for | Resolution |
|---|---|---|
| NASA GIBS — MODIS Land Surface Temperature (Day & Night) | Surface heat, thermal mass | ~1 km |
| NASA GIBS — MODIS NDVI (8-day composite) | Vegetation cover | ~250 m–1 km |
| NASA GIBS — SEDAC Gridded Population of the World v4 | People exposed | ~1 km |
| NASA POWER | 40-year warming trend, independent cross-check | ~50 km |
| Open-Meteo Geocoding | Place search | — |

There is no backend, no API key, and no account. Nothing about the user's location is
uploaded anywhere — every request goes straight from the browser to NASA.

## Why night temperature is in here

Daytime peaks get the attention, but heat illness accumulates when the night does not
let the body recover. Shade Debt reads the **night** thermal band as well as the day
one, reports each cell's night excess against the local median, and derives a thermal
mass indicator from the day–night spread — hard surfaces store heat and release it
after dark. The NASA POWER panel reports the overnight-minimum trend separately for the
same reason.

---

## Method

### Recovering numbers from a picture

GIBS serves science layers as pre-coloured PNGs. NASA publishes the palette for each
layer as a ColorMap document mapping every RGB triplet to a physical interval:

```xml
<ColorMap title="Land Surface Temperature (Day)" units="K">
  <Entries>
    <ColorMapEntry rgb="0,0,0"     transparent="true"  value="[-9999,-9999]"/>
    <ColorMapEntry rgb="6,0,110"   transparent="false" value="[280,281)"/>
    <ColorMapEntry rgb="255,200,0" transparent="false" value="[320,321)"/>
  </Entries>
</ColorMap>
```

`js/colormap.js` parses that, takes each interval's midpoint, and builds an exact-match
map plus a nearest-neighbour fallback bounded by a distance tolerance — close colours
snap, unrelated colours decode to `null` rather than being forced to a wrong value.
Kelvin is converted using the `units` attribute, with a magnitude check only as a
fallback for layers that omit it.

Real documents declare no-data in a **separate** `ColorMap` block titled "No Data", so
the mask is the union of every block's transparent entries rather than just the data
block's. Reading only the data block leaves the fill colour unmasked, and a fill pixel
then gets nearest-matched to a real temperature — a silent corruption of the very cloud
mask this method depends on. The parser is tested against unmodified GIBS documents
taken from NASA's own `onearth` repository, which is how that was caught.

### Finding the palette in the first place

Colormap filenames do **not** match layer identifiers. NASA's own documentation pairs
the `AMSRU2_*` layers with a colormap called `AMSR_Surface_Precipitation.xml`: palettes
are named after the product and shared between the satellites carrying it. So the
filename is discovered, not constructed, in this order:

1. the URL resolved on a previous visit, remembered in `localStorage`;
2. the layer identifier itself, newest colormap version first — correct for SEDAC;
3. the identifier with the satellite removed, since Terra and Aqua share palettes;
4. **progressively shorter names**, walking the layer name down from most to least
   specific — satellite off, then trailing qualifiers, then the product token. Tokens
   are only ever dropped from the end and never substituted, so a `..._Day` layer can
   never arrive at a `..._Night` palette, and candidates never shrink to a stub like
   `MODIS_Terra` that names no product. This route asks only for colormap documents,
   which are known to be reachable cross-origin;
5. **the published colormap directory index**, matched by name: a candidate qualifies
   only when every one of its tokens appears in the layer's name, and the most specific
   qualifying candidate wins, so `MODIS_Land_Surface_Temp_Day` beats the shorter
   `MODIS_Land_Surface_Temp` and can never be confused with `..._Night`;
6. failing all of that, the href published for that layer in the WMTS capabilities
   document.

Steps 5 and 6 are exact but rely on responses this project cannot guarantee are
cross-origin readable — the index is an HTML listing, and capabilities is six
megabytes. Step 4 exists because it uses only requests known to work, so the palette
is still found when the exact routes are unavailable. Steps 5 and 6 are also
self-healing: if NASA renames a palette, the app finds the new name without a code
change.

### Calibrating, not assuming

The vegetation–temperature slope is measured per study area, never borrowed:

- **Theil–Sen** (median of all pairwise slopes) supplies the coefficient, because water
  bodies and cloud edges produce outliers that drag an ordinary least-squares fit off.
  The test suite demonstrates exactly this: with four contaminated cells in forty, OLS
  is wrong by more than 5 °C/NDVI while Theil–Sen stays within 0.5.
- **OLS R²** is reported alongside so the strength of the relationship is visible rather
  than implied, and the scatter plot is drawn so it can be judged by eye.
- If the measured slope is not negative, the model **reports zero debt** instead of
  inventing a number.

### From vegetation gap to tree count

Fractional vegetation cover follows Carlson & Ripley (1997):

```
FVC = ((NDVI − NDVI_soil) / (NDVI_veg − NDVI_soil))²        NDVI_soil = 0.05, NDVI_veg = 0.86
```

The FVC shortfall against the local target becomes canopy area, divided by 50 m² per
established street tree.

---

## Limitations, stated plainly

- **Land surface temperature is not air temperature.** It is the temperature of the
  ground, and on a summer afternoon asphalt runs far hotter than the air above it. Read
  these values as a comparison between places, not as what a thermometer shows.
- **The grid is about one kilometre.** MODIS thermal resolution identifies
  neighbourhoods, not streets. This is triage — where to look first — not a planting plan.
- **Correlation, not proof.** Vegetation and temperature move together for reasons
  beyond shade: water, elevation, building density, surface material. The measured slope
  is a defensible local association, not a guarantee.
- **Population is modelled.** SEDAC's gridded population is an estimate redistributed
  from census units.
- **Cloud is the binding constraint.** If a season was clouded over, coverage drops, and
  the interface says so rather than quietly analysing four cells.

---

## The site

The project has two surfaces:

- **`/shade-debt/`** — a scroll-led explanation of the method, with a WebGL globe
  textured from live NASA Blue Marble imagery, real NASA tiles decoded on the page
  as you read about how decoding works, and an interactive demonstration of why the
  analysis uses a robust estimator.
- **`/shade-debt/app/`** — the tool itself.

The visual contract lives in [`DESIGN.md`](DESIGN.md). Two page-wide motion
behaviours and no more: a masked per-line text reveal, and one pinned section.
`prefers-reduced-motion` ships with each of them rather than after.

**No third-party CDN requests.** Three.js, GSAP, Lenis, Leaflet and both font
faces are vendored into `vendor/` and `fonts/`. The Three.js build is tree-shaken
to only the classes the globe uses — 528 KB minified, about 132 KB over the wire —
and lazy-mounted after first paint.

The globe ships three fallbacks: reduced motion stops the rotation and the dolly,
a low-power device drops the star field and the camera move, and no WebGL (or
unreachable NASA imagery) falls back to a type-only hero. It will never render a
fabricated sphere.

## Running it

It is a static page. No build step, no dependencies to install.

```bash
python3 -m http.server 8000     # then open http://localhost:8000/shade-debt/
```

### Tests

The entire analytical core is pure and tested — projection maths, palette inversion,
statistics, the model, date selection, POWER parsing, exports, and raster sampling.

```bash
cd shade-debt
npm test          # node --test test/*.test.js
```

124 tests, no dependencies, no network access required.

---

## Layout

```
shade-debt/
├── index.html              the scroll-led site
├── app/index.html          the tool
├── favicon.svg
├── DESIGN.md               the visual contract
├── ATTRIBUTION.md          imagery, typefaces, libraries, licences
├── css/
│   ├── tokens.css          palette, type scale, spacing, easing, font faces
│   ├── site.css            the site
│   └── app.css             the tool
├── fonts/                  Instrument Serif + Schibsted Grotesk (woff2, self-hosted)
├── vendor/                 Three.js, GSAP, ScrollTrigger, Lenis, Leaflet
├── js/
│   ├── site.js             motion, live tile decoding, the estimator demo
│   ├── globe.js            the WebGL globe and its NASA texture
│   ├── app.js              tool orchestration, rendering, exports
│   ├── config.js           layer candidates and analysis defaults
│   ├── gibs.js             GIBS client: probing, tile URLs, colormap fetch
│   ├── colormap.js         palette parsing and RGB → value inversion   (pure)
│   ├── raster.js           tile stitching, pixel sampling, compositing
│   ├── geo.js              Web Mercator projection and grid maths       (pure)
│   ├── dates.js            hemisphere-aware observation date selection  (pure)
│   ├── stats.js            median, percentile, OLS, Theil–Sen           (pure)
│   ├── metric.js           the Shade Debt model                         (pure)
│   ├── power.js            NASA POWER client and parsers                (pure parsers)
│   ├── services.js         place search and reverse lookup
│   └── exporters.js        GeoJSON, CSV, letter                         (pure)
└── test/
    ├── *.test.js           124 tests over the analytical core
    └── globe-harness.html  mounts the globe against a synthetic texture,
                            so the WebGL path is verifiable without a network
```

## Credits

NASA GIBS, NASA SEDAC, and NASA POWER for open data with no key and no gate.
Basemap © OpenStreetMap contributors, © CARTO. Full credits, licences and
typeface attribution in [`ATTRIBUTION.md`](ATTRIBUTION.md).

Carlson, T.N. & Ripley, D.A. (1997). *On the relation between NDVI, fractional
vegetation cover, and leaf area index.* Remote Sensing of Environment, 62(3), 241–252.

Sen, P.K. (1968). *Estimates of the regression coefficient based on Kendall's tau.*
Journal of the American Statistical Association, 63(324), 1379–1389.
