import type { Position } from 'geojson';

interface ScreenPoint {
  x: number;
  y: number;
}

export interface SnapContext {
  project: (lng: number, lat: number) => ScreenPoint;
  unproject: (x: number, y: number) => { lng: number; lat: number };
}

export const SNAP_DISTANCE_PX = 12;

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function ringBounds(ring: Position[]) {
  const lngs = ring.map((position) => position[0]!);
  const lats = ring.map((position) => position[1]!);
  return {
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

export interface SnapRing {
  ring: Position[];
  bounds: ReturnType<typeof ringBounds>;
}

export function prepareSnapRings(rings: Position[][]): SnapRing[] {
  return rings
    .filter((ring) => ring.length > 0)
    .map((ring) => ({ ring, bounds: ringBounds(ring) }));
}

/**
 * Finds a point on a neighbor to snap to. A vertex wins over an edge when both are in range,
 * because landing on a neighbor's exact vertex gives the cleanest shared border.
 */
export function findSnapPoint(
  cursor: ScreenPoint,
  rings: SnapRing[],
  context: SnapContext,
  maxDistance = SNAP_DISTANCE_PX,
): Position | undefined {
  // Skips distant rings cheaply. This runs on every mouse movement.
  const nw = context.unproject(cursor.x - maxDistance, cursor.y - maxDistance);
  const se = context.unproject(cursor.x + maxDistance, cursor.y + maxDistance);
  const nearby = rings.filter(
    ({ bounds }) =>
      bounds.west <= se.lng &&
      bounds.east >= nw.lng &&
      bounds.south <= nw.lat &&
      bounds.north >= se.lat,
  );

  let vertex: Position | undefined;
  let vertexDistance = maxDistance;
  let edge: Position | undefined;
  let edgeDistance = maxDistance;

  for (const { ring } of nearby) {
    let previous: ScreenPoint | undefined;
    for (const position of ring) {
      const point = context.project(position[0]!, position[1]!);

      const toVertex = Math.hypot(point.x - cursor.x, point.y - cursor.y);
      if (toVertex <= vertexDistance) {
        vertexDistance = toVertex;
        vertex = position;
      }

      if (previous) {
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared > 0) {
          const along =
            ((cursor.x - previous.x) * dx + (cursor.y - previous.y) * dy) / lengthSquared;
          const t = Math.max(0, Math.min(1, along));
          const x = previous.x + t * dx;
          const y = previous.y + t * dy;
          const toEdge = Math.hypot(x - cursor.x, y - cursor.y);
          if (toEdge < edgeDistance) {
            edgeDistance = toEdge;
            const { lng, lat } = context.unproject(x, y);
            edge = [round(lng), round(lat)];
          }
        }
      }
      previous = point;
    }
  }

  return vertex ?? edge;
}
