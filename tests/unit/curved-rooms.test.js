'use strict';

const { calculateComponentArea } = require('../../src/component-dimensions');
const { recalculateFloors, getShipGeometry, getCurrentFloorDimensions, getFloorGeometry } = require('../../src/floor-utils');
const { getFloorUsedArea, getPlacementRects, sumRectArea, analyzeFloorFreeSpace, planAreaFill, getEntryTons } = require('../../src/placement-geometry');
const { polygonArea, isPointInConvexPolygon, getPolygonBounds, doConvexPolygonsOverlap, rectanglePolygon, getPolygonCentroid } = require('../../src/hull-shapes');
const { checkOverlap, findValidPosition } = require('../../src/placement-logic');
const { restorePlacements, serializeLayout, parseLayout, LAYOUT_VERSION } = require('../../src/layout-io');
const { exportLayoutSvg } = require('../../src/layout-export');
const {
  getFloorInnerPolygon,
  getArcRadius,
  getFloorsWithRadius,
  getFloorsForRoom,
  arcRoomPolygon,
  getRoomOutline,
  getRoomArea,
  placementsOverlap,
  isRoomClear,
  isRoomFitting,
  roomTouchesHull,
  positionRoom,
  findRoomSpot,
  turnArcRoom,
  getRoomShapeOptions,
  parseRoomChoice
} = require('../../src/curved-rooms');

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

const item = (tons, extra = {}) => ({ category: 'Misc', item: 'Thing', itemName: 'Thing', tons, tonsPerItem: tons, quantity: 1, cost: 0, ...extra });
const circleOf = (x, y, diameter, floor = 1) => ({ floor, x, y, length: diameter, width: diameter, roomShape: 'circle' });
const place = (index, ...entries) => { global.shipData.componentPlacements[index] = { floors: entries }; };
const arcsIn = options => options.filter(o => o.roomShape === 'arc');
const circlesIn = options => options.filter(o => o.roomShape === 'circle');

/** Arc on floor 1 facing a direction */
function arcFacing(room, angle) {
  const box = getPolygonBounds(getFloorInnerPolygon(1));
  return positionRoom(room, [1],
    box.x + box.length / 2 + Math.cos(angle) * 100,
    box.y + box.width / 2 + Math.sin(angle) * 100);
}

describe('size options', () => {
  test('a circle has the same area as the item', () => {
    setShip();
    const c = item(10);
    const [circle] = circlesIn(getRoomShapeOptions(c, 1, 1));
    const { length } = parseRoomChoice(circle.value);
    expect(Math.PI * (length / 2) ** 2).toBeCloseTo(calculateComponentArea(c), 6);
    expect(circle.label).toContain('radius');
  });

  test('a circle over several floors holds that share of the item on each', () => {
    setShip({ shape: 'disk' });
    const c = item(30);
    const [circle] = circlesIn(getRoomShapeOptions(c, [1, 2, 3], 3));
    const { length } = parseRoomChoice(circle.value);
    expect(Math.PI * (length / 2) ** 2).toBeCloseTo(calculateComponentArea(c) / 3, 6);
    expect(circle.label).toContain('per floor');
  });

  test('a circle that does not fit is not offered', () => {
    const { floorLength, floorWidth } = setShip();
    const diameter = Math.max(floorLength, floorWidth) + 1;
    const tons = (Math.PI * (diameter / 2) ** 2 * 2.5) / 14;
    expect(circlesIn(getRoomShapeOptions(item(tons), 1, 1))).toEqual([]);
  });

  test('a circle has to fit the floor it is on', () => {
    setShip({ shape: 'cone', numFloors: 4 });
    const area = getFloorGeometry(4).usableArea * 1.5;
    const big = item((area * 2.5) / 14);
    expect(circlesIn(getRoomShapeOptions(big, 1, 1)).length).toBe(1);
    expect(circlesIn(getRoomShapeOptions(big, 4, 1)).length).toBe(0);
  });

  test.each(['rectangular', 'wedge', 'cylinder', 'wing', 'lifting-body'])('%s floors offer no arc', shape => {
    setShip({ shape });
    expect(arcsIn(getRoomShapeOptions(item(10), 1, 1))).toEqual([]);
  });

  test('a disk has one arc, for one floor or several', () => {
    setShip({ shape: 'disk' });
    expect(arcsIn(getRoomShapeOptions(item(10), 2, 1)).length).toBe(1);
    const shared = arcsIn(getRoomShapeOptions(item(30), [1, 2, 3], 3));
    expect(shared.length).toBe(1);
    expect(shared[0].label).toContain('per floor');
    expect(parseRoomChoice(shared[0].value).arcArea).toBeCloseTo(calculateComponentArea(item(30)) / 3, 6);
  });

  test('a cone has one arc per radius, and the chosen floor comes first', () => {
    setShip({ shape: 'cone', numFloors: 4 });
    const options = arcsIn(getRoomShapeOptions(item(2), 3, 1));
    expect(options.length).toBe(4);
    expect(new Set(options.map(o => parseRoomChoice(o.value).radius)).size).toBe(4);
    expect(parseRoomChoice(options[0].value).radius).toBeCloseTo(getArcRadius(3), 6);
    expect(options[0].label).toContain('(Floor 3)');
  });

  test('floors of different radius can not share an arc', () => {
    setShip({ shape: 'cone', numFloors: 4 });
    expect(arcsIn(getRoomShapeOptions(item(4), [1, 2], 2))).toEqual([]);
  });

  test('a sphere groups the floors that match, and those floors can share an arc', () => {
    setShip({ shape: 'sphere', numFloors: 6 });
    const options = arcsIn(getRoomShapeOptions(item(1), 1, 1));
    expect(options.length).toBe(3);
    expect(options[0].label).toContain('(Floors 1, 6)');
    expect(arcsIn(getRoomShapeOptions(item(2), [3, 4], 2)).length).toBe(1);
    expect(arcsIn(getRoomShapeOptions(item(2), [2, 3], 2))).toEqual([]);
  });

  test('a floor too small for the arc gets no option', () => {
    setShip({ shape: 'cone', numFloors: 4 });
    const area = getFloorGeometry(4).usableArea * 1.5;
    const options = arcsIn(getRoomShapeOptions(item((area * 2.5) / 14), 1, 1));
    expect(options.length).toBe(3);
    options.forEach(o => {
      expect(getFloorsWithRadius(parseRoomChoice(o.value).radius)).not.toContain(4);
    });
  });

  test('an item with no size has no options', () => {
    setShip({ shape: 'disk' });
    expect(getRoomShapeOptions(item(0), 1, 1)).toEqual([]);
  });

  test('rectangle values are not read as curved shapes', () => {
    expect(parseRoomChoice('5,4')).toBeNull();
    expect(parseRoomChoice('circle:nope')).toBeNull();
    expect(parseRoomChoice('arc:0:3')).toBeNull();
    expect(parseRoomChoice('')).toBeNull();
  });
});

describe('arc shape', () => {
  test.each([0.05, 0.3, 0.5, 0.8, 1])('uses the exact area at %d of the floor, inside the wall', share => {
    setShip({ shape: 'disk', armorTons: 20 });
    const inner = getFloorInnerPolygon(1);
    const area = polygonArea(inner) * share;
    for (const angle of [0, 0.7, 2, -1.3]) {
      const outline = arcRoomPolygon(inner, angle, area);
      expect(polygonArea(outline)).toBeCloseTo(area, 6);
      outline.forEach(([x, y]) => expect(isPointInConvexPolygon(inner, x, y)).toBe(true));
    }
  });

  test('its curved side has the radius of the floor and is centered on the direction', () => {
    setShip({ shape: 'disk' });
    const inner = getFloorInnerPolygon(1);
    const box = getPolygonBounds(inner);
    const cx = box.x + box.length / 2;
    const cy = box.y + box.width / 2;
    const radius = box.length / 2;
    const outline = arcRoomPolygon(inner, 0, polygonArea(inner) * 0.1);
    const onWall = outline.filter(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - radius) < 1e-6);
    expect(onWall.length).toBeGreaterThan(5);
    expect(getPolygonCentroid(outline).x).toBeGreaterThan(cx);
    expect(getPolygonCentroid(outline).y).toBeCloseTo(cy, 6);
  });

  test('a floor with no usable space has no arc', () => {
    expect(arcRoomPolygon([], 0, 5)).toEqual([]);
  });

  test('faces the pointer, and turning keeps the size', () => {
    setShip({ shape: 'disk' });
    const room = { roomShape: 'arc', arcArea: 40 };
    const box = getPolygonBounds(getFloorInnerPolygon(1));
    const arc = positionRoom(room, [1], box.x + box.length / 2, box.y - 5);
    expect(arc.arcAngle).toBeCloseTo(-Math.PI / 2, 6);
    expect(arc.y).toBeCloseTo(box.y, 6);
    const turned = turnArcRoom(arc, Math.PI / 2);
    expect(turned.arcAngle).toBeCloseTo(0, 6);
    expect(getRoomArea(turned)).toBe(40);
    expect(polygonArea(getRoomOutline(turned))).toBeCloseTo(40, 6);
  });

  test('stays cut to the radius it was chosen for', () => {
    setShip({ shape: 'cone', numFloors: 4 });
    const room = { roomShape: 'arc', arcArea: 5, radius: getArcRadius(1) };
    expect(positionRoom(room, [1], 0, 0)).not.toBeNull();
    expect(positionRoom(room, [2], 0, 0)).toBeNull();
    expect(getFloorsForRoom(room, 1)).toEqual([1]);
    expect(getFloorsForRoom({ roomShape: 'circle' }, 1)).toEqual([1, 2, 3, 4]);
  });

  test('an arc too big for the floor has nowhere to go', () => {
    setShip({ shape: 'cone', numFloors: 4 });
    const room = { roomShape: 'arc', arcArea: getFloorGeometry(4).usableArea + 1 };
    expect(positionRoom(room, [4], 0, 0)).toBeNull();
    expect(isRoomFitting(room, [4])).toBe(false);
  });
});

describe('overlap with true outlines', () => {
  beforeEach(() => setShip());

  test('a rectangle can sit in the corner of the box around a circle', () => {
    place(0, circleOf(10, 10, 6));
    expect(checkOverlap(1, 10, 10, 0.5, 0.5)).toBe(false);
    expect(checkOverlap(1, 10, 10, 2, 2)).toBe(true);
    expect(checkOverlap(1, 12, 12, 1, 1)).toBe(true);
  });

  test('touching does not count', () => {
    place(0, circleOf(10, 10, 6));
    expect(checkOverlap(1, 16, 12, 2, 2)).toBe(false);
    expect(placementsOverlap(circleOf(10, 10, 6), circleOf(16, 10, 6))).toBe(false);
    expect(placementsOverlap(circleOf(10, 10, 6), circleOf(15.9, 10, 6))).toBe(true);
  });

  test('only checks against the same floor', () => {
    place(0, circleOf(10, 10, 6, 2));
    expect(checkOverlap(1, 12, 12, 1, 1)).toBe(false);
    expect(checkOverlap(2, 12, 12, 1, 1)).toBe(true);
  });

  test('a circle diagonally beside another circle is clear even though the boxes overlap', () => {
    expect(placementsOverlap(circleOf(10, 10, 6), circleOf(14.5, 14.5, 6))).toBe(false);
  });

  test('polygons apart, touching and overlapping', () => {
    const a = rectanglePolygon(0, 0, 2, 2);
    expect(doConvexPolygonsOverlap(a, rectanglePolygon(3, 0, 2, 2))).toBe(false);
    expect(doConvexPolygonsOverlap(a, rectanglePolygon(2, 0, 2, 2))).toBe(false);
    expect(doConvexPolygonsOverlap(a, rectanglePolygon(1, 1, 2, 2))).toBe(true);
    expect(doConvexPolygonsOverlap(a, [])).toBe(false);
  });

  test('a free region slightly poking into a room is not an overlap, a real one is', () => {
    const circle = circleOf(10, 10, 6);
    const band = getPlacementRects(circle)[0];
    const beside = { floor: 1, x: band.x + band.length, y: band.y, length: 1, width: band.width };
    const region = { ...beside, rects: [{ x: beside.x, y: beside.y, length: 1, width: beside.width }] };
    expect(placementsOverlap(circle, region)).toBe(false);
    const inside = { floor: 1, x: 12, y: 12, length: 1, width: 1, rects: [{ x: 12, y: 12, length: 1, width: 1 }] };
    expect(placementsOverlap(circle, inside)).toBe(true);
  });

  test('rectangles slide off a circle using its real shape', () => {
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    place(0, circleOf(10, 10, 6));
    const spot = findValidPosition(1, 12, 12, 2, 2, floorLength, floorWidth, -1);
    expect(spot).not.toBeNull();
    expect(checkOverlap(1, spot.x, spot.y, 2, 2)).toBe(false);
  });
});

describe('finding a spot', () => {
  test('circles stay inside every kind of floor', () => {
    for (const shape of ['rectangular', 'disk', 'cone', 'wing', 'lifting-body']) {
      setShip({ shape, armorTons: 10 });
      const circle = positionRoom({ roomShape: 'circle', length: 6 }, [1], -100, -100);
      expect(isRoomFitting(circle, [1])).toBe(true);
      expect(roomTouchesHull(circle, [1])).toBe(true);
    }
  });

  test('a circle exactly as wide as a rectangular floor still fits', () => {
    const { floorLength, floorWidth } = setShip();
    const circle = positionRoom({ roomShape: 'circle', length: Math.min(floorLength, floorWidth) }, [1], 5, 5);
    expect(circle).not.toBeNull();
    expect(isRoomFitting(circle, [1])).toBe(true);
  });

  test('a circle that must be on the hull goes to the wall', () => {
    const { floorLength, floorWidth } = setShip();
    const circle = positionRoom({ roomShape: 'circle', length: 4 }, [1], floorLength / 2, floorWidth / 2, true);
    expect(roomTouchesHull(circle, [1])).toBe(true);
    const free = positionRoom({ roomShape: 'circle', length: 4 }, [1], floorLength / 2, floorWidth / 2, false);
    expect(roomTouchesHull(free, [1])).toBe(false);
  });

  test('a circle slides clear of what is in the way and stays close', () => {
    setShip();
    place(0, circleOf(10, 10, 6));
    const spot = findRoomSpot({ roomShape: 'circle', length: 4 }, [1], 13, 13);
    expect(isRoomClear(spot, [1])).toBe(true);
    expect(isRoomFitting(spot, [1])).toBe(true);
    expect(Math.hypot(spot.x + 2 - 13, spot.y + 2 - 13)).toBeLessThan(5.3);
  });

  test('a circle on the hull slides along it', () => {
    setShip();
    place(0, { floor: 1, x: 0, y: 0, length: 10, width: 4 });
    const spot = findRoomSpot({ roomShape: 'circle', length: 4 }, [1], 2, 1, -1, true);
    expect(isRoomClear(spot, [1])).toBe(true);
    expect(roomTouchesHull(spot, [1])).toBe(true);
  });

  test('a circle spanning floors has to be clear on all of them', () => {
    setShip();
    place(0, circleOf(10, 10, 6, 2));
    const start = { roomShape: 'circle', length: 4 };
    expect(isRoomClear(positionRoom(start, [1], 13, 13), [1])).toBe(true);
    expect(isRoomClear(positionRoom(start, [1, 2], 13, 13), [1, 2])).toBe(false);
    expect(isRoomClear(findRoomSpot(start, [1, 2], 13, 13), [1, 2])).toBe(true);
  });

  test('an arc slides around the wall, close up against what is in the way', () => {
    setShip({ shape: 'disk' });
    const room = { roomShape: 'arc', arcArea: 20 };
    const first = { floor: 1, ...arcFacing(room, 0) };
    place(0, first);
    const box = getPolygonBounds(getFloorInnerPolygon(1));
    const spot = findRoomSpot(room, [1], box.x + box.length + 5, box.y + box.width / 2);
    expect(spot).not.toBeNull();
    expect(isRoomClear(spot, [1])).toBe(true);

    // Two equal arcs that just touch are this far apart
    const radius = box.length / 2;
    const halfAngle = Math.acos(1 - getPolygonBounds(getRoomOutline(first)).length / radius);
    expect(Math.abs(spot.arcAngle)).toBeGreaterThan(2 * halfAngle - 0.02);
    expect(Math.abs(spot.arcAngle)).toBeLessThan(2 * halfAngle + 0.02);
  });

  test('no room left means no spot', () => {
    setShip({ shape: 'disk', numFloors: 2 });
    place(0, { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: getFloorGeometry(1).usableArea }, 0) });
    expect(findRoomSpot({ roomShape: 'arc', arcArea: 5 }, [1], 0, 0)).toBeNull();
    expect(findRoomSpot({ roomShape: 'circle', length: 4 }, [1], 15, 15)).toBeNull();
    expect(findRoomSpot({ roomShape: 'circle', length: 4 }, [1], 15, 15, -1, true)).toBeNull();
    expect(findRoomSpot({ roomShape: 'circle', length: 4 }, [2], 15, 15)).not.toBeNull();
  });
});

describe('free space and area', () => {
  test('bands add up to about the true area, which is what counts as used', () => {
    setShip();
    const circle = circleOf(10, 10, 8);
    place(0, circle);
    const area = getRoomArea(circle);
    expect(sumRectArea(getPlacementRects(circle)) / area).toBeGreaterThan(0.98);
    expect(sumRectArea(getPlacementRects(circle)) / area).toBeLessThan(1.02);
    expect(getFloorUsedArea(1)).toBeCloseTo(area, 6);
    expect(getEntryTons(circle)).toBeCloseTo((area * 2.5) / 14, 6);
  });

  test('the bands of an arc add up to about its area, even when it is small', () => {
    setShip({ shape: 'disk' });
    const arc = { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: 3 }, 0) };
    expect(sumRectArea(getPlacementRects(arc)) / 3).toBeGreaterThan(0.95);
    expect(sumRectArea(getPlacementRects(arc)) / 3).toBeLessThan(1.05);
  });

  test('free space leaves out rooms, and a fill around them comes to the right total', () => {
    const { floorLength, floorWidth } = setShip({ shape: 'disk', numFloors: 4 });
    const circle = { floor: 1, ...positionRoom({ roomShape: 'circle', length: 8 }, [1], 15, 15) };
    const arc = { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: 30 }, 0) };
    place(0, circle, arc);
    const usable = getFloorGeometry(1).usableArea;
    const { regions } = analyzeFloorFreeSpace(1, floorLength, floorWidth, 0);
    const free = regions.reduce((sum, r) => sum + r.area, 0);
    expect(Math.abs(free - (usable - getRoomArea(circle) - 30))).toBeLessThan(usable * 0.02);
    const plan = planAreaFill(regions, 10);
    expect(plan.reduce((sum, p) => sum + p.area, 0)).toBeCloseTo(10, 6);
  });

  test('the outline gets recalculated when a room moves', () => {
    setShip();
    const circle = circleOf(10, 10, 6);
    const before = getPolygonBounds(getRoomOutline(circle));
    circle.x = 12;
    const after = getPolygonBounds(getRoomOutline(circle));
    expect(after.x).toBeCloseTo(before.x + 2, 6);
  });

  test('an arc follows the ship when the armor changes', () => {
    setShip({ shape: 'disk' });
    const arc = { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: 9 }, 0) };
    const outline = getRoomOutline(arc);
    expect(getRoomOutline(arc)).toBe(outline);
    global.shipData.armorTons = 10;
    expect(getShipGeometry().armorThickness).toBeGreaterThan(0);
    expect(getRoomOutline(arc)).not.toBe(outline);
  });
});

describe('layouts', () => {
  const a = { category: 'Misc', item: 'Tank', itemName: 'Tank', tons: 10, tonsPerItem: 10, quantity: 1, cost: 0 };
  const b = { category: 'Misc', item: 'Vat', itemName: 'Vat', tons: 5, tonsPerItem: 5, quantity: 1, cost: 0 };
  const layoutOf = (...groups) => ({ placements: groups.map(([c, entries]) => ({ component: `${c.category}|${c.item}|0`, item: c.item, entries })) });
  const floorInfo = () => {
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    return { count: global.shipData.numFloors, length: floorLength, width: floorWidth, armorThickness: global.shipData.armorThickness || 0 };
  };

  test('circles and arcs survive saving and opening', () => {
    setShip({ shape: 'disk', components: [a, b] });
    const circle = { floor: 1, ...positionRoom({ roomShape: 'circle', length: 6 }, [1], 15, 15) };
    const arc = { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: 28 }, 0) };
    place(0, circle);
    place(1, arc);
    const saved = parseLayout(JSON.stringify({
      ...serializeLayout({ ...global.shipData, floorWidth: 30 }),
      ship: { csv: 'x' }
    }));
    expect(saved.version).toBe(LAYOUT_VERSION);
    const result = restorePlacements(saved, [a, b], floorInfo());
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors[0].roomShape).toBe('circle');
    const restored = result.placements[1].floors[0];
    expect(restored.roomShape).toBe('arc');
    expect(restored.arcAngle).toBeCloseTo(arc.arcAngle, 9);
    expect(restored.arcArea).toBe(28);
    expect(restored.x).toBeCloseTo(arc.x, 6);
    expect(restored.length).toBeCloseTo(arc.length, 6);
  });

  test('a spanning circle keeps all its floors', () => {
    setShip({ shape: 'disk' });
    const spot = positionRoom({ roomShape: 'circle', length: 6 }, [1, 2], 15, 15);
    const entries = [{ ...spot, floor: 1 }, { ...spot, floor: 2 }];
    const result = restorePlacements(layoutOf([a, entries]), [a], floorInfo());
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors.length).toBe(2);
  });

  test('a rectangle in the corner of the box around a circle is not an overlap', () => {
    setShip({ components: [a, b] });
    const rect = { floor: 1, x: 10, y: 10, length: 0.5, width: 0.5 };
    const result = restorePlacements(layoutOf([a, [circleOf(10, 10, 6)]], [b, [rect]]), [a, b], floorInfo());
    expect(result.problems).toEqual([]);
  });

  test('overlapping rooms are reported', () => {
    setShip({ components: [a, b] });
    const result = restorePlacements(
      layoutOf([a, [circleOf(10, 10, 6)]], [b, [circleOf(12, 12, 6)]]), [a, b], floorInfo());
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/overlaps/);
  });

  test('damaged shapes are skipped', () => {
    setShip({ components: [a] });
    const entries = [
      { floor: 1, x: 1, y: 1, length: 3, width: 3, roomShape: 'blob' },
      { floor: 1, x: 1, y: 1, length: 3, width: 4, roomShape: 'circle' },
      { floor: 1, x: 1, y: 1, length: 3, width: 3, roomShape: 'arc', arcAngle: 'east', arcArea: 3 },
      { floor: 1, x: 1, y: 1, length: 3, width: 3, roomShape: 'arc', arcAngle: 0, arcArea: -3 }
    ];
    const result = restorePlacements(layoutOf([a, entries]), [a], floorInfo());
    expect(result.dropped).toBe(4);
    expect(result.problems.every(p => /damaged/.test(p))).toBe(true);
  });

  test('a circle outside the hull, or an arc off a round floor, no longer fits', () => {
    setShip({ components: [a, b] });
    const arc = { floor: 1, x: 1, y: 1, length: 3, width: 3, roomShape: 'arc', arcAngle: 0, arcArea: 10 };
    const result = restorePlacements(layoutOf([a, [circleOf(-3, 5, 6)]], [b, [arc]]), [a, b], floorInfo());
    expect(result.dropped).toBe(2);
    expect(result.problems.every(p => /no longer fits/.test(p))).toBe(true);
  });

  test('a hull item keeps its place when its shape touches the hull', () => {
    const gun = { category: 'Weapons', item: 'Turret', itemName: 'Turret', tons: 5, tonsPerItem: 5, quantity: 1, cost: 0 };
    setShip({ shape: 'disk', components: [gun] });
    const onWall = { floor: 1, ...positionRoom({ roomShape: 'circle', length: 4 }, [1], 15, 15, true) };
    expect(restorePlacements(layoutOf([gun, [onWall]]), [gun], floorInfo()).restored).toBe(1);
    const arc = { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: 9 }, 0) };
    expect(restorePlacements(layoutOf([gun, [arc]]), [gun], floorInfo()).restored).toBe(1);
    const box = getPolygonBounds(getFloorInnerPolygon(1));
    const away = circleOf(box.x + box.length / 2 - 2, box.y + box.width / 2 - 2, 4);
    const result = restorePlacements(layoutOf([gun, [away]]), [gun], floorInfo());
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/touches the outer hull/);
  });

  test('layouts from before these shapes still open', () => {
    setShip({ components: [a] });
    const older = {
      format: 'starship-architect-layout',
      version: 3,
      ship: { csv: 'x' },
      floors: { shape: 'rectangular', count: 4, length: 30, ceilingHeight: 2.5 },
      placements: [{ component: 'Misc|Tank|0', item: 'Tank', entries: [{ floor: 1, x: 1, y: 1, length: 4, width: 4 }] }]
    };
    const layout = parseLayout(JSON.stringify(older));
    expect(layout.version).toBe(LAYOUT_VERSION);
    expect(restorePlacements(layout, [a], floorInfo()).restored).toBe(1);
  });
});

describe('deck plan export', () => {
  test('curved rooms export as their shape, on top of the other rooms', () => {
    setShip({ shape: 'disk' });
    const c = item(10);
    const other = item(5, { item: 'Fuel', itemName: 'Fuel', category: 'Fuel' });
    const circle = { floor: 1, ...positionRoom({ roomShape: 'circle', length: 5 }, [1], 15, 15) };
    const arc = { floor: 1, ...arcFacing({ roomShape: 'arc', arcArea: 20 }, 0) };
    const svg = exportLayoutSvg({
      ...global.shipData,
      components: [c, other],
      floorWidth: getCurrentFloorDimensions().floorWidth,
      componentPlacements: {
        0: { floors: [circle, arc] },
        1: { floors: [{ floor: 1, x: 12, y: 2, length: 2, width: 2 }] }
      }
    });
    expect((svg.match(/<circle/g) || []).length).toBe(1);
    expect(svg.indexOf('<circle')).toBeGreaterThan(svg.indexOf('data-category="Fuel"'));
    expect(svg.slice(svg.indexOf('<circle'))).toContain('<path d="M');
  });
});
