# DESIGN.md — Shade Debt

The visual contract. Everything built after this answers to it.

**Axes:** Variance 8 · Motion 8 · Density 3.
High variance (no two sections share a composition), high motion (scroll-led,
but authored — not ambient), low density (air is the point; restraint reads as
premium).

**Reference temperament:** Unseen Studio — type-led motion, impeccable pacing, a
calm surreal world rather than a brochure. Soft, warm, unhurried. The subject is
planetary heat, so the palette runs warm without ever becoming an alarm.

---

## Type — two families, locked

| Role | Family | Weights | Treatment |
|---|---|---|---|
| Display | **Instrument Serif** | 400 | Headlines only. Tracking −0.03em at display sizes. Never below 28px. |
| Text / UI | **Schibsted Grotesk** | 400, 500, 600 | Everything else. Body measure 62–70ch. |

Both self-hosted as woff2 from `fonts/`, `font-display: swap`, with a system
fallback stack sized to minimise reflow. No third family. No Inter.

Fluid scale, all `clamp()`:

```
--t-display  clamp(3.2rem, 11vw, 11rem)     display serif, line-height 0.92
--t-h1       clamp(2.4rem, 6vw, 5rem)       line-height 1.0
--t-h2       clamp(1.75rem, 3.6vw, 3rem)    line-height 1.1
--t-lead     clamp(1.05rem, 1.5vw, 1.35rem) line-height 1.55
--t-body     1rem / 1.6
--t-small    0.8125rem
--t-micro    0.6875rem  uppercase, tracking 0.12em
```

## Colour — neutral base, exactly one accent

```
--ink        #141210   warm near-black  (never #000)
--ink-2      #1C1916   raised surface
--ink-3      #262019   hairlines on dark
--bone       #EFE9E1   warm paper, the light sections
--bone-2     #E3DACE   paper, recessed
--cream      #F5F1EA   text on dark
--mute       #A79E95   secondary text on dark
--faint      #6E655D   tertiary text on dark
--slate      #4A423B   text on paper, secondary

--ember      #D77A5A   THE accent.  H14 S62% L60% — under the 80% ceiling
--ember-deep #B45B3E   pressed / hover
```

One accent, used for: the active state, the single primary CTA, the fit line on
the scatter, the priority pins. Nowhere else.

**Data ramps are exempt** — they encode measured values, not brand:

```
heat   #F0E3D0 → #E8BE8E → #D77A5A → #8E3B2A     sequential, warm
night  #2B3A55 → #4E5E86 → #8A7FA8 → #C99BA8     sequential, cool counterpart
```

## Space — 8px scale, nothing eyeballed

`4 · 8 · 16 · 24 · 32 · 48 · 64 · 96 · 128 · 192`
Section rhythm: `clamp(96px, 14vh, 176px)` vertical. Page gutter 24px mobile,
`clamp(32px, 6vw, 120px)` above 900px.

## Easing — named, never invented

```
--ease-out-expo   cubic-bezier(0.16, 1, 0.30, 1)    reveals, entrances
--ease-out-quart  cubic-bezier(0.22, 0.61, 0.36, 1) UI state
--ease-in-out-q   cubic-bezier(0.83, 0, 0.17, 1)    wipes, transitions
```

Durations: UI state **≤ 240ms**. Reveals **760–1100ms**. Page wipe **520ms**.
Never `ease-in` on UI. Never `transition: all`. Never `scale(0)`.

## Motion — exactly two page-wide behaviours

1. **Masked per-line text reveal.** Every display heading and lead paragraph.
   Lines measured at runtime, wrapped in an `overflow:hidden` mask, translated
   from 105% with a 0.06s stagger, `--ease-out-expo`, 880ms.
2. **One pinned section.** Section 3 only. The globe holds while three
   measurement steps advance against it.

That is the entire vocabulary. No parallax, no marquee, no horizontal transit,
no custom cursor. `transform` and `opacity` only, plus sanctioned `clip-path`.

`prefers-reduced-motion` ships with every animation, not after it: reveals
become instant, the globe stops rotating, the pin releases.

## 3D — one role

**Hero object, scroll-driven.** An Earth globe textured with NASA Blue Marble
imagery, persisting behind sections 1–3 while scroll drives rotation and a
camera dolly from planet to city.

Not a primitive. Not a shader field. Three fallbacks ship with it: reduced
motion (static globe), no WebGL (type-only hero), low-power/small viewport
(static globe, no dolly). DPR capped at 2, lazy-mounted after first paint.

## Banned here

Inter · purple-to-blue anything · gradient text · pure `#000` · kicker above a
heading · nested cards · centered hero · "scroll to explore" · bouncing chevrons ·
circular spinners · a secondary "learn more" CTA · custom cursors · neon glow ·
body measure outside 62–75ch · a third type family.

## Imagery

Every image is real Earth observation, fetched live from NASA at runtime —
Blue Marble for the globe, and actual MODIS thermal and vegetation tiles for the
method strip. No stock photography, no gradients standing in for photographs, no
illustration. See `ATTRIBUTION.md`.
