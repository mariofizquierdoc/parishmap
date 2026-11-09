import type { MultiPolygon } from 'geojson';

export type Bounds = [[west: number, south: number], [east: number, north: number]];

/**
 * Bounding box of one or more shapes, or null if there are none.
 * Written here rather than imported from the shared geometry module, so the public site
 * doesn't download the whole Turf library just to zoom the map.
 */
export function boundsOf(shapes: MultiPolygon[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const shape of shapes) {
    for (const polygon of shape.coordinates) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          if (lng === undefined || lat === undefined) continue;
          west = Math.min(west, lng);
          south = Math.min(south, lat);
          east = Math.max(east, lng);
          north = Math.max(north, lat);
        }
      }
    }
  }

  return west === Infinity
    ? null
    : [
        [west, south],
        [east, north],
      ];
}
