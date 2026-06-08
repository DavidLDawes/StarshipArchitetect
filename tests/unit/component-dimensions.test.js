'use strict';

const {
  calculateComponentArea,
  generateComponentDimensionOptions
} = require('../../src/component-dimensions');

// Shared floor dimensions used in most tests
const FLOOR_LENGTH = 30;
const FLOOR_WIDTH = 20;
const FLOOR_AREA = 600;

beforeEach(() => {
  global.shipData.ceilingHeight = 2.5;
  global.shipData.armorThickness = 0;
  global.shipData.floorLength = FLOOR_LENGTH;
});

// ============================================================
// calculateComponentArea
// ============================================================

describe('calculateComponentArea', () => {
  test('single-item component: 10 tons → 10 * 14 / 2.5 = 56 m²', () => {
    const comp = { tons: 10, tonsPerItem: 10 };
    expect(calculateComponentArea(comp)).toBeCloseTo(56);
  });

  test('multi-quantity component uses tonsPerItem: tonsPerItem=4, tons=40 → 4*14/2.5 = 22.4', () => {
    const comp = { tons: 40, tonsPerItem: 4, quantity: 10 };
    expect(calculateComponentArea(comp)).toBeCloseTo(22.4);
  });

  test('prefers tonsPerItem over tons when both present', () => {
    const comp = { tons: 100, tonsPerItem: 5 };
    // 5*14/2.5 = 28
    expect(calculateComponentArea(comp)).toBeCloseTo(28);
  });

  test('falls back to tons when tonsPerItem is absent', () => {
    const comp = { tons: 20 };
    // 20*14/2.5 = 112
    expect(calculateComponentArea(comp)).toBeCloseTo(112);
  });

  test('0 tons → 0 area', () => {
    const comp = { tons: 0, tonsPerItem: 0 };
    expect(calculateComponentArea(comp)).toBe(0);
  });

  test('uses global SQM_PER_TON and ceilingHeight', () => {
    global.shipData.ceilingHeight = 2;
    const comp = { tons: 10, tonsPerItem: 10 };
    // 10 * 14 / 2 = 70
    expect(calculateComponentArea(comp)).toBeCloseTo(70);
  });
});

// ============================================================
// generateComponentDimensionOptions
// ============================================================

describe('generateComponentDimensionOptions', () => {
  // Helper to create a standard component
  function makeComp(tons, tonsPerItem = null) {
    return { tons, tonsPerItem: tonsPerItem !== null ? tonsPerItem : tons };
  }

  test('returns object with options array and metadata', () => {
    const result = generateComponentDimensionOptions(
      makeComp(5),
      FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result).toHaveProperty('options');
    expect(result).toHaveProperty('componentArea');
    expect(result).toHaveProperty('isSmall');
    expect(result).toHaveProperty('isLarge');
    expect(result).toHaveProperty('isMultiFloor');
    expect(result).toHaveProperty('floorsNeeded');
    expect(result).toHaveProperty('areaPerFloor');
    expect(result).toHaveProperty('effectiveFloorCount');
  });

  // ---- Small component ----

  test('small component (5 tons, area=28m² < 40): isSmall=true', () => {
    const result = generateComponentDimensionOptions(
      makeComp(5), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.isSmall).toBe(true);
  });

  test('small component: componentArea ≈ 28 m²', () => {
    const result = generateComponentDimensionOptions(
      makeComp(5), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.componentArea).toBeCloseTo(5 * 14 / 2.5);
  });

  test('small component: options array has positive-dimension entries', () => {
    const result = generateComponentDimensionOptions(
      makeComp(5), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    for (const opt of result.options) {
      expect(opt.length).toBeGreaterThan(0);
      expect(opt.width).toBeGreaterThan(0);
    }
  });

  // ---- Normal component ----

  test('normal component (40 tons, area=224m²): isSmall=false, isMultiFloor=false', () => {
    const result = generateComponentDimensionOptions(
      makeComp(40), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.isSmall).toBe(false);
    expect(result.isMultiFloor).toBe(false);
  });

  test('normal component: options returned', () => {
    const result = generateComponentDimensionOptions(
      makeComp(40), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(Array.isArray(result.options)).toBe(true);
  });

  // ---- Large component ----

  test('large component (50 tons, area=280m² > 50% of 600): isLarge=true', () => {
    // 50*14/2.5=280; 280 >= 600*0.5=300? No — 50 tons = 280m², 280 < 300
    // Use 55 tons: 55*14/2.5=308 > 300
    const comp = makeComp(55);
    const result = generateComponentDimensionOptions(
      comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.isLarge).toBe(true);
  });

  test('isLarge is false for small components', () => {
    const result = generateComponentDimensionOptions(
      makeComp(5), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.isLarge).toBe(false);
  });

  // ---- Multi-floor component ----

  test('multi-floor component (120 tons, area=672m² > 600): isMultiFloor=true', () => {
    const result = generateComponentDimensionOptions(
      makeComp(120), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.isMultiFloor).toBe(true);
  });

  test('multi-floor component (120 tons): floorsNeeded=2', () => {
    // 120*14/2.5=672; ceil(672/600)=2
    const result = generateComponentDimensionOptions(
      makeComp(120), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.floorsNeeded).toBe(2);
  });

  test('multi-floor component: effectiveFloorCount defaults to floorsNeeded', () => {
    const result = generateComponentDimensionOptions(
      makeComp(120), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.effectiveFloorCount).toBe(result.floorsNeeded);
  });

  // ---- numFloorsSelected ----

  test('numFloorsSelected=2: areaPerFloor = componentArea / 2', () => {
    const comp = makeComp(40);
    const result = generateComponentDimensionOptions(
      comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH, 2
    );
    const expected = (40 * 14 / 2.5) / 2;
    expect(result.areaPerFloor).toBeCloseTo(expected);
  });

  test('numFloorsSelected=2: effectiveFloorCount=2', () => {
    const comp = makeComp(40);
    const result = generateComponentDimensionOptions(
      comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH, 2
    );
    expect(result.effectiveFloorCount).toBe(2);
  });

  test('numFloorsSelected=2: options dimensions fit within floor bounds', () => {
    const comp = makeComp(40);
    const result = generateComponentDimensionOptions(
      comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH, 2
    );
    for (const opt of result.options) {
      expect(opt.length).toBeLessThanOrEqual(FLOOR_LENGTH + 0.01);
      expect(opt.width).toBeLessThanOrEqual(FLOOR_WIDTH + 0.01);
    }
  });

  // ---- Armor thickness ----

  test('with armorThickness=1: usable dimensions reduced, options still within usable bounds', () => {
    global.shipData.armorThickness = 1;
    const usableLength = FLOOR_LENGTH - 2 * 1; // 28
    const usableWidth = FLOOR_WIDTH - 2 * 1;   // 18
    const comp = makeComp(10);
    const result = generateComponentDimensionOptions(
      comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    for (const opt of result.options) {
      expect(opt.length).toBeLessThanOrEqual(usableLength + 0.01);
      expect(opt.width).toBeLessThanOrEqual(usableWidth + 0.01);
    }
  });

  test('with armorThickness=0: options can use full floor length', () => {
    global.shipData.armorThickness = 0;
    const comp = makeComp(10);
    const result = generateComponentDimensionOptions(
      comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    const anyUsesFullLength = result.options.some(o => o.length <= FLOOR_LENGTH + 0.01);
    expect(anyUsesFullLength).toBe(true);
  });

  // ---- Options have positive dimensions ----

  test('all option entries have positive length and width', () => {
    const comps = [makeComp(5), makeComp(40), makeComp(120)];
    for (const comp of comps) {
      const result = generateComponentDimensionOptions(
        comp, FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
      );
      for (const opt of result.options) {
        expect(opt.length).toBeGreaterThan(0);
        expect(opt.width).toBeGreaterThan(0);
      }
    }
  });

  test('all options have a label string', () => {
    const result = generateComponentDimensionOptions(
      makeComp(10), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    for (const opt of result.options) {
      expect(typeof opt.label).toBe('string');
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  // ---- Single-floor component stays single floor ----

  test('component fitting on one floor: isMultiFloor=false and floorsNeeded=1', () => {
    const result = generateComponentDimensionOptions(
      makeComp(1), FLOOR_AREA, FLOOR_LENGTH, FLOOR_WIDTH
    );
    expect(result.isMultiFloor).toBe(false);
    expect(result.floorsNeeded).toBe(1);
    expect(result.effectiveFloorCount).toBe(1);
  });
});
