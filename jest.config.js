'use strict';
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  setupFiles: ['./tests/jest-setup.js'],
  collectCoverageFrom: [
    'src/csv-parser.js',
    'src/floor-utils.js',
    'src/component-dimensions.js',
    'src/placement-logic.js',
  ],
  coverageThreshold: {
    global: { lines: 70, functions: 70, branches: 55 }
  },
  coverageReporters: ['text', 'lcov'],
};
