'use strict';

const {
  calculateTotalFloorArea,
  calculateFloorArea,
  calculateDefaultFloorLength,
  calculateFloorWidth,
  generateDimensionOptions,
  generateDimensionOptionsWithStep,
  calculateArmorThickness,
  getShipGeometry,
  getFloorGeometry,
  getUnusableFloors,
  recalculateFloors,
  getFloorAreaRange,
  getFrameWidthAtLength,
  getHullDimensionOptions,
  getCurrentFloorDimensions
} = require('../../src/floor-utils');
const { polygonArea, circlePolygon, getDefaultHullLength } = require('../../src/hull-shapes');

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
    expect(calculateArmorThickness(0, 400, 2.5)).toBe(0);
  });

  test('0 perimeter returns 0', () => {
    expect(calculateArmorThickness(50, 0, 2.5)).toBe(0);
  });

  test('negative armorTons returns 0', () => {
    expect(calculateArmorThickness(-10, 400, 2.5)).toBe(0);
  });

  test('positive armor returns positive thickness', () => {
    expect(calculateArmorThickness(50, 400, 2.5)).toBeGreaterThan(0);
  });

  test('thickness formula: 50 tons, 4 floors of 30 × 20 m, 2.5m ceiling', () => {
    // armorVolume = 50 * 14 = 700
    // totalPerimeter = 4 * 2*(30+20) = 400
    // thickness = 700 / (400 * 2.5) = 0.7
    expect(calculateArmorThickness(50, 400, 2.5)).toBeCloseTo(0.7, 5);
  });

  test('more armor tonnage → thicker armor', () => {
    expect(calculateArmorThickness(100, 400, 2.5)).toBeGreaterThan(calculateArmorThickness(10, 400, 2.5));
  });

  test('more wall to cover → thinner armor', () => {
    expect(calculateArmorThickness(50, 800, 2.5)).toBeLessThan(calculateArmorThickness(50, 200, 2.5));
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

  test('length and width are the shared frame on a shaped hull', () => {
    global.shipData.hullShape = 'lifting-body';
    const dims = getCurrentFloorDimensions();
    const geometry = getShipGeometry();
    expect(dims.floorLength).toBe(geometry.length);
    expect(dims.floorWidth).toBe(geometry.width);
    expect(dims.totalArea).toBeCloseTo(5600);
    delete global.shipData.hullShape;
  });
});

// ============================================================
// Current ship geometry
// ============================================================

describe('current ship geometry', () => {
  beforeEach(() => {
    global.shipData.totalTons = 1000;
    global.shipData.numFloors = 4;
    global.shipData.floorLength = 30;
    global.shipData.ceilingHeight = 2.5;
    global.shipData.armorTons = 0;
    global.shipData.armorThickness = 0;
    delete global.shipData.hullShape;
  });

  afterAll(() => {
    global.shipData.armorTons = 0;
    global.shipData.armorThickness = 0;
    delete global.shipData.hullShape;
  });

  describe('getShipGeometry', () => {
    test('a ship with no shape set is rectangular', () => {
      expect(getShipGeometry().shape).toBe('rectangular');
    });

    test('reuses the result until a setting changes', () => {
      const first = getShipGeometry();
      expect(getShipGeometry()).toBe(first);
    });

    test.each([
      ['totalTons', 500],
      ['numFloors', 2],
      ['floorLength', 40],
      ['ceilingHeight', 3],
      ['armorTons', 10],
      ['hullShape', 'disk'],
    ])('rebuilds when %s changes', (setting, value) => {
      const first = getShipGeometry();
      global.shipData[setting] = value;
      expect(getShipGeometry()).not.toBe(first);
    });
  });

  describe('getFloorGeometry', () => {
    test('returns the requested floor', () => {
      expect(getFloorGeometry(1).floor).toBe(1);
      expect(getFloorGeometry(4).floor).toBe(4);
    });

    test('floors differ on a shaped hull', () => {
      global.shipData.hullShape = 'cone';
      expect(getFloorGeometry(1).area).toBeGreaterThan(getFloorGeometry(4).area);
    });

    test('a floor that does not exist is null', () => {
      expect(getFloorGeometry(0)).toBeNull();
      expect(getFloorGeometry(5)).toBeNull();
    });
  });

  describe('getUnusableFloors', () => {
    test('no armor means every floor is usable', () => {
      expect(getUnusableFloors()).toEqual([]);
    });

    test('lists floors the armor fills', () => {
      global.shipData.totalTons = 4;
      global.shipData.numFloors = 2;
      global.shipData.floorLength = 5;
      global.shipData.armorTons = 400;
      expect(getUnusableFloors()).toEqual([1, 2]);
    });

    test('can list only the smallest floors of a shaped hull', () => {
      global.shipData.hullShape = 'cone';
      global.shipData.totalTons = 90;
      global.shipData.armorTons = 90;
      const unusable = getUnusableFloors();
      expect(unusable).toContain(4);
      expect(unusable).not.toContain(1);
    });
  });

  describe('getFloorAreaRange', () => {
    test('equal floors have one size', () => {
      expect(getFloorAreaRange().min).toBeCloseTo(1400);
      expect(getFloorAreaRange().max).toBeCloseTo(1400);
    });

    test('a shaped hull reports its smallest and largest floors', () => {
      global.shipData.hullShape = 'cone';
      const { floors } = getShipGeometry();
      expect(getFloorAreaRange().max).toBeCloseTo(floors[0].area);
      expect(getFloorAreaRange().min).toBeCloseTo(floors[3].area);
    });
  });

  describe('getFrameWidthAtLength', () => {
    test('rectangular floors match the area over the length', () => {
      expect(getFrameWidthAtLength(40)).toBe(1400 / 40);
    });

    test('matches the geometry the ship gets at that length', () => {
      global.shipData.hullShape = 'wing';
      global.shipData.floorLength = 55;
      expect(getFrameWidthAtLength(55)).toBeCloseTo(getShipGeometry().width);
    });

    test('ignores armor, like the floor outline itself', () => {
      const before = getFrameWidthAtLength(40);
      global.shipData.armorTons = 50;
      expect(getFrameWidthAtLength(40)).toBe(before);
    });
  });

  describe('getHullDimensionOptions', () => {
    test('rectangular floors keep the existing choices', () => {
      expect(getHullDimensionOptions(1400)).toEqual(generateDimensionOptions(1400));
    });

    test('a shape that sets its own length has one choice', () => {
      global.shipData.hullShape = 'disk';
      const options = getHullDimensionOptions(1400);
      const { length, width } = getShipGeometry();
      expect(options).toHaveLength(1);
      expect(options[0]).toMatchObject({ length, width });
      expect(options[0].label).toContain('set by shape');
    });

    test.each(['wedge', 'cylinder', 'wing'])('%s widths come from its own geometry', (shape) => {
      global.shipData.hullShape = shape;
      const options = getHullDimensionOptions(1400);
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.width).toBeCloseTo(getFrameWidthAtLength(option.length));
        expect(option.label).toBe(`${option.length} × ${option.width.toFixed(1)} m`);
      }
    });
  });

  describe('recalculateFloors', () => {
    test('keeps the chosen length by default', () => {
      global.shipData.floorLength = 37;
      recalculateFloors();
      expect(global.shipData.floorLength).toBe(37);
    });

    test('resets to the default length when asked', () => {
      global.shipData.floorLength = 37;
      recalculateFloors({ resetLength: true });
      expect(global.shipData.floorLength).toBe(30);
    });

    test('updates the armor thickness', () => {
      global.shipData.armorTons = 20;
      recalculateFloors();
      expect(global.shipData.armorThickness).toBe(getShipGeometry().armorThickness);
      expect(global.shipData.armorThickness).toBeGreaterThan(0);
    });

    test('a shape that sets its own length overrides the chosen one', () => {
      global.shipData.hullShape = 'disk';
      global.shipData.floorLength = 37;
      recalculateFloors();
      expect(global.shipData.floorLength).toBeCloseTo(Math.sqrt((1400 / polygonArea(circlePolygon(0, 0, 1)))) * 2, 8);
      expect(getCurrentFloorDimensions().floorLength).toBe(global.shipData.floorLength);
    });

    test('a shape with a free length can reset to its own default', () => {
      global.shipData.hullShape = 'wedge';
      global.shipData.floorLength = 37;
      recalculateFloors({ resetLength: true });
      expect(global.shipData.floorLength).toBe(getDefaultHullLength('wedge', 5600, 4));
    });

    // The formulas the app used before hull shapes, written out so a change to
    // rectangular ships can't go unnoticed
    describe('rectangular ships match the previous calculations', () => {
      const previousDefaultLength = area => Math.max(5, Math.floor(Math.sqrt(area) / 10) * 10);
      const previousArmor = (armorTons, floors, length, area, ceiling) =>
        (armorTons <= 0 ? 0 : ((armorTons / floors) * 14) / (2 * (length + area / length) * ceiling));

      const ships = [[90, 11.25], [300, 0], [1000, 10], [5000, 0], [100000, 2500]];
      const floorCounts = [1, 2, 3, 4, 7, 12, 20];
      const ceilings = [2, 2.5, 3.3];

      test.each(ships)('%d tons with %d tons of armor', (tons, armorTons) => {
        for (const numFloors of floorCounts) {
          for (const ceilingHeight of ceilings) {
            Object.assign(global.shipData, { totalTons: tons, armorTons, numFloors, ceilingHeight });
            const floorArea = (tons * 14) / ceilingHeight / numFloors;

            // Loading a design or moving the floor slider
            recalculateFloors({ resetLength: true });
            const length = previousDefaultLength(floorArea);
            expect(global.shipData.floorLength).toBe(length);
            expect(getCurrentFloorDimensions().floorWidth).toBe(floorArea / length);
            expect(getCurrentFloorDimensions().floorArea).toBe(floorArea);
            expect(global.shipData.armorThickness)
              .toBeCloseTo(previousArmor(armorTons, numFloors, length, floorArea, ceilingHeight), 10);

            // Typing a length
            global.shipData.floorLength = 17.5;
            recalculateFloors();
            expect(global.shipData.floorLength).toBe(17.5);
            expect(getCurrentFloorDimensions().floorWidth).toBe(floorArea / 17.5);
            expect(global.shipData.armorThickness)
              .toBeCloseTo(previousArmor(armorTons, numFloors, 17.5, floorArea, ceilingHeight), 10);
          }
        }
      });
    });
  });
});
