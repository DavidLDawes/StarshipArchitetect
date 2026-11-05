'use strict';

const {
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  baseItemName,
  buildComponentKeys,
  serializeLayout,
  parseLayout,
  sameDesignCsv,
  restorePlacements,
  compareFloorGeometry
} = require('../../src/layout-io');
const { exportLayoutSvg, escapeXml, exportLabel } = require('../../src/layout-export');
const { parseCSV } = require('../../src/csv-parser');

const CSV = [
  'Category,Item,Tons,Cost',
  'Fittings,Bridge,20,5',
  'Crew,Staterooms x10,40,5',
  'Weapons,Triple Turret (Beam Lasers),1,4',
  'Weapons,Triple Turret (Beam Lasers),1,4',
  'Cargo,Cargo Hold,100,0',
  'Total,Total,400,100'
].join('\n');

function makeShip(overrides = {}) {
  const { components } = parseCSV(CSV);
  return {
    shipName: 'Test Ship',
    totalTons: 400,
    totalCost: 100,
    originalCsv: CSV,
    components,
    numFloors: 2,
    floorLength: 20,
    floorWidth: 30,
    ceilingHeight: 2.5,
    armorTons: 0,
    armorThickness: 0,
    combineRecHealth: false,
    componentPlacements: {
      0: { floors: [{ floor: 1, x: 0, y: 5, length: 6, width: 5 }] },
      1: { floors: [
        { floor: 1, x: 6, y: 5, length: 10, width: 8, count: 6 },
        { floor: 2, x: 0, y: 10, length: 8, width: 6, count: 4,
          rects: [{ x: 0, y: 10, length: 8, width: 3 }, { x: 0, y: 13, length: 4, width: 3 }] }
      ] },
      3: { floors: [{ floor: 2, x: 0, y: 0, length: 2, width: 2 }] }
    },
    ...overrides
  };
}

const FLOOR = { count: 2, length: 20, width: 30, armorThickness: 0 };

// Round-trip a ship through JSON text
const roundTrip = ship => parseLayout(JSON.stringify(serializeLayout(ship, new Date('2026-11-02T10:00:00Z'))));

// ============================================================
// Keys
// ============================================================

describe('component keys', () => {
  test('category|item|n, counting repeated rows', () => {
    const keys = buildComponentKeys(makeShip().components);
    expect(keys).toEqual([
      'Fittings|Bridge|0',
      'Crew|Staterooms x10|0',
      'Weapons|Triple Turret (Beam Lasers)|0',
      'Weapons|Triple Turret (Beam Lasers)|1',
      'Cargo|Cargo Hold|0'
    ]);
  });

  test('baseItemName drops quantity suffixes', () => {
    expect(baseItemName({ item: 'Staterooms (x140)' })).toBe('Staterooms');
    expect(baseItemName({ item: 'Staterooms x10' })).toBe('Staterooms');
    expect(baseItemName({ itemName: 'Gym', item: 'Gym (x2)' })).toBe('Gym');
  });
});

// ============================================================
// Saving
// ============================================================

describe('serializeLayout', () => {
  const layout = serializeLayout(makeShip(), new Date('2026-11-02T10:00:00Z'));

  test('header, ship, floors, options', () => {
    expect(layout).toMatchObject({
      format: LAYOUT_FORMAT,
      version: LAYOUT_VERSION,
      savedAt: '2026-11-02T10:00:00.000Z',
      ship: { name: 'Test Ship', totalTons: 400, totalCost: 100, csv: CSV },
      floors: { count: 2, length: 20, ceilingHeight: 2.5, width: 30, armorTons: 0, armorThickness: 0 },
      options: { combineRecHealth: false }
    });
  });

  test('placements by key, with count and rects only when needed', () => {
    expect(layout.placements.map(p => p.component)).toEqual([
      'Fittings|Bridge|0', 'Crew|Staterooms x10|0', 'Weapons|Triple Turret (Beam Lasers)|1'
    ]);
    const [bridge, staterooms] = layout.placements;
    expect(bridge.entries[0]).toEqual({ floor: 1, x: 0, y: 5, length: 6, width: 5 });
    expect(staterooms.entries[0]).toEqual({ floor: 1, x: 6, y: 5, length: 10, width: 8, count: 6 });
    expect(staterooms.entries[1].rects).toHaveLength(2);
  });

  test('does not share objects with the ship state', () => {
    const ship = makeShip();
    const l = serializeLayout(ship);
    l.placements[1].entries[1].rects[0].x = 99;
    expect(ship.componentPlacements[1].floors[1].rects[0].x).toBe(0);
  });
});

// ============================================================
// Parsing
// ============================================================

describe('parseLayout', () => {
  const valid = () => serializeLayout(makeShip());

  test('accepts its own output', () => {
    expect(() => parseLayout(JSON.stringify(valid()))).not.toThrow();
  });

  test.each([
    ['not JSON', 'nope', /not valid JSON/],
    ['wrong format', JSON.stringify({ format: 'other' }), /not a Starship Architect layout/],
    ['newer version', JSON.stringify({ ...valid(), version: LAYOUT_VERSION + 1 }), /newer version/],
    ['no version', JSON.stringify({ ...valid(), version: 'x' }), /version/],
    ['no design', JSON.stringify({ ...valid(), ship: { csv: '' } }), /ship design/],
    ['bad floors', JSON.stringify({ ...valid(), floors: { count: 0, length: 20, ceilingHeight: 2.5 } }), /floor settings/]
  ])('rejects %s', (_, text, message) => {
    expect(() => parseLayout(text)).toThrow(message);
  });

  test('missing placements and options become empty', () => {
    const l = valid();
    delete l.placements;
    delete l.options;
    const parsed = parseLayout(JSON.stringify(l));
    expect(parsed.placements).toEqual([]);
    expect(parsed.options).toEqual({});
  });
});

describe('sameDesignCsv', () => {
  test('ignores line endings and trailing whitespace', () => {
    expect(sameDesignCsv('a,b\r\nc,d  \r\n', 'a,b\nc,d')).toBe(true);
    expect(sameDesignCsv('a,b\nc,d', 'a,b\nc,e')).toBe(false);
  });
});

// ============================================================
// Restoring
// ============================================================

describe('restorePlacements: same design', () => {
  test('round trip restores everything exactly', () => {
    const ship = makeShip();
    const { placements, problems, restored, dropped } = restorePlacements(roundTrip(ship), ship.components, FLOOR);
    expect(problems).toEqual([]);
    expect(restored).toBe(4);
    expect(dropped).toBe(0);
    expect(placements).toEqual(ship.componentPlacements);
  });

  test('duplicate rows keep their own placements', () => {
    const ship = makeShip();
    const { placements } = restorePlacements(roundTrip(ship), ship.components, FLOOR);
    expect(placements[2]).toBeUndefined();
    expect(placements[3].floors).toHaveLength(1);
  });
});

describe('restorePlacements: tolerant', () => {
  const layout = roundTrip(makeShip());
  const revised = csv => parseCSV(csv).components;

  test('matches a changed quantity by name and trims blocks to what is left', () => {
    const components = revised(CSV.replace('Staterooms x10,40', 'Staterooms x8,32'));
    const { placements, problems } = restorePlacements(layout, components, FLOOR);
    // 6 + 4 saved, only 8 now: the second block is trimmed to 2
    expect(placements[1].floors.map(e => e.count)).toEqual([6, 2]);
    expect(problems.join(' ')).toMatch(/held 4 items; only 2 remain/);
  });

  test('matches an item moved to another category', () => {
    const components = revised(CSV.replace('Fittings,Bridge', 'Control,Bridge'));
    const { placements, problems } = restorePlacements(layout, components, FLOOR);
    expect(placements[0].floors).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test('reports components that are gone', () => {
    const components = revised(CSV.replace('Fittings,Bridge,20,5\n', ''));
    const { placements, problems, dropped } = restorePlacements(layout, components, FLOOR);
    expect(problems.join(' ')).toMatch(/"Bridge" is not in this ship design; 1 placed item not restored/);
    expect(dropped).toBe(1);
    // Everything else lands on the right (re-indexed) components
    const names = Object.keys(placements).map(i => components[i].item);
    expect(names.sort()).toEqual(['Staterooms x10', 'Triple Turret (Beam Lasers)']);
  });

  test('drops entries on floors that no longer exist', () => {
    const { placements, problems } = restorePlacements(layout, makeShip().components, { ...FLOOR, count: 1 });
    expect(Object.values(placements).flatMap(p => p.floors).every(e => e.floor === 1)).toBe(true);
    expect(problems.some(p => /floor 2, but the ship has 1 floor/.test(p))).toBe(true);
  });

  test('drops entries that no longer fit inside the armor', () => {
    const { problems } = restorePlacements(layout, makeShip().components, { ...FLOOR, armorThickness: 0.5 });
    expect(problems.some(p => /no longer fits inside the hull and armor/.test(p))).toBe(true);
  });

  test('drops hull components that no longer touch the hull', () => {
    const ship = makeShip();
    ship.componentPlacements[3].floors[0] = { floor: 2, x: 5, y: 5, length: 2, width: 2 };
    const { placements, problems } = restorePlacements(roundTrip(ship), ship.components, FLOOR);
    expect(placements[3]).toBeUndefined();
    expect(problems.some(p => /no longer touches the outer hull/.test(p))).toBe(true);
  });

  test('drops overlapping entries', () => {
    const ship = makeShip();
    ship.componentPlacements[4] = { floors: [{ floor: 1, x: 2, y: 6, length: 5, width: 5 }] };
    const { placements, problems } = restorePlacements(roundTrip(ship), ship.components, FLOOR);
    expect(placements[4]).toBeUndefined();
    expect(problems.some(p => /Cargo Hold.*overlaps another component/.test(p))).toBe(true);
  });

  test('skips damaged entries', () => {
    const l = roundTrip(makeShip());
    l.placements[0].entries.push({ floor: 1, x: 'a', y: 0, length: 1, width: 1 });
    l.placements[0].entries.push({ floor: 1, x: 0, y: 0, length: 1, width: 1, rects: [] });
    const { problems, dropped } = restorePlacements(l, makeShip().components, FLOOR);
    expect(problems.filter(p => /damaged/.test(p))).toHaveLength(2);
    expect(dropped).toBe(2);
  });
});

describe('compareFloorGeometry', () => {
  test('notes width and armor changes', () => {
    const layout = roundTrip(makeShip());
    expect(compareFloorGeometry(layout, FLOOR)).toEqual([]);
    const notes = compareFloorGeometry(layout, { ...FLOOR, width: 32, armorThickness: 0.3 });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/32\.0 m wide/);
  });
});

// ============================================================
// SVG export
// ============================================================

describe('exportLayoutSvg', () => {
  const svg = exportLayoutSvg(makeShip());

  test('is an SVG document sized in mm at 1:100 with a meter viewBox', () => {
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toMatch(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    const [, w, h, vw, vh] = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    expect(Number(w)).toBeCloseTo(Number(vw) * 10);
    expect(Number(h)).toBeCloseTo(Number(vh) * 10);
  });

  test('one layer per floor', () => {
    expect(svg.match(/inkscape:groupmode="layer"/g)).toHaveLength(2);
    expect(svg).toContain('inkscape:label="Floor 1"');
    expect(svg).toContain('inkscape:label="Floor 2"');
  });

  test('one group per placement, one rect per piece, with data attributes', () => {
    expect(svg.match(/class="placement"/g)).toHaveLength(4);
    // 4 placements, one with 2 rects, plus 2 hull outlines and the background
    expect(svg.match(/<rect /g)).toHaveLength(5 + 2 + 1);
    expect(svg).toContain('data-component="Crew|Staterooms x10|0"');
    expect(svg).toContain('data-count="6"');
    expect(svg).toContain('<rect x="6" y="5" width="10" height="8"');
  });

  test('tags are balanced', () => {
    const opens = (svg.match(/<(g|svg|title|desc|text)[\s>]/g) || []).length;
    const closes = (svg.match(/<\/(g|svg|title|desc|text)>/g) || []).length;
    expect(opens).toBe(closes);
  });

  test('armor band only when there is armor', () => {
    expect(svg).not.toContain('class="armor"');
    expect(exportLayoutSvg(makeShip({ armorThickness: 0.5 }))).toContain('class="armor"');
  });

  test('single floor and custom scale', () => {
    const one = exportLayoutSvg(makeShip(), { floors: [2], mmPerMeter: 5 });
    expect(one.match(/inkscape:groupmode="layer"/g)).toHaveLength(1);
    expect(one).toContain('printed scale 1:200');
  });

  test('text is escaped', () => {
    expect(escapeXml('A & B <"x">')).toBe('A &amp; B &lt;&quot;x&quot;&gt;');
    const ship = makeShip({ shipName: 'R&D <One>' });
    expect(exportLayoutSvg(ship)).toContain('R&amp;D &lt;One&gt;');
  });

  test('tall narrow shapes get rotated labels', () => {
    const ship = makeShip();
    ship.componentPlacements = { 1: { floors: [{ floor: 1, x: 0, y: 0, length: 2, width: 20, count: 10 }] } };
    expect(exportLayoutSvg(ship)).toMatch(/<text x="[\d.]+" y="[\d.]+" transform="rotate\(-90 /);
  });

  test('headings round sizes', () => {
    expect(exportLayoutSvg(makeShip({ floorWidth: 103.70370 }))).toContain('Floor 1 — 20 × 103.7 m');
  });

  test('labels', () => {
    expect(exportLabel({ item: 'Staterooms x10' }, 6)).toBe('Staterooms ×6');
    expect(exportLabel({ item: 'Staterooms x10', overheadPerItem: 0.2 }, 6)).toBe('Staterooms + rec ×6');
    expect(exportLabel({ item: 'Bridge' }, 1)).toBe('Bridge');
  });
});

// ============================================================
// exportLayoutSvg on shaped hulls
// ============================================================

describe('exportLayoutSvg on shaped hulls', () => {
  const { buildFloorGeometry } = require('../../src/hull-shapes');
  const shapedShip = (shape, armorTons = 0) => {
    const geometry = buildFloorGeometry({ shape, totalTons: 1000, ceilingHeight: 2.5, numFloors: 4, armorTons });
    return {
      shipName: 'Test',
      totalTons: 1000,
      numFloors: 4,
      ceilingHeight: 2.5,
      floorLength: geometry.length,
      floorWidth: geometry.width,
      armorThickness: geometry.armorThickness,
      components: [],
      componentPlacements: {},
      geometry,
    };
  };

  test('draws each floor\'s own hull outline', () => {
    const svg = exportLayoutSvg(shapedShip('cone'));
    const hulls = svg.match(/<path class="hull" d="M[^"]+Z"/g);
    expect(hulls).toHaveLength(4);
    expect(new Set(hulls).size).toBe(4);
    expect(svg).not.toContain('<rect class="hull"');
  });

  test('floor headers give each floor\'s own size', () => {
    const ship = shapedShip('cone');
    const svg = exportLayoutSvg(ship);
    const { describeFloorSize } = require('../../src/hull-shapes');
    for (const floor of ship.geometry.floors) {
      expect(svg).toContain(`Floor ${floor.floor} — ${describeFloorSize(floor, 'cone')}`);
    }
  });

  test('the armor band has both the hull and its inner face', () => {
    const svg = exportLayoutSvg(shapedShip('lifting-body', 20));
    const armor = svg.match(/<path class="armor"[^>]* d="([^"]+)"/g);
    expect(armor).toHaveLength(4);
    expect(armor[0].match(/M/g)).toHaveLength(2);
  });

  test('a floor the armor fills is drawn solid', () => {
    const ship = shapedShip('cone', 2000);
    expect(ship.geometry.floors[3].inner).toEqual([]);
    const armor = exportLayoutSvg(ship).match(/<path class="armor"[^>]* d="([^"]+)"/g);
    expect(armor[3].match(/M/g)).toHaveLength(1);
  });

  test('the description names the shape', () => {
    expect(exportLayoutSvg(shapedShip('wing'))).toContain('4 floors, wing hull');
  });

  test('rectangular ships are drawn as before even with geometry supplied', () => {
    const ship = shapedShip('rectangular');
    const withGeometry = exportLayoutSvg(ship);
    const without = exportLayoutSvg({ ...ship, geometry: undefined });
    expect(withGeometry).toBe(without);
    expect(withGeometry).toContain('<rect class="hull"');
  });
});

// ============================================================
// Hull shapes in layouts
// ============================================================

describe('layouts on shaped hulls', () => {
  const {
    getLayoutHullShape,
    migrateLayout,
    restorePlacements,
    serializeLayout,
    parseLayout,
    LAYOUT_VERSION
  } = require('../../src/layout-io');
  const { recalculateFloors, getCurrentFloorDimensions, getShipGeometry } = require('../../src/floor-utils');
  const { getShapedInner, planFloorExposedFill, snapToFloorHull, touchesFloorHull } = require('../../src/hull-access');
  const { analyzeFloorFreeSpace, planFloorFill } = require('../../src/placement-geometry');
  const { getRectFitRegion, isRectInConvexPolygon } = require('../../src/hull-shapes');

  const SHAPES = ['wedge', 'cone', 'sphere', 'cylinder', 'wing', 'disk', 'lifting-body'];
  const room = { category: 'Berths', item: 'Staterooms', itemName: 'Staterooms', quantity: 200, tons: 800, tonsPerItem: 4 };
  const turret = { category: 'Weapons', item: 'Triple Turret', itemName: 'Triple Turret', quantity: 40, tons: 40, tonsPerItem: 1 };

  function setShip(shape, armorTons = 40) {
    Object.assign(global.shipData, {
      hullShape: shape,
      totalTons: 1000,
      numFloors: 5,
      armorTons,
      ceilingHeight: 2.5,
      floorLength: 30,
      components: [room, turret],
      componentPlacements: {},
      originalCsv: 'x',
      shipName: 'Test'
    });
    recalculateFloors({ resetLength: true });
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    return { count: 5, length: floorLength, width: floorWidth, armorThickness: global.shipData.armorThickness };
  }

  const makeLayout = entries => ({
    placements: Object.entries(entries).map(([i, list]) => ({
      component: i === '0' ? 'Berths|Staterooms|0' : 'Weapons|Triple Turret|0',
      item: i === '0' ? room.item : turret.item,
      entries: list
    }))
  });

  afterAll(() => {
    Object.assign(global.shipData, { totalTons: 1000, armorTons: 0, numFloors: 4, floorLength: 30, components: [], componentPlacements: {} });
    delete global.shipData.hullShape;
    recalculateFloors();
  });

  describe('format', () => {
    test('saves the shape', () => {
      const floor = setShip('disk');
      const layout = serializeLayout({ ...global.shipData, floorWidth: floor.width });
      expect(layout.version).toBe(LAYOUT_VERSION);
      expect(layout.floors.shape).toBe('disk');
    });

    test('a ship without a shape saves as rectangular', () => {
      const layout = serializeLayout({ components: [], componentPlacements: {}, numFloors: 1, floorLength: 10, ceilingHeight: 2.5 });
      expect(layout.floors.shape).toBe('rectangular');
    });

    test('version 1 becomes rectangular, even when its design names a shape', () => {
      const csv = 'Courier, Streamlined Lifting Body configuration, 300 tons, Tech Level G';
      const v1 = { format: 'starship-architect-layout', version: 1, ship: { csv }, floors: { count: 2, length: 10, ceilingHeight: 2.5 }, placements: [] };
      const layout = parseLayout(JSON.stringify(v1));
      expect(layout.version).toBe(LAYOUT_VERSION);
      expect(layout.floors.shape).toBe('rectangular');
      expect(layout.floors.count).toBe(2);
      expect(v1.version).toBe(1);
    });

    test('migration leaves a damaged file for validation to report', () => {
      const v1 = { format: 'starship-architect-layout', version: 1, ship: { csv: 'x' }, placements: [] };
      expect(migrateLayout(v1).floors).toBeUndefined();
      expect(() => parseLayout(JSON.stringify(v1))).toThrow(/invalid floor settings/);
    });

    test('the current version is left alone', () => {
      const current = { version: LAYOUT_VERSION, floors: { shape: 'cone' } };
      expect(migrateLayout(current)).toBe(current);
    });

    test.each(SHAPES.concat('rectangular'))('%s opens as itself', shape => {
      expect(getLayoutHullShape({ floors: { shape } })).toEqual({ shape, problem: null });
    });

    test.each([['distributed'], ['nonsense'], [undefined], [7]])('%s opens as rectangular and says so', shape => {
      const result = getLayoutHullShape({ floors: { shape } });
      expect(result.shape).toBe('rectangular');
      expect(result.problem).toMatch(/isn't available/);
    });
  });

  describe.each(SHAPES)('restoring on a %s hull', shape => {
    test('rooms, weapons and regions all come back', () => {
      const floor = setShip(shape);
      const placements = {};
      const inner = getShapedInner(2);

      // A ring of weapons on the wall
      const { length, width, armorThickness } = floor;
      const ring = planFloorExposedFill(2, [], 1.5, 1.5, 12, length, width, armorThickness);
      expect(ring.length).toBeGreaterThan(0);
      placements[1] = { floors: ring.map(a => ({ floor: 2, ...a.bbox, ...(a.count > 1 ? { count: a.count } : {}) })) };
      global.shipData.componentPlacements = placements;

      // Free space filled as a region, on the same deck
      const analysis = analyzeFloorFreeSpace(2, length, width, armorThickness);
      const plan = planFloorFill(analysis.regions, 22.4, 3);
      placements[0] = { floors: plan.map(a => ({ floor: 2, ...a.bbox, count: a.count, rects: a.rects })) };

      // A plain room on another deck
      const box = getShipGeometry().floors[2].bounds;
      placements[0].floors.push({ floor: 3, x: box.x + box.length / 2, y: box.y + box.width / 2, length: 1, width: 1 });

      const layout = parseLayout(JSON.stringify({
        ...serializeLayout({ ...global.shipData, floorWidth: width }),
        ship: { csv: 'x' }
      }));
      const result = restorePlacements(layout, global.shipData.components, floor);

      expect(result.problems).toEqual([]);
      expect(result.dropped).toBe(0);
      expect(result.placements[1].floors).toEqual(placements[1].floors);
      expect(result.placements[0].floors).toEqual(placements[0].floors);
      expect(isRectInConvexPolygon(inner, ring[0].bbox.x, ring[0].bbox.y, ring[0].bbox.length, ring[0].bbox.width)).toBe(true);
    });

    test('a room that no longer fits this deck is reported', () => {
      const floor = setShip(shape);
      const huge = Math.max(floor.length, floor.width) + 1;
      const result = restorePlacements(makeLayout({ 0: [{ floor: 1, x: 0, y: 0, length: huge, width: 1 }] }), [room, turret], floor);
      expect(result.restored).toBe(0);
      expect(result.problems[0]).toMatch(/no longer fits/);
    });

    test('a weapon away from the wall is reported', () => {
      const floor = setShip(shape);
      const box = getShipGeometry().floors[1].bounds;
      const x = box.x + box.length / 2 - 0.5;
      const y = box.y + box.width / 2 - 0.5;
      const result = restorePlacements(makeLayout({ 1: [{ floor: 2, x, y, length: 1, width: 1 }] }), [room, turret], floor);
      expect(result.restored).toBe(0);
      expect(result.problems[0]).toMatch(/no longer touches/);
    });
  });

  describe('curved decks', () => {
    test('a room past the wall is dropped, where a rectangular check would keep it', () => {
      const floor = setShip('disk', 0);
      const entry = { floor: 1, x: 0, y: 0, length: 2, width: 2 };
      const result = restorePlacements(makeLayout({ 0: [entry] }), [room, turret], floor);
      expect(result.restored).toBe(0);
      expect(result.problems[0]).toMatch(/no longer fits/);

      const rectangular = setShip('rectangular', 0);
      expect(restorePlacements(makeLayout({ 0: [entry] }), [room, turret], rectangular).restored).toBe(1);
    });

    // A 2 m room whose top left corner is this far past the wall of a disk deck
    function roomPastWall(floor, past) {
      const radius = floor.length / 2;
      const offset = radius - (radius + past) * Math.SQRT1_2;
      return { floor: 1, x: offset, y: offset, length: 2, width: 2 };
    }
    const asRegion = e => ({ ...e, count: 1, rects: [{ x: e.x, y: e.y, length: e.length, width: e.width }] });

    test('a region may poke past the wall by part of a band, but no further', () => {
      const floor = setShip('disk', 0);
      const near = asRegion(roomPastWall(floor, 0.3));
      expect(isRectInConvexPolygon(getShapedInner(1), near.x, near.y, 2, 2)).toBe(false);
      expect(restorePlacements(makeLayout({ 0: [near] }), [room, turret], floor).restored).toBe(1);

      const far = asRegion(roomPastWall(floor, 0.7));
      expect(restorePlacements(makeLayout({ 0: [far] }), [room, turret], floor).restored).toBe(0);
    });

    test('a plain room gets no such allowance', () => {
      const floor = setShip('disk', 0);
      const near = roomPastWall(floor, 0.3);
      expect(restorePlacements(makeLayout({ 0: [near] }), [room, turret], floor).restored).toBe(0);
    });

    test('real regions on a curved deck stay within that allowance', () => {
      for (const shape of ['cone', 'sphere', 'wing', 'disk', 'lifting-body']) {
        const floor = setShip(shape);
        for (let f = 1; f <= 5; f++) {
          const inner = getShapedInner(f);
          const { regions } = analyzeFloorFreeSpace(f, floor.length, floor.width, floor.armorThickness);
          for (const r of regions.flatMap(region => region.rects)) {
            expect(isRectInConvexPolygon(inner, r.x, r.y, r.length, r.width, 0.5)).toBe(true);
          }
        }
      }
    });

    test('a weapon spanning floors only has to touch the hull on one of them', () => {
      const floor = setShip('cone');
      const { length: L, width: W, armorThickness: a } = floor;
      const floors = [1, 2];
      expect(getRectFitRegion(getShapedInner(floors), 2, 2).length).toBeGreaterThan(0);
      const p = snapToFloorHull(floors, 0, 0, 2, 2, L, W, a);
      const entries = floors.map(f => ({ floor: f, x: p.x, y: p.y, length: 2, width: 2 }));
      expect(touchesFloorHull(1, p.x, p.y, 2, 2, L, W, a)).toBe(false);
      expect(touchesFloorHull(2, p.x, p.y, 2, 2, L, W, a)).toBe(true);

      const result = restorePlacements(makeLayout({ 1: entries }), [room, turret], floor);
      expect(result.problems).toEqual([]);
      expect(result.restored).toBe(2);
    });

    test('that allowance needs a real entry on the floor that touches', () => {
      const floor = setShip('cone');
      const { length: L, width: W, armorThickness: a } = floor;
      const p = snapToFloorHull([1, 2], 0, 0, 2, 2, L, W, a);
      const onlyInside = [{ floor: 1, x: p.x, y: p.y, length: 2, width: 2 }];
      const result = restorePlacements(makeLayout({ 1: onlyInside }), [room, turret], floor);
      expect(result.restored).toBe(0);
    });

    test('a deck the armor used up holds nothing', () => {
      Object.assign(global.shipData, { hullShape: 'cone', totalTons: 90, numFloors: 4, armorTons: 90, ceilingHeight: 2.5, floorLength: 30 });
      recalculateFloors({ resetLength: true });
      const { floorLength, floorWidth } = getCurrentFloorDimensions();
      const floor = { count: 4, length: floorLength, width: floorWidth, armorThickness: global.shipData.armorThickness };
      expect(getShapedInner(4)).toEqual([]);
      const result = restorePlacements(makeLayout({ 0: [{ floor: 4, x: 1, y: 1, length: 1, width: 1 }] }), [room, turret], floor);
      expect(result.restored).toBe(0);
      expect(result.problems[0]).toMatch(/no longer fits/);
    });
  });
});
