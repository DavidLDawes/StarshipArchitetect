'use strict';

const {
  getPlacementRects,
  getPlacementCount,
  getPlacedCount,
  getPlacedCountByFloor,
  getBoundingBox,
  sumRectArea,
  getOccupiedRects,
  analyzeFreeSpace,
  analyzeFloorFreeSpace,
  findRegionAtPoint,
  mergeCellsToRects,
  takeAreaFromCells,
  nearestSweepDirection,
  planRegionAllocation,
  planFloorFill,
  summarizeFreeSpace
} = require('../../src/placement-geometry');

const FLOOR = { x0: 0, y0: 0, x1: 30, y1: 20 };
const rect = (x, y, length, width) => ({ x, y, length, width });

// Every region rect must sit inside the floor and never overlap an occupied rect
function expectInsideFreeSpace(rects, occupied, bounds = FLOOR) {
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(bounds.x0 - 1e-9);
    expect(r.y).toBeGreaterThanOrEqual(bounds.y0 - 1e-9);
    expect(r.x + r.length).toBeLessThanOrEqual(bounds.x1 + 1e-9);
    expect(r.y + r.width).toBeLessThanOrEqual(bounds.y1 + 1e-9);
    for (const o of occupied) {
      const overlaps = r.x + r.length > o.x + 1e-9 && o.x + o.length > r.x + 1e-9 &&
        r.y + r.width > o.y + 1e-9 && o.y + o.width > r.y + 1e-9;
      expect(overlaps).toBe(false);
    }
  }
}

beforeEach(() => {
  global.shipData.componentPlacements = {};
  global.shipData.armorThickness = 0;
});

// ============================================================
// Placement shape / count helpers
// ============================================================

describe('getPlacementRects', () => {
  test('plain placement returns its own rectangle', () => {
    expect(getPlacementRects({ floor: 1, x: 1, y: 2, length: 3, width: 4 }, {}))
      .toEqual([rect(1, 2, 3, 4)]);
  });

  test('falls back to component-level dimensions for legacy entries', () => {
    expect(getPlacementRects({ floor: 1, x: 1, y: 2 }, { length: 5, width: 6 }))
      .toEqual([rect(1, 2, 5, 6)]);
  });

  test('region placement returns its rects', () => {
    const rects = [rect(0, 0, 2, 2), rect(2, 0, 1, 1)];
    expect(getPlacementRects({ floor: 1, x: 0, y: 0, length: 3, width: 2, rects }, {})).toBe(rects);
  });
});

describe('placement counts', () => {
  const placement = {
    floors: [
      { floor: 1, x: 0, y: 0, length: 1, width: 1 },
      { floor: 1, x: 2, y: 0, length: 4, width: 4, count: 12 },
      { floor: 3, x: 0, y: 0, length: 4, width: 4, count: 7, rects: [rect(0, 0, 4, 4)] }
    ]
  };

  test('getPlacementCount defaults to 1', () => {
    expect(getPlacementCount({})).toBe(1);
    expect(getPlacementCount({ count: 0 })).toBe(1);
    expect(getPlacementCount({ count: 5 })).toBe(5);
  });

  test('getPlacedCount sums item counts', () => {
    expect(getPlacedCount(placement)).toBe(20);
    expect(getPlacedCount(undefined)).toBe(0);
    expect(getPlacedCount({})).toBe(0);
  });

  test('getPlacedCountByFloor breaks counts down by floor', () => {
    expect(getPlacedCountByFloor(placement)).toEqual({ 1: 13, 3: 7 });
    expect(getPlacedCountByFloor(null)).toEqual({});
  });
});

describe('getBoundingBox / sumRectArea', () => {
  test('bounding box of an L shape', () => {
    expect(getBoundingBox([rect(0, 0, 4, 1), rect(0, 1, 1, 3)])).toEqual(rect(0, 0, 4, 4));
  });

  test('empty input', () => {
    expect(getBoundingBox([])).toBeNull();
    expect(sumRectArea([])).toBe(0);
  });

  test('area sums rectangles', () => {
    expect(sumRectArea([rect(0, 0, 4, 1), rect(0, 1, 1, 3)])).toBe(7);
  });
});

describe('getOccupiedRects', () => {
  test('collects rectangles and region rects on one floor only', () => {
    const placements = {
      0: { floors: [{ floor: 1, x: 0, y: 0, length: 2, width: 2 }, { floor: 2, x: 5, y: 5, length: 1, width: 1 }] },
      1: { floors: [{ floor: 1, x: 3, y: 0, length: 3, width: 2, count: 4, rects: [rect(3, 0, 3, 1), rect(3, 1, 1, 1)] }] }
    };
    expect(getOccupiedRects(1, placements)).toEqual([rect(0, 0, 2, 2), rect(3, 0, 3, 1), rect(3, 1, 1, 1)]);
  });
});

// ============================================================
// Free-space analysis
// ============================================================

describe('analyzeFreeSpace', () => {
  test('empty floor is one region covering the whole floor', () => {
    const { regions } = analyzeFreeSpace(FLOOR, []);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(600);
    expect(regions[0].rects).toEqual([rect(0, 0, 30, 20)]);
  });

  test('a component in the middle leaves one ring-shaped region', () => {
    const occupied = [rect(10, 5, 10, 10)];
    const { regions } = analyzeFreeSpace(FLOOR, occupied);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(500);
    expect(sumRectArea(regions[0].rects)).toBeCloseTo(500);
    expectInsideFreeSpace(regions[0].rects, occupied);
  });

  test('a full-width wall splits the floor into two regions', () => {
    const { regions } = analyzeFreeSpace(FLOOR, [rect(10, 0, 2, 20)]);
    const areas = regions.map(r => r.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(200);
    expect(areas[1]).toBeCloseTo(360);
  });

  test('a hairline gap does not join regions', () => {
    // Wall with a 0.2 m gap at y = 9.9..10.1
    const occupied = [rect(10, 0, 2, 9.9), rect(10, 10.1, 2, 9.9)];
    const { regions } = analyzeFreeSpace(FLOOR, occupied);
    const big = regions.filter(r => r.area > 1);
    expect(big).toHaveLength(2);
  });

  test('a passable gap joins regions', () => {
    // Wall with a 1 m gap at y = 9.5..10.5
    const occupied = [rect(10, 0, 2, 9.5), rect(10, 10.5, 2, 9.5)];
    const { regions } = analyzeFreeSpace(FLOOR, occupied);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(600 - 2 * 19);
  });

  test('tiny cells where thin rows and columns cross are absorbed (no pinholes)', () => {
    // A thin post defines columns at x=10..10.2; a thin shelf defines rows at y=8..8.3.
    // Their crossing cell out in open floor is only 0.2 x 0.3.
    const occupied = [rect(10, 0, 0.2, 1), rect(0, 8, 1, 0.3)];
    const { regions } = analyzeFreeSpace(FLOOR, occupied);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(600 - 0.2 - 0.3);
  });

  test('region placements only occupy their rects, not their bounding box', () => {
    // L shape occupying the top and left edges of a 10x10 corner
    const occupied = [rect(0, 0, 10, 2), rect(0, 2, 2, 8)];
    const { regions } = analyzeFreeSpace(FLOOR, occupied);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(600 - 20 - 16);
  });

  test('components sticking out of the bounds are clamped', () => {
    const { regions } = analyzeFreeSpace(FLOOR, [rect(-5, -5, 10, 10)]);
    expect(regions[0].area).toBeCloseTo(600 - 25);
  });

  test('fully occupied floor has no regions', () => {
    expect(analyzeFreeSpace(FLOOR, [rect(0, 0, 30, 20)]).regions).toHaveLength(0);
  });
});

describe('analyzeFloorFreeSpace', () => {
  test('respects armor and reads placements for the floor', () => {
    global.shipData.componentPlacements = {
      0: { floors: [{ floor: 2, x: 1, y: 1, length: 4, width: 4 }] }
    };
    const floor1 = analyzeFloorFreeSpace(1, 30, 20, 1);
    expect(floor1.regions[0].area).toBeCloseTo(28 * 18);

    const floor2 = analyzeFloorFreeSpace(2, 30, 20, 1);
    expect(floor2.regions[0].area).toBeCloseTo(28 * 18 - 16);
  });
});

describe('findRegionAtPoint', () => {
  const analysis = analyzeFreeSpace(FLOOR, [rect(10, 0, 2, 20)]);

  test('finds the region on each side of a wall', () => {
    expect(findRegionAtPoint(analysis, 5, 5).area).toBeCloseTo(200);
    expect(findRegionAtPoint(analysis, 20, 15).area).toBeCloseTo(360);
  });

  test('returns null on an occupied cell', () => {
    expect(findRegionAtPoint(analysis, 11, 5)).toBeNull();
  });

  test('returns null outside the floor', () => {
    expect(findRegionAtPoint(analysis, -1, 5)).toBeNull();
    expect(findRegionAtPoint(analysis, 5, 25)).toBeNull();
  });

  test('handles a fully occupied floor', () => {
    expect(findRegionAtPoint(analyzeFreeSpace(FLOOR, [rect(0, 0, 30, 20)]), 5, 5)).toBeNull();
  });
});

// ============================================================
// Rectangle merging and area sweeping
// ============================================================

describe('mergeCellsToRects', () => {
  test('a 2x2 block of cells merges into one rectangle', () => {
    const cells = [rect(0, 0, 1, 1), rect(1, 0, 1, 1), rect(0, 1, 1, 1), rect(1, 1, 1, 1)];
    expect(mergeCellsToRects(cells)).toEqual([rect(0, 0, 2, 2)]);
  });

  test('an L shape becomes two rectangles with the same area', () => {
    const cells = [rect(0, 0, 1, 1), rect(0, 1, 1, 1), rect(1, 1, 1, 1)];
    const merged = mergeCellsToRects(cells);
    expect(merged).toHaveLength(2);
    expect(sumRectArea(merged)).toBeCloseTo(3);
  });

  test('empty input', () => {
    expect(mergeCellsToRects([])).toEqual([]);
  });
});

describe('nearestSweepDirection', () => {
  const box = rect(0, 0, 30, 20);
  test('picks the closest edge', () => {
    expect(nearestSweepDirection(box, 1, 10)).toBe('left');
    expect(nearestSweepDirection(box, 29, 10)).toBe('right');
    expect(nearestSweepDirection(box, 15, 2)).toBe('top');
    expect(nearestSweepDirection(box, 15, 19)).toBe('bottom');
  });
});

describe('takeAreaFromCells', () => {
  test('cuts a single cell to the exact area from the low-x side', () => {
    expect(takeAreaFromCells([rect(0, 0, 10, 4)], 12)).toEqual([rect(0, 0, 3, 4)]);
  });

  test('takes whole columns then trims the last one', () => {
    const cells = [rect(0, 0, 2, 4), rect(2, 0, 4, 2)];
    const taken = takeAreaFromCells(cells, 10);
    expect(sumRectArea(taken)).toBeCloseTo(10);
    expect(taken).toEqual([rect(0, 0, 2, 4), rect(2, 0, 1, 2)]);
  });

  test('sweeps from each side', () => {
    const cell = [rect(0, 0, 10, 4)];
    expect(takeAreaFromCells(cell, 12, 'right')).toEqual([rect(7, 0, 3, 4)]);
    expect(takeAreaFromCells(cell, 20, 'top')).toEqual([rect(0, 0, 10, 2)]);
    expect(takeAreaFromCells(cell, 20, 'bottom')).toEqual([rect(0, 2, 10, 2)]);
  });

  test('right sweep takes the high-x columns first', () => {
    const cells = [rect(0, 0, 2, 4), rect(2, 0, 4, 2)];
    const taken = takeAreaFromCells(cells, 10, 'right');
    expect(taken).toEqual([rect(2, 0, 4, 2), rect(1.5, 0, 0.5, 4)]);
  });

  test('cells in the same column are cut together', () => {
    const cells = [rect(0, 0, 4, 1), rect(0, 3, 4, 1)];
    const taken = takeAreaFromCells(cells, 4);
    expect(taken).toEqual([rect(0, 0, 2, 1), rect(0, 3, 2, 1)]);
  });
});

// ============================================================
// Allocation planning
// ============================================================

describe('planRegionAllocation', () => {
  const region = analyzeFreeSpace({ x0: 0, y0: 0, x1: 10, y1: 10 }, []).regions[0]; // 100 m²

  test('region smaller than the remaining need is consumed whole', () => {
    const plan = planRegionAllocation(region, 22.4, 10);
    expect(plan.count).toBe(4);
    expect(plan.area).toBeCloseTo(100);
  });

  test('region bigger than the remaining need is packed to the exact area', () => {
    const plan = planRegionAllocation(region, 22.4, 3);
    expect(plan.count).toBe(3);
    expect(plan.area).toBeCloseTo(67.2);
    expect(plan.bbox.x).toBe(0);
    expectInsideFreeSpace(plan.rects, [], { x0: 0, y0: 0, x1: 10, y1: 10 });
  });

  test('packs from the requested side', () => {
    const plan = planRegionAllocation(region, 10, 2, 'bottom');
    expect(plan.bbox).toEqual(rect(0, 8, 10, 2));
  });

  test('exact fit uses the whole region', () => {
    const plan = planRegionAllocation(region, 25, 4);
    expect(plan.count).toBe(4);
    expect(plan.area).toBeCloseTo(100);
  });

  test('returns copies so the analysis is not mutated', () => {
    const plan = planRegionAllocation(region, 25, 4);
    plan.rects[0].x = 99;
    expect(region.rects[0].x).toBe(0);
  });

  test('too small for one item returns null', () => {
    expect(planRegionAllocation(region, 150, 3)).toBeNull();
  });

  test('invalid inputs return null', () => {
    expect(planRegionAllocation(null, 10, 3)).toBeNull();
    expect(planRegionAllocation(region, 0, 3)).toBeNull();
    expect(planRegionAllocation(region, 10, 0)).toBeNull();
  });

  test('packing an odd-shaped region stays inside its free space', () => {
    const occupied = [rect(10, 5, 10, 10)];
    const ring = analyzeFreeSpace(FLOOR, occupied).regions[0];
    const plan = planRegionAllocation(ring, 10, 25); // 250 of 500 m²
    expect(plan.count).toBe(25);
    expect(plan.area).toBeCloseTo(250);
    expectInsideFreeSpace(plan.rects, occupied);
  });
});

describe('planFloorFill', () => {
  // Wall splits the floor into 200 m² (left) and 360 m² (right)
  const { regions } = analyzeFreeSpace(FLOOR, [rect(10, 0, 2, 20)]);
  const total = plans => plans.reduce((s, p) => s + p.count, 0);

  test('best fit: uses the smallest region that holds everything', () => {
    const plans = planFloorFill(regions, 20, 5);
    expect(plans).toHaveLength(1);
    expect(plans[0].count).toBe(5);
    expect(plans[0].regionArea).toBeCloseTo(200);
    expect(plans[0].area).toBeCloseTo(100);
  });

  test('best fit picks the larger region when the smaller is too small', () => {
    const plans = planFloorFill(regions, 20, 15);
    expect(plans).toHaveLength(1);
    expect(plans[0].regionArea).toBeCloseTo(360);
  });

  test('spills across regions largest first, packing the last one', () => {
    const plans = planFloorFill(regions, 20, 20);
    expect(plans.map(p => p.count)).toEqual([18, 2]);
    expect(plans[1].area).toBeCloseTo(40);
  });

  test('floor with less room than needed is consumed entirely', () => {
    const plans = planFloorFill(regions, 20, 50);
    expect(total(plans)).toBe(28);
    expect(plans.reduce((s, p) => s + p.area, 0)).toBeCloseTo(560);
  });

  test('regions too small for one item are skipped', () => {
    const occupied = [rect(10, 0, 2, 9.9), rect(10, 10.1, 2, 9.9)]; // leaves a 0.4 m² sliver
    const r = analyzeFreeSpace(FLOOR, occupied).regions;
    const plans = planFloorFill(r, 1, 10000);
    expect(plans.every(p => p.regionArea > 1)).toBe(true);
  });

  test('nothing to place or nothing fits', () => {
    expect(planFloorFill(regions, 20, 0)).toEqual([]);
    expect(planFloorFill(regions, 1000, 5)).toEqual([]);
    expect(planFloorFill(regions, 0, 5)).toEqual([]);
  });
});

describe('summarizeFreeSpace', () => {
  test('reports free area, usable regions, and total fit', () => {
    const occupied = [rect(10, 0, 2, 9.9), rect(10, 10.1, 2, 9.9)];
    const { regions } = analyzeFreeSpace(FLOOR, occupied);
    const summary = summarizeFreeSpace(regions, 20);
    expect(summary.freeArea).toBeCloseTo(600 - 2 * 19.8);
    expect(summary.regionCount).toBe(2);
    expect(summary.fits).toBe(10 + 18);
  });

  test('zero item area fits nothing', () => {
    const { regions } = analyzeFreeSpace(FLOOR, []);
    expect(summarizeFreeSpace(regions, 0).fits).toBe(0);
  });
});

describe('analyzeFreeSpace with thin rows and columns crossing together', () => {
  test('tiny cells that only touch other tiny cells still join the region', () => {
    // Small rooms along two sides make thin rows and columns that cross as a cluster
    // of tiny cells near (10, 10)
    const occupied = [
      { x: 10, y: 0, length: 0.2, width: 1 },
      { x: 10.4, y: 0, length: 0.2, width: 1 },
      { x: 0, y: 10, length: 1, width: 0.2 },
      { x: 0, y: 10.4, length: 1, width: 0.2 }
    ];
    const { regions } = analyzeFreeSpace({ x0: 0, y0: 0, x1: 20, y1: 20 }, occupied);
    const area = regions.reduce((sum, r) => sum + r.area, 0);
    const taken = occupied.reduce((sum, r) => sum + r.length * r.width, 0);
    expect(area).toBeCloseTo(400 - taken, 6);
  });
});
