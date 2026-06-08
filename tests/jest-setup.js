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
