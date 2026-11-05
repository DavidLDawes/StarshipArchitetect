'use strict';

const fs = require('fs');
const path = require('path');
const { parseCSV } = require('../../src/csv-parser');
const {
  canTakeIrregularSpace,
  getRemainingTons,
  isComponentFullyPlaced,
  getPlacementTarget,
  getStillToPlaceArea,
  calculateComponentArea,
  generateComponentDimensionOptions,
  getDeckDimensionOptions,
  getSuggestedFloors
} = require('../../src/component-dimensions');
const {
  analyzeFreeSpace,
  analyzeFloorFreeSpace,
  planFloorFill,
  planRegionArea,
  planAreaFill,
  getEntryTons,
  getPlacedTons,
  getPlacedTonsByFloor,
  getFloorUsedArea,
  sumRectArea
} = require('../../src/placement-geometry');
const { recalculateFloors, getShipGeometry, getCurrentFloorDimensions } = require('../../src/floor-utils');
const { getShapedInner, requiresHullAccess, snapToFloorHull } = require('../../src/hull-access');
const { getRectFitRegion, polygonArea } = require('../../src/hull-shapes');
const { clampToFloor, findValidPosition } = require('../../src/placement-logic');
const { restorePlacements, serializeLayout, parseLayout, migrateLayout, LAYOUT_VERSION } = require('../../src/layout-io');
const { exportLayoutSvg } = require('../../src/layout-export');
const { setRecHealthCombined } = require('../../src/rec-health');

const SHAPED = ['wedge', 'cone', 'sphere', 'cylinder', 'wing', 'disk', 'lifting-body'];

function setShip({ shape = 'rectangular', totalTons = 1000, numFloors = 4, armorTons = 0, components = [] } = {}) {
  Object.assign(global.shipData, {
    hullShape: shape,
    totalTons,
    numFloors,
    armorTons,
    ceilingHeight: 2.5,
    floorLength: 30,
    components,
    componentPlacements: {},
    combineRecHealth: false
  });
  recalculateFloors({ resetLength: true });
  return getCurrentFloorDimensions();
}

afterAll(() => {
  setShip({});
  global.shipData.floorLength = 30;
  recalculateFloors();
  delete global.shipData.hullShape;
});

// ============================================================
// Which components take irregular space
// ============================================================

describe('canTakeIrregularSpace', () => {
  const comp = (category, item) => ({ category, item, itemName: item });

  test.each([
    ['Fuel', 'Fuel (2 weeks)'],
    ['Fuel', '9.75 tons (504 hours)'],
    ['Fuel', 'Fuel Tank'],
    ['Engines', 'Jump Fuel (2 parsecs)'],
    ['Cargo', 'Cargo Bay'],
    ['Cargo', 'Cargo Hold'],
    ['Cargo', 'Spares'],
    ['Cargo', 'Vacuum Bay'],
    ['Cargo', 'Data Storage Bay'],
    ['Cargo', 'Cold Storage Bay']
  ])('%s / %s can', (category, item) => {
    expect(canTakeIrregularSpace(comp(category, item))).toBe(true);
  });

  test.each([
    ['Cargo', 'Secure Storage Bay'],
    ['Fuel', 'Fuel Processors'],
    ['Fuel', 'Fuel Scoops'],
    ['Fuel', 'Fuel Purifier'],
    ['Cargo', 'Cargo Crane'],
    ['Berths', 'Staterooms'],
    ['Fittings', 'Bridge'],
    ['Engines', 'Jump Drive J-8'],
    ['Rec/Health', 'Commissary'],
    ['Vehicles', 'Air/Raft Truck']
  ])('%s / %s cannot', (category, item) => {
    expect(canTakeIrregularSpace(comp(category, item))).toBe(false);
  });

  test('nothing is not a component', () => {
    expect(canTakeIrregularSpace(null)).toBe(false);
  });

  test('none of them need the hull, so the fill modes always apply', () => {
    for (const file of ['Courier', 'Heavy_Fighter', 'sample-ship', 'transport']) {
      const csv = fs.readFileSync(path.join(__dirname, '../../data', file + '.csv'), 'utf8');
      for (const c of parseCSV(csv, file).components.filter(canTakeIrregularSpace)) {
        expect(requiresHullAccess(c)).toBe(false);
      }
    }
  });
});

// ============================================================
// Tonnage accounting
// ============================================================

describe('placing by tonnage', () => {
  const fuel = { category: 'Fuel', item: 'Fuel', itemName: 'Fuel', tons: 21, tonsPerItem: 21, quantity: 1 };

  beforeEach(() => setShip({ components: [fuel] }));

  test('an entry holds its tons, or what its floor area works out to', () => {
    expect(getEntryTons({ floor: 1, x: 0, y: 0, length: 1, width: 1, tons: 7 })).toBe(7);
    expect(getEntryTons({ floor: 1, x: 0, y: 0, length: 5.6, width: 5 })).toBeCloseTo(5, 9); // 28 m² at 2.5 m
    expect(getEntryTons({ floor: 1, x: 0, y: 0, length: 9, width: 9, rects: [{ x: 0, y: 0, length: 2, width: 7 }] })).toBeCloseTo(2.5, 9);
  });

  test('placed tons add up, by floor too', () => {
    const placement = { floors: [{ floor: 1, length: 1, width: 1, tons: 7 }, { floor: 2, length: 1, width: 1, tons: 3 }, { floor: 1, length: 1, width: 1, tons: 1 }] };
    expect(getPlacedTons(placement)).toBe(11);
    expect(getPlacedTonsByFloor(placement)).toEqual({ 1: 8, 2: 3 });
    expect(getPlacedTons(undefined)).toBe(0);
    expect(getPlacedTonsByFloor(undefined)).toEqual({});
  });

  test('what is left goes down as parts are placed', () => {
    expect(getRemainingTons(fuel, undefined)).toBe(21);
    const part = { floors: [{ floor: 1, length: 1, width: 1, tons: 15 }] };
    expect(getRemainingTons(fuel, part)).toBe(6);
    expect(isComponentFullyPlaced(fuel, part)).toBe(false);
  });

  test('a tiny remainder counts as placed', () => {
    const nearly = { floors: [{ floor: 1, length: 1, width: 1, tons: 20.995 }] };
    expect(getRemainingTons(fuel, nearly)).toBe(0);
    expect(isComponentFullyPlaced(fuel, nearly)).toBe(true);
  });

  test('other components still count items', () => {
    const rooms = { category: 'Berths', item: 'Staterooms', quantity: 2, tons: 8, tonsPerItem: 4 };
    expect(isComponentFullyPlaced(rooms, { floors: [{ floor: 1 }] })).toBe(false);
    expect(isComponentFullyPlaced(rooms, { floors: [{ floor: 1 }, { floor: 2 }] })).toBe(true);
    expect(getPlacementTarget(rooms, undefined)).toBe(rooms);
  });

  test('the next rectangle only has to hold what is left', () => {
    const target = getPlacementTarget(fuel, { floors: [{ floor: 1, length: 1, width: 1, tons: 15 }] });
    expect(target.tons).toBe(6);
    expect(calculateComponentArea(target)).toBeCloseTo(33.6, 9);
    expect(fuel.tons).toBe(21);
  });

  test('still to place covers everything not placed yet', () => {
    const rooms = { category: 'Berths', item: 'Staterooms', quantity: 4, tons: 16, tonsPerItem: 4 };
    const rec = { category: 'Rec/Health', item: 'Gym', tons: 3, tonsPerItem: 3, combinedWithStaterooms: true };
    const software = { category: 'Software', item: 'Jump', tons: 0, tonsPerItem: 0 };
    const placements = { 0: { floors: [{ floor: 1, length: 1, width: 1, tons: 15 }] }, 1: { floors: [{ floor: 1 }] } };
    expect(getStillToPlaceArea([fuel, rooms, rec, software], placements)).toBeCloseTo((6 + 12) * 14 / 2.5, 6);
  });

  test('floor use counts every rectangle on that floor', () => {
    const placements = {
      0: { floors: [{ floor: 1, x: 0, y: 0, length: 2, width: 3 }, { floor: 2, x: 0, y: 0, length: 5, width: 5 }] },
      1: { floors: [{ floor: 1, x: 5, y: 5, length: 1, width: 1, rects: [{ x: 5, y: 5, length: 1, width: 1 }, { x: 6, y: 5, length: 1, width: 1 }] }] }
    };
    expect(getFloorUsedArea(1, placements)).toBe(8);
    expect(getFloorUsedArea(3, placements)).toBe(0);
  });
});

// ============================================================
// Planning a fill by area
// ============================================================

describe('planRegionArea', () => {
  const { regions: [open] } = analyzeFreeSpace({ x0: 0, y0: 0, x1: 10, y1: 10 }, []);
  const cell = { x: 0, y: 0, length: 0.2, width: 0.1 };
  const sliver = { area: 0.02, cells: [cell], rects: [cell] };

  test('takes just what is needed, from the chosen side', () => {
    const plan = planRegionArea(open, 30, 'right');
    expect(plan.area).toBeCloseTo(30, 6);
    expect(plan.bbox.x).toBeCloseTo(7, 6);
    expect(plan.regionArea).toBe(100);
  });

  test('takes all of a region that is too small', () => {
    expect(planRegionArea(open, 500).area).toBe(100);
  });

  test('ignores nothing to do and tiny gaps', () => {
    expect(planRegionArea(open, 0)).toBeNull();
    expect(planRegionArea(null, 5)).toBeNull();
    expect(planRegionArea(sliver, 5)).toBeNull();
  });

  test('uses a small gap when the open areas have run out', () => {
    const { regions: [gap] } = analyzeFreeSpace({ x0: 0, y0: 0, x1: 1, y1: 0.5 }, []);
    expect(planRegionArea(gap, 5).area).toBeCloseTo(0.5, 6);
  });

  test('uses a tiny gap when that is all that is left to place', () => {
    expect(planRegionArea(sliver, 0.01).area).toBeCloseTo(0.01, 6);
  });
});

describe('planAreaFill', () => {
  // Three rooms made by walls: 10 × 10, 10 × 5, and 10 × 2
  const { regions } = analyzeFreeSpace({ x0: 0, y0: 0, x1: 10, y1: 19 }, [
    { x: 0, y: 10, length: 10, width: 1 },
    { x: 0, y: 16, length: 10, width: 1 }
  ]);

  test('uses the smallest region that holds it all', () => {
    const plan = planAreaFill(regions, 40);
    expect(plan).toHaveLength(1);
    expect(plan[0].regionArea).toBe(50);
    expect(plan[0].area).toBeCloseTo(40, 6);
  });

  test('otherwise fills the largest first until done', () => {
    const plan = planAreaFill(regions, 130);
    expect(plan.map(p => Math.round(p.area))).toEqual([100, 30]);
  });

  test('stops when the free space runs out', () => {
    const plan = planAreaFill(regions, 500);
    expect(plan.reduce((sum, p) => sum + p.area, 0)).toBe(170);
  });

  test('has nothing to do for nothing', () => {
    expect(planAreaFill(regions, 0)).toEqual([]);
    expect(planAreaFill([], 10)).toEqual([]);
  });
});

// ============================================================
// Size presets
// ============================================================

describe('size presets', () => {
  const item = tons => ({ category: 'Engines', item: 'Drive', itemName: 'Drive', tons, tonsPerItem: tons, quantity: 1 });

  test('a full width preset is kept when the width rounds down', () => {
    // 17.1085 m rounds to 17.1 m, which used to make the exact fit look too wide
    global.shipData.armorThickness = 0;
    const { options } = generateComponentDimensionOptions(item(60), 500, 34.217, 17.1085, 1);
    const fullWidth = options.find(o => /full width/.test(o.label));
    expect(fullWidth).toBeDefined();
    expect(fullWidth.width).toBe(17.1085);
    expect(fullWidth.length * fullWidth.width).toBeCloseTo(336, 6);
  });

  test('sizes past the floor are still refused', () => {
    global.shipData.armorThickness = 0;
    const { options } = generateComponentDimensionOptions(item(60), 500, 34, 17, 1);
    for (const o of options) {
      expect(o.length).toBeLessThanOrEqual(34 + 1e-6);
      expect(o.width).toBeLessThanOrEqual(17 + 1e-6);
    }
  });

  test.each(['Courier', 'Heavy_Fighter', 'sample-ship', 'transport'])('no preset for %s takes more floor than the item needs', file => {
    const csv = fs.readFileSync(path.join(__dirname, '../../data', file + '.csv'), 'utf8');
    const { components, totalTons } = parseCSV(csv, file);
    for (const shape of ['rectangular', 'cone', 'lifting-body']) {
      setShip({ shape, totalTons, numFloors: 4, components });
      for (const c of components.filter(x => x.tons > 0)) {
        for (const floors of [1, [1, 2]]) {
          const numFloors = [].concat(floors).length;
          const { options, areaPerFloor } = getDeckDimensionOptions(c, floors, numFloors);
          for (const o of options) {
            expect(o.length * o.width).toBeLessThanOrEqual(areaPerFloor + 1e-6);
          }
        }
      }
    }
  });

  test('a round size is still offered when it is exactly the right area', () => {
    global.shipData.armorThickness = 0;
    const { options } = generateComponentDimensionOptions(item(5), 500, 30, 20, 1); // 28 m²
    expect(options.some(o => o.length === 4 && o.width === 7)).toBe(true);
    expect(options.every(o => o.length * o.width <= 28 + 1e-6)).toBe(true);
  });

  test('a very small item gets a square under the 1 m minimum', () => {
    global.shipData.armorThickness = 0;
    const { options } = generateComponentDimensionOptions(item(0.1), 500, 30, 20, 1);
    expect(options).toHaveLength(1);
    expect(options[0].length).toBeCloseTo(Math.sqrt(0.56), 9);
  });

  test('rectangular ships size against the floor, as before', () => {
    const { floorArea, floorLength, floorWidth } = setShip({ armorTons: 20 });
    expect(getDeckDimensionOptions(item(20), 2, 1).options)
      .toEqual(generateComponentDimensionOptions(item(20), floorArea, floorLength, floorWidth, 1).options);
  });

  describe.each(SHAPED)('on a %s hull', shape => {
    beforeEach(() => setShip({ shape, armorTons: 20 }));

    test('every preset fits the deck it was offered for', () => {
      for (let f = 1; f <= 4; f++) {
        for (const tons of [0.5, 2, 4, 10, 20]) {
          for (const o of getDeckDimensionOptions(item(tons), f, 1).options) {
            expect(getRectFitRegion(getShapedInner(f), o.length, o.width).length).toBeGreaterThan(0);
          }
        }
      }
    });

    test('every preset for several floors fits the space they share', () => {
      for (const o of getDeckDimensionOptions(item(20), [2, 3], 2).options) {
        expect(getRectFitRegion(getShapedInner([2, 3]), o.length, o.width).length).toBeGreaterThan(0);
        expect(o.length * o.width).toBeGreaterThanOrEqual(calculateComponentArea(item(10)) * 0.95);
      }
    });

    test('something ordinary always has a choice on the largest deck', () => {
      const [largest] = getSuggestedFloors(1);
      expect(getDeckDimensionOptions(item(2), largest, 1).options.length).toBeGreaterThan(0);
    });

    test('something too big for a deck gets no choices', () => {
      const f = getSuggestedFloors(1)[0];
      const tooBig = item(getShipGeometry().floors[f - 1].usableArea * 2.5 / 14 * 1.2);
      expect(getDeckDimensionOptions(tooBig, f, 1).options).toEqual([]);
    });

    test('a deck with no usable space offers nothing', () => {
      const original = getShipGeometry().floors[0].inner;
      getShipGeometry().floors[0].inner = [];
      expect(getDeckDimensionOptions(item(2), 1, 1).options).toEqual([]);
      getShipGeometry().floors[0].inner = original;
    });
  });

  test('needing several floors is judged by the largest deck', () => {
    setShip({ shape: 'cone' });
    const largest = Math.max(...getShipGeometry().floors.map(f => f.usableArea));
    const justFits = item(largest * 2.5 / 14 - 1);
    const tooBig = item(largest * 2.5 / 14 + 1);
    expect(getDeckDimensionOptions(justFits, 1).isMultiFloor).toBe(false);
    expect(getDeckDimensionOptions(tooBig, 1).isMultiFloor).toBe(true);
    expect(getDeckDimensionOptions(tooBig, 1).floorsNeeded).toBe(2);
  });
});

describe('getSuggestedFloors', () => {
  test('rectangular ships start from the bottom', () => {
    setShip({ numFloors: 5 });
    expect(getSuggestedFloors(1)).toEqual([1]);
    expect(getSuggestedFloors(3)).toEqual([1, 2, 3]);
  });

  test('never asks for more floors than the ship has', () => {
    setShip({ numFloors: 2 });
    expect(getSuggestedFloors(5)).toEqual([1, 2]);
    expect(getSuggestedFloors(0)).toEqual([1]);
  });

  test('a cone suggests its large bottom decks', () => {
    setShip({ shape: 'cone', numFloors: 5 });
    expect(getSuggestedFloors(2)).toEqual([1, 2]);
  });

  test('a sphere suggests its large middle decks', () => {
    setShip({ shape: 'sphere', numFloors: 5 });
    expect(getSuggestedFloors(1)).toEqual([3]);
    expect(getSuggestedFloors(3)).toEqual([2, 3, 4]);
  });

  test('a suggestion has the most shared space of any neighboring floors', () => {
    setShip({ shape: 'sphere', numFloors: 6 });
    const best = polygonArea(getShapedInner(getSuggestedFloors(2)));
    for (let f = 1; f < 6; f++) {
      expect(polygonArea(getShapedInner([f, f + 1]))).toBeLessThanOrEqual(best + 1e-9);
    }
  });
});

// ============================================================
// Spanning floors
// ============================================================

describe('findValidPosition across floors', () => {
  const blocker = { floors: [{ floor: 2, x: 8, y: 8, length: 6, width: 6 }] };

  test.each(['rectangular', 'disk'])('on a %s hull it slides clear of rooms on the other floors', shape => {
    const { floorLength: L, floorWidth: W } = setShip({ shape });
    global.shipData.componentPlacements = { 0: blocker };

    // Free on floor 1, but not on floor 2 which it also spans
    expect(findValidPosition(1, 9, 9, 3, 3, L, W, -1)).toEqual({ x: 9, y: 9 });
    const position = findValidPosition(1, 9, 9, 3, 3, L, W, -1, false, [1, 2]);
    expect(position).not.toBeNull();
    expect(position).not.toEqual({ x: 9, y: 9 });
    for (const floor of [1, 2]) {
      expect(findValidPosition(floor, position.x, position.y, 3, 3, L, W, -1)).toEqual(position);
    }
  });
});

// ============================================================
// Layouts
// ============================================================

describe('layouts with tonnage placements', () => {
  const fuel = { category: 'Fuel', item: 'Fuel', itemName: 'Fuel', tons: 21, tonsPerItem: 21, quantity: 1 };
  const drive = { category: 'Engines', item: 'Jump Drive', itemName: 'Jump Drive', tons: 60, tonsPerItem: 60, quantity: 1 };
  const floor = { count: 4, length: 30, width: 30, armorThickness: 0 };
  const layoutFor = (component, entries) => ({ placements: [{ component: `${component.category}|${component.item}|0`, item: component.item, entries }] });

  beforeEach(() => setShip({}));

  test('tons survive saving and restoring', () => {
    const entries = [
      { floor: 1, x: 0, y: 0, length: 3, width: 3, tons: 5.5 },
      { floor: 2, x: 0, y: 0, length: 3, width: 3, tons: 15.5, rects: [{ x: 0, y: 0, length: 3, width: 3 }] }
    ];
    const layout = parseLayout(JSON.stringify({
      ...serializeLayout({ ...global.shipData, components: [fuel], componentPlacements: { 0: { floors: entries } }, floorWidth: 30 }),
      ship: { csv: 'x' }
    }));
    expect(layout.version).toBe(LAYOUT_VERSION);
    const result = restorePlacements(layout, [fuel], floor);
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors).toEqual(entries);
  });

  test('entries saved without tons work them out from their area', () => {
    const result = restorePlacements(layoutFor(fuel, [{ floor: 1, x: 0, y: 0, length: 6, width: 7 }]), [fuel], floor);
    expect(result.restored).toBe(1);
    expect(result.placements[0].floors[0].tons).toBeCloseTo(7.5, 9);
  });

  test('more tons than the design has are trimmed, then dropped', () => {
    const entries = [
      { floor: 1, x: 0, y: 0, length: 3, width: 3, tons: 20 },
      { floor: 2, x: 0, y: 0, length: 3, width: 3, tons: 5 },
      { floor: 3, x: 0, y: 0, length: 3, width: 3, tons: 5 }
    ];
    const result = restorePlacements(layoutFor(fuel, entries), [fuel], floor);
    expect(result.restored).toBe(2);
    expect(result.dropped).toBe(1);
    expect(result.placements[0].floors.map(e => e.tons)).toEqual([20, 1]);
    expect(result.problems[0]).toMatch(/now holds 1\.0/);
    expect(result.problems[1]).toMatch(/already placed/);
  });

  test('tiny parts that add up to the total all come back, exactly as saved', () => {
    const part = (floor, tons) => ({ floor, x: floor, y: 0, length: 0.2, width: 0.2, tons });
    const entries = [part(1, 20.1), part(2, 0.893), part(3, 0.004), part(4, 0.003)];
    const result = restorePlacements(layoutFor(fuel, entries), [fuel], floor);
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors).toEqual(entries);
  });

  test('a part just past the total counts as rounding', () => {
    const entries = [
      { floor: 1, x: 0, y: 0, length: 3, width: 3, tons: 20.999 },
      { floor: 2, x: 0, y: 0, length: 3, width: 3, tons: 0.005 }
    ];
    const result = restorePlacements(layoutFor(fuel, entries), [fuel], floor);
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors).toEqual(entries);
  });

  test('damaged tons are reported', () => {
    const result = restorePlacements(layoutFor(fuel, [{ floor: 1, x: 0, y: 0, length: 3, width: 3, tons: -2 }]), [fuel], floor);
    expect(result.restored).toBe(0);
    expect(result.problems[0]).toMatch(/damaged/);
  });

  test('a component no longer placed by tonnage drops the field', () => {
    const result = restorePlacements(layoutFor(drive, [{ floor: 1, x: 0, y: 0, length: 3, width: 3, tons: 5 }]), [drive], floor);
    expect(result.placements[0].floors[0].tons).toBeUndefined();
  });

  test('a single item spanning floors keeps all of them', () => {
    const entries = [1, 2, 3].map(f => ({ floor: f, x: 2, y: 2, length: 5, width: 5 }));
    const result = restorePlacements(layoutFor(drive, entries), [drive], floor);
    expect(result.problems).toEqual([]);
    expect(result.restored).toBe(3);
    expect(result.placements[0].floors).toEqual(entries);
  });

  test('a second copy somewhere else is still too many', () => {
    const entries = [
      { floor: 1, x: 2, y: 2, length: 5, width: 5 },
      { floor: 2, x: 12, y: 2, length: 5, width: 5 }
    ];
    const result = restorePlacements(layoutFor(drive, entries), [drive], floor);
    expect(result.restored).toBe(1);
    expect(result.problems[0]).toMatch(/already placed/);
  });

  test('older versions migrate, keeping a version 2 shape', () => {
    const base = { format: 'starship-architect-layout', ship: { csv: 'x' }, placements: [] };
    const floors = { count: 2, length: 10, ceilingHeight: 2.5 };
    expect(parseLayout(JSON.stringify({ ...base, version: 1, floors })).floors.shape).toBe('rectangular');
    expect(parseLayout(JSON.stringify({ ...base, version: 2, floors: { ...floors, shape: 'cone' } })).floors.shape).toBe('cone');
    const current = { version: LAYOUT_VERSION, floors };
    expect(migrateLayout(current)).toBe(current);
  });
});

describe('SVG export of tonnage placements', () => {
  test('labels and tooltips give the tons in that part', () => {
    const fuel = { category: 'Fuel', item: 'Fuel', itemName: 'Fuel', tons: 21, tonsPerItem: 21, quantity: 1 };
    const svg = exportLayoutSvg({
      ...global.shipData,
      floorLength: 30,
      floorWidth: 30,
      numFloors: 1,
      components: [fuel],
      componentPlacements: { 0: { floors: [{ floor: 1, x: 0, y: 0, length: 3, width: 3, tons: 5.5 }] } }
    });
    expect(svg).toContain('Fuel 5.5 t');
    expect(svg).not.toContain('21 t');
  });
});

// ============================================================
// Does the Courier fit?
// ============================================================

describe('fitting a full ship', () => {
  // Places everything solid as rectangles, largest first, the way a simple player
  // might, then fills what is left with what can take any shape. Rooms are placed
  // one at a time unless the ship is out of neat rectangles.
  function fit(file, shape, numFloors = 4) {
    const csv = fs.readFileSync(path.join(__dirname, '../../data', file + '.csv'), 'utf8');
    const parsed = parseCSV(csv, file);
    const components = parsed.components.filter(c => !/^hull$/i.test(c.category));
    const { floorLength: L, floorWidth: W } = setShip({ shape, totalTons: parsed.totalTons, numFloors, armorTons: parsed.armorTons || 0, components });
    global.shipData.combineRecHealth = true;
    setRecHealthCombined(components, true);
    const armor = global.shipData.armorThickness;
    const P = global.shipData.componentPlacements;
    const add = (i, entry) => { (P[i] = P[i] || { floors: [] }).floors.push(entry); };
    const decks = getShipGeometry().floors.map(f => f.floor)
      .sort((a, b) => getShipGeometry().floors[b - 1].usableArea - getShipGeometry().floors[a - 1].usableArea);

    function placeOn(floors, i, length, width, hull) {
      const list = [].concat(floors);
      let p = clampToFloor(list, 0, 0, length, width, L, W, armor);
      if (hull) p = snapToFloorHull(list, p.x, p.y, length, width, L, W, armor);
      const position = findValidPosition(list[0], p.x, p.y, length, width, L, W, -1, hull, list);
      if (!position) return false;
      list.forEach(floor => add(i, { floor, x: position.x, y: position.y, length, width }));
      return true;
    }

    function placeSolid(i, item) {
      const hull = requiresHullAccess(item);
      for (const floor of decks) {
        for (const o of getDeckDimensionOptions(item, floor, 1).options) {
          if (placeOn(floor, i, o.length, o.width, hull)) return true;
        }
      }
      for (let n = 2; n <= Math.min(4, numFloors); n++) {
        for (let from = 1; from + n - 1 <= numFloors; from++) {
          const span = Array.from({ length: n }, (_, k) => from + k);
          for (const o of getDeckDimensionOptions(item, span, n).options) {
            if (placeOn(span, i, o.length, o.width, hull)) return true;
          }
        }
      }
      return false;
    }

    const solid = components.map((c, i) => i).filter(i => components[i].tons > 0 &&
      !components[i].combinedWithStaterooms && !canTakeIrregularSpace(components[i]));
    // Weapons need wall space, so they go first; then the largest single items
    const hullFirst = i => (requiresHullAccess(components[i]) ? 1 : 0);
    solid.sort((a, b) => hullFirst(b) - hullFirst(a) || components[b].tonsPerItem - components[a].tonsPerItem);

    const unplaced = [];
    let overSized = 0;
    for (const i of solid) {
      const c = components[i];
      for (let k = 0; k < (c.quantity || 1); k++) {
        const one = { ...c, quantity: 1, tons: c.tonsPerItem };
        if (placeSolid(i, one)) continue;
        // Out of neat rectangles: an item in quantity can still use Fill Floor
        let placed = false;
        if ((c.quantity || 1) > 1 && !requiresHullAccess(c)) {
          for (const floor of decks) {
            const { regions } = analyzeFloorFreeSpace(floor, L, W, armor);
            const [plan] = planFloorFill(regions, calculateComponentArea(c), 1);
            if (plan) {
              add(i, { floor, x: plan.bbox.x, y: plan.bbox.y, length: plan.bbox.length, width: plan.bbox.width, rects: plan.rects });
              placed = true;
              break;
            }
          }
        }
        if (!placed) unplaced.push(c.itemName || c.item);
      }
      overSized += (P[i] ? P[i].floors : []).reduce((sum, e) => sum + sumRectArea(e.rects || [e]), 0) - (P[i] ? calculateComponentArea(c) * (c.quantity || 1) : 0);
    }

    // Fuel, cargo and the like fill whatever is left
    let tonsLeft = 0;
    components.forEach((c, i) => {
      if (!canTakeIrregularSpace(c)) return;
      let left = c.tons;
      for (const floor of decks) {
        if (left <= 0.01) break;
        const { regions } = analyzeFloorFreeSpace(floor, L, W, armor);
        for (const plan of planAreaFill(regions, left * 14 / 2.5)) {
          const tons = plan.area * 2.5 / 14;
          add(i, { floor, x: plan.bbox.x, y: plan.bbox.y, length: plan.bbox.length, width: plan.bbox.width, rects: plan.rects, tons });
          left -= tons;
        }
      }
      tonsLeft += Math.max(0, left);
    });
    return { unplaced, tonsLeft, overSized };
  }

  afterEach(() => { global.shipData.combineRecHealth = false; });

  test.each(['rectangular', 'wedge', 'cylinder', 'wing', 'disk', 'lifting-body'])('the Courier fits on a %s hull', shape => {
    const { unplaced, tonsLeft } = fit('Courier', shape);
    expect(unplaced).toEqual([]);
    expect(tonsLeft).toBeLessThan(0.05);
  });

});
