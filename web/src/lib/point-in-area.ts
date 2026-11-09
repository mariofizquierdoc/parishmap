import type { PublicTerritoryCollection, PublicTerritoryFeature } from '@parishmap/shared';
import type { MultiPolygon, Position } from 'geojson';
import { boundsOf } from './bbox';

/**
 * Point-in-polygon tests for the public site. Written here rather than imported from the shared
 * geometry module, so visitors don't download the whole Turf library (see bbox.ts).
 */

/** Even-odd ray casting: is the point inside this closed ring? */
function inRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (xi === undefined || yi === undefined || xj === undefined || yj === undefined) continue;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True if the point is inside any polygon of the shape, and not inside one of its holes. */
export function pointInMultiPolygon(lng: number, lat: number, shape: MultiPolygon): boolean {
  return shape.coordinates.some(([outer, ...holes]) => {
    if (!outer || !inRing(lng, lat, outer)) return false;
    return !holes.some((hole) => inRing(lng, lat, hole));
  });
}

/** The published parish territory containing the point, or null if none does. */
export function territoryAt(
  lng: number,
  lat: number,
  territories: PublicTerritoryCollection,
): PublicTerritoryFeature | null {
  for (const territory of territories.features) {
    const bounds = boundsOf([territory.geometry]);
    if (!bounds) continue;
    const [[west, south], [east, north]] = bounds;
    if (lng < west || lng > east || lat < south || lat > north) continue;
    if (pointInMultiPolygon(lng, lat, territory.geometry)) return territory;
  }
  return null;
}
