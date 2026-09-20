# NextStep Hacks 2026 — "Earth Forward" Competitive Research

Compiled 2026-09-20. Purpose: understand what has won at NextStep Hacks and at comparable
environmental/climate hackathons, so the project we build is aimed at the actual scoring surface.

---

## 0. Two things to read first

**A. The deadline is effectively now.** The listing says *Sep 20, 2026 @ 5:00pm EDT* with "21 more
hours" remaining. Today is Sep 20. Whatever we build must be scoped to something that can be
finished, deployed, recorded, and submitted in a single working session — not a multi-day build.
Every recommendation below is filtered through that constraint.

**B. Research limitation, stated honestly.** This cloud environment's network policy blocks
`devpost.com` and all its subdomains (403 at the egress proxy), so I could not open the NextStep
Hacks winner galleries for 2021/2022/2024/2025 and read the individual winning project pages.
Web *search* works, but Devpost project pages for a hackathon this size are thinly indexed — search
surfaced the event pages, not the winner lists. So: **no verified list of past NextStep winners
below.** What is below is (1) confirmed facts about the event's history and (2) a well-sourced body
of winners from *comparable* environmental hackathons, which is the useful signal anyway.

If you want the actual NextStep winner galleries, open these on your phone and paste back what you
see — I'll fold them in:
- `https://nextstep2025.devpost.com/project-gallery`
- `https://nextstep2024.devpost.com/project-gallery`
- `https://nextstep2022.devpost.com/project-gallery`

---

## 1. The event itself

**HackAlphaX**, student-founded, has run NextStep Hacks for six years; claims 3,000+ students
reached. NextStep bills itself as "the largest virtual middle and high-school hackathon."

Theme history — note the pattern:

| Year | Theme | Focus |
|---|---|---|
| 2021 | "Hack 2 Success" | General |
| 2022 | (Ethereum-sponsored) | "Solve the biggest problem in life" |
| 2024 | "Changing the world, one line at a time" / Code4Good | Social good, NordVPN-sponsored |
| 2025 | "Limitless" / "Breaking limits, one idea at a time" | **Accessibility + disability assistive tech** |
| 2026 | "Earth Forward" / "Breaking barriers, one idea at a time" | **Environment + climate** |

The read: this organizer runs a **single hard social-good theme each year and weights adherence to
it heavily** (it is one of six judging criteria, phrased as "does it implement this theme *fully or
just partially*"). A generically good app with environmental framing bolted on scores badly here.
The environmental mechanism has to be load-bearing.

Also note the crowd: 986 participants, beginner-friendly, ages 13+, students only. The field is
mostly beginners. That has a strategic implication — see §5.

**Sponsor signal:** Claude is the headline sponsor, and prizes are denominated partly in Claude
credits ($500 / $250 / $100). Prize sponsors' tech is disproportionately likely to be viewed
favorably. Using the Claude API meaningfully (not decoratively) is a cheap alignment win.

---

## 2. Winning environmental projects at comparable hackathons

These are verified from news/university/organizer sources.

### CarbonCompass — 1st, Sustainability Track, HackHarvard 2025
AI tool that recommends **where to physically locate a business** for profit *and* planet. You type
a short business description; it returns neighborhoods color-coded by a composite "Green Score"
blending energy efficiency, waste potential, walkability, and transit access.
*Why it won:* fused several public datasets into one novel composite metric, and served it as a map
— a decision tool for a decision people actually make, not a dashboard.

### ThermaWise — 1st, MIT Hack The Climate (MIT RAISE AI & Education Summit, July 2025)
Morgan State team. AI platform giving non-experts data-driven, building-specific energy-saving
recommendations. Framed as "**democratizing access to building science**."
*Why it won:* took a field where advice normally requires a paid professional audit and made it
free and instant. The framing — expertise made accessible — was the pitch.

### Canopy — top sustainability prize, HooHacks (UVA)
Estimates the **environmental impact of software itself** and visualizes waste estimates *before*
code is finalized, so developers fix it early.
*Why it won:* genuinely unusual target (the carbon cost of the thing hackers themselves make),
and intervenes at the point of decision rather than reporting after the fact.

### Forest Guard — Microsoft Student Hackathon winner
IoT + ML on-site sensor detecting **illegal logging and forest fire** by sound/signal, with
real-time alerting.
*Why it won:* hardware + ML + a real enforcement workflow, built and field-tested in a week.

### Wildfire growth prediction — 1st, University of Waterloo wildfire hackathon
Combined the outputs of **multiple AI models** to predict wildfire spread.
*Why it won:* ensemble approach = visible technical depth against a hard forecasting problem.

### Tree mortality risk tool — Stanford wildfire hackathon (with US Forest Service)
Evaluates tree mortality risk by combining **low- and high-resolution satellite imagery**.
*Why it won:* built in direct collaboration with the agency that would use it. (NextStep's rules
text explicitly encourages partnering with local orgs — that's a hint from the organizers.)

### NASA Space Apps 2025 global winners (114,000 participants, 167 countries)
- **QUEÑARIS (Peru)** — water scarcity in Arequipa driven by degradation of queñua forests. Won
  *Local Impact*. A hyper-specific local problem, deeply researched.
- **Zumorroda-X (Egypt)** — mini-games teaching how farmers adapt to heat waves and flooding. Won
  *Art & Technology*.
- **Gaia+LEO (US)** — mixed-integer optimization co-designing orbital + terrestrial data-center
  networks for climate modeling. Won *Global Connection*.

### Lost & Found web app — 1st, Waste Management track, Hack the Herd 2025
Reconnects students with lost belongings to reduce replacement-driven waste.
*Why it matters here:* the environmental angle is **second-order** (less replacement buying = less
waste) and it still won its track. Small, finishable, real users.

### EcoJustice — Hack the Nest 2025 (DMV's largest high-school hackathon)
Combines **EPA + CDC + Census** data to identify where environmental racism occurs, plus an **AI
letter generator to local representatives**.
*Why it's the closest analogue to our situation:* high-school level, web-based, public data fused
into a map, and — critically — it doesn't stop at visualization. It ends in an *action* the user
takes. (Search could not confirm its final placement, only that it was a featured project.)

### The Earth Prize (13–19 year olds, $100k, 160+ countries) — what wins at teen level
2026 top-35 Scholars include: recycling **rubble into building blocks** in Gaza; **Fluoronet**, a
glowing fishing net attacking ghost-gear ocean pollution; **WeaveLand**, coconut-fibre waste into
reusable materials.
*Pattern:* at teen level, judges reward a **specific material or mechanism**, tied to a place the
team actually knows, over broad software platforms.

---

## 3. The pattern across every winner above

1. **One decision, not one dashboard.** Every winner ends in an action: where to locate, what to
   fix, whom to email, where to send the ranger. Pure "visualize the data" projects don't appear in
   the winners' list anywhere in this research.
2. **Fuse 2+ real public datasets into a metric that didn't previously exist.** CarbonCompass
   (Green Score), EcoJustice (EPA+CDC+Census), Stanford (two satellite resolutions). This is the
   single most repeated technical move, and it is the cheapest way to score on *Technology* and
   *Originality* simultaneously.
3. **Democratize expensive expertise.** ThermaWise = free building science. Canopy = free impact
   audit. This framing plays directly to a social-good organizer.
4. **Hyper-local beats global.** QUEÑARIS won on one city's water supply. Judges reward evidence
   you understand *one* place or *one* user, deeply.
5. **Real data, live, in the demo.** Stubbed/fake data is visible instantly on video and destroys
   the *Completion* score.

---

## 4. What to avoid (saturation risk against "Originality")

Judges at environment-themed events see these every single time. Sources on hackathon pitfalls are
blunt: teams pick environmental topics because they *sound* impactful, then build something they
have no personal experience with, and the result feels generic.

High-saturation, treat as burned unless radically re-angled:
- Personal **carbon footprint calculator / tracker** (the single most common climate hack).
- **Recycling image classifier** ("point your camera at trash, is it recyclable?") — extremely
  common, and MobileNet-on-TrashNet is a well-worn path.
- Generic "eco habit" gamification with points/streaks/badges and no data behind it.
- A ChatGPT/Claude wrapper that answers sustainability questions, with no dataset underneath.
- Carbon-offset marketplace mockups with no real transactions.
- Yet another EV-charger / solar-panel-placement map with no novel scoring.

Re-angling rule: if the project's core loop is *"user inputs their behavior → app shows a number,"*
it's in the saturated bucket. Move the core loop to *"app ingests real external data → user takes a
specific action."*

---

## 5. The six judging criteria, and how to attack each

Criteria are equally listed (no published weights), so a balanced submission wins — judges
explicitly say they reward projects that visibly balance *across* all criteria rather than maxing
one.

| Criterion | What it actually rewards | Our lever |
|---|---|---|
| **Originality** | "Has this been done before at hackathons?" | Avoid §4 list. Novel *composite metric* is the reliable originality move. |
| **Adherence to Track** | "Fully or just partially" Earth Forward | Environmental mechanism must be load-bearing, stated in the first 15 seconds of the video. |
| **Completion** | "Does the hack work? Did the team achieve everything they wanted?" | Ship a **live, working URL**. Scope so that nothing in the demo is a mockup. Don't state unachieved goals in the writeup — you're scored against your own stated ambition. |
| **Learning** | "Did the team stretch? Try something new?" | Devpost writeup must have an explicit "what we learned / what was new to us" section. This is free points almost everyone leaves on the table. |
| **Design** | UX and interface quality | This is where most high-school submissions are weakest, so it's the highest-leverage differentiator. A genuinely polished, responsive, accessible interface will stand out against ~986 mostly-beginner entries. |
| **Technology** | "Did it make you go wow?" Difficulty, cleverness, many components | Real API ingestion + a real algorithm (scoring/optimization/ML) + a live deploy = three visible components. |

**Field-strength note:** with ~986 mostly-beginner participants, the realistic bar for top-3 is not
"invent something unprecedented" — it's **flawless execution and design on a genuinely non-obvious
idea, deployed live, with real data**. Design and Completion are where the field collapses.

---

## 6. Submission mechanics (hard requirements)

- **Demo video ≤ 5 minutes.** Required.
- **Public repo link.** Required.
- **Live site/app link** if applicable — *we should make this applicable.* A live URL is the single
  strongest Completion signal.
- Multi-submission to other hackathons this month is allowed (if the other event also allows it).
- **If any part predates the hackathon, it must be explicitly declared** — what was built before vs.
  during. This matters directly for us: this repo already contains a deployed site, so anything
  reused must be disclosed in the Devpost writeup. Non-negotiable; undeclared reuse is a
  disqualification risk.

**Demo video guidance, from Devpost's own judging advice:**
- Judges' first contact with the project is the video — it carries disproportionate weight.
- Script it and rehearse; don't improvise.
- Show the product *running on real input* for the majority of the runtime. Cut the slide deck.
- Cover: the problem → the features you built → future potential, and tie each explicitly to the
  hackathon's theme.
- Host on YouTube (link works before upload finishes — useful under deadline pressure).
- Make sure audio is clean and the screen is legible; judges must be able to see and hear it.

---

## 7. Free, no-friction environmental data sources

Vetted for hackathon use (open access, no lengthy approval):

| Source | Data | Notes |
|---|---|---|
| **NASA FIRMS** | Near-real-time active fire/thermal anomalies, global | Free; strong visual payoff |
| **OpenAQ** | Global air quality measurements, open API | Very fast to integrate |
| **EPA** (AQS / EJScreen / ECHO) | US air quality, environmental justice indices, facility violations | Used by EcoJustice |
| **Global Forest Watch Open Data Portal** | Forest loss/gain; CSV, GeoJSON, GeoTIFF; GeoServices/WMS/WFS APIs | |
| **NASA EOSDIS / Earthdata** | Broad Earth observation catalog | Free |
| **NOAA** | Weather, climate normals, sea level | |
| **USGS** | Water data, streamflow, land cover | |
| **US Census** | Demographics for equity overlays | Pairs with EPA for justice angles |
| **Electricity Maps / grid intensity APIs** | Real-time grid carbon intensity by region | Enables "when to run/charge" logic |
| **Open-Meteo** | Free weather forecast API, no key required | Fastest possible integration |

The winning move in §3.2 is literally: **pick two of these, join them on geography, produce a score
that doesn't exist elsewhere, render it as a map, and end with an action.**

---

## 8. Repo context

Current repo `rishikrrontala-bot/anxiety-guide` is a static GitHub Pages site:
`index.html` (~246KB, single bundled page), `og-image.png`, `robots.txt`, `sitemap.xml`,
`old-anxiety-guide.html`, plus a Google site-verification file. Working branch for this effort:
`claude/nextstep-hacks-2026-b9fyuh`.

Implication: the delivery path of least resistance is **a single self-contained, deployable page** —
same shape as what's already here, same hosting, no build step, live URL in minutes. That directly
serves the *Completion* criterion under a same-day deadline. If we reuse anything from the existing
site (styles, structure, patterns), it gets declared in the Devpost writeup per §6.

---

## Sources

- https://www.hackalphax.co/
- https://nextstep2026.devpost.com/
- https://nextstep2025.devpost.com/
- https://nextstep2024.devpost.com/
- https://nextstep2022.devpost.com/
- https://nextstep-hacks-2021.devpost.com/
- https://scai.engineering.asu.edu/news/students-win-sustainability-challenge-at-hackharvard-2025/
- https://www.morgan.edu/news/morgan-students-win-first-place-at-mit-hackathon
- https://www.fm.virginia.edu/employees/employeenews/2026/app-wins-sustainability-prize.html
- https://www.microsoft.com/en-us/garage/blog/2022/01/forest-guard-microsoft-student-hackathon-winners-create-rapid-response-deforestation-sensor/
- https://uwaterloo.ca/news/innovation-and-creativity-win-wildfire-hackathon
- https://sustainability.stanford.edu/news/hackathon-focused-equity-prediction-mitigation-wildland-fires
- https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-announces-2025-international-space-apps-challenge-global-winners/
- https://www.spaceappschallenge.org/2025/awards/global-finalists/
- https://admissionstudentblogs.wordpress.amherst.edu/2025/03/31/from-idea-to-impact-hack-the-herd-ai-in-sustainability-hackathon/
- https://hack-the-nest-2025.devpost.com/project-gallery
- https://www.theearthprize.org/scholars
- https://opportunitydesk.org/2025/09/08/earth-prize-2026/
- https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video
- https://info.devpost.com/blog/hackathon-judging-tips
- https://atlas.co/blog/free-data-sources-for-environmental-data/
- https://data.globalforestwatch.org/
