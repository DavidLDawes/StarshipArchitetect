'use strict';

const {
  polygonArea,
  rectanglePolygon,
  circlePolygon,
  getPolygonBounds,
  isRectInConvexPolygon,
  intersectConvexPolygons,
  getRectFitRegion,
  closestPointOnPolygonBoundary,
  closestPointInConvexPolygon,
  isRectOnConvexPolygonWall,
  getPolygonCrossings
} = require('../../src/hull-shapes');
const {
  getHullBounds,
  touchesHull,
  snapToHullEdge,
  planCurvedExposedFill,
  getShapedInner,
  touchesFloorHull,
  snapToFloorHull,
  getFloorUsableBounds,
  planFloorExposedFill
} = require('../../src/hull-access');
const {
  isWithinUsableArea,
  fitsFloor,
  clampToFloor,
  checkOverlap,
  findValidPosition
} = require('../../src/placement-logic');
const { analyzeFloorFreeSpace, sumRectArea } = require('../../src/placement-geometry');
const { recalculateFloors, getShipGeometry, getCurrentFloorDimensions } = require('../../src/floor-utils');
const { calculateNewDimensions } = require('../../src/component-resize');
const { exportLayoutSvg } = require('../../src/layout-export');

const SHAPED = ['wedge', 'cone', 'sphere', 'cylinder', 'wing', 'disk', 'lifting-body'];
const CURVED = ['cone', 'sphere', 'wing', 'disk', 'lifting-body'];
const RECTANGULAR_DECKS = ['wedge', 'cylinder'];

// Small repeatable random number generator, so failures can be reproduced
function makeRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function setShip({ shape = 'rectangular', totalTons = 1000, numFloors = 5, armorTons = 0 }) {
  Object.assign(global.shipData, {
    hullShape: shape,
    totalTons,
    numFloors,
    armorTons,
    ceilingHeight: 2.5,
    floorLength: 30,
    components: [],
    componentPlacements: {}
  });
  recalculateFloors({ resetLength: true });
  return getCurrentFloorDimensions();
}

const rectsOverlap = (a, b) =>
  a.x + a.length > b.x + 1e-6 && b.x + b.length > a.x + 1e-6 &&
  a.y + a.width > b.y + 1e-6 && b.y + b.width > a.y + 1e-6;

afterAll(() => {
  setShip({ totalTons: 1000, numFloors: 4 });
  global.shipData.floorLength = 30;
  global.shipData.armorThickness = 0;
  delete global.shipData.hullShape;
});

// ============================================================
// Polygon helpers
// ============================================================

describe('getRectFitRegion', () => {
  const square = rectanglePolygon(0, 0, 10, 10);

  test('in a square, positions run from the corner to where the far side touches', () => {
    const box = getPolygonBounds(getRectFitRegion(square, 4, 2));
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
    expect(box.length).toBeCloseTo(6, 6);
    expect(box.width).toBeCloseTo(8, 6);
  });

  test('a rectangle that exactly fits still has somewhere to go', () => {
    const region = getRectFitRegion(square, 10, 10);
    expect(region.length).toBeGreaterThanOrEqual(3);
    const p = closestPointInConvexPolygon(region, 3, 3);
    expect(isRectInConvexPolygon(square, p.x, p.y, 10, 10)).toBe(true);
  });

  test('a rectangle too big for the polygon has nowhere to go', () => {
    expect(getRectFitRegion(square, 10.01, 2)).toEqual([]);
    expect(getRectFitRegion(square, 2, 10.01)).toEqual([]);
    expect(getRectFitRegion([], 1, 1)).toEqual([]);
  });

  test('a circle holds a rectangle only up to its diagonal', () => {
    const circle = circlePolygon(10, 10, 10);
    expect(getRectFitRegion(circle, 12, 12).length).toBeGreaterThan(0); // diagonal 17
    expect(getRectFitRegion(circle, 15, 15)).toEqual([]);                // diagonal 21
  });

  test('every position on the boundary fits and touches a wall', () => {
    const circle = circlePolygon(10, 10, 10);
    for (const [x, y] of getRectFitRegion(circle, 6, 3)) {
      expect(isRectInConvexPolygon(circle, x, y, 6, 3)).toBe(true);
      expect(isRectOnConvexPolygonWall(circle, x, y, 6, 3)).toBe(true);
    }
  });
});

describe('closest points', () => {
  const square = rectanglePolygon(0, 0, 10, 10);

  test('a point inside stays put, or moves to the boundary if asked', () => {
    expect(closestPointInConvexPolygon(square, 2, 3)).toEqual({ x: 2, y: 3 });
    expect(closestPointOnPolygonBoundary(square, 2, 3)).toEqual({ x: 0, y: 3 });
  });

  test('a point outside moves to the nearest edge or corner', () => {
    expect(closestPointInConvexPolygon(square, 15, 4)).toEqual({ x: 10, y: 4 });
    expect(closestPointInConvexPolygon(square, 15, 15)).toEqual({ x: 10, y: 10 });
  });

  test('an empty polygon has no closest point', () => {
    expect(closestPointInConvexPolygon([], 1, 1)).toBeNull();
    expect(closestPointOnPolygonBoundary([], 1, 1)).toBeNull();
  });
});

describe('isRectOnConvexPolygonWall', () => {
  const circle = circlePolygon(10, 10, 10);

  test('a rectangle in the middle does not touch', () => {
    expect(isRectOnConvexPolygonWall(circle, 8, 8, 4, 4)).toBe(false);
  });

  test('a rectangle with one corner on the curve touches', () => {
    const p = closestPointOnPolygonBoundary(getRectFitRegion(circle, 4, 4), 16, 16);
    expect(isRectOnConvexPolygonWall(circle, p.x, p.y, 4, 4)).toBe(true);
  });

  test('a rectangle whose corner is past the wall does not count', () => {
    expect(isRectOnConvexPolygonWall(circle, 0, 0, 2, 2)).toBe(false);
  });
});

describe('getPolygonCrossings', () => {
  const square = rectanglePolygon(0, 0, 10, 10);

  test('finds both sides of a line through the polygon', () => {
    const ys = getPolygonCrossings(square, 'x', 4).map(p => p.y).sort((a, b) => a - b);
    expect(ys).toEqual([0, 10]);
    const xs = getPolygonCrossings(square, 'y', 4).map(p => p.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 10]);
  });

  test('finds nothing for a line that misses', () => {
    expect(getPolygonCrossings(square, 'x', 11)).toEqual([]);
  });
});

describe('intersectConvexPolygons', () => {
  test('keeps the overlap of two rectangles', () => {
    const shared = intersectConvexPolygons(rectanglePolygon(0, 0, 10, 10), rectanglePolygon(6, 4, 10, 10));
    const box = getPolygonBounds(shared);
    expect([box.x, box.y, box.length, box.width]).toEqual([6, 4, 4, 6]);
  });

  test('is empty when they do not meet', () => {
    expect(intersectConvexPolygons(rectanglePolygon(0, 0, 2, 2), rectanglePolygon(5, 5, 2, 2))).toEqual([]);
  });
});

// ============================================================
// Rectangular ships keep their old behavior
// ============================================================

describe('rectangular ships', () => {
  test('have no shaped hull, however the shape is written', () => {
    for (const shape of [undefined, 'rectangular', 'distributed', 'nonsense']) {
      global.shipData.hullShape = shape;
      expect(getShapedInner(1)).toBeNull();
    }
  });

  test('the floor-aware rules match the plain functions', () => {
    const { floorLength: L, floorWidth: W } = setShip({ armorTons: 30 });
    const armor = global.shipData.armorThickness;
    expect(armor).toBeGreaterThan(0);
    const random = makeRandom(1);

    for (let i = 0; i < 500; i++) {
      const length = 1 + random() * 12;
      const width = 1 + random() * 12;
      const x = random() * (L + 4) - 2;
      const y = random() * (W + 4) - 2;
      expect(fitsFloor(1, x, y, length, width, L, W, armor)).toBe(isWithinUsableArea(x, y, length, width, L, W, armor));
      expect(touchesFloorHull(1, x, y, length, width, L, W, armor)).toBe(touchesHull(x, y, length, width, L, W, armor));
      expect(snapToFloorHull(1, x, y, length, width, L, W, armor)).toEqual(snapToHullEdge(x, y, length, width, L, W, armor));
      expect(clampToFloor(1, x, y, length, width, L, W, armor)).toEqual({
        x: Math.max(armor, Math.min(x, L - length - armor)),
        y: Math.max(armor, Math.min(y, W - width - armor))
      });
    }
    expect(getFloorUsableBounds(1, L, W, armor)).toEqual(getHullBounds(L, W, armor));
  });

  test('free space ignores hull bands', () => {
    const { floorLength: L, floorWidth: W } = setShip({ armorTons: 30 });
    const armor = global.shipData.armorThickness;
    const { regions, xs, ys } = analyzeFloorFreeSpace(1, L, W, armor);
    expect(regions).toHaveLength(1);
    expect(xs).toHaveLength(2);
    expect(ys).toHaveLength(2);
    expect(regions[0].area).toBeCloseTo((L - 2 * armor) * (W - 2 * armor), 6);
  });

  test('multi-floor placement ignores the floor list', () => {
    const { floorLength: L, floorWidth: W } = setShip({});
    expect(findValidPosition(1, 3, 3, 5, 5, L, W, -1, false, [1, 2, 3])).toEqual({ x: 3, y: 3 });
  });
});

// ============================================================
// Shaped hull rules
// ============================================================

describe.each(SHAPED)('%s hull', shape => {
  describe.each([[0], [40]])('with %d tons of armor', armorTons => {
    let L, W, armor;

    beforeEach(() => {
      ({ floorLength: L, floorWidth: W } = setShip({ shape, armorTons }));
      armor = global.shipData.armorThickness;
    });

    test('positions clamped to a floor are inside its hull', () => {
      const random = makeRandom(2);
      for (let f = 1; f <= 5; f++) {
        const inner = getShapedInner(f);
        for (let i = 0; i < 25; i++) {
          const length = 0.5 + random() * 6;
          const width = 0.5 + random() * 6;
          const p = clampToFloor(f, random() * L, random() * W, length, width, L, W, armor);
          if (getRectFitRegion(inner, length, width).length === 0) continue;
          expect(isRectInConvexPolygon(inner, p.x, p.y, length, width)).toBe(true);
          expect(fitsFloor(f, p.x, p.y, length, width, L, W, armor)).toBe(true);
        }
      }
    });

    test('positions snapped to the hull fit and touch it', () => {
      const random = makeRandom(3);
      for (let f = 1; f <= 5; f++) {
        const inner = getShapedInner(f);
        for (let i = 0; i < 25; i++) {
          const length = 0.5 + random() * 6;
          const width = 0.5 + random() * 6;
          if (getRectFitRegion(inner, length, width).length === 0) continue;
          const p = snapToFloorHull(f, random() * L, random() * W, length, width, L, W, armor);
          expect(fitsFloor(f, p.x, p.y, length, width, L, W, armor)).toBe(true);
          expect(touchesFloorHull(f, p.x, p.y, length, width, L, W, armor)).toBe(true);
        }
      }
    });

    test('a rectangle too big for the deck is never placed', () => {
      for (let f = 1; f <= 5; f++) {
        const huge = Math.max(L, W) + 1;
        const p = clampToFloor(f, 1, 2, huge, huge, L, W, armor);
        expect(p).toEqual({ x: 1, y: 2 });
        expect(fitsFloor(f, p.x, p.y, huge, huge, L, W, armor)).toBe(false);
        expect(findValidPosition(f, 1, 2, huge, huge, L, W, -1)).toBeNull();
        expect(findValidPosition(f, 1, 2, huge, huge, L, W, -1, true)).toBeNull();
      }
    });

    test.each([[false], [true]])('findValidPosition finds legal spots around obstacles (hull: %s)', requireHull => {
      const random = makeRandom(4);
      const f = 2;
      const inner = getShapedInner(f);

      for (let i = 0; i < 25; i++) {
        const length = 1 + random() * 3;
        const width = 1 + random() * 3;
        const x = random() * L;
        const y = random() * W;
        const position = findValidPosition(f, x, y, length, width, L, W, -1, requireHull);
        if (!position) continue;

        expect(isRectInConvexPolygon(inner, position.x, position.y, length, width)).toBe(true);
        expect(checkOverlap(f, position.x, position.y, length, width)).toBe(false);
        if (requireHull) {
          expect(isRectOnConvexPolygonWall(inner, position.x, position.y, length, width)).toBe(true);
        }

        const placement = global.shipData.componentPlacements[i] || { floors: [] };
        placement.floors.push({ floor: f, x: position.x, y: position.y, length, width });
        global.shipData.componentPlacements[i] = placement;
      }
      expect(Object.keys(global.shipData.componentPlacements).length).toBeGreaterThan(5);
    });

    test('a spot that is already legal is kept', () => {
      const f = 2;
      const box = getPolygonBounds(getShapedInner(f));
      const x = box.x + box.length / 2 - 1;
      const y = box.y + box.width / 2 - 1;
      expect(findValidPosition(f, x, y, 2, 2, L, W, -1)).toEqual({ x, y });
    });

    test('a component spanning floors fits all of them and touches at least one hull', () => {
      const random = makeRandom(5);
      const floors = [2, 3, 4];
      for (let i = 0; i < 25; i++) {
        const length = 1 + random() * 5;
        const width = 1 + random() * 5;
        if (getRectFitRegion(getShapedInner(floors), length, width).length === 0) continue;

        const inside = clampToFloor(floors, random() * L, random() * W, length, width, L, W, armor);
        const onHull = snapToFloorHull(floors, inside.x, inside.y, length, width, L, W, armor);
        for (const f of floors) {
          expect(fitsFloor(f, inside.x, inside.y, length, width, L, W, armor)).toBe(true);
          expect(fitsFloor(f, onHull.x, onHull.y, length, width, L, W, armor)).toBe(true);
        }
        expect(floors.some(f => touchesFloorHull(f, onHull.x, onHull.y, length, width, L, W, armor))).toBe(true);
      }
    });

    test('an open deck is one free region with about the right area', () => {
      for (let f = 1; f <= 5; f++) {
        const inner = getShapedInner(f);
        const { regions } = analyzeFloorFreeSpace(f, L, W, armor);
        expect(regions).toHaveLength(1);
        expect(Math.abs(regions[0].area - polygonArea(inner)) / polygonArea(inner)).toBeLessThan(0.01);
      }
    });

    test('a deck ringed with items leaves no pinholes in its open area', () => {
      const f = 3;
      const plan = planFloorExposedFill(f, [], 1.3, 1.3, Infinity, L, W, armor);
      plan.forEach((a, i) => {
        global.shipData.componentPlacements[i] = { floors: [{ floor: f, ...a.bbox }] };
      });
      const { regions } = analyzeFloorFreeSpace(f, L, W, armor);
      const free = polygonArea(getShapedInner(f)) - plan.reduce((sum, a) => sum + a.area, 0);
      const largest = Math.max(...regions.map(r => r.area));
      expect(largest).toBeGreaterThan(free * 0.9);
    });

    test('placing a component takes its area out of the free region', () => {
      const f = 3;
      const before = analyzeFloorFreeSpace(f, L, W, armor).regions[0].area;
      const box = getPolygonBounds(getShapedInner(f));
      global.shipData.componentPlacements[0] = {
        floors: [{ floor: f, x: box.x + box.length / 2 - 1, y: box.y + box.width / 2 - 1, length: 2, width: 2 }]
      };
      const { regions } = analyzeFloorFreeSpace(f, L, W, armor);
      expect(sumRectArea(regions.flatMap(r => r.cells))).toBeCloseTo(before - 4, 0);
    });

    test('free regions stay inside the box around the deck', () => {
      const f = 5;
      const { x0, y0, x1, y1 } = getFloorUsableBounds(f, L, W, armor);
      for (const c of analyzeFloorFreeSpace(f, L, W, armor).regions.flatMap(r => r.cells)) {
        expect(c.x).toBeGreaterThanOrEqual(x0 - 1e-6);
        expect(c.y).toBeGreaterThanOrEqual(y0 - 1e-6);
        expect(c.x + c.length).toBeLessThanOrEqual(x1 + 1e-6);
        expect(c.y + c.width).toBeLessThanOrEqual(y1 + 1e-6);
      }
    });
  });
});

describe('getShapedInner', () => {
  test('a floor that does not exist has no usable space', () => {
    setShip({ shape: 'cone' });
    expect(getShapedInner(99)).toEqual([]);
    expect(fitsFloor(99, 0, 0, 1, 1, 10, 10, 0)).toBe(false);
  });

  test('several floors share only what all of them have', () => {
    setShip({ shape: 'cone' });
    const shared = polygonArea(getShapedInner([1, 5]));
    expect(shared).toBeCloseTo(polygonArea(getShapedInner(5)), 6); // top deck sits inside the bottom one
  });

  test('the shared space follows the ship when it changes', () => {
    setShip({ shape: 'cone' });
    const small = polygonArea(getShapedInner([1, 2]));
    setShip({ shape: 'cone', totalTons: 4000 });
    expect(polygonArea(getShapedInner([1, 2]))).toBeGreaterThan(small);
  });

  test('decks of a wing share the area behind their leading points', () => {
    setShip({ shape: 'wing' });
    const common = getShapedInner([1, 5]);
    expect(polygonArea(common)).toBeLessThanOrEqual(polygonArea(getShapedInner(1)));
    expect(polygonArea(common)).toBeGreaterThan(0);
  });
});

describe('placing around a deck that the armor used up', () => {
  test('nothing fits and no free space is offered', () => {
    const { floorLength: L, floorWidth: W } = setShip({ shape: 'cone', totalTons: 90, numFloors: 4, armorTons: 90 });
    const armor = global.shipData.armorThickness;
    const geometry = getShipGeometry();
    const f = geometry.floors.find(floor => floor.inner.length === 0);
    expect(f).toBeDefined();
    expect(fitsFloor(f.floor, 1, 1, 0.1, 0.1, L, W, armor)).toBe(false);
    expect(findValidPosition(f.floor, 1, 1, 0.1, 0.1, L, W, -1)).toBeNull();
    expect(snapToFloorHull(f.floor, 1, 2, 0.1, 0.1, L, W, armor)).toEqual({ x: 1, y: 2 });
    expect(analyzeFloorFreeSpace(f.floor, L, W, armor).regions).toEqual([]);
    expect(planFloorExposedFill(f.floor, [], 1, 1, 5, L, W, armor)).toEqual([]);
  });
});

// ============================================================
// Filling the exposed hull
// ============================================================

describe('planCurvedExposedFill', () => {
  const circle = circlePolygon(15, 15, 15);

  function expectLegal(plan, polygon, occupied = []) {
    const rects = plan.flatMap(a => a.rects);
    rects.forEach((r, i) => {
      expect(isRectInConvexPolygon(polygon, r.x, r.y, r.length, r.width)).toBe(true);
      expect(isRectOnConvexPolygonWall(polygon, r.x, r.y, r.length, r.width)).toBe(true);
      for (const other of rects.slice(i + 1).concat(occupied)) {
        expect(rectsOverlap(r, other)).toBe(false);
      }
    });
    return rects;
  }

  test('rings the hull with items that fit, touch it, and do not overlap', () => {
    const plan = planCurvedExposedFill(circle, [], 3, 1.5, Infinity);
    expectLegal(plan, circle);
    // The ring is 94 m around, so 3 m items should fill most of it
    expect(plan.length).toBeGreaterThan(20);
    expect(plan.every(a => a.count === 1)).toBe(true);
  });

  test('stops when the items run out', () => {
    const plan = planCurvedExposedFill(circle, [], 3, 1.5, 5);
    expect(plan).toHaveLength(5);
    expectLegal(plan, circle);
  });

  test('leaves occupied space alone', () => {
    const occupied = [{ x: 0, y: 10, length: 8, width: 10 }, { x: 24, y: 8, length: 6, width: 12 }];
    const all = planCurvedExposedFill(circle, [], 3, 1.5, Infinity);
    const plan = planCurvedExposedFill(circle, occupied, 3, 1.5, Infinity);
    expectLegal(plan, circle, occupied);
    expect(plan.length).toBeLessThan(all.length);
  });

  test('lines up items with the wall on all sides', () => {
    const rects = planCurvedExposedFill(circle, [], 3, 1, Infinity).flatMap(a => a.rects);
    expect(rects.some(r => r.length > r.width)).toBe(true);
    expect(rects.some(r => r.width > r.length)).toBe(true);
  });

  test('has no room for an item too big for the deck', () => {
    expect(planCurvedExposedFill(circle, [], 40, 40, Infinity)).toEqual([]);
    expect(planCurvedExposedFill([], [], 1, 1, 1)).toEqual([]);
  });

  test('turns an item that only fits one way', () => {
    const narrow = rectanglePolygon(0, 0, 40, 4);
    const rects = planCurvedExposedFill(narrow, [], 1, 6, Infinity).flatMap(a => a.rects);
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.every(r => r.length === 6 && r.width === 1)).toBe(true);
  });

  test('stays quick on a very large hull', () => {
    const huge = circlePolygon(100, 100, 100);
    const start = Date.now();
    const plan = planCurvedExposedFill(huge, [], 1, 1, Infinity);
    expect(plan.length).toBeGreaterThan(300);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('planFloorExposedFill', () => {
  test('curved decks ring the hull', () => {
    for (const shape of CURVED) {
      const { floorLength: L, floorWidth: W } = setShip({ shape, armorTons: 20 });
      const armor = global.shipData.armorThickness;
      const plan = planFloorExposedFill(2, [], 2, 2, 10, L, W, armor);
      expect(plan).toHaveLength(10);
      for (const { rects: [r] } of plan) {
        expect(fitsFloor(2, r.x, r.y, r.length, r.width, L, W, armor)).toBe(true);
        expect(touchesFloorHull(2, r.x, r.y, r.length, r.width, L, W, armor)).toBe(true);
      }
    }
  });

  test('rectangular decks of a shaped hull line the deck\'s own walls with blocks', () => {
    for (const shape of RECTANGULAR_DECKS) {
      const { floorLength: L, floorWidth: W } = setShip({ shape, armorTons: 20 });
      const armor = global.shipData.armorThickness;
      const plan = planFloorExposedFill(1, [], 2, 2, Infinity, L, W, armor);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.length).toBeLessThanOrEqual(4); // one block per wall
      for (const { rects: [r] } of plan) {
        expect(fitsFloor(1, r.x, r.y, r.length, r.width, L, W, armor)).toBe(true);
        expect(touchesFloorHull(1, r.x, r.y, r.length, r.width, L, W, armor)).toBe(true);
      }
    }
  });

  test('rectangular ships are unchanged', () => {
    const { floorLength: L, floorWidth: W } = setShip({ armorTons: 20 });
    const armor = global.shipData.armorThickness;
    const plan = planFloorExposedFill(1, [], 2, 2, Infinity, L, W, armor);
    expect(plan.map(a => a.side)).toEqual(['top', 'bottom', 'left', 'right']);
  });
});

// ============================================================
// Resizing
// ============================================================

describe('calculateNewDimensions', () => {
  const bounds = { x0: 2, y0: 2, x1: 28, y1: 18 };
  const inside = ({ x, y, length, width }) =>
    x >= bounds.x0 - 1e-9 && y >= bounds.y0 - 1e-9 &&
    x + length <= bounds.x1 + 1e-9 && y + width <= bounds.y1 + 1e-9;

  test.each([
    ['right', 100],
    ['left', -100],
    ['bottom', 100],
    ['top', -100]
  ])('dragging the %s edge far past the wall stops at the armor', (edge, delta) => {
    const result = calculateNewDimensions(edge, delta, 4, 4, 16, 10, 8, bounds);
    expect(inside(result)).toBe(true);
  });

  test.each([
    ['right', 3, 7, 16 / 7],
    ['left', -3, 7, 16 / 7],
    ['bottom', 3, 16 / 7, 7],
    ['top', -3, 16 / 7, 7]
  ])('dragging the %s edge inside the floor keeps the area', (edge, delta, length, width) => {
    const result = calculateNewDimensions(edge, delta, 4, 4, 16, 10, 8, bounds);
    expect(result.length).toBeCloseTo(length, 9);
    expect(result.width).toBeCloseTo(width, 9);
    expect(result.length * result.width).toBeCloseTo(16, 9);
  });

  test('never shrinks a side below 1 m', () => {
    const result = calculateNewDimensions('right', -100, 4, 4, 16, 10, 2, bounds);
    expect(result.length).toBe(1);
    expect(result.width).toBe(16);
  });
});

// ============================================================
// SVG export of regions
// ============================================================

describe('exportLayoutSvg clipping', () => {
  const component = { category: 'Cargo', item: 'Cargo', tons: 100 };
  const placements = {
    0: { floors: [{ floor: 1, x: 5, y: 5, length: 4, width: 4, count: 5, rects: [{ x: 5, y: 5, length: 4, width: 4 }] }] },
    1: { floors: [{ floor: 1, x: 12, y: 12, length: 2, width: 2 }] }
  };

  function svgFor(shape) {
    const { floorLength, floorWidth } = setShip({ shape });
    return exportLayoutSvg({
      ...global.shipData,
      floorLength,
      floorWidth,
      components: [component, { ...component, item: 'Bridge' }],
      componentPlacements: placements,
      geometry: getShipGeometry()
    });
  }

  test('regions on a curved deck are clipped to the usable space, plain rooms are not', () => {
    const svg = svgFor('disk');
    expect(svg).toContain('<clipPath id="floor-1-usable">');
    expect(svg.match(/clip-path="url\(#floor-1-usable\)"/g)).toHaveLength(1);
  });

  test('rectangular decks need no clipping', () => {
    for (const shape of ['rectangular', 'wedge']) {
      expect(svgFor(shape)).not.toContain('clip');
    }
  });
});
