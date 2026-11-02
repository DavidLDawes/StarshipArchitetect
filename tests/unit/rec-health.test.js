'use strict';

const fs = require('fs');
const path = require('path');
const {
  isStateroomComponent,
  isRecHealthComponent,
  findCombinableComponents,
  canCombineRecHealth,
  computeRecHealthOverhead,
  setRecHealthCombined,
  expandRecHealthUnits,
  distributeRecHealth,
  summarizeAccommodations
} = require('../../src/rec-health');
const { calculateComponentArea, getEffectiveTonsPerItem } = require('../../src/component-dimensions');
const { parseCSV } = require('../../src/csv-parser');

const comp = (category, item, tons, quantity = 1) => ({
  category, item, itemName: item, tons, quantity, tonsPerItem: tons / quantity, cost: 0
});

// A liner-like design: 10 staterooms (40 t) and 5 t of rec/health in 6 items
function smallLiner() {
  return [
    comp('Engines', 'Power Plant', 20),
    comp('Berths', 'Staterooms', 40, 10),
    comp('Berths', 'Low Berths', 10, 20),
    comp('Rec/Health', 'Gym', 2, 2),   // 2 x 1 t
    comp('Rec/Health', 'Spa', 1.5, 3), // 3 x 0.5 t
    comp('Rec/Health', 'Autodoc', 1.5) // 1 x 1.5 t
  ];
}

// placedByFloor stand-in: placement.byFloor is { floor: count }
const byFloor = placement => (placement ? placement.byFloor : {});

// ============================================================
// Classification
// ============================================================

describe('isStateroomComponent', () => {
  test.each([
    'Staterooms x10', 'Luxury Staterooms', 'Passenger Cabin (4 passengers)', 'Crew Quarters', 'Double Bunks'
  ])('%s is a stateroom', item => {
    expect(isStateroomComponent(comp('Berths', item, 4))).toBe(true);
  });

  test.each([
    'Low Berths', 'Emergency Low Berths x10', 'Emergency Low', 'Control Cabin (2 crew)', 'Cryo Berths', 'Cargo Bay'
  ])('%s is not', item => {
    expect(isStateroomComponent(comp('Berths', item, 4))).toBe(false);
  });

  test('null: false', () => {
    expect(isStateroomComponent(null)).toBe(false);
  });
});

describe('isRecHealthComponent', () => {
  test('anything in a Rec/Health category', () => {
    expect(isRecHealthComponent(comp('Rec/Health', 'Range', 2))).toBe(true);
    expect(isRecHealthComponent(comp('Medical', 'Surgery Suite Equipment', 2))).toBe(true);
  });

  test.each(['Gym (x2)', 'Spa', 'Garden', 'Kitchens', 'Galley', 'Commissary', 'Autodoc', 'Medical Bay',
    'First Aid Station', 'Library', 'Shrine', 'Theater', 'Lounge'])('%s by name in any category', item => {
    expect(isRecHealthComponent(comp('Fittings', item, 1))).toBe(true);
  });

  test.each(['Bridge', 'Cargo Bay', 'Fuel Tank', 'Long Range Sensors', 'Spares'])('%s is not', item => {
    expect(isRecHealthComponent(comp('Fittings', item, 1))).toBe(false);
  });

  test('staterooms are never overhead, even in a rec category', () => {
    expect(isRecHealthComponent(comp('Rec/Health', 'Staterooms', 4))).toBe(false);
  });
});

describe('findCombinableComponents / canCombineRecHealth', () => {
  test('finds stateroom and rec/health indices', () => {
    expect(findCombinableComponents(smallLiner())).toEqual({ staterooms: [1], recHealth: [3, 4, 5] });
    expect(canCombineRecHealth(smallLiner())).toBe(true);
  });

  test('needs both kinds', () => {
    expect(canCombineRecHealth([comp('Berths', 'Staterooms', 40, 10)])).toBe(false);
    expect(canCombineRecHealth([comp('Rec/Health', 'Gym', 2)])).toBe(false);
  });

  test('transport.csv: two stateroom kinds and ten rec/health items', () => {
    const csv = fs.readFileSync(path.join(__dirname, '../../data/transport.csv'), 'utf8');
    const { components } = parseCSV(csv);
    const { staterooms, recHealth } = findCombinableComponents(components);
    expect(staterooms.map(i => components[i].itemName)).toEqual(['Staterooms', 'Luxury Staterooms']);
    expect(recHealth.map(i => components[i].itemName)).toEqual([
      'Commissary', 'Gym', 'Spa', 'Garden', 'Kitchens', 'First Aid Station', 'Autodoc', 'Library', 'Range', 'Shrine'
    ]);
    const { recTons, stateroomCount } = computeRecHealthOverhead(components);
    expect(recTons).toBeCloseTo(32);
    expect(stateroomCount).toBe(160);
  });
});

// ============================================================
// Combining
// ============================================================

describe('setRecHealthCombined', () => {
  test('shares rec/health tons over every stateroom', () => {
    const components = smallLiner();
    const overhead = setRecHealthCombined(components, true);
    expect(overhead).toBeCloseTo(0.5); // 5 t over 10 staterooms
    expect(components[1].overheadPerItem).toBeCloseTo(0.5);
    expect([3, 4, 5].every(i => components[i].combinedWithStaterooms)).toBe(true);
    expect(components[0].overheadPerItem).toBeUndefined();
    expect(components[2].combinedWithStaterooms).toBeUndefined(); // low berths untouched
  });

  test('stateroom area grows by the overhead', () => {
    const components = smallLiner();
    const before = calculateComponentArea(components[1]);
    setRecHealthCombined(components, true);
    expect(getEffectiveTonsPerItem(components[1])).toBeCloseTo(4.5);
    expect(calculateComponentArea(components[1])).toBeCloseTo(before * 4.5 / 4);
  });

  test('turning off clears the marks', () => {
    const components = smallLiner();
    setRecHealthCombined(components, true);
    expect(setRecHealthCombined(components, false)).toBe(0);
    expect(components.some(c => 'overheadPerItem' in c || 'combinedWithStaterooms' in c)).toBe(false);
  });

  test('does nothing without both kinds', () => {
    const components = [comp('Berths', 'Staterooms', 40, 10)];
    expect(setRecHealthCombined(components, true)).toBe(0);
    expect(components[0].overheadPerItem).toBeUndefined();
  });

  test('several stateroom kinds share the same per-room overhead', () => {
    const components = [comp('Berths', 'Staterooms', 40, 10), comp('Berths', 'Luxury Staterooms', 50, 10),
      comp('Rec/Health', 'Spa', 4, 2)];
    setRecHealthCombined(components, true);
    expect(components[0].overheadPerItem).toBeCloseTo(0.2);
    expect(components[1].overheadPerItem).toBeCloseTo(0.2);
  });
});

describe('expandRecHealthUnits', () => {
  test('one unit per item', () => {
    const components = smallLiner();
    setRecHealthCombined(components, true);
    const units = expandRecHealthUnits(components);
    expect(units).toHaveLength(6);
    expect(units.filter(u => u.componentIndex === 4).map(u => u.tons)).toEqual([0.5, 0.5, 0.5]);
  });

  test('nothing when not combined', () => {
    expect(expandRecHealthUnits(smallLiner())).toEqual([]);
  });
});

// ============================================================
// Distribution
// ============================================================

describe('distributeRecHealth', () => {
  const units = [
    { componentIndex: 3, tons: 1 }, { componentIndex: 3, tons: 1 },
    { componentIndex: 4, tons: 0.5 }, { componentIndex: 4, tons: 0.5 }, { componentIndex: 4, tons: 0.5 },
    { componentIndex: 5, tons: 1.5 }
  ];
  const tons = list => list.reduce((s, u) => s + u.tons, 0);

  // Spreading copies of an item can cost up to one item of balance
  const LARGEST = 1.5;

  test('complete: every item is assigned and floors stay within one item of their budget', () => {
    const { byFloor, unassigned } = distributeRecHealth(units, { 1: 2.5, 2: 2.5 }, true);
    expect(unassigned).toEqual([]);
    expect(tons(byFloor[1]) + tons(byFloor[2])).toBeCloseTo(5);
    expect(Math.abs(tons(byFloor[1]) - 2.5)).toBeLessThanOrEqual(LARGEST);
    expect(Math.abs(tons(byFloor[2]) - 2.5)).toBeLessThanOrEqual(LARGEST);
  });

  test('the same item spreads over floors', () => {
    const { byFloor } = distributeRecHealth(units, { 1: 2.5, 2: 2.5 }, true);
    const gyms = f => byFloor[f].filter(u => u.componentIndex === 3).length;
    expect(gyms(1)).toBe(1);
    expect(gyms(2)).toBe(1);
  });

  test('budget follows the stateroom share', () => {
    const { byFloor } = distributeRecHealth(units, { 1: 4, 2: 1 }, true);
    expect(tons(byFloor[1])).toBeGreaterThan(tons(byFloor[2]));
    expect(Math.abs(tons(byFloor[1]) - 4)).toBeLessThanOrEqual(LARGEST);
    expect(Math.abs(tons(byFloor[2]) - 1)).toBeLessThanOrEqual(LARGEST);
  });

  test('partial: items wait until enough staterooms are placed', () => {
    const { byFloor, unassigned } = distributeRecHealth(units, { 1: 1.5 }, false);
    expect(tons(byFloor[1])).toBeCloseTo(1.5);
    expect(tons(unassigned)).toBeCloseTo(3.5);
  });

  test('partial: an item is assigned when at least half of it is covered', () => {
    expect(distributeRecHealth([{ componentIndex: 1, tons: 2 }], { 1: 1 }, false).unassigned).toEqual([]);
    expect(distributeRecHealth([{ componentIndex: 1, tons: 2 }], { 1: 0.9 }, false).unassigned).toHaveLength(1);
  });

  test('no floors: everything waits', () => {
    expect(distributeRecHealth(units, {}, false).unassigned).toHaveLength(6);
    expect(distributeRecHealth(units, { 1: 0 }, true).unassigned).toHaveLength(6);
  });

  test('deterministic', () => {
    const a = distributeRecHealth(units, { 1: 2, 2: 2, 3: 1 }, true);
    const b = distributeRecHealth(units.slice().reverse(), { 3: 1, 2: 2, 1: 2 }, true);
    expect(a).toEqual(b);
  });
});

// ============================================================
// summarizeAccommodations
// ============================================================

describe('summarizeAccommodations', () => {
  test('null when not combined', () => {
    expect(summarizeAccommodations(smallLiner(), {}, byFloor)).toBeNull();
  });

  test('nothing placed: no floors, everything waiting', () => {
    const components = smallLiner();
    setRecHealthCombined(components, true);
    const s = summarizeAccommodations(components, {}, byFloor);
    expect(s.floors).toEqual([]);
    expect(s.totals).toMatchObject({ staterooms: 0, stateroomTotal: 10, recTons: 0, recTotal: 5, totalTons: 0 });
    expect(s.unassigned.map(u => [u.name, u.count])).toEqual([['Gym', 2], ['Spa', 3], ['Autodoc', 1]]);
  });

  test('all placed on two floors: per-floor counts and tonnage', () => {
    const components = smallLiner();
    setRecHealthCombined(components, true);
    const placements = { 1: { byFloor: { 1: 6, 2: 4 } } };
    const s = summarizeAccommodations(components, placements, byFloor);

    expect(s.unassigned).toEqual([]);
    expect(s.floors.map(f => [f.floor, f.staterooms, f.stateroomTons])).toEqual([[1, 6, 24], [2, 4, 16]]);
    // Overhead budgets 3 t and 2 t, give or take one item (largest is 1.5 t)
    expect(Math.abs(s.floors[0].recTons - 3)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(s.floors[1].recTons - 2)).toBeLessThanOrEqual(1.5);
    expect(s.floors[0].totalTons).toBeCloseTo(24 + s.floors[0].recTons);
    expect(s.totals.recTons).toBeCloseTo(5);
    expect(s.totals.totalTons).toBeCloseTo(45);

    // Every item accounted for exactly once across floors
    const counts = {};
    for (const f of s.floors) for (const r of f.recItems) counts[r.name] = (counts[r.name] || 0) + r.count;
    expect(counts).toEqual({ Gym: 2, Spa: 3, Autodoc: 1 });
    expect(s.recPlaced[4].total).toBe(3);
    expect(Object.values(s.recPlaced[3].byFloor).reduce((a, b) => a + b, 0)).toBe(2);
  });

  test('several stateroom kinds count together', () => {
    const components = [comp('Berths', 'Staterooms', 40, 10), comp('Berths', 'Luxury Staterooms', 50, 10),
      comp('Rec/Health', 'Spa', 4, 2)];
    setRecHealthCombined(components, true);
    const placements = { 0: { byFloor: { 1: 10 } }, 1: { byFloor: { 2: 10 } } };
    const s = summarizeAccommodations(components, placements, byFloor);
    expect(s.floors.map(f => [f.floor, f.staterooms, f.stateroomTons, f.recTons])).toEqual([
      [1, 10, 40, 2], [2, 10, 50, 2]
    ]);
    expect(s.totals.staterooms).toBe(20);
  });
});
