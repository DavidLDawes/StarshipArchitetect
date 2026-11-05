'use strict';

const fs = require('fs');
const path = require('path');
const {
  isWithinUsableArea,
  checkOverlap,
  findValidPosition
} = require('../../src/placement-logic');
const { parseCSV } = require('../../src/csv-parser');
const { generateComponentDimensionOptions } = require('../../src/component-dimensions');
const { recalculateFloors, getCurrentFloorDimensions } = require('../../src/floor-utils');

beforeEach(() => {
  global.shipData.componentPlacements = {};
  global.shipData.armorThickness = 0;
  global.shipData.floorLength = 30;
  global.shipData.floorWidth = 20;
});

// ============================================================
// isWithinUsableArea
// ============================================================

describe('isWithinUsableArea', () => {
  // Signature: (x, y, length, width, floorLength, floorWidth, armorThickness)

  test('inside bounds, no armor: returns true', () => {
    expect(isWithinUsableArea(5, 5, 10, 8, 30, 20, 0)).toBe(true);
  });

  test('touching left edge (x=0): returns true with no armor', () => {
    expect(isWithinUsableArea(0, 5, 10, 8, 30, 20, 0)).toBe(true);
  });

  test('touching top edge (y=0): returns true', () => {
    expect(isWithinUsableArea(5, 0, 10, 8, 30, 20, 0)).toBe(true);
  });

  test('exactly filling floor: returns true', () => {
    expect(isWithinUsableArea(0, 0, 30, 20, 30, 20, 0)).toBe(true);
  });

  test('out left (x=-1): returns false', () => {
    expect(isWithinUsableArea(-1, 5, 10, 8, 30, 20, 0)).toBe(false);
  });

  test('out right (x=25, length=10): 25+10=35 > 30, returns false', () => {
    expect(isWithinUsableArea(25, 5, 10, 8, 30, 20, 0)).toBe(false);
  });

  test('out bottom (y=15, width=8): 15+8=23 > 20, returns false', () => {
    expect(isWithinUsableArea(5, 15, 10, 8, 30, 20, 0)).toBe(false);
  });

  test('out top (y=-1): returns false', () => {
    expect(isWithinUsableArea(5, -1, 10, 8, 30, 20, 0)).toBe(false);
  });

  test('with armor=2: position (2,2,5,5) is inside usable area', () => {
    // usable: x>=2, y>=2, x+len<=28, y+wid<=18
    // 2>=2, 2>=2, 7<=28, 7<=18 → true
    expect(isWithinUsableArea(2, 2, 5, 5, 30, 20, 2)).toBe(true);
  });

  test('with armor=2: position (0,0,5,5) is inside armor boundary, returns false', () => {
    // x=0 < armorThickness=2 → false
    expect(isWithinUsableArea(0, 0, 5, 5, 30, 20, 2)).toBe(false);
  });

  test('with armor=2: position (1,2,5,5) fails on x<armor', () => {
    expect(isWithinUsableArea(1, 2, 5, 5, 30, 20, 2)).toBe(false);
  });

  test('with armor=2: position right at edge (2,2,26,16) exactly fills usable area', () => {
    // 2+26=28 <= 30-2=28, 2+16=18 <= 20-2=18 → true
    expect(isWithinUsableArea(2, 2, 26, 16, 30, 20, 2)).toBe(true);
  });

  test('with armor=2: one pixel over right edge returns false', () => {
    // 2+27=29 > 28 → false
    expect(isWithinUsableArea(2, 2, 27, 16, 30, 20, 2)).toBe(false);
  });

  test('uses shipData.armorThickness as default when not passed', () => {
    global.shipData.armorThickness = 3;
    // Calling with only 6 args — default = shipData.armorThickness = 3
    // x=0 < 3 → false
    expect(isWithinUsableArea(0, 3, 5, 5, 30, 20)).toBe(false);
    // x=3 >= 3 → true
    expect(isWithinUsableArea(3, 3, 5, 5, 30, 20)).toBe(true);
  });
});

// ============================================================
// checkOverlap
// ============================================================

describe('checkOverlap', () => {
  // Add a component at floor 1: x=5, y=5, length=10, width=8
  function addComponent(idx, floorIndex, x, y, length, width) {
    global.shipData.componentPlacements[idx] = {
      floors: [{ floor: floorIndex, x, y, length, width }],
      length,
      width
    };
  }

  beforeEach(() => {
    addComponent(0, 1, 5, 5, 10, 8);
  });

  // Signature: checkOverlap(floorIndex, x, y, length, width, excludeComponentIndex=-1)

  test('overlapping placement returns true', () => {
    // (7,7,5,5) overlaps with (5,5,10,8)
    expect(checkOverlap(1, 7, 7, 5, 5)).toBe(true);
  });

  test('non-overlapping placement returns false', () => {
    // (0,0,4,4): 0+4=4 <= 5, so no overlap on x side
    expect(checkOverlap(1, 0, 0, 4, 4)).toBe(false);
  });

  test('adjacent but not overlapping: (15,5,5,5) → false', () => {
    // existing: x=5, len=10 → right edge at 15
    // new: x=15, so 15+5=20; 5<=15 from existing right edge → no overlap
    expect(checkOverlap(1, 15, 5, 5, 5)).toBe(false);
  });

  test('adjacent above: (5,0,10,5) — existing starts at y=5, new ends at y=5 → false', () => {
    expect(checkOverlap(1, 5, 0, 10, 5)).toBe(false);
  });

  test('different floor index: no overlap (returns false)', () => {
    expect(checkOverlap(2, 7, 7, 5, 5)).toBe(false);
  });

  test('excluded by excludeComponentIndex: checkOverlap with excludeComponentIndex=0 returns false', () => {
    expect(checkOverlap(1, 7, 7, 5, 5, 0)).toBe(false);
  });

  test('excludeComponentIndex=-1: checks all, returns true for overlap', () => {
    expect(checkOverlap(1, 7, 7, 5, 5, -1)).toBe(true);
  });

  test('no placements: returns false', () => {
    global.shipData.componentPlacements = {};
    expect(checkOverlap(1, 0, 0, 5, 5)).toBe(false);
  });

  test('placement without floors property is skipped', () => {
    global.shipData.componentPlacements[5] = { length: 5, width: 5 }; // no floors
    expect(checkOverlap(1, 7, 7, 5, 5)).toBe(true); // still overlaps with component 0
  });

  test('exact match position returns true (full overlap)', () => {
    expect(checkOverlap(1, 5, 5, 10, 8)).toBe(true);
  });

  test('multiple components, overlaps with second one', () => {
    addComponent(1, 1, 20, 5, 5, 5);
    expect(checkOverlap(1, 21, 6, 2, 2)).toBe(true);
    expect(checkOverlap(1, 0, 0, 4, 4)).toBe(false);
  });

  test('per-placement length/width used (pos.length overrides placement.length)', () => {
    // Isolate this test: only component 2 with per-placement dims 3×3 at (0,0)
    global.shipData.componentPlacements = {};
    global.shipData.componentPlacements[2] = {
      length: 99,
      width: 99,
      floors: [{ floor: 1, x: 0, y: 0, length: 3, width: 3 }]
    };
    // overlap with the 3×3 at (0,0) — should be true
    expect(checkOverlap(1, 0, 0, 2, 2)).toBe(true);
    // non-overlap: (4,4,2,2) is entirely outside the 3×3 region (3 < 4)
    expect(checkOverlap(1, 4, 4, 2, 2)).toBe(false);
  });
});

// ============================================================
// findValidPosition
// ============================================================

describe('findValidPosition', () => {
  // Signature: findValidPosition(floorIndex, origX, origY, compLength, compWidth, floorLength, floorWidth, excludeComponentIndex)

  beforeEach(() => {
    global.shipData.floorLength = 30;
    global.shipData.floorWidth = 20;
    global.shipData.armorThickness = 0;
  });

  test('empty floor, valid original position: returns that position', () => {
    const pos = findValidPosition(1, 5, 5, 10, 8, 30, 20, -1);
    expect(pos).not.toBeNull();
    expect(pos.x).toBe(5);
    expect(pos.y).toBe(5);
  });

  test('empty floor, position exactly at (0,0): returns {x:0, y:0}', () => {
    const pos = findValidPosition(1, 0, 0, 5, 5, 30, 20, -1);
    expect(pos).not.toBeNull();
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  test('out of bounds x: returns clamped position', () => {
    // origX=25, compLength=10 → 25+10=35 > 30, should clamp
    const pos = findValidPosition(1, 25, 5, 10, 8, 30, 20, -1);
    // Should return something valid (clamped or adjacent)
    if (pos !== null) {
      expect(pos.x + 10).toBeLessThanOrEqual(30 + 0.01);
      expect(pos.x).toBeGreaterThanOrEqual(0);
    }
    // It's also acceptable to return null if truly no room, but with empty floor it should clamp
    expect(pos).not.toBeNull();
  });

  test('out of bounds y: returns clamped position', () => {
    const pos = findValidPosition(1, 5, 18, 10, 8, 30, 20, -1);
    if (pos !== null) {
      expect(pos.y + 8).toBeLessThanOrEqual(20 + 0.01);
    }
    expect(pos).not.toBeNull();
  });

  test('position blocked by other component: returns different valid position', () => {
    // Place a component at (5,5,10,8)
    global.shipData.componentPlacements[0] = {
      floors: [{ floor: 1, x: 5, y: 5, length: 10, width: 8 }],
      length: 10, width: 8
    };
    // Try to place another 5×5 at the same spot
    const pos = findValidPosition(1, 5, 5, 5, 5, 30, 20, -1);
    if (pos !== null) {
      // Must not overlap with existing
      const noOverlap = checkOverlap(1, pos.x, pos.y, 5, 5, -1);
      expect(noOverlap).toBe(false);
    }
    // Position should be valid within floor
    if (pos !== null) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.x + 5).toBeLessThanOrEqual(30 + 0.01);
      expect(pos.y + 5).toBeLessThanOrEqual(20 + 0.01);
    }
  });

  test('no room on floor (filled with large component): returns null', () => {
    // Fill the floor with a component that covers everything
    global.shipData.componentPlacements[0] = {
      floors: [{ floor: 1, x: 0, y: 0, length: 30, width: 20 }],
      length: 30, width: 20
    };
    // Trying to place a 5×5 anywhere → no room
    const pos = findValidPosition(1, 0, 0, 5, 5, 30, 20, -1);
    expect(pos).toBeNull();
  });

  test('excludeComponentIndex: placing on top of excluded component is valid', () => {
    // Place component 0 at (0,0,10,10)
    global.shipData.componentPlacements[0] = {
      floors: [{ floor: 1, x: 0, y: 0, length: 10, width: 10 }],
      length: 10, width: 10
    };
    // Repositioning component 0 to the same spot — exclude its own index
    const pos = findValidPosition(1, 0, 0, 10, 10, 30, 20, 0);
    expect(pos).not.toBeNull();
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  test('different floor index: blocked component on floor 2, valid placement on floor 1', () => {
    global.shipData.componentPlacements[0] = {
      floors: [{ floor: 2, x: 5, y: 5, length: 10, width: 8 }],
      length: 10, width: 8
    };
    // Floor 1 is empty, should find (5,5) fine
    const pos = findValidPosition(1, 5, 5, 10, 8, 30, 20, -1);
    expect(pos).not.toBeNull();
    expect(pos.x).toBe(5);
    expect(pos.y).toBe(5);
  });

  test('returns object with x and y numeric properties when successful', () => {
    const pos = findValidPosition(1, 2, 2, 5, 5, 30, 20, -1);
    expect(pos).not.toBeNull();
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });

  test('with armor: valid original position inside armor boundary returns that position', () => {
    global.shipData.armorThickness = 2;
    const pos = findValidPosition(1, 3, 3, 5, 5, 30, 20, -1);
    expect(pos).not.toBeNull();
    expect(pos.x).toBeGreaterThanOrEqual(2);
    expect(pos.y).toBeGreaterThanOrEqual(2);
  });

  test('with armor: position inside armor zone is adjusted to valid position', () => {
    global.shipData.armorThickness = 2;
    // x=0 is inside armor (need x>=2), should clamp/adjust
    const pos = findValidPosition(1, 0, 0, 5, 5, 30, 20, -1);
    if (pos !== null) {
      expect(pos.x).toBeGreaterThanOrEqual(2);
      expect(pos.y).toBeGreaterThanOrEqual(2);
    }
  });
});

// ============================================================
// Region (odd-shaped) placements
// ============================================================

describe('checkOverlap with region placements', () => {
  beforeEach(() => {
    // L shape along the top and left of a 10x10 corner; bounding box is 0..10 x 0..10
    global.shipData.componentPlacements = {
      0: {
        floors: [{
          floor: 1, x: 0, y: 0, length: 10, width: 10, count: 9,
          rects: [{ x: 0, y: 0, length: 10, width: 2 }, { x: 0, y: 2, length: 2, width: 8 }]
        }]
      }
    };
  });

  test('space inside the bounding box but outside the shape is free', () => {
    expect(checkOverlap(1, 3, 3, 5, 5)).toBe(false);
  });

  test('overlapping one of the shape rects is detected', () => {
    expect(checkOverlap(1, 1, 5, 3, 3)).toBe(true);
    expect(checkOverlap(1, 5, 1, 3, 3)).toBe(true);
  });

  test('touching edges with floating-point drift is not an overlap', () => {
    // 0.1 + 0.2 = 0.30000000000000004
    global.shipData.componentPlacements = {
      0: { floors: [{ floor: 1, x: 0.1, y: 0, length: 0.2, width: 1 }] }
    };
    expect(checkOverlap(1, 0.3, 0, 1, 1)).toBe(false);
  });

  test('findValidPosition steps around a region shape', () => {
    const pos = findValidPosition(1, 1, 1, 3, 3, 30, 20, -1);
    expect(pos).not.toBeNull();
    expect(checkOverlap(1, pos.x, pos.y, 3, 3)).toBe(false);
  });
});

// ============================================================
// Size presets on armored ships
// ============================================================

describe('size presets on armored ships', () => {
  afterAll(() => {
    Object.assign(global.shipData, {
      totalTons: 1000, armorTons: 0, armorThickness: 0, numFloors: 4, floorLength: 30, ceilingHeight: 2.5,
    });
  });

  test('a size that exactly fills the usable area fits despite rounding error', () => {
    // Real values from a Heavy Fighter with one 23 m floor: the sum lands just past the limit
    const armor = 0.7013552758954501;
    const length = 23 - 2 * armor;
    expect(armor + length).toBeGreaterThan(23 - armor);
    expect(isWithinUsableArea(armor, armor, length, 1.6, 23, 21.9, armor)).toBe(true);
  });

  test('a size clearly past the armor still does not fit', () => {
    expect(isWithinUsableArea(2, 2, 26.001, 16, 30, 20, 2)).toBe(false);
    expect(isWithinUsableArea(2, 2, 26, 16.001, 30, 20, 2)).toBe(false);
    expect(isWithinUsableArea(1.999, 2, 5, 5, 30, 20, 2)).toBe(false);
    expect(isWithinUsableArea(2, 1.999, 5, 5, 30, 20, 2)).toBe(false);
  });

  // Armor tonnage is made up for the ships whose sample files have none
  test.each([
    ['Heavy_Fighter', 11.25],
    ['Courier', 6],
    ['sample-ship', 30],
    ['transport', 100],
  ])('every preset for %s fits on an empty floor, flush against the armor', (file, armorTons) => {
    const csv = fs.readFileSync(path.join(__dirname, '../../data', file + '.csv'), 'utf8');
    const { components, totalTons } = parseCSV(csv, file);
    const parts = components.filter(c => c.tons > 0 && !/hull|armor/i.test(c.category));
    let presets = 0;

    for (const numFloors of [1, 2, 3, 4, 5, 6, 8]) {
      for (const length of [null, 13, 17.5, 23, 37, 41.3]) {
        Object.assign(global.shipData, { totalTons, armorTons, numFloors, ceilingHeight: 2.5, componentPlacements: {} });
        if (length) global.shipData.floorLength = length;
        recalculateFloors({ resetLength: !length });
        const { floorArea, floorLength, floorWidth } = getCurrentFloorDimensions();
        const armor = global.shipData.armorThickness;

        for (const component of parts) {
          const { options } = generateComponentDimensionOptions(component, floorArea, floorLength, floorWidth);
          for (const option of options) {
            presets++;
            const position = findValidPosition(1, armor, armor, option.length, option.width, floorLength, floorWidth, -1);
            if (!position) {
              throw new Error(`${component.item} ${option.label} does not fit: floor ${floorLength} × ${floorWidth}, armor ${armor}`);
            }
          }
        }
      }
    }
    expect(presets).toBeGreaterThan(100);
  });
});
