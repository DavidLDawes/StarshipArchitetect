'use strict';
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  setupFiles: ['./tests/jest-setup.js'],
  collectCoverageFrom: [
    'src/csv-parser.js',
    'src/floor-utils.js',
    'src/component-dimensions.js',
    'src/component-resize.js',
    'src/placement-logic.js',
    'src/placement-geometry.js',
    'src/hull-access.js',
    'src/hull-shapes.js',
    'src/curved-rooms.js',
    'src/rec-health.js',
    'src/layout-io.js',
    'src/layout-export.js',
  ],
  coverageThreshold: {
    global: { lines: 70, functions: 70, branches: 55 }
  },
  coverageReporters: ['text', 'lcov'],
};
