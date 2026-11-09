import type { Bounds } from './bbox';

/**
 * Address search through Photon, a free geocoder built on OpenStreetMap data.
 * Google's address search can't be used here: its terms forbid showing results on a non-Google map.
 * Only the typed text is sent. The visitor's own location never leaves the browser.
 */
export const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Extra margin around the diocese, in degrees (about 5 km), so edge addresses still match. */
const BIAS_MARGIN = 0.05;

export interface AddressResult {
  id: string;
  label: string;
  lng: number;
  lat: number;
}

export interface PhotonProperties {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  locality?: string;
  city?: string;
}

interface PhotonResponse {
  features?: {
    geometry?: { type?: string; coordinates?: unknown };
    properties?: PhotonProperties;
  }[];
}

export class GeocodeError extends Error {
  constructor(public readonly status: number) {
    super(`Address search failed with HTTP ${status}`);
  }
}

/** A short, readable label such as "Malecón 2000, Av. Malecón Simón Bolívar, Guayaquil". */
export function formatLabel(properties: PhotonProperties): string {
  const street = [properties.street, properties.housenumber].filter(Boolean).join(' ');
  const parts = [
    properties.name,
    street,
    properties.district ?? properties.locality,
    properties.city,
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const text = part?.trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    unique.push(text);
  }
  return unique.join(', ');
}

/** Builds the Photon request: limited to the diocese area and ranked by distance from its center. */
export function searchUrl(query: string, bias: Bounds | null, limit = 5): string {
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  if (bias) {
    const [[west, south], [east, north]] = bias;
    const box = [west - BIAS_MARGIN, south - BIAS_MARGIN, east + BIAS_MARGIN, north + BIAS_MARGIN];
    params.set('bbox', box.map((n) => n.toFixed(4)).join(','));
    params.set('lat', ((south + north) / 2).toFixed(4));
    params.set('lon', ((west + east) / 2).toFixed(4));
  }
  return `${PHOTON_URL}?${params.toString()}`;
}

export async function searchAddresses(
  query: string,
  bias: Bounds | null,
  signal?: AbortSignal,
): Promise<AddressResult[]> {
  const response = await fetch(searchUrl(query, bias), { signal });
  if (!response.ok) throw new GeocodeError(response.status);
  const body = (await response.json()) as PhotonResponse;

  const results: AddressResult[] = [];
  const seen = new Set<string>();
  for (const feature of body.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) continue;
    const [lng, lat] = coordinates as unknown[];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;

    const properties = feature.properties ?? {};
    const label = formatLabel(properties);
    if (!label) continue;
    const id =
      properties.osm_type && properties.osm_id !== undefined
        ? `${properties.osm_type}${properties.osm_id}`
        : `${lng},${lat}`;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({ id, label, lng, lat });
  }
  return results;
}
