# NextStep Hacks 2026 — submission pack

Everything needed for the Devpost entry. Paste the sections into the matching
Devpost fields; the video script is timed to fit the five-minute limit with room to spare.

---

## Required declaration — prior work

**Read the rules carefully: this one is not optional.**

NextStep Hacks requires that if you continue an old project you must state what was
built *before* the hackathon and what was built *during* it. Put this in the Devpost
description verbatim:

> **Prior work declaration.** Everything in the `shade-debt/` directory — the entire
> application, the site, the model, and the test suite — was written during NextStep Hacks 2026.
> Nothing was carried over from an earlier project. The repository it lives in also
> hosts an unrelated pre-existing static site (a teen anxiety guide) at the repository
> root; that site predates the hackathon, is not part of this submission, and shares no
> code with it. No third-party code was copied in. The only external runtime dependency
> is Leaflet, loaded from a CDN for map rendering.

---

## Devpost fields

### Elevator pitch (one line, 200 char limit)

> Shade Debt reads NASA satellite imagery in your browser to measure how much of a
> neighbourhood's heat comes from missing trees — and ranks where planting helps the most people.

### Inspiration

Urban heat is the deadliest climate hazard most people will personally encounter, and
inside a single city surface temperature routinely varies by more than 10 °C. That gap
is not weather. It tracks where the trees are.

Plenty of tools will show you a heat map. Almost none of them answer the question a city
actually has to answer, which is not *where is it hot* but *where does planting a tree
remove the most heat from the most people*. We wanted to close that gap — and to do it
with public data anyone can check, rather than a proprietary model nobody can audit.

### What it does

You search a city or tap the map. Shade Debt then:

- Pulls NASA MODIS **land surface temperature** (day and night) and **NDVI vegetation**
  imagery for that area across several cloud-screened dates from its hottest season.
- Recovers real temperatures from those images and builds a ~1 km analysis grid.
- Measures **that city's own cooling slope** — how many degrees of surface cooling one
  unit of vegetation index is worth *there* — by regressing temperature against NDVI.
- Calculates each cell's **shade debt**: the degrees of heat attributable to its
  vegetation shortfall against the local 75th percentile.
- Weights that by NASA SEDAC population to rank cells in **degree-persons**: avoidable
  heat multiplied by the people who would benefit.
- Cross-checks itself against NASA POWER's independent 40-year record, and reports the
  area's warming trend — separately for daytime highs and overnight lows.

Then it hands you something to *do*: the ranked coordinates, a GeoJSON a city GIS office
can open, a CSV, and a letter to your council with every measured number already in it.

### How we built it

A single static page with no backend and no API keys. The interesting part is that
**NASA GIBS serves science layers as pre-coloured PNGs, not numbers** — so we had to get
the numbers back out.

NASA publishes the exact palette for every layer as a ColorMap document, mapping each
RGB triplet to the physical interval it represents. So the app fetches that document,
builds a reverse lookup, stitches the map tiles into a canvas, reads the pixels, and
inverts each one back to degrees Celsius, NDVI, or persons per square kilometre — with
the units taken from NASA's own metadata rather than assumed.

That choice paid off twice. Palette entries marked transparent or no-data decode to
nothing, which means **the cloud mask falls out of the method for free**: cloudy pixels
simply do not produce a measurement, and the per-cell median across several dates does
the rest.

The statistics are deliberately conservative. The cooling slope uses the **Theil–Sen
estimator** — the median of all pairwise slopes — because water bodies and cloud edges
produce outliers that drag an ordinary least-squares fit badly off. Our test suite
demonstrates this on synthetic data: with four contaminated cells in forty, OLS is wrong
by over 5 °C/NDVI while Theil–Sen stays within 0.5. We report OLS R² alongside it and
draw the scatter plot, so the strength of the relationship can be judged rather than
taken on trust. If the measured slope is not negative, the model reports zero rather
than inventing a number.

Nothing about the layer configuration is hardcoded as an assumption. The app probes
candidate layer identifiers across candidate tile matrix sets at startup and uses the
first that answers, so a renamed or retired NASA product degrades to the next best
source instead of breaking the page.

Tree counts come from fractional vegetation cover after Carlson & Ripley (1997), not
from a guess.

### Design and build

The interface is a deliberate study of type-led motion — the temperament of
studios like Unseen Studio, where restraint reads as premium — applied to a
measurement tool rather than a portfolio.

The rules were written down first, in `DESIGN.md`, and everything answers to
them: two typefaces, one accent under 80% saturation, an 8px spacing scale, named
easing curves, and **exactly two page-wide motion behaviours** — a masked
per-line text reveal and a single pinned section. No parallax, no marquee, no
custom cursor. `transform` and `opacity` only. `prefers-reduced-motion` ships
with each animation rather than after it.

The 3D has one named role: a hero object. It is an Earth globe whose texture is
**not shipped with the page** — it is stitched at runtime from NASA Blue Marble
equirectangular tiles, using the same probe-then-decode machinery as the
analysis, with a warm atmospheric rim shader written to stay on palette. Scroll
drives its rotation and a camera dolly. It ships three fallbacks: reduced motion,
low-power device, and no-WebGL-or-no-imagery, which drops to a type-only hero. It
will never render a fabricated sphere in place of real data.

Two elements of the page are not illustrations of the method — they *are* the
method, running. The tiles in "How a temperature is recovered from a picture" are
live NASA tiles fetched and decoded while you read; if the network blocks them
the panels stay empty and say so. And the scatter in "Calibrated here" calls the
same tested `theilSen` and `olsRegression` functions the analysis uses: add
outliers and watch the least-squares line break while the robust line holds.

Every image on the site is real Earth observation data. No stock photography, no
gradients standing in for photographs.

### Challenges we ran into

- **Getting physical values out of rendered imagery.** This was the whole problem.
  The solution — inverting NASA's published palette client-side — is the technical heart
  of the project.
- **Cloud.** A single thermal image over a city is mostly cloud. Compositing several
  dates from the hottest season, hemisphere-aware, and taking a per-cell median was the
  fix.
- **Not overclaiming.** MODIS thermal is ~1 km, so this identifies neighbourhoods, not
  streets. Land surface temperature is not air temperature. It was tempting to quietly
  blur those lines; instead we put them in the interface, in the exported metadata, and
  in the letter itself.
- **The correct URL shape.** GIBS rejects a TIME segment on layers that have no time
  dimension, which is why gridded population kept failing until the tile URL builder was
  taught to omit it. There is a regression test for exactly that now.
- **Verifying 3D you cannot see.** The globe needs both WebGL and NASA imagery, so it
  is the hardest part of the build to trust. We added a harness
  (`test/globe-harness.html`) that mounts the scene against a locally generated
  texture, which let us confirm the shader compiles and the sphere renders with no
  network at all. It immediately caught a real bug: the renderer was delegating canvas
  sizing to the stylesheet, so the canvas overflowed anywhere that CSS was absent.
- **A units trap in CSS.** `max-width: 16ch` on a container resolves against the
  *container's* 16px font, not the 100px display type inside it — so three headline
  columns were roughly 180px wide while their text rendered far larger. Screenshot
  testing at two viewports is what surfaced it.

### Accomplishments we're proud of

- Real remote-sensing analysis running entirely in a browser tab, with no server, no API
  key, and no account.
- A metric with honest units — degree-persons — and no arbitrary weights to defend.
- A model that is **calibrated per city from that city's own data** rather than applying
  one borrowed coefficient everywhere.
- **89 passing tests** covering the whole analytical core, plus a WebGL harness that
  makes the 3D verifiable offline.
- An interface audited for WCAG 2.2 AA: contrast checked on every text node at two
  viewports, 24px minimum target sizes, visible focus on every tab stop, sane heading
  order, and reduced-motion paths throughout.
- A tool that self-validates against an independent NASA record and reports the
  disagreement instead of hiding it.

### What we learned

- How WMTS actually works: tile matrix sets, the REST path layout, and why an omitted
  TIME segment is the safest thing to probe a layer with.
- How to write a line-splitting text reveal that survives emphasis spanning a line
  break, and why `ch` units mean something different on a container than on the
  heading inside it.
- That tree-shaking a 2 MB library down to the classes you actually use is the
  difference between a 3D site that loads and one that does not.
- That satellite science products are distributed as *pictures* far more often than as
  arrays, and that the metadata to reverse that is public if you go looking.
- Why robust statistics exist. We started with ordinary least squares, watched a handful
  of water pixels wreck the slope, and learned what Theil–Sen is for by needing it.
- The difference between land surface temperature and air temperature — and that a
  project is more trustworthy, not less, for saying so out loud.
- That the hardest part of an environmental tool is not the data. It is deciding what
  decision the data is supposed to support.

### What's next

- Finer thermal imagery. Landsat and ECOSTRESS reach 30–70 m, which would take this from
  neighbourhood triage down to the street level a planting crew works at.
- Cooling-per-dollar, by joining municipal tree-planting cost data.
- A before/after mode that re-runs a past season to check whether planting actually moved
  the measured temperature.
- Letters addressed automatically to the correct council member for the coordinates.

### Built with

`javascript` · `html5` · `css3` · `three.js` · `webgl` · `glsl` · `gsap` · `scrolltrigger` ·
`lenis` · `leaflet` · `nasa-gibs` · `nasa-power` · `nasa-sedac` · `modis` · `wmts` ·
`remote-sensing` · `geojson` · `canvas` · `node-test`

### Links

- **Live site:** https://rishikrrontala-bot.github.io/anxiety-guide/shade-debt/
- **The tool directly:** https://rishikrrontala-bot.github.io/anxiety-guide/shade-debt/app/
- **Repository:** https://github.com/rishikrrontala-bot/anxiety-guide/tree/main/shade-debt

---

## Demo video script — 4:20 target, 5:00 limit

Record the screen at 1080p. Speak over a live run; do not show slides. Devpost's own
judging advice is that the video is the first thing judges see and carries
disproportionate weight, so rehearse it once before recording.

**Pick your city before recording**, run it once to confirm it decodes cleanly, and copy
the permalink — then start the recording from that URL so the demo cannot fail live.

---

**0:00 – 0:18 — Open on the site, not the tool.** Let the globe turn for two seconds
before you speak. Scroll once, slowly, so a headline reveals on camera.

> "This is Shade Debt. That globe is not an illustration — the texture is NASA
> imagery, stitched in the browser while the page loads."

Then click *Measure a city* so the page transition plays into the tool.

**0:18 – 0:38 — The hook. Screen: the app, already on your city, cells coloured.**

> "Inside this one city, the ground temperature varies by [X] degrees. That is not
> weather — every one of these red cells is within a few kilometres of a blue one. The
> difference is trees. This is Shade Debt, and it measures exactly how much of that heat
> is avoidable, using NASA satellites, entirely in a browser tab."

**0:20 – 0:50 — The problem. Screen: slowly pan across the heat overlay.**

> "Heat is the climate hazard that kills the most people, and it is not shared out
> evenly. Plenty of tools will show you a heat map. None of them answer the question a
> city actually has to answer: of all the places we could plant, which one removes the
> most heat from the most people? That is what this computes."

**0:50 – 1:50 — The live run. Screen: type a different city, let it run.**

> "Watch it work. It probes NASA's imagery service for the best available layers — no
> API key, no account, nothing hardcoded. It pulls land surface temperature, day and
> night, and vegetation index, across several dates from this city's hottest season."
>
> *(point at the status panel as rows turn green)*
>
> "And here is the part I want to show you. NASA serves these layers as coloured
> pictures, not numbers. So we fetch NASA's published colour palette for each layer,
> build a reverse lookup, read the actual pixels out of the map tiles, and invert every
> one of them back into degrees Celsius. The units come from NASA's own metadata."

**1:50 – 2:20 — The free cloud mask. Screen: the status panel percentages.**

> "That has a nice consequence. Palette entries marked no-data — cloud, fill — decode to
> nothing. So cloud screening falls out of the method for free, and taking the median
> across several dates means one bad day can't move the answer. It's telling you right
> here how much of the grid actually decoded."

**2:20 – 3:10 — The science. Screen: scroll to the calibration scatter plot.**

> "Now the model. Every dot is a grid cell: vegetation on the x-axis, temperature on the
> y. This slope is measured *here*, in this city, not borrowed from a paper — [N] cells,
> and each unit of vegetation index is worth [X] degrees of cooling.
>
> It's a Theil–Sen fit, the median of all pairwise slopes, because water and cloud edges
> produce outliers that wreck a normal least-squares line. We show the R² so you can see
> how strong the relationship actually is.
>
> A cell's shade debt is its vegetation shortfall times that slope. And we rank by shade
> debt multiplied by the people living there — degree-persons — so a hot empty lot never
> outranks a slightly cooler block where thousands live."

**3:10 – 3:40 — The action. Screen: click the top site, then the export buttons.**

> "Here is the top site. [X] degrees of avoidable heat, [N] people, roughly [T] trees to
> close the gap.
>
> And it doesn't stop at a picture. GeoJSON a city GIS office opens directly. A CSV. And
> a letter to the council with every measured number already in it — the coordinates,
> the temperatures, the calibration, and the caveats."

*(scroll the letter briefly so the numbers are visible)*

**3:40 – 4:05 — Honesty as a feature. Screen: the cross-check paragraph.**

> "Two things I want to be straight about, because they're in the tool too. Land surface
> temperature is not air temperature — this is the ground, and asphalt runs hotter than
> the air above it. And the grid is about a kilometre, so this finds neighbourhoods, not
> streets.
>
> It also checks itself: this compares our satellite figure against NASA POWER, a record
> built from completely different instruments, and reports the gap instead of hiding it."

**4:05 – 4:20 — Close.**

> "No backend. No API key. No account. Eighty-nine tests over the analysis core. Public
> data, a method you can audit, and a letter you can send on Monday. That's Shade Debt."

---

## Pre-submission checklist

- [ ] Live URL loads and completes a run on a phone as well as a laptop
- [ ] Permalink in the video description opens the exact analysis shown
- [ ] Video is under 5:00 and uploaded to YouTube, set to public or unlisted
- [ ] Repository link is public
- [ ] **Prior work declaration pasted into the Devpost description**
- [ ] `npm test` passing, and the count in the writeup matches reality
- [ ] Screenshots attached: the hero with the globe, the map, the calibration scatter,
      the generated letter
- [ ] Confirm the globe actually renders on your machine — if NASA's Blue Marble tiles
      are blocked, the hero correctly falls back to type only, which is worth knowing
      before you record
- [ ] Try a second, geographically different city (one in the southern hemisphere) so
      the seasonal logic is exercised on camera if you re-record
