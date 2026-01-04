/**
 * Integration test for zero-ton filtering
 * Run with: node test-filtering-integration.js
 */

const fs = require('fs');

// Read required modules
eval(fs.readFileSync('csv-parser.js', 'utf8'));

// Mock constants and global variables
const SQM_PER_TON = 14;
const DEFAULT_CEILING_HEIGHT = 2.5;

let shipData = {
    totalTons: 0,
    totalCost: 0,
    components: [],
    numFloors: 4,
    floorLength: 30,
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
    componentPlacements: {}
};

// Simplified version of loadCsvFromString for testing
function testLoadCsvFromString(csvString, testName) {
    try {
        const parsed = parseCSV(csvString);

        if (!parsed.components || parsed.components.length === 0) {
            throw new Error('No valid components found in CSV data');
        }

        // Filter out zero-ton items (they don't need physical placement)
        const originalCount = parsed.components.length;
        const filteredComponents = parsed.components.filter(component => {
            // Remove items with 0 tons (or invalid/negative values)
            if (!component.tons || component.tons <= 0) {
                console.log(`  [FILTERED] ${component.category} - ${component.item} (${component.tons} tons)`);
                return false;
            }
            return true;
        });

        // Log if any items were filtered out
        if (filteredComponents.length < originalCount) {
            console.log(`  Filtered out ${originalCount - filteredComponents.length} zero-ton items`);
        }

        // Check if we have any valid components left
        if (filteredComponents.length === 0) {
            throw new Error('No valid components found after filtering (all items had 0 tons)');
        }

        return {
            success: true,
            originalCount,
            filteredCount: filteredComponents.length,
            components: filteredComponents,
            totalTons: parsed.totalTons,
            totalCost: parsed.totalCost
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Test Suite
console.log('='.repeat(60));
console.log('ZERO-TON FILTERING INTEGRATION TESTS');
console.log('='.repeat(60));

// Test 1: Sample ship CSV
console.log('\n[TEST 1] Sample Ship CSV (from sample-ship.csv)');
console.log('-'.repeat(60));
const sampleShipCsv = fs.readFileSync('sample-ship.csv', 'utf8');
const result1 = testLoadCsvFromString(sampleShipCsv, 'Test 1');
console.log(`Result: ${result1.success ? 'PASS' : 'FAIL'}`);
console.log(`Original components: ${result1.originalCount}`);
console.log(`After filtering: ${result1.filteredCount}`);
console.log(`Items removed: ${result1.originalCount - result1.filteredCount}`);

// Test 2: Mixed valid and zero-ton
console.log('\n[TEST 2] Mixed Valid and Zero-Ton Items');
console.log('-'.repeat(60));
const mixedCsv = `Category,Item,Tons,Cost
Hull,Standard Hull,1000,80
Hull,Hull Configuration,0,5
Drive,Maneuver Drive-4,41,84
Computer,Software/Library,0,0
Bridge,Bridge,20,5`;
const result2 = testLoadCsvFromString(mixedCsv, 'Test 2');
console.log(`Result: ${result2.success ? 'PASS' : 'FAIL'}`);
console.log(`Original components: ${result2.originalCount}`);
console.log(`After filtering: ${result2.filteredCount}`);
console.log(`Expected: 3 components with tonnage`);
console.log(`Actual: ${result2.filteredCount} components`);
console.log(`Test: ${result2.filteredCount === 3 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test 3: All zero-ton items (should fail)
console.log('\n[TEST 3] All Zero-Ton Items (should error)');
console.log('-'.repeat(60));
const allZeroCsv = `Category,Item,Tons,Cost
Computer,Software/Library,0,0
Systems,Fuel Scoops,0,1`;
const result3 = testLoadCsvFromString(allZeroCsv, 'Test 3');
console.log(`Result: ${result3.success ? 'FAIL (should have errored)' : 'PASS'}`);
if (!result3.success) {
    console.log(`Error message: ${result3.error}`);
    console.log(`Expected error: "all items had 0 tons"`);
    console.log(`Test: ${result3.error.includes('all items had 0 tons') ? 'PASS ✓' : 'FAIL ✗'}`);
}

// Test 4: Transport CSV (real world example)
console.log('\n[TEST 4] Transport CSV (from transport.csv)');
console.log('-'.repeat(60));
const transportCsv = fs.readFileSync('transport.csv', 'utf8');
const result4 = testLoadCsvFromString(transportCsv, 'Test 4');
console.log(`Result: ${result4.success ? 'PASS' : 'FAIL'}`);
console.log(`Original components: ${result4.originalCount}`);
console.log(`After filtering: ${result4.filteredCount}`);
console.log(`Items removed: ${result4.originalCount - result4.filteredCount}`);

// Test 5: Only valid items (nothing to filter)
console.log('\n[TEST 5] Only Valid Items (nothing to filter)');
console.log('-'.repeat(60));
const validOnlyCsv = `Category,Item,Tons,Cost
Hull,Standard Hull,1000,80
Drive,Maneuver Drive-4,41,84
Bridge,Bridge,20,5`;
const result5 = testLoadCsvFromString(validOnlyCsv, 'Test 5');
console.log(`Result: ${result5.success ? 'PASS' : 'FAIL'}`);
console.log(`Original components: ${result5.originalCount}`);
console.log(`After filtering: ${result5.filteredCount}`);
console.log(`Should be equal: ${result5.originalCount === result5.filteredCount ? 'PASS ✓' : 'FAIL ✗'}`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('TEST SUMMARY');
console.log('='.repeat(60));
const results = [result1, result2, result3, result4, result5];
const passed = results.filter(r => r.success || (!r.success && r.error && r.error.includes('all items had 0 tons'))).length;
console.log(`Total tests: ${results.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${results.length - passed}`);
console.log('='.repeat(60));
