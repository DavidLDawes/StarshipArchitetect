'use strict';

const { recalculateFloors, getCurrentFloorDimensions } = require('../../src/floor-utils');
const { restorePlacements } = require('../../src/layout-io');
const { positionRoom, turnArcRoom, getRoomFields } = require('../../src/curved-rooms');
const {
  getLinkedEntries,
  getFloorsAfterMove,
  withoutEntries,
  canPlaceOnFloors,
  updateLinkedEntries
} = require('../../src/placement-logic');

function setShip({ shape = 'rectangular', numFloors = 4, components = [] } = {}) {
  Object.assign(global.shipData, {
    hullShape: shape,
    totalTons: 1000,
    numFloors,
    armorTons: 0,
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

const drive = { category: 'Engines', item: 'Jump Drive', itemName: 'Jump Drive', tons: 60, tonsPerItem: 60, quantity: 1, cost: 0 };
const cabins = { category: 'Crew', item: 'Staterooms', itemName: 'Staterooms', tons: 12, tonsPerItem: 4, quantity: 3, cost: 0 };
const fuel = { category: 'Fuel', item: 'Fuel', itemName: 'Fuel', tons: 20, tonsPerItem: 20, quantity: 1, cost: 0 };
const span = (floors, x = 1, y = 1, length = 6, width = 7) => floors.map(floor => ({ floor, x, y, length, width }));

describe('getLinkedEntries', () => {
  test('all floors of a one-off component belong together', () => {
    setShip({ components: [drive] });
    const entries = span([1, 2, 3]);
    global.shipData.componentPlacements[0] = { floors: entries };
    expect(getLinkedEntries(0, entries[1])).toEqual(entries);
    expect(getLinkedEntries(0, entries[1])).not.toBe(entries);
  });

  test('a component with no quantity counts as a one-off', () => {
    const { quantity, ...noQuantity } = drive;
    expect(quantity).toBe(1);
    setShip({ components: [noQuantity] });
    const entries = span([1, 2]);
    global.shipData.componentPlacements[0] = { floors: entries };
    expect(getLinkedEntries(0, entries[0]).length).toBe(2);
  });

  test('multi-quantity items in the same spot are still separate rooms', () => {
    setShip({ components: [cabins] });
    const entries = span([1, 2]);
    global.shipData.componentPlacements[0] = { floors: entries };
    expect(getLinkedEntries(0, entries[0])).toEqual([entries[0]]);
  });

  test('parts of a component placed by tonnage move on their own', () => {
    setShip({ components: [fuel] });
    const entries = span([1, 2]);
    global.shipData.componentPlacements[0] = { floors: entries };
    expect(getLinkedEntries(0, entries[0])).toEqual([entries[0]]);
  });

  test('an entry that is no longer placed stands alone', () => {
    setShip({ components: [drive] });
    global.shipData.componentPlacements[0] = { floors: span([1, 2]) };
    const gone = span([3])[0];
    expect(getLinkedEntries(0, gone)).toEqual([gone]);
    expect(getLinkedEntries(5, gone)).toEqual([gone]);
  });
});

describe('getFloorsAfterMove', () => {
  beforeEach(() => setShip({ numFloors: 5 }));

  test('moving within its floors keeps them', () => {
    expect(getFloorsAfterMove(span([1, 2, 3]), 3)).toEqual([1, 2, 3]);
  });

  test('moving to another floor shifts by the smallest amount that reaches it', () => {
    expect(getFloorsAfterMove(span([1, 2, 3]), 4)).toEqual([2, 3, 4]);
    expect(getFloorsAfterMove(span([1, 2, 3]), 5)).toEqual([3, 4, 5]);
    expect(getFloorsAfterMove(span([3, 4, 5]), 1)).toEqual([1, 2, 3]);
  });

  test('a single entry just goes to the floor', () => {
    expect(getFloorsAfterMove(span([2]), 5)).toEqual([5]);
  });

  test('gaps between floors are kept, as far as the ship allows', () => {
    expect(getFloorsAfterMove(span([1, 3]), 2)).toEqual([2, 4]);
    expect(getFloorsAfterMove(span([1, 5]), 3)).toBeNull();
  });
});

describe('checking and changing them together', () => {
  test('entries are put back after a check, even if it throws', () => {
    const entries = span([1, 2]);
    const placement = { floors: entries };
    expect(withoutEntries(placement, [entries[0]], () => placement.floors.length)).toBe(1);
    expect(placement.floors).toBe(entries);
    expect(() => withoutEntries(placement, entries, () => { throw new Error('x'); })).toThrow('x');
    expect(placement.floors).toBe(entries);
  });

  test('has to be clear on every floor, but not of itself', () => {
    const { floorLength, floorWidth } = setShip({ components: [drive, cabins] });
    const entries = span([1, 2, 3]);
    const placement = { floors: entries };
    global.shipData.componentPlacements[0] = placement;
    global.shipData.componentPlacements[1] = { floors: [{ floor: 3, x: 12, y: 1, length: 3, width: 3 }] };
    const can = (floors, x, y) => canPlaceOnFloors(placement, entries, floors, x, y, 6, 7, floorLength, floorWidth, 0);
    expect(can([1, 2, 3], 2, 2)).toBe(true);
    expect(can([1, 2, 3], 10, 1)).toBe(false);
    expect(can([1, 2], 10, 1)).toBe(true);
  });

  test('has to fit the space its floors share', () => {
    const { floorLength, floorWidth } = setShip({ shape: 'cone', components: [drive] });
    const entries = span([1, 2]);
    const placement = { floors: entries };
    global.shipData.componentPlacements[0] = placement;
    const inFloorOneOnly = getCurrentFloorDimensions().floorLength / 2 - 3;
    expect(canPlaceOnFloors(placement, entries, [1], inFloorOneOnly, 1, 6, 3, floorLength, floorWidth, 0)).toBe(true);
    expect(canPlaceOnFloors(placement, entries, [1, 2], inFloorOneOnly, 1, 6, 3, floorLength, floorWidth, 0)).toBe(false);
  });

  test('changing them keeps the same objects', () => {
    const entries = span([1, 2]);
    const [first, second] = entries;
    updateLinkedEntries(entries, [3, 4], { x: 9, y: 8 });
    expect(entries[0]).toBe(first);
    expect(first).toMatchObject({ floor: 3, x: 9, y: 8 });
    expect(second).toMatchObject({ floor: 4, x: 9, y: 8 });
  });
});

describe('reopening after a change', () => {
  const reopen = (components, entries) => {
    const { floorLength, floorWidth } = getCurrentFloorDimensions();
    return restorePlacements(
      { placements: [{ component: `${components[0].category}|${components[0].item}|0`, item: components[0].item, entries: JSON.parse(JSON.stringify(entries)) }] },
      components,
      { count: global.shipData.numFloors, length: floorLength, width: floorWidth, armorThickness: 0 }
    );
  };

  test('a moved component keeps all its floors', () => {
    setShip({ components: [drive] });
    const entries = span([1, 2, 3]);
    global.shipData.componentPlacements[0] = { floors: entries };
    updateLinkedEntries(entries, getFloorsAfterMove(entries, 4), { x: 5, y: 6 });
    const result = reopen([drive], entries);
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors.map(e => e.floor)).toEqual([2, 3, 4]);
  });

  test('a turned arc keeps all its floors', () => {
    setShip({ shape: 'disk', components: [drive] });
    const room = positionRoom({ roomShape: 'arc', arcArea: 40 }, [1, 2], 1000, 15);
    const entries = [1, 2].map(floor => ({ ...room, floor }));
    global.shipData.componentPlacements[0] = { floors: entries };
    const turned = turnArcRoom(entries[0], Math.PI / 2);
    const { x, y, length, width } = turned;
    updateLinkedEntries(entries, [1, 2], { x, y, length, width, ...getRoomFields(turned) });
    const result = reopen([drive], entries);
    expect(result.problems).toEqual([]);
    expect(result.placements[0].floors.length).toBe(2);
  });

  test('a layout already out of line still reports the floors it can not keep', () => {
    setShip({ components: [drive] });
    const entries = [...span([1], 1, 1), ...span([2], 9, 9)];
    const result = reopen([drive], entries);
    expect(result.dropped).toBe(1);
    expect(result.problems[0]).toMatch(/already placed/);
  });
});
