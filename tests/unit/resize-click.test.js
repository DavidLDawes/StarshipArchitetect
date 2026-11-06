'use strict';

const { recalculateFloors } = require('../../src/floor-utils');
const placementLogic = require('../../src/placement-logic');
const { resizeState, consumeResizeClick, isResizeValid } = require('../../src/component-resize');

// In the browser every src/ module shares the global scope
Object.assign(global, placementLogic);

const { getLinkedEntries } = placementLogic;

const drive = { category: 'Engines', item: 'Jump Drive', itemName: 'Jump Drive', tons: 60, tonsPerItem: 60, quantity: 1, cost: 0 };
const cabins = { category: 'Crew', item: 'Staterooms', itemName: 'Staterooms', tons: 12, tonsPerItem: 4, quantity: 3, cost: 0 };
const turret = { category: 'Weapons', item: 'Triple Turret', itemName: 'Triple Turret', tons: 3, tonsPerItem: 3, quantity: 1, cost: 0 };

function setShip(components) {
  Object.assign(global.shipData, {
    hullShape: 'rectangular',
    totalTons: 1000,
    numFloors: 4,
    armorTons: 0,
    ceilingHeight: 2.5,
    floorLength: 30,
    components,
    componentPlacements: {},
    combineRecHealth: false
  });
  recalculateFloors({ resetLength: true });
}

/** Start resizing one entry, as startResize does */
function resizing(componentIndex, pos) {
  resizeState.componentIndex = componentIndex;
  resizeState.entries = getLinkedEntries(componentIndex, pos);
  resizeState.floors = resizeState.entries.map(e => e.floor);
}

afterEach(() => {
  resizeState.isResizing = false;
  resizeState.justFinished = false;
  resizeState.entries = null;
  resizeState.floors = null;
});

describe('consumeResizeClick', () => {
  test('an ordinary click goes through', () => {
    expect(consumeResizeClick()).toBe(false);
  });

  test('the click that ends a drag is ignored, and only that one', () => {
    resizeState.justFinished = true;
    expect(consumeResizeClick()).toBe(true);
    expect(consumeResizeClick()).toBe(false);
  });

  test('a click during a drag is ignored', () => {
    resizeState.isResizing = true;
    expect(consumeResizeClick()).toBe(true);
  });
});

describe('isResizeValid', () => {
  test('a room can not grow over another room of the same component', () => {
    setShip([cabins]);
    const first = { floor: 1, x: 1, y: 1, length: 4, width: 4 };
    const second = { floor: 1, x: 6, y: 1, length: 4, width: 4 };
    global.shipData.componentPlacements[0] = { floors: [first, second] };
    resizing(0, first);
    expect(isResizeValid(1, 1, 5, 4)).toBe(true);
    expect(isResizeValid(1, 1, 6, 4)).toBe(false);
  });

  test('it does not get in its own way', () => {
    setShip([drive]);
    const entries = [1, 2].map(floor => ({ floor, x: 1, y: 1, length: 6, width: 7 }));
    global.shipData.componentPlacements[0] = { floors: entries };
    resizing(0, entries[0]);
    expect(isResizeValid(1, 1, 7, 6)).toBe(true);
    expect(global.shipData.componentPlacements[0].floors).toBe(entries);
  });

  test('all the floors it spans have to be clear', () => {
    setShip([drive, cabins]);
    const entries = [1, 2].map(floor => ({ floor, x: 1, y: 1, length: 6, width: 7 }));
    global.shipData.componentPlacements[0] = { floors: entries };
    global.shipData.componentPlacements[1] = { floors: [{ floor: 2, x: 8, y: 1, length: 3, width: 3 }] };
    resizing(0, entries[0]);
    expect(isResizeValid(1, 1, 7, 6)).toBe(true);
    expect(isResizeValid(1, 1, 8, 6)).toBe(false);
  });

  test('it has to stay inside the floor', () => {
    setShip([drive]);
    const entries = [{ floor: 1, x: 1, y: 1, length: 6, width: 7 }];
    global.shipData.componentPlacements[0] = { floors: entries };
    resizing(0, entries[0]);
    expect(isResizeValid(1, 1, 500, 1)).toBe(false);
  });

  test('a hull component has to stay on the hull', () => {
    setShip([turret]);
    const entries = [{ floor: 1, x: 0, y: 1, length: 3, width: 3 }];
    global.shipData.componentPlacements[0] = { floors: entries };
    resizing(0, entries[0]);
    expect(isResizeValid(0, 1, 3, 3)).toBe(true);
    expect(isResizeValid(2, 2, 3, 3)).toBe(false);
  });
});
