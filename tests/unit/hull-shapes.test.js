'use strict';

const {
  HULL_SHAPES,
  HULL_BAND_STEP,
  getFloorPosition,
  polygonArea,
  polygonPerimeter,
  getPolygonBounds,
  rectanglePolygon,
  circlePolygon,
  roundedRectanglePolygon,
  insetConvexPolygon,
  isPointInConvexPolygon,
  isRectInConvexPolygon,
  getHullBands,
  getOutsideHullRects,
  resolveHullShape,
  getDefaultHullLength,
  getNaturalFloorCount,
  buildFloorGeometry,
} = require('../../src/hull-shapes');
const {
  calculateFloorWidth,
  calculateDefaultFloorLength,
} = require('../../src/floor-utils');
const { getHullBounds } = require('../../src/hull-access');
const { analyzeFreeSpace, MIN_PASSAGE } = require('../../src/placement-geometry');

const ALL_SHAPES = Object.keys(HULL_SHAPES);

const build = (shape, numFloors, extra = {}) => buildFloorGeometry({
  shape,
  totalTons: 1000,
  ceilingHeight: 2.5,
  numFloors,
  ...extra,
});

/** Relative size of each floor's bounding box along one axis */
const relative = (geometry, axis) => {
  const sizes = geometry.floors.map(f => f.bounds[axis]);
  const largest = Math.max(...sizes);
  return sizes.map(size => size / largest);
};

const expectAllClose = (actual, expected, digits = 3) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
};

const isConvex = polygon => {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const [cx, cy] = polygon[(i + 2) % polygon.length];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign !== 0 && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
};

// ============================================================
// Floor position
// ============================================================

describe('getFloorPosition', () => {
  test('a single floor sits in the middle', () => {
    expect(getFloorPosition(0, 1)).toEqual({ t: 0, h: 0, u: 0 });
  });

  test('five floors', () => {
    expect(getFloorPosition(0, 5)).toEqual({ t: 1, h: 0, u: -0.8 });
    expect(getFloorPosition(2, 5)).toEqual({ t: 0, h: 0.5, u: 0 });
    expect(getFloorPosition(4, 5)).toEqual({ t: 1, h: 1, u: 0.8 });
  });

  test('two floors are both end floors', () => {
    expect(getFloorPosition(0, 2).t).toBe(1);
    expect(getFloorPosition(1, 2).t).toBe(1);
  });
});

// ============================================================
// Polygon helpers
// ============================================================

describe('polygon helpers', () => {
  test('rectangle area and perimeter', () => {
    const rect = rectanglePolygon(1, 2, 10, 4);
    expect(polygonArea(rect)).toBeCloseTo(40);
    expect(polygonPerimeter(rect)).toBeCloseTo(28);
    expect(getPolygonBounds(rect)).toEqual({ x: 1, y: 2, length: 10, width: 4 });
  });

  test('empty polygon has no area or bounds', () => {
    expect(polygonArea([])).toBe(0);
    expect(getPolygonBounds([])).toBeNull();
  });

  test('a circle reaches exactly one radius along both axes', () => {
    const bounds = getPolygonBounds(circlePolygon(10, 20, 5));
    expect(bounds.x).toBeCloseTo(5, 10);
    expect(bounds.y).toBeCloseTo(15, 10);
    expect(bounds.length).toBeCloseTo(10, 10);
    expect(bounds.width).toBeCloseTo(10, 10);
  });

  test('a circle polygon is very close to a true circle', () => {
    expect(polygonArea(circlePolygon(0, 0, 10)) / (Math.PI * 100)).toBeCloseTo(1, 2);
  });

  test('a rounded rectangle has the requested size and rounded corners', () => {
    const polygon = roundedRectanglePolygon(0, 0, 20, 10, 2.5);
    const bounds = getPolygonBounds(polygon);
    expect(bounds.length).toBeCloseTo(20, 10);
    expect(bounds.width).toBeCloseTo(10, 10);
    expect(isConvex(polygon)).toBe(true);
    // Rectangle minus the part of each corner outside its arc
    expect(polygonArea(polygon)).toBeCloseTo(200 - (4 - Math.PI) * 2.5 * 2.5, 0);
    expect(isPointInConvexPolygon(polygon, 9.9, 4.9)).toBe(false);
  });

  test('inset moves every wall of a rectangle inward', () => {
    const inner = insetConvexPolygon(rectanglePolygon(0, 0, 10, 6), 1);
    const bounds = getPolygonBounds(inner);
    expect(bounds.x).toBeCloseTo(1);
    expect(bounds.y).toBeCloseTo(1);
    expect(bounds.length).toBeCloseTo(8);
    expect(bounds.width).toBeCloseTo(4);
  });

  test('inset of a circle moves its flat sides in by the distance', () => {
    // The corners of a 96-sided polygon sit slightly further out than its flat sides
    const cornerShrink = 2 / Math.cos(Math.PI / 96);
    const inner = insetConvexPolygon(circlePolygon(0, 0, 10), 2);
    expect(polygonArea(inner)).toBeCloseTo(polygonArea(circlePolygon(0, 0, 10 - cornerShrink)), 6);
  });

  test('inset of zero returns the same shape', () => {
    const rect = rectanglePolygon(0, 0, 4, 4);
    expect(insetConvexPolygon(rect, 0)).toEqual(rect);
  });

  test('an inset larger than the shape leaves nothing', () => {
    expect(insetConvexPolygon(rectanglePolygon(0, 0, 4, 4), 3)).toEqual([]);
    expect(insetConvexPolygon(circlePolygon(0, 0, 2), 3)).toEqual([]);
  });
});

describe('fit checks', () => {
  const circle = circlePolygon(10, 10, 10);

  test('points inside, outside, and on the boundary', () => {
    expect(isPointInConvexPolygon(circle, 10, 10)).toBe(true);
    expect(isPointInConvexPolygon(circle, 20, 10)).toBe(true);
    expect(isPointInConvexPolygon(circle, 21, 10)).toBe(false);
    expect(isPointInConvexPolygon(circle, 1, 1)).toBe(false);
    expect(isPointInConvexPolygon([], 0, 0)).toBe(false);
  });

  test('a rectangle fits only when all its corners do', () => {
    expect(isRectInConvexPolygon(circle, 5, 5, 10, 10)).toBe(true);
    expect(isRectInConvexPolygon(circle, 0, 0, 10, 10)).toBe(false);
    expect(isRectInConvexPolygon(circle, 2, 2, 16, 16)).toBe(false);
  });

  test('a rectangle against a rectangular hull counts as inside', () => {
    expect(isRectInConvexPolygon(rectanglePolygon(0, 0, 10, 10), 0, 0, 10, 10)).toBe(true);
    expect(isRectInConvexPolygon(rectanglePolygon(0, 0, 10, 10), 0, 0, 10.01, 10)).toBe(false);
  });

  test('nothing fits in an empty hull', () => {
    expect(isRectInConvexPolygon([], 0, 0, 1, 1)).toBe(false);
  });
});

// ============================================================
// Every shape
// ============================================================

describe.each(ALL_SHAPES)('%s floors', (shape) => {
  const FLOOR_COUNTS = [1, 2, 3, 4, 5, 8, 20, 50];

  test.each(FLOOR_COUNTS)('%i floors add up to the total area', (numFloors) => {
    const geometry = build(shape, numFloors);
    expect(geometry.floors).toHaveLength(numFloors);
    const total = geometry.floors.reduce((sum, f) => sum + f.area, 0);
    expect(total / geometry.totalArea).toBeCloseTo(1, 8);
  });

  test.each(FLOOR_COUNTS)('%i floors are convex and fit inside the frame', (numFloors) => {
    const geometry = build(shape, numFloors);
    for (const f of geometry.floors) {
      expect(isConvex(f.outline)).toBe(true);
      expect(f.bounds.x).toBeGreaterThanOrEqual(-1e-9);
      expect(f.bounds.y).toBeGreaterThanOrEqual(-1e-9);
      expect(f.bounds.x + f.bounds.length).toBeLessThanOrEqual(geometry.length + 1e-9);
      expect(f.bounds.y + f.bounds.width).toBeLessThanOrEqual(geometry.width + 1e-9);
    }
  });

  test('the frame is exactly as big as its largest floors', () => {
    const geometry = build(shape, 5);
    expect(Math.max(...geometry.floors.map(f => f.bounds.length))).toBeCloseTo(geometry.length, 8);
    expect(Math.max(...geometry.floors.map(f => f.bounds.width))).toBeLessThanOrEqual(geometry.width + 1e-9);
  });

  test('floors are numbered from 1 at the bottom', () => {
    expect(build(shape, 3).floors.map(f => f.floor)).toEqual([1, 2, 3]);
  });

  test('armor shrinks every floor and stays inside the outline', () => {
    const geometry = build(shape, 4, { armorTons: 20 });
    expect(geometry.armorThickness).toBeGreaterThan(0);
    for (const f of geometry.floors) {
      expect(f.usableArea).toBeLessThan(f.area);
      expect(f.usableArea).toBeGreaterThan(0);
      for (const [x, y] of f.inner) {
        expect(isPointInConvexPolygon(f.outline, x, y)).toBe(true);
      }
    }
  });

  test('armor uses roughly its share of the floor area', () => {
    const armorTons = 10;
    const geometry = build(shape, 4, { armorTons });
    const used = geometry.floors.reduce((sum, f) => sum + f.area - f.usableArea, 0);
    expect(used / ((armorTons * 14) / 2.5)).toBeCloseTo(1, 1);
  });

  test('without armor the usable area is the whole floor', () => {
    const geometry = build(shape, 3);
    expect(geometry.armorThickness).toBe(0);
    for (const f of geometry.floors) expect(f.usableArea).toBeCloseTo(f.area, 8);
  });

  test('armor thicker than a floor leaves it with no usable space', () => {
    const geometry = build(shape, 2, { totalTons: 4, armorTons: 400 });
    expect(geometry.floors.every(f => f.inner.length === 0 && f.usableArea === 0)).toBe(true);
  });

  test('a ship with no tonnage yet does not break', () => {
    const geometry = build(shape, 4, { totalTons: 0 });
    expect(geometry.floors).toHaveLength(4);
    expect(geometry.armorThickness).toBe(0);
  });
});

// ============================================================
// Specific shapes
// ============================================================

describe('rectangular', () => {
  const armorTons = 10;
  const totalArea = (1000 * 14) / 2.5;
  const floorArea = totalArea / 4;
  const geometry = build('rectangular', 4, { length: 30, armorTons });

  test('every floor is the same rectangle, sized as the app always has', () => {
    const width = calculateFloorWidth(floorArea, 30);
    expect(geometry.length).toBe(30);
    expect(geometry.width).toBe(width);
    for (const f of geometry.floors) {
      expect(f.bounds).toEqual({ x: 0, y: 0, length: 30, width });
      expect(f.isRectangle).toBe(true);
    }
  });

  test('armor thickness is the armor volume per floor over that floor\'s wall area', () => {
    const perimeter = 2 * (30 + floorArea / 30);
    const expected = ((armorTons / 4) * 14) / (perimeter * 2.5);
    expect(geometry.armorThickness).toBeCloseTo(expected, 12);
  });

  test('usable area matches the existing hull bounds exactly', () => {
    const { x0, y0, x1, y1 } = getHullBounds(geometry.length, geometry.width, geometry.armorThickness);
    const inner = getPolygonBounds(geometry.floors[0].inner);
    expect(inner.x).toBe(x0);
    expect(inner.y).toBe(y0);
    expect(inner.x + inner.length).toBeCloseTo(x1, 12);
    expect(inner.y + inner.width).toBeCloseTo(y1, 12);
  });

  test('default length is the existing default', () => {
    expect(build('rectangular', 4).length).toBe(calculateDefaultFloorLength(floorArea));
  });
});

describe('wedge', () => {
  test('length follows the profile, width stays fixed', () => {
    const geometry = build('wedge', 5);
    expectAllClose(relative(geometry, 'length'), [0.75, 0.875, 1, 0.875, 0.75]);
    expectAllClose(relative(geometry, 'width'), [1, 1, 1, 1, 1]);
  });

  test('rear edges line up', () => {
    const geometry = build('wedge', 5, { length: 60 });
    for (const f of geometry.floors) expect(f.bounds.x + f.bounds.length).toBeCloseTo(60, 8);
  });

  test('the chosen length is the largest floor\'s length, even with no single middle floor', () => {
    const geometry = build('wedge', 4, { length: 60 });
    expect(Math.max(...geometry.floors.map(f => f.bounds.length))).toBeCloseTo(60, 8);
  });

  test('every floor is a rectangle', () => {
    expect(build('wedge', 5).floors.every(f => f.isRectangle)).toBe(true);
  });
});

describe('cone', () => {
  test('diameter follows the profile, largest at the bottom', () => {
    const geometry = build('cone', 5);
    expectAllClose(relative(geometry, 'length'), [1, 0.8125, 0.625, 0.4375, 0.25]);
    expectAllClose(relative(geometry, 'width'), [1, 0.8125, 0.625, 0.4375, 0.25]);
  });

  test('floors are centered on each other', () => {
    const geometry = build('cone', 5);
    for (const f of geometry.floors) {
      expect(f.bounds.x + f.bounds.length / 2).toBeCloseTo(geometry.length / 2, 8);
      expect(f.bounds.y + f.bounds.width / 2).toBeCloseTo(geometry.width / 2, 8);
    }
  });

  test('a chosen length is ignored', () => {
    expect(build('cone', 5, { length: 999 }).length).toBeCloseTo(build('cone', 5).length, 8);
  });
});

describe('sphere', () => {
  test('diameter follows the profile, largest in the middle', () => {
    const geometry = build('sphere', 5);
    expectAllClose(relative(geometry, 'length'), [0.6, 0.917, 1, 0.917, 0.6]);
  });

  test('at its natural floor count the diameter matches the stack height', () => {
    const floors = getNaturalFloorCount('sphere', 1000, 2.5);
    expect(floors).toBe(12);
    expect(build('sphere', floors).length / (floors * 2.5)).toBeCloseTo(1, 1);
  });
});

describe('cylinder', () => {
  test('width follows a circular curve, length stays fixed', () => {
    const geometry = build('cylinder', 5);
    expectAllClose(relative(geometry, 'width'), [0.6, 0.917, 1, 0.917, 0.6]);
    expectAllClose(relative(geometry, 'length'), [1, 1, 1, 1, 1]);
  });

  test('floors are centered across the width', () => {
    const geometry = build('cylinder', 5, { length: 60 });
    for (const f of geometry.floors) {
      expect(f.bounds.y + f.bounds.width / 2).toBeCloseTo(geometry.width / 2, 8);
      expect(f.bounds.length).toBeCloseTo(60, 8);
    }
  });
});

describe('wing', () => {
  const geometry = build('wing', 5, { length: 60 });

  test('every floor is a pentagon', () => {
    for (const f of geometry.floors) expect(f.outline).toHaveLength(5);
  });

  test('span and rear edge are the same on every floor', () => {
    for (const f of geometry.floors) {
      expect(f.bounds.length).toBeCloseTo(60, 8);
      expect(f.bounds.y + f.bounds.width).toBeCloseTo(geometry.width, 8);
    }
  });

  test('the bottom floor reaches furthest forward and each higher floor sits further back', () => {
    const fronts = geometry.floors.map(f => f.bounds.y);
    expect(fronts[0]).toBeCloseTo(0, 8);
    for (let i = 1; i < fronts.length; i++) expect(fronts[i]).toBeGreaterThan(fronts[i - 1]);
  });

  test('each floor comes to a point in the center', () => {
    for (const f of geometry.floors) {
      const front = f.outline.reduce((a, b) => (b[1] < a[1] ? b : a));
      expect(front[0]).toBeCloseTo(30, 8);
    }
  });

  test('the side walls survive even on a very wide wing', () => {
    const wide = build('wing', 5, { length: 500 });
    for (const f of wide.floors) {
      const sideY = f.outline.filter(p => p[0] === 0).map(p => p[1]);
      expect(sideY).toHaveLength(2);
      expect(Math.abs(sideY[0] - sideY[1])).toBeGreaterThan(0);
      expect(isConvex(f.outline)).toBe(true);
    }
  });
});

describe('disk', () => {
  test('every floor is the same circle', () => {
    const geometry = build('disk', 4);
    for (const f of geometry.floors) {
      expect(f.area).toBeCloseTo(geometry.totalArea / 4, 8);
      expect(f.bounds.length).toBeCloseTo(geometry.length, 8);
    }
    expect(geometry.length).toBeCloseTo(geometry.width, 10);
  });
});

describe('lifting body', () => {
  const geometry = build('lifting-body', 5);

  test('size follows the profile on both axes, largest at the bottom', () => {
    expectAllClose(relative(geometry, 'length'), [1, 0.975, 0.9, 0.775, 0.6]);
    expectAllClose(relative(geometry, 'width'), [1, 0.975, 0.9, 0.775, 0.6]);
  });

  test('every floor is twice as long as it is wide', () => {
    for (const f of geometry.floors) expect(f.bounds.length / f.bounds.width).toBeCloseTo(2, 8);
  });

  test('floors are centered on each other', () => {
    for (const f of geometry.floors) {
      expect(f.bounds.x + f.bounds.length / 2).toBeCloseTo(geometry.length / 2, 8);
      expect(f.bounds.y + f.bounds.width / 2).toBeCloseTo(geometry.width / 2, 8);
    }
  });
});

// ============================================================
// Shape lookup, defaults, and natural floor counts
// ============================================================

describe('shape lookup', () => {
  test('known shapes resolve to themselves', () => {
    for (const shape of ALL_SHAPES) expect(resolveHullShape(shape)).toBe(shape);
  });

  test('distributed and unknown shapes are rectangular for now', () => {
    expect(resolveHullShape('distributed')).toBe('rectangular');
    expect(resolveHullShape('banana')).toBe('rectangular');
    expect(resolveHullShape(undefined)).toBe('rectangular');
    expect(resolveHullShape('constructor')).toBe('rectangular');
    expect(build('distributed', 3).shape).toBe('rectangular');
  });

  test('the CSV parser and this module agree on every shape and its class', () => {
    const { parseConfiguration } = require('../../src/csv-parser');
    for (const shape of ALL_SHAPES) {
      expect(parseConfiguration(shape.replace('-', ' ')).shape).toBe(shape);
      expect(parseConfiguration(shape.replace('-', ' ')).general).toBe(HULL_SHAPES[shape].general);
    }
  });
});

describe('getDefaultHullLength', () => {
  const totalArea = 5600;

  test('shapes sized by area have no default length', () => {
    for (const shape of ['cone', 'sphere', 'disk', 'lifting-body']) {
      expect(getDefaultHullLength(shape, totalArea, 4)).toBeNull();
    }
  });

  test('shapes with a free length give one that builds a sensible floor', () => {
    for (const shape of ['rectangular', 'wedge', 'cylinder', 'wing']) {
      const length = getDefaultHullLength(shape, totalArea, 4);
      expect(length).toBeGreaterThanOrEqual(5);
      expect(build(shape, 4).length).toBeCloseTo(length, 8);
    }
  });

  test('default proportions of the largest floor', () => {
    const wedge = build('wedge', 5).floors[2].bounds;
    expect(wedge.length / wedge.width).toBeCloseTo(2, 1);
    const cylinder = build('cylinder', 5).floors[2].bounds;
    expect(cylinder.length / cylinder.width).toBeCloseTo(3, 1);
  });

  test('never below the 5 m minimum of the length control', () => {
    expect(getDefaultHullLength('wedge', 1, 1)).toBe(5);
    expect(getDefaultHullLength('wing', 1, 1)).toBe(5);
  });
});

describe('getNaturalFloorCount', () => {
  test.each([[90, 5], [1000, 12], [5000, 20], [100000, 56]])('%i ton sphere', (tons, floors) => {
    expect(getNaturalFloorCount('sphere', tons, 2.5)).toBe(floors);
  });

  test('taller ceilings mean fewer floors', () => {
    expect(getNaturalFloorCount('sphere', 1000, 5)).toBe(6);
  });

  test('at least one floor', () => {
    expect(getNaturalFloorCount('sphere', 0.01, 2.5)).toBe(1);
  });

  test('other shapes have no natural count', () => {
    for (const shape of ALL_SHAPES.filter(s => s !== 'sphere')) {
      expect(getNaturalFloorCount(shape, 1000, 2.5)).toBeNull();
    }
  });
});

// ============================================================
// Hull bands and free space
// ============================================================

describe('getHullBands', () => {
  test('bands are never thinner than the step', () => {
    expect(HULL_BAND_STEP).toBeGreaterThanOrEqual(MIN_PASSAGE);
    for (const radius of [3, 7.4, 21, 47]) {
      for (const band of getHullBands(circlePolygon(0, 0, radius))) {
        expect(band.height).toBeGreaterThanOrEqual(HULL_BAND_STEP);
      }
    }
  });

  test('bands cover the polygon from top to bottom', () => {
    const bands = getHullBands(circlePolygon(0, 0, 10));
    expect(bands[0].y).toBeCloseTo(-10, 8);
    const last = bands[bands.length - 1];
    expect(last.y + last.height).toBeCloseTo(10, 8);
  });

  test.each([[circlePolygon(0, 0, 21)], [roundedRectanglePolygon(0, 0, 80, 40, 10)]])(
    'band area is within a fraction of a percent of the true area', (polygon) => {
      const area = getHullBands(polygon).reduce((sum, b) => sum + (b.x1 - b.x0) * b.height, 0);
      expect(Math.abs(area / polygonArea(polygon) - 1)).toBeLessThan(0.002);
    });

  test('a polygon thinner than the step is one band', () => {
    expect(getHullBands(rectanglePolygon(0, 0, 10, 0.2))).toEqual([{ y: 0, height: 0.2, x0: 0, x1: 10 }]);
  });

  test('an empty polygon has no bands', () => {
    expect(getHullBands([])).toEqual([]);
  });
});

describe('getOutsideHullRects', () => {
  const area = { x0: 0, y0: 0, x1: 40, y1: 40 };

  test('nothing is outside a hull that fills the area', () => {
    expect(getOutsideHullRects(rectanglePolygon(0, 0, 40, 40), area)).toEqual([]);
  });

  test('an empty hull leaves the whole area outside', () => {
    expect(getOutsideHullRects([], area)).toEqual([{ x: 0, y: 0, length: 40, width: 40 }]);
  });

  test('space above and below a smaller hull is covered', () => {
    const rects = getOutsideHullRects(rectanglePolygon(10, 10, 20, 20), area);
    const covered = rects.reduce((sum, r) => sum + r.length * r.width, 0);
    expect(covered).toBeCloseTo(1600 - 400, 6);
  });

  test.each([
    ['a floor of a small ship', 7.4],
    ['a medium floor', 21],
    ['a large floor', 47],
    ['a small top floor', 3],
  ])('the free-space analysis sees %s as one open region of the right size', (_label, radius) => {
    const polygon = circlePolygon(radius, radius, radius);
    const frame = { x0: 0, y0: 0, x1: radius * 2, y1: radius * 2 };
    const { regions } = analyzeFreeSpace(frame, getOutsideHullRects(polygon, frame));
    expect(regions).toHaveLength(1);
    expect(Math.abs(regions[0].area / polygonArea(polygon) - 1)).toBeLessThan(0.01);
  });

  test('a long rounded floor stays one open region', () => {
    const polygon = roundedRectanglePolygon(47.5, 24, 95, 47.5, 11.875);
    const frame = { x0: 0, y0: 0, x1: 95, y1: 48 };
    const { regions } = analyzeFreeSpace(frame, getOutsideHullRects(polygon, frame));
    expect(regions).toHaveLength(1);
    expect(Math.abs(regions[0].area / polygonArea(polygon) - 1)).toBeLessThan(0.01);
  });

  test('rooms on a curved floor are subtracted', () => {
    const polygon = circlePolygon(21, 21, 21);
    const frame = { x0: 0, y0: 0, x1: 42, y1: 42 };
    const room = { x: 16, y: 16, length: 10, width: 7.3 };
    const { regions } = analyzeFreeSpace(frame, [...getOutsideHullRects(polygon, frame), room]);
    expect(regions).toHaveLength(1);
    expect(Math.abs(regions[0].area / (polygonArea(polygon) - 73) - 1)).toBeLessThan(0.01);
  });
});
