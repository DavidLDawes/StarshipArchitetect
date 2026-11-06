'use strict';

const { recalculateFloors, getFloorGeometry, getCurrentFloorDimensions } = require('../../src/floor-utils');
const { serializeLayout, parseLayout, restorePlacements } = require('../../src/layout-io');
const { exportLayoutSvg } = require('../../src/layout-export');
const { polygonArea, getPolygonBounds, isPointInConvexPolygon, HULL_SHAPES } = require('../../src/hull-shapes');
const { getFloorUsedArea, getPlacementArea } = require('../../src/placement-geometry');
const { checkOverlap } = require('../../src/placement-logic');
const {
  getRoomOutline,
  getRoomArea,
  getRoomFields,
  getRoomShapeOptions,
  parseRoomChoice,
  isRoomClear,
  isRoomFitting,
  roomTouchesHull,
  isPointInRoom,
  positionRoom,
  findRoomSpot,
  placementsOverlap
} = require('../../src/curved-rooms');
const {
  CORNER_DIRECTIONS,
  hasRoundedHullCorners,
  getCornerRadius,
  getCornerFloor,
  getFilledCornerArea,
  cornerRoomPolygon,
  buildCornerRoom,
  switchCornerRoomWall,
  getCornerOptions
} = require('../../src/corner-rooms');

function setShip({ shape = 'lifting-body', totalTons = 1000, numFloors = 4, armorTons = 0, components = [] } = {}) {
  Object.assign(global.shipData, {
    hullShape: shape,
    totalTons,
    numFloors,
    armorTons,
    ceilingHeight: 2.5,
    floorLength: 30,
    components,
    componentPlacements: {},
    combineRecHealth: false,
    originalCsv: 'x'
  });
  recalculateFloors({ resetLength: true });
  return getCurrentFloorDimensions();
}

afterAll(() => {
  setShip({ shape: 'rectangular' });
  global.shipData.floorLength = 30;
  recalculateFloors();
  delete global.shipData.hullShape;
});

const CORNERS = Object.keys(CORNER_DIRECTIONS);
const item = (tons, extra = {}) => ({ category: 'Misc', item: 'Thing', itemName: 'Thing', tons, tonsPerItem: tons, quantity: 1, cost: 0, ...extra });
const place = (index, ...entries) => { global.shipData.componentPlacements[index] = { floors: entries }; };
const innerOf = floor => getFloorGeometry(floor).inner;
const cornersIn = options => options.filter(o => o.roomShape === 'corner');

describe('Which hulls have rounded corners', () => {
  test('only a lifting body has them', () => {
    Object.keys(HULL_SHAPES).forEach(shape => {
      setShip({ shape });
      expect(hasRoundedHullCorners()).toBe(shape === 'lifting-body');
    });
  });

  test('other hulls are not offered corner rooms', () => {
    ['rectangular', 'wedge', 'cylinder', 'cone', 'sphere', 'disk', 'wing'].forEach(shape => {
      setShip({ shape });
      expect(cornersIn(getRoomShapeOptions(item(10), 1))).toEqual([]);
    });
  });

  test('a lifting body floor has corners a quarter of its width in radius', () => {
    setShip();
    const { width } = getPolygonBounds(innerOf(1));
    expect(getCornerRadius(innerOf(1))).toBeCloseTo(width / 4, 6);
  });

  test('armor shrinks the corner', () => {
    setShip({ armorTons: 100 });
    const floor = getFloorGeometry(1);
    expect(floor.inner.length).toBeGreaterThan(0);
    expect(getCornerRadius(floor.inner)).toBeLessThan(floor.bounds.width / 4);
    expect(getCornerRadius(floor.inner)).toBeGreaterThan(0);
  });

  test('a floor with sharp corners has no radius', () => {
    expect(getCornerRadius([[0, 0], [10, 0], [10, 5], [0, 5]])).toBe(0);
    expect(getCornerRadius([])).toBe(0);
  });
});

describe('Outline', () => {
  beforeEach(() => setShip());

  test.each(CORNERS)('has exactly the area asked for, in the %s corner', cornerAt => {
    const inner = innerOf(1);
    const usable = polygonArea(inner);
    [0.02, 0.05, 0.1, 0.3, 0.6, 0.9].forEach(share => {
      ['x', 'y'].forEach(axis => {
        const outline = cornerRoomPolygon(inner, cornerAt, axis, usable * share);
        expect(polygonArea(outline)).toBeCloseTo(usable * share, 6);
      });
    });
  });

  test('stays inside the floor', () => {
    const inner = innerOf(1);
    CORNERS.forEach(cornerAt => {
      cornerRoomPolygon(inner, cornerAt, 'x', polygonArea(inner) / 5).forEach(([x, y]) => {
        expect(isPointInConvexPolygon(inner, x, y, 1e-6)).toBe(true);
      });
    });
  });

  test('sits against the walls of its own corner', () => {
    const inner = innerOf(1);
    const floorBox = getPolygonBounds(inner);
    const area = getFilledCornerArea(inner) * 3;

    const topLeft = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', 'x', area));
    expect(topLeft.x).toBeCloseTo(floorBox.x, 6);
    expect(topLeft.y).toBeCloseTo(floorBox.y, 6);

    const bottomRight = getPolygonBounds(cornerRoomPolygon(inner, 'bottom-right', 'x', area));
    expect(bottomRight.x + bottomRight.length).toBeCloseTo(floorBox.x + floorBox.length, 6);
    expect(bottomRight.y + bottomRight.width).toBeCloseTo(floorBox.y + floorBox.width, 6);
  });

  test('all four corners are the same shape', () => {
    const inner = innerOf(1);
    const area = getFilledCornerArea(inner) * 2;
    const sizes = CORNERS.map(c => getPolygonBounds(cornerRoomPolygon(inner, c, 'x', area)));
    sizes.forEach(size => {
      expect(size.length).toBeCloseTo(sizes[0].length, 6);
      expect(size.width).toBeCloseTo(sizes[0].width, 6);
    });
  });

  test('takes no more than the corner when that is enough', () => {
    const inner = innerOf(1);
    const radius = getCornerRadius(inner);
    const box = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', 'x', getFilledCornerArea(inner) * 0.7));
    expect(box.length).toBeLessThan(radius);
    expect(box.width).toBeCloseTo(box.length, 6);
  });

  test('exactly fills the corner at the corner\'s own area', () => {
    const inner = innerOf(1);
    const radius = getCornerRadius(inner);
    const box = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', 'y', getFilledCornerArea(inner)));
    expect(box.length).toBeCloseTo(radius, 4);
    expect(box.width).toBeCloseTo(radius, 4);
  });

  test('spills along the chosen wall, keeping the corner\'s depth', () => {
    const inner = innerOf(1);
    const radius = getCornerRadius(inner);
    const area = getFilledCornerArea(inner) * 2;

    const alongX = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', 'x', area));
    expect(alongX.width).toBeCloseTo(radius, 6);
    expect(alongX.length).toBeGreaterThan(radius);

    const alongY = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', 'y', area));
    expect(alongY.length).toBeCloseTo(radius, 6);
    expect(alongY.width).toBeGreaterThan(radius);
  });

  test('its far end is square, and only the corner is curved', () => {
    const inner = innerOf(1);
    const area = getFilledCornerArea(inner) * 2;
    const outline = cornerRoomPolygon(inner, 'top-left', 'x', area);
    const box = getPolygonBounds(outline);
    const atFarEnd = outline.filter(([x]) => x > box.x + box.length - 1e-6);
    expect(atFarEnd.some(([, y]) => y < box.y + 1e-6)).toBe(true);
    expect(atFarEnd.some(([, y]) => y > box.y + box.width - 1e-6)).toBe(true);
    // Its area is the rectangle less what the floor's curve takes off one corner
    const radius = getCornerRadius(inner);
    const cutOff = radius * radius - getFilledCornerArea(inner);
    expect(box.length * box.width - area).toBeCloseTo(cutOff, 6);
  });

  test('goes deeper only once it has taken the whole wall', () => {
    const inner = innerOf(1);
    const floorBox = getPolygonBounds(inner);
    const radius = getCornerRadius(inner);
    const usable = polygonArea(inner);

    const box = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', 'y', usable * 0.5));
    expect(box.width).toBeCloseTo(floorBox.width, 6);
    expect(box.length).toBeGreaterThan(radius);
  });

  test('a room as big as the floor is the floor', () => {
    const inner = innerOf(1);
    expect(polygonArea(cornerRoomPolygon(inner, 'top-left', 'x', polygonArea(inner)))).toBeCloseTo(polygonArea(inner), 6);
    expect(cornerRoomPolygon([], 'top-left', 'x', 10)).toEqual([]);
  });
});

describe('Size options', () => {
  beforeEach(() => setShip());

  test('a room bigger than the corner can spill along either wall', () => {
    const options = cornersIn(getRoomShapeOptions(item(40), 1));
    expect(options.map(o => o.value.split(':')[1])).toEqual(['x', 'y']);
    expect(options[0].label).toMatch(/long wall/);
    expect(options[1].label).toMatch(/short wall/);
  });

  test('a room that fits in the corner has one option', () => {
    const inner = innerOf(1);
    const tons = (getFilledCornerArea(inner) / 2) * 2.5 / 14;
    const options = cornersIn(getRoomShapeOptions(item(tons), 1));
    expect(options).toHaveLength(1);
    expect(options[0].label).toMatch(/^Rounded corner, /);
  });

  test('labels say how far along the wall it runs and how deep it is', () => {
    const inner = innerOf(1);
    const radius = getCornerRadius(inner);
    const area = getFilledCornerArea(inner) * 2;
    const [option] = getCornerOptions([1], area);
    const room = parseRoomChoice(option.value);
    const box = getPolygonBounds(cornerRoomPolygon(inner, 'top-left', room.cornerAxis, area));
    expect(option.label).toContain(`${box.length.toFixed(1)} m along`);
    expect(option.label).toContain(`${radius.toFixed(1)} m deep`);
  });

  test('a room too big for the floor gets none', () => {
    expect(getCornerOptions([1], polygonArea(innerOf(1)) + 1)).toEqual([]);
  });

  test('a room can take nearly a whole floor, where a rectangle could not', () => {
    const area = polygonArea(innerOf(1)) * 0.99;
    expect(getCornerOptions([1], area)).toHaveLength(2);
  });

  test('floors shared by a component give the per floor area, and say so', () => {
    const options = cornersIn(getRoomShapeOptions(item(40), [1, 2], 2));
    expect(options).toHaveLength(2);
    options.forEach(o => expect(o.label).toMatch(/\(per floor\)$/));
    const room = parseRoomChoice(options[0].value);
    expect(room.cornerArea).toBeCloseTo((40 * 14) / 2.5 / 2, 6);
  });

  test('a floor whose curve is too small gets none', () => {
    setShip({ totalTons: 5, numFloors: 3 });
    expect(getCornerRadius(innerOf(3))).toBeLessThan(0.5);
    expect(getCornerOptions([3], 1)).toEqual([]);
  });

  test('a block of items is offered as one corner room', () => {
    // As the block mode of the allocation section asks for it
    const block = { ...item(4), quantity: 10, tons: 40, tonsPerItem: 40, overheadPerItem: 0 };
    const [option] = cornersIn(getRoomShapeOptions(block, 1, 1));
    expect(parseRoomChoice(option.value).cornerArea).toBeCloseTo((40 * 14) / 2.5, 6);
  });
});

describe('Reading the dropdown', () => {
  test('reads a corner choice', () => {
    expect(parseRoomChoice('corner:y:42.5')).toMatchObject({ roomShape: 'corner', cornerAxis: 'y', cornerArea: 42.5 });
  });

  test('gives it a usable size for placement mode', () => {
    const room = parseRoomChoice('corner:x:25');
    expect(room.length).toBeGreaterThan(0);
    expect(room.width).toBeGreaterThan(0);
  });

  test.each(['corner:z:10', 'corner:x:0', 'corner:x:-3', 'corner:x:abc'])('rejects %s', value => {
    expect(parseRoomChoice(value)).toBeNull();
  });
});

describe('Positioning', () => {
  beforeEach(() => setShip());

  const roomOf = (area, cornerAxis = 'x') => ({ roomShape: 'corner', cornerAxis, cornerArea: area });

  test('goes in the corner nearest the pointer', () => {
    const box = getPolygonBounds(innerOf(1));
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const at = (fx, fy) => positionRoom(roomOf(area), [1], box.x + box.length * fx, box.y + box.width * fy).cornerAt;
    expect(at(0.1, 0.1)).toBe('top-left');
    expect(at(0.9, 0.1)).toBe('top-right');
    expect(at(0.9, 0.9)).toBe('bottom-right');
    expect(at(0.1, 0.9)).toBe('bottom-left');
  });

  test('its box is its outline\'s, and it knows its floor', () => {
    const room = positionRoom(roomOf(getFilledCornerArea(innerOf(2)) * 2), [2], 0, 0);
    const box = getPolygonBounds(getRoomOutline(room));
    expect(room).toMatchObject({ floor: 2, cornerFloor: 2, x: box.x, y: box.y, length: box.length, width: box.width });
  });

  test('moving to a smaller floor refits it to that floor\'s corner', () => {
    const area = getFilledCornerArea(innerOf(3)) * 2;
    const lower = positionRoom(roomOf(area), [1], 0, 0);
    const upper = positionRoom(roomOf(area), [3], 0, 0);
    expect(getRoomArea(upper)).toBeCloseTo(getRoomArea(lower), 6);
    expect(upper.x).not.toBeCloseTo(lower.x, 3);
  });

  test('is refused on a floor too small for it', () => {
    const area = polygonArea(innerOf(1)) * 0.99;
    expect(positionRoom(roomOf(area), [4], 0, 0)).toBeNull();
  });

  test('always touches the hull', () => {
    const room = positionRoom(roomOf(20), [1], 0, 0);
    expect(roomTouchesHull(room, [1])).toBe(true);
  });

  test('hit testing follows its curve', () => {
    const inner = innerOf(1);
    const room = positionRoom(roomOf(getFilledCornerArea(inner) * 2), [1], 0, 0);
    const box = getPolygonBounds(inner);
    expect(isPointInRoom(room, box.x + 0.05, box.y + 0.05)).toBe(false);
    expect(isPointInRoom(room, room.x + room.length - 0.5, room.y + 0.5)).toBe(true);
  });

  test('finds the next nearest corner when the nearest is taken', () => {
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const box = getPolygonBounds(innerOf(1));
    const first = findRoomSpot(roomOf(area), [1], box.x, box.y);
    expect(first.cornerAt).toBe('top-left');
    place(0, first);
    const second = findRoomSpot(roomOf(area), [1], box.x, box.y);
    expect(second.cornerAt).toBe('bottom-left');
    expect(placementsOverlap(second, first)).toBe(false);
  });

  test('gives up when all four corners are taken', () => {
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const rooms = CORNERS.map(c => buildCornerRoom(roomOf(area), [1], c));
    place(0, ...rooms);
    expect(findRoomSpot(roomOf(area), [1], 0, 0)).toBeNull();
  });

  test('ignores its own component when asked', () => {
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const box = getPolygonBounds(innerOf(1));
    const first = buildCornerRoom(roomOf(area), [1], 'top-left');
    place(0, first);
    expect(findRoomSpot(roomOf(area), [1], box.x, box.y, 0).cornerAt).toBe('top-left');
  });

  test('two rooms spilling toward each other along a wall are caught', () => {
    const inner = innerOf(1);
    const area = polygonArea(inner) * 0.14;
    const left = buildCornerRoom(roomOf(area), [1], 'top-left');
    const right = buildCornerRoom(roomOf(area), [1], 'top-right');
    expect(left.x + left.length).toBeGreaterThan(right.x);
    place(0, left);
    expect(isRoomClear(right, [1])).toBe(false);
    expect(isRoomClear(buildCornerRoom(roomOf(area), [1], 'bottom-left'), [1])).toBe(true);
  });

  test('a rectangle in the curve it leaves free does not overlap it', () => {
    const inner = innerOf(1);
    const room = buildCornerRoom(roomOf(getFilledCornerArea(inner) * 2), [1], 'top-left');
    place(0, room);
    expect(checkOverlap(1, room.x + room.length, room.y, 1, 1)).toBe(false);
    expect(checkOverlap(1, room.x + room.length - 1, room.y + 0.5, 1, 1)).toBe(true);
  });
});

describe('Switching wall', () => {
  beforeEach(() => setShip());

  test('continues along the other wall, in the same corner, with the same area', () => {
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const room = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1], 'bottom-right');
    const switched = switchCornerRoomWall(room, [1]);
    expect(switched).toMatchObject({ cornerAt: 'bottom-right', cornerAxis: 'y' });
    expect(polygonArea(getRoomOutline(switched))).toBeCloseTo(area, 6);
    expect(switched.width).toBeGreaterThan(room.width);
    expect(switched.length).toBeLessThan(room.length);
    expect(switchCornerRoomWall(switched, [1]).cornerAxis).toBe('x');
  });
});

describe('Spanning floors', () => {
  beforeEach(() => setShip());

  test('the smallest floor shapes it', () => {
    expect(getCornerFloor([1, 2, 3])).toBe(3);
    expect(getCornerFloor([4, 1])).toBe(4);
    expect(getCornerFloor([2])).toBe(2);
  });

  test('has the same outline on every floor, inside all of them', () => {
    const area = getFilledCornerArea(innerOf(3)) * 2;
    const room = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1, 3], 'top-left');
    expect(room.cornerFloor).toBe(3);

    const entries = [1, 3].map(floor => ({ ...room, floor }));
    const [lower, upper] = entries.map(getRoomOutline);
    expect(lower).toEqual(upper);
    expect(isRoomFitting(room, [1, 3])).toBe(true);
    entries.forEach(entry => expect(isRoomFitting(entry, [entry.floor])).toBe(true));
  });

  test('a saved room on a floor too small for its outline does not fit', () => {
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const room = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1], 'top-left');
    expect(isRoomFitting({ ...room, floor: 4 }, [4])).toBe(false);
  });

  test('is checked for overlap on every floor', () => {
    const area = getFilledCornerArea(innerOf(3)) * 2;
    const inner = getPolygonBounds(innerOf(3));
    const other = { floor: 3, x: inner.x + 3, y: inner.y, length: 2, width: 2 };
    place(0, other);
    const room = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1, 3], 'top-left');
    expect(isRoomClear(room, [1])).toBe(true);
    expect(isRoomClear(room, [1, 3])).toBe(false);
  });
});

describe('Floor use and area', () => {
  beforeEach(() => setShip());

  test('counts its exact area against the floor', () => {
    const area = getFilledCornerArea(innerOf(1)) * 2;
    const room = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1], 'top-left');
    place(0, room);
    expect(getPlacementArea(room)).toBeCloseTo(area, 6);
    expect(getFloorUsedArea(1)).toBeCloseTo(area, 6);
    expect(getRoomArea(room)).toBe(area);
  });
});

describe('Saving and loading', () => {
  const components = [item(40), item(10, { item: 'Other', itemName: 'Other' })];
  const floorOf = dims => ({ count: 4, length: dims.floorLength, width: dims.floorWidth, armorThickness: 0 });

  function saved() {
    const dims = setShip({ components });
    const area = (40 * 14) / 2.5;
    const room = { ...buildCornerRoom({ cornerAxis: 'y', cornerArea: area }, [1], 'bottom-left') };
    place(0, room);
    return { dims, room, layout: serializeLayout(global.shipData, new Date('2026-11-06T10:00:00Z')) };
  }

  test('saves all of its fields', () => {
    const { layout, room } = saved();
    const [entry] = layout.placements[0].entries;
    expect(entry).toMatchObject(getRoomFields(room));
    expect(entry.roomShape).toBe('corner');
  });

  test('comes back the same', () => {
    const { layout, room, dims } = saved();
    const result = restorePlacements(parseLayout(JSON.stringify(layout)), components, floorOf(dims));
    expect(result.problems).toEqual([]);
    const [entry] = result.placements[0].floors;
    expect(entry).toMatchObject(getRoomFields(room));
    expect(entry.x).toBeCloseTo(room.x, 6);
    expect(entry.width).toBeCloseTo(room.width, 6);
  });

  test('a room spanning floors comes back on all of them', () => {
    const dims = setShip({ components: [item(40)] });
    const room = buildCornerRoom({ cornerAxis: 'x', cornerArea: 60 }, [1, 2], 'top-right');
    place(0, { ...room, floor: 1 }, { ...room, floor: 2 });
    const layout = serializeLayout(global.shipData, new Date('2026-11-06T10:00:00Z'));
    const result = restorePlacements(parseLayout(JSON.stringify(layout)), [item(40)], floorOf(dims));
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors.map(e => e.floor)).toEqual([1, 2]);
    expect(result.placements[0].floors[0].cornerFloor).toBe(2);
    expect(result.placements[0].floors[1].x).toBeCloseTo(result.placements[0].floors[0].x, 6);
  });

  test('a hull component stays against the hull', () => {
    const turret = item(10, { category: 'Weapons', item: 'Turret', itemName: 'Turret' });
    const dims = setShip({ components: [turret] });
    place(0, buildCornerRoom({ cornerAxis: 'x', cornerArea: 56 }, [1], 'top-left'));
    const layout = serializeLayout(global.shipData, new Date('2026-11-06T10:00:00Z'));
    const result = restorePlacements(parseLayout(JSON.stringify(layout)), [turret], floorOf(dims));
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors).toHaveLength(1);
  });

  test('overlapping corner rooms are reported', () => {
    const dims = setShip({ components });
    const area = polygonArea(innerOf(1)) * 0.14;
    const left = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1], 'top-left');
    const right = buildCornerRoom({ cornerAxis: 'x', cornerArea: area }, [1], 'top-right');
    place(0, left);
    place(1, right);
    const layout = serializeLayout(global.shipData, new Date('2026-11-06T10:00:00Z'));
    const result = restorePlacements(parseLayout(JSON.stringify(layout)), components, floorOf(dims));
    expect(result.problems.join(' ')).toMatch(/overlaps/);
  });

  test.each([
    ['an unknown corner', { cornerAt: 'middle' }],
    ['an inherited property as a corner', { cornerAt: 'constructor' }],
    ['an unknown wall', { cornerAxis: 'z' }],
    ['no area', { cornerArea: 0 }],
    ['a floor that is not a number', { cornerFloor: 'top' }]
  ])('rejects %s', (_name, change) => {
    const { layout, dims } = saved();
    Object.assign(layout.placements[0].entries[0], change);
    const result = restorePlacements(layout, components, floorOf(dims));
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/damaged/);
  });

  test('a shaping floor that no longer exists is dropped', () => {
    const { layout, dims } = saved();
    layout.placements[0].entries[0].cornerFloor = 9;
    const result = restorePlacements(layout, components, floorOf(dims));
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/no longer fits/);
  });

  test('a room too big for the floor is dropped', () => {
    const { layout, dims } = saved();
    layout.placements[0].entries[0].cornerArea = 1e6;
    const result = restorePlacements(layout, components, floorOf(dims));
    expect(result.dropped).toBe(1);
  });

  test('is dropped on a hull without rounded corners', () => {
    const { layout } = saved();
    const dims = setShip({ shape: 'wedge', components });
    const result = restorePlacements(layout, components, floorOf(dims));
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/no longer fits/);
  });
});

describe('Exporting', () => {
  test('is drawn as its own outline', () => {
    setShip({ components: [item(40)] });
    place(0, buildCornerRoom({ cornerAxis: 'x', cornerArea: 60 }, [1], 'top-left'));
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    const svg = exportLayoutSvg({ ...global.shipData, floorLength, floorWidth });
    expect(svg).toMatch(/<path d="M[^"]+" fill-rule="evenodd"/);
  });
});
