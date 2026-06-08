'use strict';

const {
  calculateTotalFloorArea,
  calculateFloorArea,
  calculateDefaultFloorLength,
  calculateFloorWidth,
  generateDimensionOptions,
  generateDimensionOptionsWithStep,
  calculateArmorThickness,
  getCurrentFloorDimensions
} = require('../../src/floor-utils');

// ============================================================
// calculateTotalFloorArea
// ============================================================

describe('calculateTotalFloorArea', () => {
  test('1000 tons, 2.5m ceiling = 5600 m²', () => {
    // 1000 * 14 / 2.5 = 5600
    expect(calculateTotalFloorArea(1000, 2.5)).toBeCloseTo(5600);
  });

  test('500 tons, 2.5m ceiling = 2800 m²', () => {
    expect(calculateTotalFloorArea(500, 2.5)).toBeCloseTo(2800);
  });

  test('200 tons, 2m ceiling = 1400 m²', () => {
    // 200 * 14 / 2 = 1400
    expect(calculateTotalFloorArea(200, 2)).toBeCloseTo(1400);
  });

  test('0 tons returns 0', () => {
    expect(calculateTotalFloorArea(0, 2.5)).toBe(0);
  });

  test('uses global SQM_PER_TON (14)', () => {
    // Direct verification: result should equal tons * 14 / ceilingHeight
    const result = calculateTotalFloorArea(100, 2);
    expect(result).toBeCloseTo(100 * 14 / 2);
  });
});

// ============================================================
// calculateFloorArea
// ============================================================

describe('calculateFloorArea', () => {
  test('5600 / 4 floors = 1400 m² per floor', () => {
    expect(calculateFloorArea(5600, 4)).toBeCloseTo(1400);
  });

  test('2800 / 2 floors = 1400 m² per floor', () => {
    expect(calculateFloorArea(2800, 2)).toBeCloseTo(1400);
  });

  test('single floor returns total area unchanged', () => {
    expect(calculateFloorArea(600, 1)).toBeCloseTo(600);
  });

  test('10000 / 5 = 2000', () => {
    expect(calculateFloorArea(10000, 5)).toBeCloseTo(2000);
  });
});

// ============================================================
// calculateDefaultFloorLength
// ============================================================

describe('calculateDefaultFloorLength', () => {
  test('floorArea=1400 → sqrt≈37.4 → floor(37.4/10)*10 = 30', () => {
    expect(calculateDefaultFloorLength(1400)).toBe(30);
  });

  test('floorArea=100 → sqrt=10 → floor(10/10)*10 = 10', () => {
    expect(calculateDefaultFloorLength(100)).toBe(10);
  });

  test('floorArea=2500 → sqrt=50 → floor(50/10)*10 = 50', () => {
    expect(calculateDefaultFloorLength(2500)).toBe(50);
  });

  test('very small area gives minimum of 5', () => {
    // sqrt(1)=1, floor(1/10)*10=0, minimum kicks in → 5
    expect(calculateDefaultFloorLength(1)).toBe(5);
  });

  test('floorArea=9 → sqrt=3, floor(0.3)*10=0 → minimum 5', () => {
    expect(calculateDefaultFloorLength(9)).toBe(5);
  });

  test('floorArea=10000 → sqrt=100 → 100', () => {
    expect(calculateDefaultFloorLength(10000)).toBe(100);
  });
});

// ============================================================
// calculateFloorWidth
// ============================================================

describe('calculateFloorWidth', () => {
  test('600 / 30 = 20', () => {
    expect(calculateFloorWidth(600, 30)).toBeCloseTo(20);
  });

  test('1400 / 30 ≈ 46.67', () => {
    expect(calculateFloorWidth(1400, 30)).toBeCloseTo(46.67, 1);
  });

  test('200 / 10 = 20', () => {
    expect(calculateFloorWidth(200, 10)).toBeCloseTo(20);
  });
});

// ============================================================
// generateDimensionOptions
// ============================================================

describe('generateDimensionOptions', () => {
  test('returns an array', () => {
    const opts = generateDimensionOptions(600);
    expect(Array.isArray(opts)).toBe(true);
  });

  test('each option has length, width, label properties', () => {
    const opts = generateDimensionOptions(600);
    for (const opt of opts) {
      expect(opt).toHaveProperty('length');
      expect(opt).toHaveProperty('width');
      expect(opt).toHaveProperty('label');
    }
  });

  test('result has between 1 and 12 options for normal area', () => {
    const opts = generateDimensionOptions(600);
    expect(opts.length).toBeGreaterThanOrEqual(1);
    expect(opts.length).toBeLessThanOrEqual(12);
  });

  test('each option has ratio between 0.33 and 3 (length/width)', () => {
    const opts = generateDimensionOptions(600);
    for (const opt of opts) {
      const ratio = opt.length / opt.width;
      expect(ratio).toBeGreaterThanOrEqual(0.33 - 0.01);
      expect(ratio).toBeLessThanOrEqual(3 + 0.01);
    }
  });

  test('large ship (floorArea=60000) triggers step=100 branch', () => {
    const opts = generateDimensionOptions(60000);
    expect(Array.isArray(opts)).toBe(true);
    // At step=100 the lengths should be multiples of 100
    for (const opt of opts) {
      expect(opt.length % 100).toBe(0);
    }
  });

  test('medium ship (floorArea=15000) triggers step=50 branch', () => {
    const opts = generateDimensionOptions(15000);
    expect(Array.isArray(opts)).toBe(true);
    for (const opt of opts) {
      expect(opt.length % 50).toBe(0);
    }
  });

  test('small-medium ship (floorArea=3000) uses step=20 branch', () => {
    const opts = generateDimensionOptions(3000);
    expect(Array.isArray(opts)).toBe(true);
    for (const opt of opts) {
      expect(opt.length % 20).toBe(0);
    }
  });

  test('result options do not exceed 12 entries', () => {
    // For a large ship, thinning should apply
    const opts = generateDimensionOptions(50000);
    expect(opts.length).toBeLessThanOrEqual(12);
  });

  test('all returned widths are positive', () => {
    const opts = generateDimensionOptions(600);
    for (const opt of opts) {
      expect(opt.width).toBeGreaterThan(0);
    }
  });

  test('all returned lengths are positive', () => {
    const opts = generateDimensionOptions(600);
    for (const opt of opts) {
      expect(opt.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// generateDimensionOptionsWithStep
// ============================================================

describe('generateDimensionOptionsWithStep', () => {
  test('returns an array', () => {
    const opts = generateDimensionOptionsWithStep(600, 10);
    expect(Array.isArray(opts)).toBe(true);
  });

  test('with a small area and large step, recurses to smaller step for >=2 results', () => {
    // floorArea=200, step=20: small range, may be <3 options, recursion kicks in to step=10
    const opts = generateDimensionOptionsWithStep(200, 20);
    expect(opts.length).toBeGreaterThanOrEqual(2);
  });

  test('step is clamped to minimum of 5', () => {
    // step=1 is clipped to 5 internally
    const opts = generateDimensionOptionsWithStep(600, 1);
    expect(Array.isArray(opts)).toBe(true);
    // lengths should be multiples of 5
    for (const opt of opts) {
      expect(opt.length % 5).toBe(0);
    }
  });

  test('options have valid ratio', () => {
    const opts = generateDimensionOptionsWithStep(1400, 10);
    for (const opt of opts) {
      const ratio = opt.length / opt.width;
      expect(ratio).toBeGreaterThanOrEqual(0.33 - 0.01);
      expect(ratio).toBeLessThanOrEqual(3 + 0.01);
    }
  });

  test('recursion terminates: very small area, small step', () => {
    const opts = generateDimensionOptionsWithStep(25, 5);
    expect(Array.isArray(opts)).toBe(true);
  });
});

// ============================================================
// calculateArmorThickness
// ============================================================

describe('calculateArmorThickness', () => {
  test('0 armor tons returns 0', () => {
    expect(calculateArmorThickness(0, 4, 30, 600, 2.5)).toBe(0);
  });

  test('0 numFloors returns 0', () => {
    expect(calculateArmorThickness(50, 0, 30, 600, 2.5)).toBe(0);
  });

  test('negative armorTons returns 0', () => {
    expect(calculateArmorThickness(-10, 4, 30, 600, 2.5)).toBe(0);
  });

  test('positive armor returns positive thickness', () => {
    const result = calculateArmorThickness(50, 4, 30, 600, 2.5);
    expect(result).toBeGreaterThan(0);
  });

  test('thickness formula: 50 tons, 4 floors, 30m len, 600m² area, 2.5m ceiling', () => {
    // armorTonsPerFloor = 50/4 = 12.5
    // armorVolume = 12.5 * 14 = 175
    // floorWidth = 600/30 = 20
    // perimeter = 2*(30+20) = 100
    // thickness = 175 / (100 * 2.5) = 0.7
    const result = calculateArmorThickness(50, 4, 30, 600, 2.5);
    expect(result).toBeCloseTo(0.7, 5);
  });

  test('more armor tonnage → thicker armor', () => {
    const thin = calculateArmorThickness(10, 4, 30, 600, 2.5);
    const thick = calculateArmorThickness(100, 4, 30, 600, 2.5);
    expect(thick).toBeGreaterThan(thin);
  });

  test('more floors → thinner armor per floor', () => {
    const twoFloors = calculateArmorThickness(50, 2, 30, 600, 2.5);
    const eightFloors = calculateArmorThickness(50, 8, 30, 600, 2.5);
    // Same total tons but spread over more floors → less per floor → same total coverage,
    // but per-floor volume is smaller so thickness is smaller
    expect(eightFloors).toBeLessThan(twoFloors);
  });
});

// ============================================================
// getCurrentFloorDimensions
// ============================================================

describe('getCurrentFloorDimensions', () => {
  beforeEach(() => {
    // Reset to known global state matching jest-setup defaults
    global.shipData.totalTons = 1000;
    global.shipData.numFloors = 4;
    global.shipData.floorLength = 30;
    global.shipData.ceilingHeight = 2.5;
  });

  test('returns object with totalArea, floorArea, floorWidth, floorLength', () => {
    const dims = getCurrentFloorDimensions();
    expect(dims).toHaveProperty('totalArea');
    expect(dims).toHaveProperty('floorArea');
    expect(dims).toHaveProperty('floorWidth');
    expect(dims).toHaveProperty('floorLength');
  });

  test('totalArea equals 1000 * 14 / 2.5 = 5600', () => {
    const dims = getCurrentFloorDimensions();
    expect(dims.totalArea).toBeCloseTo(5600);
  });

  test('floorArea equals totalArea / numFloors = 1400', () => {
    const dims = getCurrentFloorDimensions();
    expect(dims.floorArea).toBeCloseTo(1400);
  });

  test('floorWidth equals floorArea / floorLength ≈ 46.67', () => {
    const dims = getCurrentFloorDimensions();
    expect(dims.floorWidth).toBeCloseTo(1400 / 30);
  });

  test('floorLength matches shipData.floorLength', () => {
    const dims = getCurrentFloorDimensions();
    expect(dims.floorLength).toBe(30);
  });

  test('reflects changes to global shipData', () => {
    global.shipData.totalTons = 500;
    global.shipData.numFloors = 2;
    const dims = getCurrentFloorDimensions();
    expect(dims.totalArea).toBeCloseTo(500 * 14 / 2.5);
    expect(dims.floorArea).toBeCloseTo((500 * 14 / 2.5) / 2);
  });
});
