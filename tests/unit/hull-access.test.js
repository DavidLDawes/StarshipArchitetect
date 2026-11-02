'use strict';

const {
  requiresHullAccess,
  getHullBounds,
  getHullSides,
  touchesHull,
  snapToHullEdge,
  getHullCandidates,
  planExposedFill,
  countExposedCapacity
} = require('../../src/hull-access');
const { findValidPosition } = require('../../src/placement-logic');
const { parseCSV } = require('../../src/csv-parser');

beforeEach(() => {
  global.shipData.componentPlacements = {};
  global.shipData.armorThickness = 0;
});

// Rectangles overlap (beyond floating-point noise)?
const overlaps = (a, b) =>
  a.x + a.length > b.x + 1e-6 && b.x + b.length > a.x + 1e-6 &&
  a.y + a.width > b.y + 1e-6 && b.y + b.width > a.y + 1e-6;

// ============================================================
// requiresHullAccess
// ============================================================

describe('requiresHullAccess', () => {
  const comp = (category, item) => ({ category, item, itemName: item });

  test.each([
    ['Weapons', 'Triple Turret (Beam Lasers)'],
    ['Weapons', 'Particle Beam Barbette x1 (turret)'],
    ['Weapons', 'Hard Point'],
    ['Weapons', 'Large Missile Bay'],
    ['Defenses', 'Point Defense Laser'],
    ['Screens', 'Nuclear Damper'],
    ['Systems', 'Repulsor'],
    ['Vehicles', 'Air/Raft Truck'],
    ['Vehicles', 'All-Terrain Vehicle tracked'],
    ['Craft', 'Launch Bay'],
    ['Fittings', 'Docking Space (40 tons)'],
    ['Craft', 'Full Hangar'],
    ['', 'Double Beam Laser Turret x1 (turret)']
  ])('%s / %s needs hull access', (category, item) => {
    expect(requiresHullAccess(comp(category, item))).toBe(true);
  });

  test.each([
    ['Weapons', 'Ammunition (50 canisters)'],
    ['Weapons', 'Missile Magazine'],
    ['Crew', 'Gunners: 2'],
    ['Berths', 'Staterooms'],
    ['Cargo', 'Cargo Bay'],
    ['Cargo', 'Vacuum Bay'],
    ['Drones', 'Repair'],
    ['Engines', 'Fuel Tank'],
    ['Fittings', 'Bridge']
  ])('%s / %s does not', (category, item) => {
    expect(requiresHullAccess(comp(category, item))).toBe(false);
  });

  test('null component: false', () => {
    expect(requiresHullAccess(null)).toBe(false);
  });

  test('works with parsed CSV rows (category inherited from earlier rows)', () => {
    const csv = [
      'Category,Item,Mass,Cost',
      'Weapons,Hard Point (x50),50,50',
      ',Sandcaster Turret (x4),4,1',
      'Vehicles,Air/Raft Truck (x4),20,2.2',
      ',All-Terrain Vehicle wheeled (x2),20,0.46',
      'Berths,Staterooms (x140),560,70',
      'Total,,654,123'
    ].join('\n');
    const { components } = parseCSV(csv);
    expect(components.map(c => requiresHullAccess(c))).toEqual([true, true, true, true, false]);
  });
});

// ============================================================
// Hull geometry
// ============================================================

describe('getHullBounds', () => {
  test('insets the floor by the armor', () => {
    expect(getHullBounds(30, 20, 1)).toEqual({ x0: 1, y0: 1, x1: 29, y1: 19 });
  });

  test('never inverts when armor exceeds the floor', () => {
    const b = getHullBounds(2, 2, 3);
    expect(b.x1).toBeGreaterThanOrEqual(b.x0);
    expect(b.y1).toBeGreaterThanOrEqual(b.y0);
  });
});

describe('getHullSides / touchesHull', () => {
  // Signature: (x, y, length, width, floorLength, floorWidth, armor)

  test('interior rectangle touches nothing', () => {
    expect(getHullSides(5, 5, 4, 4, 30, 20, 0)).toEqual([]);
    expect(touchesHull(5, 5, 4, 4, 30, 20, 0)).toBe(false);
  });

  test('each side is detected', () => {
    expect(getHullSides(5, 0, 4, 4, 30, 20, 0)).toEqual(['top']);
    expect(getHullSides(5, 16, 4, 4, 30, 20, 0)).toEqual(['bottom']);
    expect(getHullSides(0, 5, 4, 4, 30, 20, 0)).toEqual(['left']);
    expect(getHullSides(26, 5, 4, 4, 30, 20, 0)).toEqual(['right']);
  });

  test('corner touches two sides', () => {
    expect(getHullSides(0, 0, 4, 4, 30, 20, 0)).toEqual(['top', 'left']);
  });

  test('the hull is the inner face of the armor', () => {
    expect(touchesHull(1, 5, 4, 4, 30, 20, 1)).toBe(true);
    expect(touchesHull(0.5, 5, 4, 4, 30, 20, 1)).toBe(true); // inside armor still counts as against it
    expect(touchesHull(2, 5, 4, 4, 30, 20, 1)).toBe(false);
  });

  test('floating point drift is tolerated', () => {
    expect(touchesHull(26 + 1e-9 - 0.1 + 0.1, 5, 4, 4, 30, 20, 0)).toBe(true);
  });
});

describe('snapToHullEdge', () => {
  test('snaps to the closest side', () => {
    expect(snapToHullEdge(10, 1, 4, 4, 30, 20, 0)).toEqual({ x: 10, y: 0, side: 'top' });
    expect(snapToHullEdge(10, 15, 4, 4, 30, 20, 0)).toEqual({ x: 10, y: 16, side: 'bottom' });
    expect(snapToHullEdge(2, 8, 4, 4, 30, 20, 0)).toEqual({ x: 0, y: 8, side: 'left' });
    expect(snapToHullEdge(25, 8, 4, 4, 30, 20, 0)).toEqual({ x: 26, y: 8, side: 'right' });
  });

  test('respects armor', () => {
    expect(snapToHullEdge(10, 3, 4, 4, 30, 20, 2)).toEqual({ x: 10, y: 2, side: 'top' });
  });

  test('clamps positions outside the usable area', () => {
    const p = snapToHullEdge(-5, 50, 4, 4, 30, 20, 0);
    expect(p).toEqual({ x: 0, y: 16, side: expect.any(String) });
  });

  test('result always touches the hull', () => {
    for (let x = 0; x <= 26; x += 3) {
      for (let y = 0; y <= 16; y += 3) {
        const p = snapToHullEdge(x, y, 4, 4, 30, 20, 0.5);
        expect(touchesHull(p.x, p.y, 4, 4, 30, 20, 0.5)).toBe(true);
      }
    }
  });
});

describe('getHullCandidates', () => {
  test('every candidate sits against a side', () => {
    const bounds = getHullBounds(30, 20, 0);
    const cands = getHullCandidates(bounds, [{ x: 10, y: 0, length: 5, width: 5 }], 12, 0, 2, 2);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      const onSide = c.y === 0 || c.y === 18 || c.x === 0 || c.x === 28;
      expect(onSide).toBe(true);
    }
  });

  test('includes positions just past an obstacle on the same side', () => {
    const bounds = getHullBounds(30, 20, 0);
    const cands = getHullCandidates(bounds, [{ x: 10, y: 0, length: 5, width: 5 }], 12, 0, 2, 2);
    expect(cands).toContainEqual({ x: 15, y: 0 });
    expect(cands).toContainEqual({ x: 8, y: 0 });
  });
});

// ============================================================
// findValidPosition with requireHull
// ============================================================

describe('findValidPosition (requireHull)', () => {
  // Signature: (floor, x, y, length, width, floorLength, floorWidth, exclude, requireHull)

  test('accepts a free position on the hull', () => {
    expect(findValidPosition(1, 10, 0, 2, 2, 30, 20, -1, true)).toEqual({ x: 10, y: 0 });
  });

  test('rejects an interior position and moves onto the hull', () => {
    const pos = findValidPosition(1, 10, 1, 2, 2, 30, 20, -1, true);
    expect(pos).not.toBeNull();
    expect(touchesHull(pos.x, pos.y, 2, 2, 30, 20, 0)).toBe(true);
  });

  test('slides along the hull past an obstacle', () => {
    global.shipData.componentPlacements = {
      0: { floors: [{ floor: 1, x: 8, y: 0, length: 6, width: 5 }] }
    };
    const pos = findValidPosition(1, 9, 0, 2, 2, 30, 20, -1, true);
    expect(pos).not.toBeNull();
    expect(touchesHull(pos.x, pos.y, 2, 2, 30, 20, 0)).toBe(true);
    expect(overlaps({ ...pos, length: 2, width: 2 }, { x: 8, y: 0, length: 6, width: 5 })).toBe(false);
    // Nearest free spot on the same side is just past the obstacle
    expect(pos).toEqual({ x: 6, y: 0 });
  });

  test('returns null when the whole hull is lined', () => {
    global.shipData.componentPlacements = {
      0: {
        floors: [
          { floor: 1, x: 0, y: 0, length: 10, width: 10, rects: [
            { x: 0, y: 0, length: 10, width: 1 },
            { x: 0, y: 9, length: 10, width: 1 },
            { x: 0, y: 1, length: 1, width: 8 },
            { x: 9, y: 1, length: 1, width: 8 }
          ] }
        ]
      }
    };
    expect(findValidPosition(1, 4, 4, 2, 2, 10, 10, -1, true)).toBeNull();
    // Without the hull rule the open middle is fine
    expect(findValidPosition(1, 4, 4, 2, 2, 10, 10, -1, false)).toEqual({ x: 4, y: 4 });
  });

  test('respects armor thickness', () => {
    global.shipData.armorThickness = 1;
    const pos = findValidPosition(1, 10, 5, 2, 2, 30, 20, -1, true);
    expect(pos).not.toBeNull();
    expect(touchesHull(pos.x, pos.y, 2, 2, 30, 20, 1)).toBe(true);
    expect(pos.x).toBeGreaterThanOrEqual(1);
    expect(pos.y).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// planExposedFill / countExposedCapacity
// ============================================================

describe('planExposedFill', () => {
  const bounds = getHullBounds(30, 20, 0);

  test('empty floor: lines top, then bottom, then the sides', () => {
    // 2 x 2 items: top 15, bottom 15, left (20 - 4) / 2 = 8, right 8
    expect(countExposedCapacity(bounds, [], 2, 2)).toBe(46);
    const plan = planExposedFill(bounds, [], 2, 2, Infinity);
    expect(plan.map(a => [a.side, a.count])).toEqual([['top', 15], ['bottom', 15], ['left', 8], ['right', 8]]);
  });

  test('every block touches the hull and nothing overlaps', () => {
    const occupied = [{ x: 5, y: 0, length: 6, width: 6 }, { x: 20, y: 10, length: 10, width: 4 }];
    const plan = planExposedFill(bounds, occupied, 2, 3, Infinity);
    const rects = plan.map(a => a.rects[0]);
    for (const r of rects) {
      expect(touchesHull(r.x, r.y, r.length, r.width, 30, 20, 0)).toBe(true);
      for (const o of occupied) expect(overlaps(r, o)).toBe(false);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    }
  });

  test('stops when items run out, packing from the start of the stretch', () => {
    const plan = planExposedFill(bounds, [], 2, 2, 4);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ count: 4, side: 'top', area: 16 });
    expect(plan[0].rects[0]).toEqual({ x: 0, y: 0, length: 8, width: 2 });
  });

  test('obstacles split a side into stretches; short stretches are skipped', () => {
    // Top side: obstacle from x=3 to x=10 leaves [0,3] (1 item of 2 m) and [10,30] (10 items)
    const occupied = [{ x: 3, y: 0, length: 7, width: 5 }];
    const plan = planExposedFill(bounds, occupied, 2, 2, Infinity);
    const top = plan.filter(a => a.side === 'top');
    expect(top.map(a => a.count)).toEqual([1, 10]);
  });

  test('an obstacle set back from the hull deeper than the item does not block it', () => {
    const occupied = [{ x: 10, y: 3, length: 5, width: 5 }];
    const plan = planExposedFill(bounds, occupied, 2, 2, Infinity);
    expect(plan.filter(a => a.side === 'top').map(a => a.count)).toEqual([15]);
  });

  test('side blocks run vertically with depth across', () => {
    const tall = getHullBounds(4, 20, 0); // too narrow for top/bottom strips to leave much
    const plan = planExposedFill(tall, [], 2, 1, Infinity);
    const left = plan.find(a => a.side === 'left');
    expect(left.rects[0].length).toBe(1);
    expect(left.rects[0].width % 2).toBe(0);
  });

  test('items deeper than the floor fit nowhere', () => {
    expect(planExposedFill(getHullBounds(10, 3, 0), [], 1, 5, 10).filter(a => a.side === 'top')).toEqual([]);
  });

  test('invalid input returns nothing', () => {
    expect(planExposedFill(bounds, [], 0, 2, 5)).toEqual([]);
    expect(planExposedFill(bounds, [], 2, 0, 5)).toEqual([]);
    expect(planExposedFill(bounds, [], 2, 2, 0)).toEqual([]);
  });

  test('a fully lined floor has no capacity left', () => {
    const plan = planExposedFill(bounds, [], 2, 2, Infinity);
    const lined = plan.map(a => a.rects[0]);
    expect(countExposedCapacity(bounds, lined, 2, 2)).toBe(0);
  });
});
