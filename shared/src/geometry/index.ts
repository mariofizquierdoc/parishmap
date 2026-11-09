import {
  area,
  bbox as turfBbox,
  booleanPointInPolygon,
  difference,
  feature,
  featureCollection,
  intersect,
  kinks,
  length,
  point,
  polygonToLine,
  union,
} from '@turf/turf';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

export type BBox = [west: number, south: number, east: number, north: number];
export type AreaGeometry = Polygon | MultiPolygon;

export interface NamedArea<Id = number> {
  id: Id;
  geometry: MultiPolygon;
}

export interface Overlap<Id = number> {
  id: Id;
  areaM2: number;
  geometry: MultiPolygon;
}

export type ValidationIssue =
  | 'empty'
  | 'coordinates-out-of-range'
  | 'too-few-points'
  | 'self-intersection'
  | 'hole-outside-shell'
  | 'overlapping-parts';

/** 6 decimal places is about 11 cm at the equator, well beyond the accuracy of hand drawing. */
const COORDINATE_FACTOR = 1e6;

/** Pieces smaller than this are treated as drawing noise. */
const MIN_REAL_AREA_M2 = 1;

/**
 * Pieces narrower than this are treated as drawing noise, however long they are.
 * A fixed area limit wouldn't work: rounding alone can leave a 5 km shared border with a
 * harmless sliver of around 500 m², while a real 500 m² overlap should still be reported.
 */
const MIN_REAL_WIDTH_M = 0.5;

function roundPosition([lng, lat]: Position): Position {
  return [
    Math.round((lng ?? 0) * COORDINATE_FACTOR) / COORDINATE_FACTOR,
    Math.round((lat ?? 0) * COORDINATE_FACTOR) / COORDINATE_FACTOR,
  ];
}

function samePosition(a: Position | undefined, b: Position | undefined): boolean {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function normalizeRing(ring: Position[]): Position[] {
  const result: Position[] = [];
  for (const position of ring.map(roundPosition)) {
    if (!samePosition(result.at(-1), position)) result.push(position);
  }
  if (result.length > 0 && !samePosition(result[0], result.at(-1))) {
    result.push([...result[0]!]);
  }
  return result;
}

/** Converts to MultiPolygon, rounds coordinates, closes rings, and removes repeated points. */
export function normalize(geometry: AreaGeometry): MultiPolygon {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((rings) => rings.map(normalizeRing)),
  };
}

function polygonsOf(geometry: MultiPolygon): Feature<Polygon>[] {
  return geometry.coordinates.map((coordinates) => feature({ type: 'Polygon', coordinates }));
}

/** Lists problems that make a shape unusable. An empty list means the shape is valid. */
export function validate(geometry: MultiPolygon): ValidationIssue[] {
  const hasShape = geometry.coordinates.some((polygon) => (polygon[0]?.length ?? 0) > 0);
  if (!hasShape) return ['empty'];

  const rings = geometry.coordinates.flat();
  const outOfRange = rings
    .flat()
    .some(([lng, lat]) => Math.abs(lng ?? NaN) > 180 || Math.abs(lat ?? NaN) > 90);
  if (outOfRange) return ['coordinates-out-of-range'];

  // A closed ring needs at least 3 distinct points plus the repeated first point.
  if (rings.some((ring) => ring.length < 4)) return ['too-few-points'];

  const issues: ValidationIssue[] = [];
  const parts = polygonsOf(geometry);

  if (parts.some((part) => kinks(part).features.length > 0)) {
    issues.push('self-intersection');
  }

  for (const part of parts) {
    const [shell, ...holes] = part.geometry.coordinates;
    const shellOnly = feature<Polygon>({ type: 'Polygon', coordinates: [shell!] });
    const holeEscapes = holes.some((hole) =>
      hole.some((position) => !booleanPointInPolygon(position, shellOnly)),
    );
    if (holeEscapes) {
      issues.push('hole-outside-shell');
      break;
    }
  }

  if (issues.length === 0) {
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const shared = intersect(featureCollection([parts[i]!, parts[j]!]));
        if (shared && realParts(shared).length > 0) {
          issues.push('overlapping-parts');
          break outer;
        }
      }
    }
  }

  return issues;
}

export function bboxOf(geometry: MultiPolygon): BBox {
  return turfBbox(geometry).slice(0, 4) as BBox;
}

function bboxesTouch(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function isSliver(part: Feature<Polygon>): boolean {
  const areaM2 = area(part);
  if (areaM2 < MIN_REAL_AREA_M2) return true;
  const perimeterM = length(polygonToLine(part) as Feature, { units: 'meters' });
  // For a long thin shape, perimeter is about twice its length, so this estimates its width.
  return (2 * areaM2) / perimeterM < MIN_REAL_WIDTH_M;
}

/** Splits a result into its polygons and discards any that are only slivers. */
function realParts(result: Feature<AreaGeometry>): Position[][][] {
  const polygons =
    result.geometry.type === 'Polygon'
      ? [result.geometry.coordinates]
      : result.geometry.coordinates;
  return polygons.filter(
    (coordinates) => !isSliver(feature<Polygon>({ type: 'Polygon', coordinates })),
  );
}

/** Keeps the real parts of a result. Returns null if nothing real remains. */
function cleanResult(result: Feature<AreaGeometry> | null): MultiPolygon | null {
  if (!result) return null;
  const parts = realParts(result);
  if (parts.length === 0) return null;
  return normalize({ type: 'MultiPolygon', coordinates: parts });
}

/** Finds where a shape overlaps other areas, ignoring slivers. */
export function findOverlaps<Id>(shape: MultiPolygon, others: NamedArea<Id>[]): Overlap<Id>[] {
  const shapeBox = bboxOf(shape);
  const overlaps: Overlap<Id>[] = [];

  for (const other of others) {
    if (!bboxesTouch(shapeBox, bboxOf(other.geometry))) continue;
    const shared = cleanResult(
      intersect(featureCollection([feature(shape), feature(other.geometry)])),
    );
    if (shared) overlaps.push({ id: other.id, areaM2: area(shared), geometry: shared });
  }

  return overlaps;
}

/**
 * Removes neighboring areas from a shape, giving it a clean shared edge with each one.
 * Returns null if nothing is left, which the caller should report rather than save.
 */
export function trimToNeighbors(
  shape: MultiPolygon,
  neighbors: MultiPolygon[],
): MultiPolygon | null {
  const shapeBox = bboxOf(shape);
  const nearby = neighbors.filter((neighbor) => bboxesTouch(shapeBox, bboxOf(neighbor)));
  if (nearby.length === 0) return shape;

  return cleanResult(
    difference(featureCollection([feature(shape), ...nearby.map((n) => feature(n))])),
  );
}

/** Returns the part of a shape outside the diocese outline, or null if it's fully inside. */
export function findOutsideDiocese(
  shape: MultiPolygon,
  diocese: MultiPolygon,
): MultiPolygon | null {
  return cleanResult(difference(featureCollection([feature(shape), feature(diocese)])));
}

/** Returns the parts of the diocese no parish covers, or null if it's fully covered. */
export function findCoverageGaps(
  diocese: MultiPolygon,
  parishes: MultiPolygon[],
): MultiPolygon | null {
  if (parishes.length === 0) return diocese;
  const covered =
    parishes.length === 1
      ? feature<AreaGeometry>(parishes[0]!)
      : union(featureCollection(parishes.map((parish) => feature(parish))));
  if (!covered) return diocese;
  return cleanResult(difference(featureCollection([feature(diocese), covered])));
}

/** Returns the id of the area containing a point, or null if none does. */
export function parishAtPoint<Id>(lng: number, lat: number, areas: NamedArea<Id>[]): Id | null {
  const location = point([lng, lat]);
  for (const candidate of areas) {
    const [west, south, east, north] = bboxOf(candidate.geometry);
    if (lng < west || lng > east || lat < south || lat > north) continue;
    if (booleanPointInPolygon(location, candidate.geometry)) return candidate.id;
  }
  return null;
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function isPolygonCoordinates(value: unknown): value is Position[][] {
  return (
    Array.isArray(value) &&
    value.every((ring) => Array.isArray(ring) && ring.every((position) => isPosition(position)))
  );
}

/**
 * Reads shapes from uploaded or submitted JSON: a Polygon, a MultiPolygon, a Feature, or a
 * FeatureCollection whose polygons are combined. Returns null for anything else, including
 * collections containing other geometry, rather than quietly importing part of a file.
 */
export function parseAreaGeometry(input: unknown): AreaGeometry | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = input as {
    type?: unknown;
    coordinates?: unknown;
    geometry?: unknown;
    features?: unknown;
  };

  switch (value.type) {
    case 'Polygon':
      return isPolygonCoordinates(value.coordinates)
        ? { type: 'Polygon', coordinates: value.coordinates }
        : null;
    case 'MultiPolygon':
      return Array.isArray(value.coordinates) && value.coordinates.every(isPolygonCoordinates)
        ? { type: 'MultiPolygon', coordinates: value.coordinates as Position[][][] }
        : null;
    case 'Feature':
      return parseAreaGeometry(value.geometry);
    case 'FeatureCollection': {
      if (!Array.isArray(value.features) || value.features.length === 0) return null;
      const coordinates: Position[][][] = [];
      for (const item of value.features) {
        const geometry = parseAreaGeometry(item);
        if (!geometry) return null;
        if (geometry.type === 'Polygon') coordinates.push(geometry.coordinates);
        else coordinates.push(...geometry.coordinates);
      }
      return { type: 'MultiPolygon', coordinates };
    }
    default:
      return null;
  }
}

export interface EditableShape {
  /** Outer ring of each part. */
  parts: Position[][];
  /** Holes, kept apart because the drawing library can't edit polygons that have them. */
  holes: Position[][];
}

/** Separates a shape into outer rings and holes for editing. */
export function splitHoles(geometry: MultiPolygon): EditableShape {
  const parts: Position[][] = [];
  const holes: Position[][] = [];
  for (const [shell, ...polygonHoles] of geometry.coordinates) {
    if (shell) parts.push(shell);
    holes.push(...polygonHoles);
  }
  return { parts, holes };
}

/**
 * Rebuilds a shape after editing. A hole is kept only if it's still fully inside a part.
 * The number dropped is returned, so the editor can warn rather than lose one silently.
 */
export function joinHoles(shape: EditableShape): { geometry: MultiPolygon; droppedHoles: number } {
  const polygons: Position[][][] = shape.parts.map((part) => [part]);
  let droppedHoles = 0;

  for (const hole of shape.holes) {
    const owner = polygons.find((rings) => {
      const shell = feature<Polygon>({ type: 'Polygon', coordinates: [rings[0]!] });
      return hole.every((position) => booleanPointInPolygon(position, shell));
    });
    if (owner) owner.push(hole);
    else droppedHoles += 1;
  }

  return { geometry: normalize({ type: 'MultiPolygon', coordinates: polygons }), droppedHoles };
}
