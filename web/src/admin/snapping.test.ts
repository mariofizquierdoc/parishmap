import { describe, expect, it } from 'vitest';
import { findSnapPoint, prepareSnapRings, type SnapContext } from './snapping';

// 1 degree = 1000 pixels. Latitude increases upward, as on a real map.
const context: SnapContext = {
  project: (lng, lat) => ({ x: lng * 1000, y: -lat * 1000 }),
  unproject: (x, y) => ({ lng: x / 1000, lat: -y / 1000 }),
};

const square = prepareSnapRings([
  [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
    [1, 1],
  ],
]);

describe('findSnapPoint', () => {
  it('snaps to a nearby vertex exactly', () => {
    expect(findSnapPoint({ x: 1005, y: -1005 }, square, context)).toEqual([1, 1]);
  });

  it('snaps to the closest point on a nearby edge', () => {
    expect(findSnapPoint({ x: 1500, y: -1008 }, square, context)).toEqual([1.5, 1]);
  });

  it('prefers a vertex over a closer edge', () => {
    // 2 px from the edge but 10 px from the vertex.
    expect(findSnapPoint({ x: 1010, y: -1002 }, square, context)).toEqual([1, 1]);
  });

  it('returns nothing when out of range', () => {
    expect(findSnapPoint({ x: 1500, y: -1500 }, square, context)).toBeUndefined();
    expect(findSnapPoint({ x: 5000, y: -5000 }, square, context)).toBeUndefined();
  });

  it('checks the edge that closes the ring', () => {
    expect(findSnapPoint({ x: 995, y: -1500 }, square, context)).toEqual([1, 1.5]);
  });

  it('handles empty input', () => {
    expect(findSnapPoint({ x: 0, y: 0 }, [], context)).toBeUndefined();
    expect(prepareSnapRings([[]])).toEqual([]);
  });

  it('picks the nearest of several neighbors', () => {
    const rings = prepareSnapRings([
      [
        [1, 1],
        [1.1, 1],
        [1.1, 1.1],
        [1, 1],
      ],
      [
        [1.008, 1],
        [1.2, 1],
        [1.2, 1.1],
        [1.008, 1],
      ],
    ]);
    expect(findSnapPoint({ x: 1007, y: -1000 }, rings, context)).toEqual([1.008, 1]);
  });
});
