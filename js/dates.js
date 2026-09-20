/**
 * Observation date selection.
 *
 * A single thermal image is mostly cloud. The analysis composites several
 * dates drawn from the study area's hottest season, which is hemisphere
 * dependent, and snaps to the product's native compositing period where one
 * exists (MODIS NDVI is an 8-day composite, so only certain dates exist).
 * Pure functions - no DOM, no network.
 */

export function isoDate(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString().slice(0, 10);
}

export function parseIso(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86400000) + 1;
}

/**
 * MODIS 8-day composites begin on day-of-year 1, 9, 17 ... within each year.
 * Requesting any other date returns nothing, so snap down to the period start.
 */
export function snapToPeriod(date, periodDays) {
  if (!periodDays || periodDays <= 1) return new Date(date.getTime());
  const doy = dayOfYear(date);
  const snappedDoy = Math.floor((doy - 1) / periodDays) * periodDays + 1;
  return new Date(Date.UTC(date.getUTCFullYear(), 0, snappedDoy));
}

/**
 * The most recent hot season at a latitude, relative to `now`.
 * Northern hemisphere: 1 June to 15 September. Southern: 1 December to
 * 15 March. The window is clipped to allow for processing latency.
 */
export function hottestSeason(lat, now = new Date(), latencyDays = 4) {
  const latest = addDays(now, -latencyDays);
  const y = latest.getUTCFullYear();
  if (lat >= 0) {
    let start = new Date(Date.UTC(y, 5, 1));       // 1 Jun
    let end = new Date(Date.UTC(y, 8, 15));        // 15 Sep
    if (latest < start) {
      start = new Date(Date.UTC(y - 1, 5, 1));
      end = new Date(Date.UTC(y - 1, 8, 15));
    }
    if (latest < end) end = latest;
    return { start, end, hemisphere: 'north' };
  }
  let start = new Date(Date.UTC(y - 1, 11, 1));    // 1 Dec previous year
  let end = new Date(Date.UTC(y, 2, 15));          // 15 Mar
  if (latest < start) {
    start = new Date(Date.UTC(y - 2, 11, 1));
    end = new Date(Date.UTC(y - 1, 2, 15));
  }
  if (latest < end) end = latest;
  return { start, end, hemisphere: 'south' };
}

/**
 * Evenly spaced, de-duplicated observation dates across the hot season,
 * snapped to the product period. Returned newest first so a partial result
 * still reflects the most recent conditions.
 */
export function observationDates({ lat, now = new Date(), count = 8, periodDays = 1, latencyDays = 4 }) {
  const season = hottestSeason(lat, now, latencyDays);
  const spanDays = Math.max(1, Math.round((season.end - season.start) / 86400000));
  const n = Math.max(1, count);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 1 : i / (n - 1);
    const raw = addDays(season.start, Math.round(frac * spanDays));
    const snapped = snapToPeriod(raw, periodDays);
    const iso = isoDate(snapped);
    if (!seen.has(iso)) { seen.add(iso); out.push(iso); }
  }
  out.sort((a, b) => (a < b ? 1 : -1));
  return { dates: out, season: { start: isoDate(season.start), end: isoDate(season.end), hemisphere: season.hemisphere } };
}
