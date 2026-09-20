import test from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, parseIso, addDays, dayOfYear, snapToPeriod, hottestSeason, observationDates } from '../js/dates.js';

const SEP20 = new Date(Date.UTC(2026, 8, 20));

test('date helpers work in UTC and survive month boundaries', () => {
  assert.equal(isoDate(new Date(Date.UTC(2026, 0, 5))), '2026-01-05');
  assert.equal(isoDate(addDays(parseIso('2026-02-28'), 1)), '2026-03-01');
  assert.equal(isoDate(addDays(parseIso('2024-02-28'), 1)), '2024-02-29', 'leap year');
  assert.equal(dayOfYear(parseIso('2026-01-01')), 1);
  assert.equal(dayOfYear(parseIso('2026-12-31')), 365);
});

test('dates snap back to the start of a MODIS 8-day compositing period', () => {
  // Periods begin on day-of-year 1, 9, 17 ... so 2026-01-10 (doy 10) snaps to doy 9.
  assert.equal(isoDate(snapToPeriod(parseIso('2026-01-10'), 8)), '2026-01-09');
  assert.equal(isoDate(snapToPeriod(parseIso('2026-01-09'), 8)), '2026-01-09', 'already a period start');
  assert.equal(isoDate(snapToPeriod(parseIso('2026-01-01'), 8)), '2026-01-01');
  assert.equal(isoDate(snapToPeriod(parseIso('2026-06-15'), 1)), '2026-06-15', 'daily products are untouched');
});

test('the hot season follows the hemisphere', () => {
  const north = hottestSeason(40, SEP20);
  assert.equal(north.hemisphere, 'north');
  assert.equal(isoDate(north.start), '2026-06-01');

  const south = hottestSeason(-33, SEP20);
  assert.equal(south.hemisphere, 'south');
  assert.equal(isoDate(south.start), '2025-12-01', 'the southern summer starts the previous December');
  assert.equal(isoDate(south.end), '2026-03-15');
});

test('a season that has not started yet falls back to the previous year', () => {
  const march = new Date(Date.UTC(2026, 2, 1));
  const north = hottestSeason(40, march);
  assert.equal(isoDate(north.start), '2025-06-01');
});

test('the window never reaches into imagery that has not been processed yet', () => {
  const midSummer = new Date(Date.UTC(2026, 6, 10));
  const season = hottestSeason(40, midSummer, 4);
  assert.equal(isoDate(season.end), '2026-07-06', 'clipped to now minus the latency allowance');
  assert.ok(season.end <= midSummer);
});

test('observation dates are unique, in range, and newest first', () => {
  const { dates, season } = observationDates({ lat: 40, now: SEP20, count: 6 });
  assert.equal(dates.length, new Set(dates).size, 'no duplicates');
  assert.deepEqual([...dates].sort().reverse(), dates, 'newest first');
  assert.ok(dates[0] <= season.end);
  assert.equal(dates.length, 6);
});

test('8-day snapping collapses duplicates rather than requesting the same tile twice', () => {
  const { dates } = observationDates({ lat: 40, now: SEP20, count: 20, periodDays: 8 });
  assert.equal(dates.length, new Set(dates).size);
  assert.ok(dates.length < 20, 'requesting more dates than periods exist yields fewer, not repeats');
  for (const d of dates) {
    assert.equal(isoDate(snapToPeriod(parseIso(d), 8)), d, 'every date is a real period start');
  }
});

test('a single requested date lands at the hot end of the season', () => {
  const { dates, season } = observationDates({ lat: 40, now: SEP20, count: 1 });
  assert.equal(dates.length, 1);
  assert.equal(dates[0], season.end);
});

test('the southern hemisphere gets southern summer dates', () => {
  const { dates } = observationDates({ lat: -33.9, now: SEP20, count: 4 });
  for (const d of dates) {
    const month = Number(d.slice(5, 7));
    assert.ok([12, 1, 2, 3].includes(month), `${d} is not in the southern summer`);
  }
});
