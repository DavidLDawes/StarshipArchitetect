'use strict';

global.SQM_PER_TON = 14;
global.DEFAULT_CEILING_HEIGHT = 2.5;
global.shipData = {
  shipName: '',
  totalTons: 1000,
  totalCost: 0,
  components: [],
  armorTons: 0,
  armorThickness: 0,
  numFloors: 4,
  floorLength: 30,
  ceilingHeight: 2.5,
  componentPlacements: {}
};
global.uiState = {
  selectedComponent: null,
  isPlacingComponent: false,
  placementData: null,
  placementHistory: [],
  redoHistory: [],
  selectedPlacement: null
};

// In the browser every src/ module shares the global scope; mirror that for
// helpers other modules call (e.g. placement-logic uses getPlacementRects).
Object.assign(global, require('../src/floor-utils'));
Object.assign(global, require('../src/placement-geometry'));
Object.assign(global, require('../src/hull-access'));
Object.assign(global, require('../src/hull-shapes'));
Object.assign(global, require('../src/curved-rooms'));
Object.assign(global, require('../src/component-dimensions'));
Object.assign(global, require('../src/rec-health'));
Object.assign(global, require('../src/layout-io'));
