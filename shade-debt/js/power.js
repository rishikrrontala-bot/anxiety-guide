/**
 * NASA POWER client.
 *
 * POWER serves a satellite- and reanalysis-derived climate record for any
 * coordinate on Earth, with no API key. It supplies two things the imagery
 * cannot: how fast this specific place has been warming over four decades, and
 * an independent temperature record to cross-check the imagery against.
 */

import { trendPerDecade, mean } from './stats.js';

export const POWER_BASE = 'https://power.larc.nasa.gov/api/temporal';
export const FILL_VALUE = -999;

export function isFill(v) {
  return !Number.isFinite(v) || v <= FILL_VALUE + 1e-6;
}

export function monthlyUrl({ lat, lon, start, end, parameters }) {
  const p = new URLSearchParams({
    parameters: parameters.join(','),
    community: 'RE',
    latitude: String(lat),
    longitude: String(lon),
    start: String(start),
    end: String(end),
    format: 'JSON',
  });
  return `${POWER_BASE}/monthly/point?${p}`;
}

export function dailyUrl({ lat, lon, start, end, parameters }) {
  const p = new URLSearchParams({
    parameters: parameters.join(','),
    community: 'RE',
    latitude: String(lat),
    longitude: String(lon),
    start: String(start).replace(/-/g, ''),
    end: String(end).replace(/-/g, ''),
    format: 'JSON',
  });
  return `${POWER_BASE}/daily/point?${p}`;
}

/**
 * POWER monthly responses key values as YYYYMM, with MM=13 carrying the annual
 * figure. Returns { year -> { month -> value } } with fill values removed.
 */
export function parseMonthly(json, parameter) {
  const raw = json?.properties?.parameter?.[parameter];
  if (!raw) return {};
  const byYear = {};
  for (const [key, value] of Object.entries(raw)) {
    const m = /^(\d{4})(\d{2})$/.exec(key);
    if (!m || isFill(value)) continue;
    const year = Number(m[1]);
    const month = Number(m[2]);
    (byYear[year] ||= {})[month] = value;
  }
  return byYear;
}

export function parseDaily(json, parameter) {
  const raw = json?.properties?.parameter?.[parameter];
  if (!raw) return [];
  const out = [];
  for (const [key, value] of Object.entries(raw)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(key);
    if (!m || isFill(value)) continue;
    out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, value });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/** Months that constitute the hot season for a hemisphere. */
export function hotMonths(lat) {
  return lat >= 0 ? [6, 7, 8] : [12, 1, 2];
}

/**
 * Mean hot-season value per year.
 * In the southern hemisphere December belongs to the summer that ends in the
 * following calendar year, so it is attributed forward.
 */
export function hotSeasonSeries(byYear, lat) {
  const months = hotMonths(lat);
  const buckets = {};
  for (const [yearStr, monthly] of Object.entries(byYear)) {
    const year = Number(yearStr);
    for (const m of months) {
      const v = monthly[m];
      if (!Number.isFinite(v)) continue;
      const season = lat >= 0 ? year : (m === 12 ? year + 1 : year);
      (buckets[season] ||= []).push(v);
    }
  }
  const years = [], values = [];
  for (const [season, vals] of Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (vals.length < months.length) continue; // incomplete season
    years.push(Number(season));
    values.push(mean(vals));
  }
  return { years, values };
}

/** Warming trend and recent-versus-baseline comparison for a coordinate. */
export function summariseWarming(json, parameter, lat) {
  const byYear = parseMonthly(json, parameter);
  const series = hotSeasonSeries(byYear, lat);
  if (series.years.length < 8) return null;
  const trend = trendPerDecade(series.years, series.values);
  const firstDecade = series.values.slice(0, 10);
  const lastDecade = series.values.slice(-10);
  return {
    parameter,
    years: series.years,
    values: series.values,
    trend,
    baselineMean: mean(firstDecade),
    recentMean: mean(lastDecade),
    change: mean(lastDecade) - mean(firstDecade),
    span: [series.years[0], series.years[series.years.length - 1]],
  };
}

/** Count of days in the record whose minimum temperature stayed above a threshold. */
export function countHotNights(dailyMin, thresholdC) {
  const byYear = {};
  for (const { date, value } of dailyMin) {
    const year = Number(date.slice(0, 4));
    byYear[year] ||= { total: 0, hot: 0 };
    byYear[year].total += 1;
    if (value >= thresholdC) byYear[year].hot += 1;
  }
  return byYear;
}
