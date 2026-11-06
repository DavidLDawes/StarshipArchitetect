'use strict';

const { recalculateFloors, getFloorGeometry } = require('../../src/floor-utils');
const { serializeLayout, restorePlacements } = require('../../src/layout-io');
const { exportLayoutSvg } = require('../../src/layout-export');
const { getPlacementRects, getPlacementArea } = require('../../src/placement-geometry');
const { checkOverlap } = require('../../src/placement-logic');
const { calculateComponentArea } = require('../../src/component-dimensions');
const {
  getRoomShapeOptions,
  parseRoomChoice,
  placementsOverlap,
  isRoomClear,
  isPointInRoom,
  getRoomContours,
  getRoomArea,
  roomTouchesHull,
  findRoomSpot
} = require('../../src/curved-rooms');
const {
  FULL_TURN,
  getRingWallRadius,
  getSharedRingWall,
  getRingCenter,
  getRingSweep,
  getRingRoomArea,
  buildRingRoom,
  positionRingRoom,
  turnRingRoom,
  getRingsInUse,
  getNextRingOuter,
  getFreeRingArcs,
  getNextRing,
  findRingSpot,
  getRingOptions,
  planRingFill,
  getRingFillDepths
} = require('../../src/ring-rooms');

function setShip({ shape = 'disk', numFloors = 4, components = [], tons = 1000, armor = 0 } = {}) {
  Object.assign(global.shipData, {
    hullShape: shape,
    totalTons: tons,
    numFloors,
    armorTons: armor,
    ceilingHeight: 2.5,
    floorLength: 30,
    components,
    componentPlacements: {},
    combineRecHealth: false
  });
  recalculateFloors({ resetLength: true });
}

afterAll(() => {
  setShip({ shape: 'rectangular' });
  global.shipData.floorLength = 30;
  recalculateFloors();
  delete global.shipData.hullShape;
});

const item = (tons, quantity = 1, name = 'Lab') => ({
  category: 'Fittings', item: name, itemName: name, tons: tons * quantity, tonsPerItem: tons, quantity, cost: 0
});
const ringsIn = options => options.filter(o => o.roomShape === 'ring');

/** A room placed on a floor, as the only placement of component `index` */
function place(index, ...rooms) {
  global.shipData.componentPlacements[index] = { floors: rooms };
  return rooms;
}
const section = (floor, outer, inner, angle, sweep) =>
  buildRingRoom({ ringOuter: outer, ringInner: inner, ringSweep: sweep }, [floor], angle);

describe('getRingSweep', () => {
  test('gives the area back', () => {
    const sweep = getRingSweep(30, 12, 8);
    expect((sweep / 2) * (144 - 64)).toBeCloseTo(30, 9);
  });

  test('a room taking the whole ring is exactly a full turn', () => {
    expect(getRingSweep(Math.PI * (144 - 64), 12, 8)).toBe(FULL_TURN);
    expect(getRingSweep(Math.PI * 16, 4, 0)).toBe(FULL_TURN);
  });

  test('a room too big for the ring does not fit', () => {
    expect(getRingSweep(Math.PI * 16 + 1, 4, 0)).toBe(0);
    expect(getRingSweep(0, 4, 0)).toBe(0);
    expect(getRingSweep(5, 4, 4)).toBe(0);
  });
});

describe('floors', () => {
  test('the wall holds exactly the usable area', () => {
    setShip();
    const radius = getRingWallRadius(1);
    expect(Math.PI * radius * radius).toBeCloseTo(getFloorGeometry(1).usableArea, 6);
  });

  test('stays inside the armor', () => {
    setShip({ armor: 50 });
    const inner = getFloorGeometry(1).inner;
    const center = getRingCenter(1);
    const reach = Math.max(...inner.map(([x, y]) => Math.hypot(x - center.x, y - center.y)));
    expect(getRingWallRadius(1)).toBeLessThanOrEqual(reach);
    expect(getRingWallRadius(1)).toBeGreaterThan(reach * 0.999);
  });

  test('not on a floor that is not round', () => {
    setShip({ shape: 'rectangular' });
    expect(getRingWallRadius(1)).toBe(0);
    expect(ringsIn(getRoomShapeOptions(item(10), 1, 1))).toEqual([]);
  });

  test('floors only share a wall if they are the same size', () => {
    setShip({ shape: 'cone' });
    expect(getSharedRingWall([1])).toBeGreaterThan(0);
    expect(getSharedRingWall([1, 2])).toBe(0);
    setShip({ shape: 'disk' });
    expect(getSharedRingWall([1, 2, 3])).toBeGreaterThan(0);
  });
});

describe('shape of a ring room', () => {
  beforeEach(() => setShip());

  test('a section has curved walls and straight sides that point at the center', () => {
    const room = section(1, 12, 8, 0.7, 0.9);
    const [outline] = getRoomContours(room);
    const center = getRingCenter(1);
    const radii = outline.map(([x, y]) => Math.hypot(x - center.x, y - center.y));
    const onOuter = radii.filter(r => Math.abs(r - 12) < 1e-9).length;
    const onInner = radii.filter(r => Math.abs(r - 8) < 1e-9).length;
    expect(onOuter + onInner).toBe(outline.length);
    expect(onOuter).toBe(onInner);

    // Corners at each end of the room are in line with the center
    const angle = ([x, y]) => Math.atan2(y - center.y, x - center.x);
    expect(angle(outline[0])).toBeCloseTo(angle(outline[outline.length - 1]), 9);
    expect(angle(outline[onOuter - 1])).toBeCloseTo(angle(outline[onOuter]), 9);
  });

  test('a slice has an arc and two straight sides meeting in the middle', () => {
    const room = section(1, 6, 0, 1, 1.2);
    const [outline] = getRoomContours(room);
    const center = getRingCenter(1);
    const tip = outline[outline.length - 1];
    expect(tip[0]).toBeCloseTo(center.x, 9);
    expect(tip[1]).toBeCloseTo(center.y, 9);
    expect(getRingRoomArea(room)).toBeCloseTo(0.6 * 36, 9);
  });

  test('a whole ring has a hole, and all of the center is a plain circle', () => {
    expect(getRoomContours(section(1, 12, 8, 0, FULL_TURN)).length).toBe(2);
    expect(getRoomContours(section(1, 6, 0, 0, FULL_TURN)).length).toBe(1);
    expect(getRingRoomArea(section(1, 6, 0, 0, FULL_TURN))).toBeCloseTo(Math.PI * 36, 9);
  });

  test('the box is around the room', () => {
    const room = section(1, 12, 8, 0, 0.4);
    const center = getRingCenter(1);
    expect(room.x).toBeGreaterThanOrEqual(center.x);
    expect(room.x + room.length).toBeCloseTo(center.x + 12, 2);
  });

  test('clicks hit the room, not its hole or what is past its ends', () => {
    const c = getRingCenter(1);
    const room = section(1, 12, 8, 0, 1);
    expect(isPointInRoom(room, c.x + 10, c.y)).toBe(true);
    expect(isPointInRoom(room, c.x + 7, c.y)).toBe(false);
    expect(isPointInRoom(room, c.x + 13, c.y)).toBe(false);
    expect(isPointInRoom(room, c.x, c.y + 10)).toBe(false);

    const whole = section(1, 12, 8, 0, FULL_TURN);
    expect(isPointInRoom(whole, c.x, c.y + 10)).toBe(true);
    expect(isPointInRoom(whole, c.x, c.y)).toBe(false);
  });

  test('its rectangles match its area', () => {
    for (const room of [section(1, 12, 8, 0.3, 1), section(1, 12, 8, 0, FULL_TURN), section(1, 6, 0, 2, 2)]) {
      const area = getPlacementRects(room).reduce((sum, r) => sum + r.length * r.width, 0);
      expect(area).toBeGreaterThan(getRoomArea(room) * 0.95);
      expect(area).toBeLessThan(getRoomArea(room) * 1.05);
      expect(getPlacementArea(room)).toBeCloseTo(getRoomArea(room), 9);
    }
  });

  test('its rectangles leave the hole of a whole ring free', () => {
    const c = getRingCenter(1);
    const rects = getPlacementRects(section(1, 12, 8, 0, FULL_TURN));
    expect(rects.some(r => r.x <= c.x && r.x + r.length >= c.x && r.y <= c.y && r.y + r.width >= c.y)).toBe(false);
  });
});

describe('overlap', () => {
  beforeEach(() => setShip({ components: [item(1), item(1), item(1)] }));

  test('rooms side by side on a ring only touch', () => {
    const a = section(1, 12, 8, 0, 1);
    expect(placementsOverlap(a, section(1, 12, 8, 1, 1))).toBe(false);
    expect(placementsOverlap(a, section(1, 12, 8, 0.99, 1))).toBe(true);
  });

  test('rings one inside the other only touch', () => {
    const a = section(1, 12, 8, 0, FULL_TURN);
    expect(placementsOverlap(a, section(1, 8, 4, 0, FULL_TURN))).toBe(false);
    expect(placementsOverlap(a, section(1, 8.5, 4, 0, 0.5))).toBe(true);
  });

  test('angles compare around the circle', () => {
    expect(placementsOverlap(section(1, 12, 8, 3.1, 0.4), section(1, 12, 8, -3.1, 0.4))).toBe(true);
    expect(placementsOverlap(section(1, 12, 8, 7, 0.4), section(1, 12, 8, 7 - FULL_TURN, 0.4))).toBe(true);
  });

  test('a rectangle in the hole of a ring is clear of it', () => {
    const c = getRingCenter(1);
    place(0, section(1, 12, 8, 0, FULL_TURN));
    expect(checkOverlap(1, c.x - 2, c.y - 2, 4, 4)).toBe(false);
    expect(checkOverlap(1, c.x - 2, c.y - 2, 10, 4)).toBe(true);
    expect(checkOverlap(2, c.x - 2, c.y - 2, 10, 4)).toBe(false);
  });

  test('a rectangle in the corner of a section is clear of it', () => {
    const c = getRingCenter(1);
    // In the box of a section, but toward the center of the curve
    const room = section(1, 12, 8, Math.PI / 4, Math.PI / 2);
    place(0, room);
    expect(room.x).toBeLessThan(c.x + 2);
    expect(checkOverlap(1, c.x + 0.5, c.y + 0.5, 2, 2)).toBe(false);
    expect(checkOverlap(1, c.x + 6, c.y + 6, 2, 2)).toBe(true);
  });

  test('a ring room checks against circles and arcs', () => {
    const c = getRingCenter(1);
    const circle = { floor: 1, x: c.x + 9, y: c.y - 1, length: 2, width: 2, roomShape: 'circle' };
    expect(placementsOverlap(section(1, 12, 8, 0, 1), circle)).toBe(true);
    expect(placementsOverlap(section(1, 12, 8, Math.PI, 1), circle)).toBe(false);
    const arc = { floor: 1, x: 0, y: 0, length: 30, width: 30, roomShape: 'arc', arcAngle: 0, arcArea: 20 };
    expect(placementsOverlap(section(1, getRingWallRadius(1), 8, 0, 0.5), arc)).toBe(true);
    expect(placementsOverlap(section(1, getRingWallRadius(1), 8, Math.PI, 0.5), arc)).toBe(false);
  });
});

describe('free stretches', () => {
  beforeEach(() => setShip({ components: [item(1), item(1)] }));
  const ring = { ringOuter: 12, ringInner: 8 };

  test('an empty ring is free all the way around', () => {
    const arcs = getFreeRingArcs(ring, [1]);
    expect(arcs.length).toBe(1);
    expect(arcs[0].sweep).toBeCloseTo(FULL_TURN, 9);
  });

  test('leaves out rooms on the ring, exactly', () => {
    place(0, section(1, 12, 8, 1, 1), section(1, 12, 8, 3, 1));
    const arcs = getFreeRingArcs(ring, [1]);
    expect(arcs.map(a => a.sweep).sort((a, b) => a - b)[0]).toBeCloseTo(1, 9);
    expect(arcs.reduce((sum, a) => sum + a.sweep, 0)).toBeCloseTo(FULL_TURN - 2, 9);
  });

  test('a room crossing the start of the circle is handled', () => {
    place(0, section(1, 12, 8, 0, 1));
    const arcs = getFreeRingArcs(ring, [1]);
    expect(arcs.length).toBe(1);
    expect(arcs[0].sweep).toBeCloseTo(FULL_TURN - 1, 9);
  });

  test('a whole ring leaves nothing', () => {
    place(0, section(1, 12, 8, 0, FULL_TURN));
    expect(getFreeRingArcs(ring, [1])).toEqual([]);
  });

  test('other rings do not count', () => {
    place(0, section(1, 8, 4, 0, FULL_TURN));
    expect(getFreeRingArcs(ring, [1])[0].sweep).toBeCloseTo(FULL_TURN, 9);
    expect(getFreeRingArcs(ring, [2])[0].sweep).toBeCloseTo(FULL_TURN, 9);
  });

  test('goes around anything else in the way', () => {
    const c = getRingCenter(1);
    place(0, { floor: 1, x: c.x + 9, y: c.y - 1, length: 2, width: 2 });
    const arcs = getFreeRingArcs(ring, [1]);
    expect(arcs.length).toBe(1);
    expect(arcs[0].sweep).toBeLessThan(FULL_TURN - 0.15);
    expect(arcs[0].sweep).toBeGreaterThan(FULL_TURN - 0.5);
    const room = buildRingRoom({ ...ring, ringSweep: arcs[0].sweep }, [1], arcs[0].start + arcs[0].sweep / 2);
    expect(isRoomClear(room, [1])).toBe(true);
  });
});

describe('finding a spot', () => {
  beforeEach(() => setShip({ components: [item(1), item(1)] }));
  const ring = { ringOuter: 12, ringInner: 8, ringSweep: 1 };
  const pointAt = (angle, radius = 10) => {
    const c = getRingCenter(1);
    return [c.x + radius * Math.cos(angle), c.y + radius * Math.sin(angle)];
  };

  test('faces the pointer on an empty ring', () => {
    expect(positionRingRoom(ring, [1], ...pointAt(2)).ringAngle).toBeCloseTo(2, 9);
    expect(findRingSpot(ring, [1], ...pointAt(2)).ringAngle).toBeCloseTo(2, 9);
  });

  test('stays on its ring wherever the pointer is', () => {
    const spot = findRingSpot(ring, [1], ...pointAt(2, 2));
    expect(spot.ringOuter).toBe(12);
    expect(spot.ringAngle).toBeCloseTo(2, 9);
  });

  test('slides clear of a room in the way, and touches it', () => {
    place(0, section(1, 12, 8, 0, 1));
    const spot = findRingSpot(ring, [1], ...pointAt(0.2));
    expect(isRoomClear(spot, [1])).toBe(true);
    expect(spot.ringAngle).toBeCloseTo(1, 6);
  });

  test('goes against a neighbor when close to it', () => {
    place(0, section(1, 12, 8, 0, 1));
    expect(findRingSpot(ring, [1], ...pointAt(1.05)).ringAngle).toBeCloseTo(1, 6);
    expect(findRingSpot(ring, [1], ...pointAt(2)).ringAngle).toBeCloseTo(2, 6);
  });

  test('a room that exactly fills what is left goes in', () => {
    const sweep = FULL_TURN / 4;
    place(0, section(1, 12, 8, 0, sweep), section(1, 12, 8, sweep, sweep), section(1, 12, 8, 2 * sweep, sweep));
    const spot = findRingSpot({ ...ring, ringSweep: sweep }, [1], ...pointAt(0));
    expect(spot.ringOuter).toBe(12);
    expect(spot.ringAngle).toBeCloseTo(3 * sweep - FULL_TURN, 6);
  });

  test('a full ring sends it to the next ring in, with the same area', () => {
    place(0, section(1, 12, 8, 0, FULL_TURN));
    const spot = findRingSpot(ring, [1], ...pointAt(1));
    expect(spot.ringOuter).toBe(8);
    expect(spot.ringInner).toBe(4);
    expect(getRingRoomArea(spot)).toBeCloseTo(getRingRoomArea(ring), 9);
    expect(isRoomClear(spot, [1])).toBe(true);
  });

  test('close to the center it becomes a slice', () => {
    const area = getRingRoomArea(ring);
    place(0, section(1, 12, 8, 0, FULL_TURN), section(1, 8, 4, 0, FULL_TURN));
    const spot = findRingSpot(ring, [1], ...pointAt(1));
    expect(spot.ringOuter).toBe(4);
    expect(spot.ringInner).toBe(0);
    expect(getRingRoomArea(spot)).toBeCloseTo(area, 9);
  });

  test('the next ring in does not leave a hole too small for the room', () => {
    // Inner wall of 3 m is far enough out by depth, but its hole holds less than a room
    const area = Math.PI * 9 + 1;
    const next = getNextRing({ ringOuter: 11, ringInner: 7, ringSweep: (2 * area) / (121 - 49) }, [1]);
    expect(next.ringOuter).toBe(7);
    expect(next.ringInner).toBe(0);
  });

  test('a room needing all of the center becomes a circle', () => {
    const next = getNextRing({ ringOuter: 8, ringInner: 3, ringSweep: (2 * Math.PI * 9) / (64 - 9) }, [1]);
    expect(next).toEqual({ ringOuter: 3, ringInner: 0, ringSweep: FULL_TURN });
  });

  test('no room left anywhere inside', () => {
    place(0, section(1, 12, 8, 0, FULL_TURN), section(1, 8, 4, 0, FULL_TURN), section(1, 4, 0, 0, FULL_TURN));
    expect(findRingSpot(ring, [1], ...pointAt(1))).toBeNull();
  });

  test('moving keeps it on the ring when told to', () => {
    place(0, section(1, 12, 8, 0, FULL_TURN));
    expect(findRingSpot(ring, [1], ...pointAt(1), -1, false, false)).toBeNull();
  });

  test('a hull room does not go on to an inner ring', () => {
    const wall = getRingWallRadius(1);
    const atWall = { ringOuter: wall, ringInner: wall - 3, ringSweep: 1 };
    place(0, section(1, wall, wall - 3, 0, FULL_TURN));
    expect(findRingSpot(atWall, [1], ...pointAt(1), -1, true)).toBeNull();
    expect(findRingSpot(atWall, [1], ...pointAt(1), -1, false).ringOuter).toBeCloseTo(wall - 3, 9);
  });

  test('ignores the component being placed if told to', () => {
    place(0, section(1, 12, 8, 0, FULL_TURN));
    expect(findRoomSpot({ roomShape: 'ring', ...ring }, [1], ...pointAt(1), 0).ringOuter).toBe(12);
  });

  test('spans floors only when clear on all of them', () => {
    place(0, section(2, 12, 8, 0, FULL_TURN));
    const spot = findRingSpot(ring, [1, 2], ...pointAt(1));
    expect(spot.ringOuter).toBe(8);
    expect(spot.floor).toBe(1);
  });

  test('can not span floors of different sizes', () => {
    setShip({ shape: 'cone' });
    expect(findRingSpot({ ringOuter: 2, ringInner: 1, ringSweep: 1 }, [1, 2], 1, 1)).toBeNull();
  });

  test('turning goes around its ring', () => {
    const turned = turnRingRoom(section(1, 12, 8, 0, 1), Math.PI / 2);
    expect(turned.ringAngle).toBeCloseTo(Math.PI / 2, 9);
    expect(turned.ringOuter).toBe(12);
  });
});

describe('size options', () => {
  test('a room comes in depths, a whole ring and a slice', () => {
    setShip();
    const options = ringsIn(getRoomShapeOptions(item(40), 1, 1));
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.some(o => /^Ring room at the wall/.test(o.label))).toBe(true);
    expect(options.some(o => /^Whole ring at the wall/.test(o.label))).toBe(true);
    expect(options.some(o => /^Slice of pie/.test(o.label))).toBe(true);
  });

  test.each(ringsInOptionsCases())('%s keeps its area', (_name, component, floors, count) => {
    setShip();
    const area = calculateComponentArea(component) / count;
    for (const option of ringsIn(getRoomShapeOptions(component, floors, count))) {
      const room = parseRoomChoice(option.value);
      expect(getRingRoomArea(room)).toBeCloseTo(area, 6);
      expect(room.ringSweep).toBeLessThanOrEqual(FULL_TURN);
      expect(room.ringInner).toBeLessThan(room.ringOuter);
    }
  });

  test('rooms in quantity are sized to fill the ring', () => {
    setShip();
    const options = ringsIn(getRoomShapeOptions(item(4, 12, 'Staterooms'), 1, 1));
    const fitted = options.filter(o => /to a ring/.test(o.label));
    expect(fitted.length).toBeGreaterThan(0);
    for (const option of fitted) {
      const count = parseInt(option.label.match(/\((\d+) to a ring\)/)[1], 10);
      expect(parseRoomChoice(option.value).ringSweep * count).toBeCloseTo(FULL_TURN, 6);
    }
  });

  test('several floors share a ring on a Disk', () => {
    setShip();
    const options = ringsIn(getRoomShapeOptions(item(60), [1, 2, 3], 3));
    expect(options.length).toBeGreaterThan(0);
    expect(options.every(o => / \(per floor\)$/.test(o.label))).toBe(true);
  });

  test('several floors of different sizes do not', () => {
    setShip({ shape: 'cone' });
    expect(ringsIn(getRoomShapeOptions(item(4), [1, 2], 2))).toEqual([]);
    expect(ringsIn(getRoomShapeOptions(item(2), 1, 1)).length).toBeGreaterThan(0);
  });

  test('a new ring starts inside the rings already there', () => {
    setShip({ components: [item(1)] });
    const wall = getRingWallRadius(1);
    place(0, section(1, wall, wall - 3, 0, FULL_TURN));
    expect(getNextRingOuter([1])).toBeCloseTo(wall - 3, 9);
    const options = ringsIn(getRoomShapeOptions(item(10), 1, 1));
    expect(options.every(o => parseRoomChoice(o.value).ringOuter <= wall - 3 + 1e-9)).toBe(true);
    expect(options.some(o => /^Ring room inside/.test(o.label))).toBe(true);
  });

  test('more of a ring is offered while it has room', () => {
    setShip({ components: [item(1)] });
    const wall = getRingWallRadius(1);
    place(0, section(1, wall, wall - 3, 0, 2));
    const more = ringsIn(getRoomShapeOptions(item(10), 1, 1)).filter(o => /^More of the ring/.test(o.label));
    expect(more.length).toBe(1);
    expect(parseRoomChoice(more[0].value).ringOuter).toBeCloseTo(wall, 9);

    place(0, section(1, wall, wall - 3, 0, FULL_TURN - 0.01));
    expect(ringsIn(getRoomShapeOptions(item(10), 1, 1)).filter(o => /^More of the ring/.test(o.label))).toEqual([]);
  });

  test('all of the center taken by one item is a circle', () => {
    setShip({ components: [item(1)] });
    const wall = getRingWallRadius(1);
    const center = 5;
    place(0, section(1, wall, center, 0, FULL_TURN));
    const tons = (Math.PI * center * center * 2.5) / 14;
    const options = ringsIn(getRoomShapeOptions(item(tons), 1, 1));
    const circle = options.find(o => /^Circle filling the center/.test(o.label));
    expect(circle).toBeDefined();
    expect(parseRoomChoice(circle.value)).toMatchObject({ ringOuter: center, ringInner: 0, ringSweep: FULL_TURN });
    expect(options.filter(o => /^(Ring room|Whole ring|Slice)/.test(o.label))).toEqual([]);
  });

  test('nothing is offered once the center is taken', () => {
    setShip({ components: [item(1)] });
    const wall = getRingWallRadius(1);
    place(0, section(1, wall, 0, 0, FULL_TURN));
    expect(getNextRingOuter([1])).toBe(0);
    expect(ringsIn(getRoomShapeOptions(item(1), 1, 1))).toEqual([]);
  });

  test('hull items only get the ring against the wall', () => {
    const turret = { category: 'Weapons', item: 'Triple Turret', itemName: 'Triple Turret', tons: 4, tonsPerItem: 4, quantity: 1, cost: 0 };
    setShip({ components: [turret, item(1)] });
    expect(ringsIn(getRingOptions(turret, [1], 10)).length).toBeGreaterThan(0);
    const wall = getRingWallRadius(1);
    place(1, section(1, wall, wall - 3, 0, FULL_TURN));
    expect(getRingOptions(turret, [1], 10)).toEqual([]);
  });

  test('a ring room against the wall touches the hull', () => {
    setShip();
    const wall = getRingWallRadius(1);
    expect(roomTouchesHull(section(1, wall, wall - 3, 0, 1), [1])).toBe(true);
    expect(roomTouchesHull(section(1, wall - 3, wall - 6, 0, 1), [1])).toBe(false);
  });
});

function ringsInOptionsCases() {
  return [
    ['one room', item(20), 1, 1],
    ['a big room', item(150), 1, 1],
    ['one room of many', item(4, 12, 'Staterooms'), 1, 1],
    ['a room across floors', item(60), [1, 2, 3], 3],
    ['a small room', item(0.5), 1, 1]
  ];
}

describe('label', () => {
  test('stays inside the room', () => {
    setShip();
    const { getRoomLabelSpot } = require('../../src/curved-rooms');
    for (const room of [section(1, 12, 8, 0.3, 1), section(1, 12, 8, 1.6, 0.6), section(1, 6, 0, 2, 2), section(1, 12, 8, 0, FULL_TURN)]) {
      const spot = getRoomLabelSpot(room);
      expect(isPointInRoom(room, spot.x, spot.y)).toBe(true);
      expect(spot.width).toBeGreaterThan(0);
    }
  });

  test('all of the center is labelled in the middle', () => {
    setShip();
    const { getRoomLabelSpot } = require('../../src/curved-rooms');
    const c = getRingCenter(1);
    expect(getRoomLabelSpot(section(1, 6, 0, 0, FULL_TURN))).toEqual({ x: c.x, y: c.y, width: 12 });
  });

  test('a room with no more to come may leave a small hole', () => {
    // A ring from 6 m in to 2 m is far enough out by depth, but its hole holds less than a room
    setShip({ components: [item(1)] });
    place(0, section(1, getRingWallRadius(1), 6, 0, FULL_TURN));
    const area = Math.PI * 9;
    const [only] = planRingFill([1], 4, { itemArea: area, count: 1 });
    expect(only.ringOuter).toBe(6);
    expect(only.ringInner).toBe(2);
    const two = planRingFill([1], 4, { itemArea: area, count: 2 });
    expect(two.length).toBe(2);
    expect(two.every(r => r.ringOuter === 6 && r.ringInner === 0)).toBe(true);
  });
});

describe('filling a floor', () => {
  const sum = rooms => rooms.reduce((total, room) => total + getRingRoomArea(room), 0);

  test('fills a ring exactly, then the next one in', () => {
    setShip();
    const wall = getRingWallRadius(1);
    const rooms = planRingFill([1], 3, { itemArea: 16, count: 40 });
    expect(rooms.length).toBe(40);
    rooms.forEach(room => expect(getRingRoomArea(room)).toBeCloseTo(16, 9));

    const outerRing = rooms.filter(r => Math.abs(r.ringOuter - wall) < 1e-9);
    expect(outerRing.reduce((total, r) => total + r.ringSweep, 0)).toBeCloseTo(FULL_TURN, 9);
    const nextOuter = outerRing[0].ringInner;
    expect(rooms.find(r => r.ringOuter < wall).ringOuter).toBeCloseTo(nextOuter, 9);
  });

  test('no two rooms overlap', () => {
    setShip();
    const rooms = planRingFill([1], 3, { itemArea: 16, count: 40 });
    rooms.forEach((a, i) => rooms.slice(i + 1).forEach(b => expect(placementsOverlap(a, b)).toBe(false)));
  });

  test('the last ones are slices meeting in the middle', () => {
    setShip();
    const usable = getFloorGeometry(1).usableArea;
    const count = Math.floor(usable / 16);
    const rooms = planRingFill([1], 3, { itemArea: 16, count });
    const slices = rooms.filter(r => r.ringInner === 0);
    expect(slices.length).toBeGreaterThan(0);
    const ringsOuter = new Set(rooms.map(r => r.ringOuter));
    expect(ringsOuter.size).toBeGreaterThan(1);
    expect(slices[0].ringOuter).toBe(Math.min(...ringsOuter));
  });

  test('never leaves a hole in the middle too small for a room', () => {
    setShip();
    for (const depth of [2, 3, 4, 5, 6, 7]) {
      for (const itemArea of [9, 16, 22.4, 30, 50]) {
        const rooms = planRingFill([1], depth, { itemArea, count: 1000 });
        const smallest = Math.min(...rooms.map(r => r.ringInner));
        expect(smallest === 0 || Math.PI * smallest * smallest >= itemArea - 1e-6).toBe(true);
      }
    }
  });

  test('uses nearly the whole floor when it has that many', () => {
    setShip();
    const usable = getFloorGeometry(1).usableArea;
    const rooms = planRingFill([1], 3, { itemArea: 16, count: 1000 });
    expect(sum(rooms)).toBeGreaterThan(usable * 0.9);
    expect(sum(rooms)).toBeLessThanOrEqual(usable + 1e-6);
  });

  test('one partial ring when there are few', () => {
    setShip();
    const rooms = planRingFill([1], 3, { itemArea: 16, count: 3 });
    expect(rooms.length).toBe(3);
    expect(new Set(rooms.map(r => r.ringOuter)).size).toBe(1);
    expect(placementsOverlap(rooms[0], rooms[1])).toBe(false);
    expect(rooms[1].ringAngle - rooms[0].ringAngle).toBeCloseTo(rooms[0].ringSweep, 9);
  });

  test('carries on around a ring already started', () => {
    setShip({ components: [item(1)] });
    const first = planRingFill([1], 3, { itemArea: 16, count: 3 });
    place(0, ...first);
    const more = planRingFill([1], 3, { itemArea: 16, count: 3 });
    expect(more[0].ringOuter).toBe(first[0].ringOuter);
    expect(more[0].ringInner).toBe(first[0].ringInner);
    more.forEach(room => expect(isRoomClear(room, [1])).toBe(true));
  });

  test('goes around things in the way', () => {
    setShip({ components: [item(1)] });
    const c = getRingCenter(1);
    const wall = getRingWallRadius(1);
    place(0, { floor: 1, x: c.x + wall - 4, y: c.y - 2, length: 3, width: 4 });
    const rooms = planRingFill([1], 3, { itemArea: 16, count: 200 });
    rooms.forEach(room => expect(isRoomClear(room, [1])).toBe(true));
    expect(rooms.length).toBeGreaterThan(5);
  });

  test('tonnage takes whole rings, then what it needs of the last', () => {
    setShip();
    const wall = getRingWallRadius(1);
    const total = Math.PI * (wall ** 2 - (wall - 3) ** 2) * 1.5;
    const rooms = planRingFill([1], 3, { totalArea: total });
    expect(sum(rooms)).toBeCloseTo(total, 6);
    expect(rooms.length).toBe(2);
    expect(rooms[0].ringSweep).toBe(FULL_TURN);
    expect(rooms[1].ringSweep).toBeLessThan(FULL_TURN);
  });

  test('tonnage that takes it all ends with a circle', () => {
    setShip();
    const usable = getFloorGeometry(1).usableArea;
    const rooms = planRingFill([1], 3, { totalArea: usable });
    expect(sum(rooms)).toBeCloseTo(usable, 6);
    const last = rooms[rooms.length - 1];
    expect(last.ringInner).toBe(0);
    expect(last.ringSweep).toBe(FULL_TURN);
    expect(rooms.slice(0, -1).every(r => r.ringSweep === FULL_TURN && r.ringInner > 0)).toBe(true);
  });

  test('tonnage stops when the floor is full', () => {
    setShip();
    const usable = getFloorGeometry(1).usableArea;
    expect(sum(planRingFill([1], 3, { totalArea: usable * 2 }))).toBeCloseTo(usable, 6);
  });

  test('hull items stop at the first ring', () => {
    setShip();
    const wall = getRingWallRadius(1);
    const rooms = planRingFill([1], 3, { itemArea: 16, count: 1000 }, true);
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms.every(r => Math.abs(r.ringOuter - wall) < 1e-9)).toBe(true);
  });

  test('an item too big for the ring depth gets a deeper ring', () => {
    setShip();
    const wall = getRingWallRadius(1);
    const area = Math.PI * (wall ** 2 - (wall - 3) ** 2) * 1.2;
    const [room] = planRingFill([1], 3, { itemArea: area, count: 1 });
    expect(getRingRoomArea(room)).toBeCloseTo(area, 6);
    expect(room.ringOuter).toBeCloseTo(wall, 9);
  });

  test('nothing to do on a floor that is not round', () => {
    setShip({ shape: 'rectangular' });
    expect(planRingFill([1], 3, { itemArea: 16, count: 3 })).toEqual([]);
  });

  test('depths to choose from', () => {
    setShip();
    const depths = getRingFillDepths([1], 16);
    expect(depths).toContain(4);
    expect(new Set(depths).size).toBe(depths.length);
    expect(getRingFillDepths([1], 0).length).toBeGreaterThan(0);
  });

  test('rings in use are found outermost first', () => {
    setShip({ components: [item(1)] });
    place(0, section(1, 8, 4, 0, 1), section(1, 12, 8, 0, 1), section(1, 12, 8, 2, 1));
    expect(getRingsInUse([1])).toEqual([{ ringOuter: 12, ringInner: 8 }, { ringOuter: 8, ringInner: 4 }]);
  });
});

describe('saving and reopening', () => {
  const design = 'Test,Disk configuration,1000 tons\n';

  function roundTrip(components, entries) {
    global.shipData.componentPlacements[0] = { floors: entries };
    const { floorLength, floorWidth } = require('../../src/floor-utils').getCurrentFloorDimensions();
    const layout = serializeLayout({ ...global.shipData, floorWidth, csvText: design }, new Date(0));
    return restorePlacements(
      JSON.parse(JSON.stringify(layout)),
      components,
      { count: global.shipData.numFloors, length: floorLength, width: floorWidth, armorThickness: 0 }
    );
  }

  test('sections, whole rings and slices come back the same', () => {
    const component = item(4, 12, 'Staterooms');
    setShip({ components: [component] });
    const wall = getRingWallRadius(1);
    const entries = [section(1, wall, wall - 3, 1, 0.5), section(1, wall, wall - 3, 2, 0.5), section(2, wall, wall - 3, 0, FULL_TURN), section(1, 5, 0, 1, 2)];
    const result = roundTrip([component], entries);
    expect(result.problems).toEqual([]);
    const back = result.placements[0].floors;
    expect(back.length).toBe(4);
    back.forEach((room, i) => {
      expect(room).toMatchObject({
        floor: entries[i].floor,
        roomShape: 'ring',
        ringOuter: entries[i].ringOuter,
        ringInner: entries[i].ringInner,
        ringAngle: entries[i].ringAngle,
        ringSweep: entries[i].ringSweep
      });
      expect(room.x).toBeCloseTo(entries[i].x, 9);
    });
  });

  test('a ring room across floors keeps them all', () => {
    const component = item(60);
    setShip({ components: [component] });
    const wall = getRingWallRadius(1);
    const room = section(1, wall, wall - 3, 1, 1);
    const result = roundTrip([component], [1, 2, 3].map(floor => ({ ...room, floor })));
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors.length).toBe(3);
  });

  test('damaged rooms are reported', () => {
    const component = item(4, 12, 'Staterooms');
    setShip({ components: [component] });
    const good = section(1, 8, 4, 0, 1);
    const bad = [
      { ...good, ringOuter: 'x' },
      { ...good, ringInner: -1 },
      { ...good, ringInner: 9 },
      { ...good, ringSweep: 0 },
      { ...good, ringSweep: 7 }
    ];
    const result = restorePlacements(
      { placements: [{ component: 'Fittings|Staterooms|0', item: 'Staterooms', entries: bad }] },
      [component],
      { count: 4, length: 30, width: 30, armorThickness: 0 }
    );
    expect(result.dropped).toBe(5);
  });

  test('a ring too big for the floor is dropped', () => {
    const component = item(4, 12, 'Staterooms');
    setShip({ components: [component] });
    const result = roundTrip([component], [section(1, 500, 490, 0, 0.1)]);
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/no longer fits/);
  });
});

describe('SVG export', () => {
  test('a whole ring exports with its hole', () => {
    const component = item(60);
    setShip({ components: [component] });
    const { floorLength, floorWidth } = require('../../src/floor-utils').getCurrentFloorDimensions();
    global.shipData.componentPlacements[0] = { floors: [section(1, 12, 8, 0, FULL_TURN)] };
    const svg = exportLayoutSvg({ ...global.shipData, floorLength, floorWidth });
    expect(svg).toMatch(/<path d="M[^"]*Z M[^"]*Z" fill-rule="evenodd"/);
  });
});
