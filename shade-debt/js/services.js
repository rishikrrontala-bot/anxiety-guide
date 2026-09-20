/**
 * Small keyless services: place search and reverse lookup.
 * Both degrade quietly - the analysis only needs coordinates.
 */

import { fetchWithTimeout } from './gibs.js';

export async function searchPlaces(query, count = 6) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}&language=en&format=json`;
  const res = await fetchWithTimeout(url, { timeout: 12000 });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    name: r.name,
    admin: [r.admin1, r.country].filter(Boolean).join(', '),
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
    population: r.population || null,
  }));
}

export async function reverseLookup(lat, lon) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetchWithTimeout(url, { timeout: 8000 });
    if (!res.ok) return null;
    const j = await res.json();
    const parts = [j.city || j.locality, j.principalSubdivision, j.countryName].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}
