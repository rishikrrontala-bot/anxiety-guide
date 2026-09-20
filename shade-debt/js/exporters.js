/**
 * Deliverables: machine-readable exports a city GIS office can load directly,
 * and a letter a resident can actually send.
 * Pure functions - no DOM, no network.
 */

const FIELDS = [
  ['rank', 'Rank'],
  ['lat', 'Latitude'],
  ['lon', 'Longitude'],
  ['shadeDebt', 'Shade debt (C)'],
  ['lstDay', 'Surface temp day (C)'],
  ['lstNight', 'Surface temp night (C)'],
  ['dayExcess', 'Day excess vs median (C)'],
  ['nightExcess', 'Night excess vs median (C)'],
  ['ndvi', 'NDVI'],
  ['popDensity', 'Population density (per km2)'],
  ['population', 'Population in cell'],
  ['degreePersons', 'Priority (degree-persons)'],
  ['trees', 'Trees to close gap'],
  ['areaKm2', 'Cell area (km2)'],
];

function round(v, dp) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function flatten(cell, rank) {
  return {
    rank,
    lat: round(cell.centre?.lat, 5),
    lon: round(cell.centre?.lng, 5),
    shadeDebt: round(cell.shadeDebt, 2),
    lstDay: round(cell.lstDay, 2),
    lstNight: round(cell.lstNight, 2),
    dayExcess: round(cell.dayExcess, 2),
    nightExcess: round(cell.nightExcess, 2),
    ndvi: round(cell.ndvi, 3),
    popDensity: round(cell.popDensity, 1),
    population: Number.isFinite(cell.population) ? Math.round(cell.population) : null,
    degreePersons: Number.isFinite(cell.degreePersons) ? Math.round(cell.degreePersons) : null,
    trees: cell.trees ?? null,
    areaKm2: round(cell.areaKm2, 3),
  };
}

export function escapeCsv(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(ranked, meta = {}) {
  const lines = [];
  if (meta.place) lines.push(`# Shade Debt analysis,${escapeCsv(meta.place)}`);
  if (meta.generated) lines.push(`# Generated,${escapeCsv(meta.generated)}`);
  if (meta.dates?.length) lines.push(`# Source dates,${escapeCsv(meta.dates.join(' '))}`);
  lines.push(FIELDS.map(([, label]) => escapeCsv(label)).join(','));
  ranked.forEach((cell, i) => {
    const flat = flatten(cell, i + 1);
    lines.push(FIELDS.map(([key]) => escapeCsv(flat[key])).join(','));
  });
  return lines.join('\n');
}

export function toGeoJSON(ranked, meta = {}) {
  return {
    type: 'FeatureCollection',
    metadata: {
      title: 'Shade Debt priority sites',
      place: meta.place || null,
      generated: meta.generated || null,
      sourceDates: meta.dates || [],
      model: meta.model || null,
      sources: meta.sources || [],
      note: 'Shade debt is degrees C of surface heat attributable to missing vegetation, '
        + 'derived from a locally calibrated NDVI-temperature regression. Land surface '
        + 'temperature is not air temperature.',
    },
    features: ranked.map((cell, i) => {
      const flat = flatten(cell, i + 1);
      const b = cell.bounds;
      return {
        type: 'Feature',
        geometry: b
          ? {
              type: 'Polygon',
              coordinates: [[
                [b.west, b.north], [b.east, b.north],
                [b.east, b.south], [b.west, b.south], [b.west, b.north],
              ]],
            }
          : { type: 'Point', coordinates: [flat.lon, flat.lat] },
        properties: flat,
      };
    }),
  };
}

function plural(n, one, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/**
 * A letter to a local official, filled entirely from measured values.
 * Nothing here is generated prose about data that was not computed: every
 * number in the body comes from the analysis object passed in.
 */
export function buildLetter({ place, ranked, summary, calibration, totals, dates = [], generated, recipient }) {
  const top = ranked.slice(0, 5);
  const where = place || 'our area';
  const to = recipient || 'Members of the City Council';
  const dateLine = generated || new Date().toISOString().slice(0, 10);
  const obs = dates.length
    ? `${dates.length} cloud-screened satellite ${dates.length === 1 ? 'observation' : 'observations'} (${dates[0]} to ${dates[dates.length - 1]})`
    : 'cloud-screened satellite observations';

  const siteLines = top.map((c, i) => {
    const bits = [
      `${i + 1}. ${c.centre.lat.toFixed(4)}, ${c.centre.lng.toFixed(4)}`,
      `     Surface temperature: ${Number.isFinite(c.lstDay) ? c.lstDay.toFixed(1) + ' C' : 'n/a'}`
        + (Number.isFinite(c.dayExcess) ? ` (${c.dayExcess >= 0 ? '+' : ''}${c.dayExcess.toFixed(1)} C vs the local median)` : ''),
      `     Vegetation index: ${Number.isFinite(c.ndvi) ? c.ndvi.toFixed(2) : 'n/a'} against a local target of ${Number.isFinite(summary.ndviTarget) ? summary.ndviTarget.toFixed(2) : 'n/a'}`,
      `     Shade debt: ${Number.isFinite(c.shadeDebt) ? c.shadeDebt.toFixed(1) : 'n/a'} C of avoidable heat`,
    ];
    if (Number.isFinite(c.population)) bits.push(`     People living in this cell: approximately ${Math.round(c.population).toLocaleString('en-US')}`);
    if (Number.isFinite(c.trees)) bits.push(`     Canopy required to close the gap: roughly ${plural(c.trees, 'tree', 'trees')}`);
    if (Number.isFinite(c.nightExcess) && c.nightExcess > 0) bits.push(`     Night-time surface temperature runs ${c.nightExcess.toFixed(1)} C above the local median, so this cell stays hot after dark.`);
    return bits.join('\n');
  }).join('\n\n');

  const calLine = calibration
    ? `Across ${calibration.n} grid cells in this area, each unit of vegetation index is associated with `
      + `${Math.abs(calibration.slope).toFixed(1)} C of surface cooling (Theil-Sen estimator; OLS R-squared ${calibration.r2.toFixed(2)}). `
      + `That coefficient was measured here, not borrowed from another city.`
    : 'The vegetation-temperature relationship could not be calibrated for this area from the available observations.';

  const reach = totals && Number.isFinite(totals.people) && totals.people > 0
    ? ` Those five sites together hold approximately ${Math.round(totals.people).toLocaleString('en-US')} residents`
      + (Number.isFinite(totals.trees) && totals.trees > 0 ? ` and would need on the order of ${plural(totals.trees, 'tree', 'trees')} to reach the local canopy target.` : '.')
    : '';

  return `${dateLine}

To: ${to}
Subject: Measured heat priority sites in ${where}

Dear ${to},

I am writing about extreme heat in ${where}, and I want to point to specific
locations rather than a general concern.

Using NASA satellite observations, I measured surface temperature and vegetation
cover across ${where} on a grid of approximately one kilometre cells, and
calculated how much of each cell's heat is attributable to missing vegetation.
The analysis used ${obs}.

${calLine}

The area's surface temperature spans ${Number.isFinite(summary.spread) ? summary.spread.toFixed(1) : 'n/a'} C between its coolest and
hottest cells${Number.isFinite(summary.dayMedian) ? `, with a median of ${summary.dayMedian.toFixed(1)} C` : ''}. That gap is not
inevitable. It tracks where trees are.

The five highest-priority sites, ranked by avoidable heat multiplied by the
number of people exposed to it:

${siteLines}
${reach}

I am asking for three things:

1. Prioritise canopy planting and shade infrastructure at the coordinates above
   in the next planting season.
2. Publish the city's own canopy and surface temperature data so residents can
   check this analysis and improve it.
3. Include night-time surface temperature in the city's heat planning. Daytime
   peaks get the attention, but it is the nights that do not cool down that
   drive heat illness.

The full dataset behind this letter, including every grid cell and the code that
produced it, is available on request as GeoJSON and CSV.

A note on method, offered honestly: these are satellite measurements of land
surface temperature, which is the temperature of the ground itself and runs
warmer than the air temperature a thermometer reports. The grid resolution is
about one kilometre, so this identifies neighbourhoods rather than individual
streets. It is a triage tool for deciding where to look first, and it is built
on public data that anyone can verify.

Thank you for your time.

Sincerely,


[Your name]
[Your address in ${where}]

---
Data: NASA MODIS land surface temperature and vegetation index via NASA GIBS;
population from NASA SEDAC Gridded Population of the World; climate record from
NASA POWER. Generated with Shade Debt, an open-source tool.`;
}
