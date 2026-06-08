/**
 * Test script to verify CSV parsing from URL parameter
 * Run this in browser console to test the logic
 */

// Test 1: Simple CSV
console.log('=== Test 1: Simple CSV ===');
const simpleCsv = `Category,Item,Tons,Cost
Engine,Maneuver Drive,75,1000
Power,Power Plant,50,800`;

try {
    const result1 = parseCSV(simpleCsv);
    console.log('✓ Parsed components:', result1.components.length);
    console.log('✓ Total tons:', result1.totalTons);
    console.log('✓ Components:', result1.components);
    console.assert(result1.components.length === 2, 'Should have 2 components');
    console.log('Test 1 PASSED\n');
} catch (e) {
    console.error('✗ Test 1 FAILED:', e);
}

// Test 2: URL Encoding/Decoding
console.log('=== Test 2: URL Encoding/Decoding ===');
const urlEncodedCsv = encodeURIComponent(simpleCsv);
console.log('Encoded length:', urlEncodedCsv.length);
const decodedCsv = decodeURIComponent(urlEncodedCsv);
console.assert(decodedCsv === simpleCsv, 'Decoded CSV should match original');
console.log('Test 2 PASSED\n');

// Test 3: CSV with commas in fields
console.log('=== Test 3: CSV with quoted fields ===');
const quotedCsv = `Category,Item,Tons,Cost
Hull,"Standard Hull, Type A",1000,80
Drive,"Maneuver Drive-4, Advanced",41,84`;

try {
    const result3 = parseCSV(quotedCsv);
    console.log('✓ Parsed components:', result3.components.length);
    console.log('✓ Components:', result3.components);
    console.assert(result3.components.length === 2, 'Should have 2 components');
    console.log('Test 3 PASSED\n');
} catch (e) {
    console.error('✗ Test 3 FAILED:', e);
}

// Test 4: Invalid CSV
console.log('=== Test 4: Invalid CSV ===');
const invalidCsv = 'invalid data here';
try {
    const result4 = parseCSV(invalidCsv);
    console.error('✗ Test 4 FAILED: Should have thrown error');
} catch (e) {
    console.log('✓ Correctly caught error:', e.message);
    console.log('Test 4 PASSED\n');
}

// Test 5: Full sample ship CSV
console.log('=== Test 5: Full Sample Ship ===');
const fullCsv = `Category,Item,Tons,Cost
Hull,Standard Hull,1000,80
Hull,Hull Configuration,0,5
Hull,Armor (TL 13),10,4
Drive,Maneuver Drive-4,41,84
Drive,Jump Drive-2,50,75
Power,Power Plant-4,43,86
Fuel,Jump Fuel (2 parsecs),200,0
Fuel,Power Plant Fuel (4 weeks),10,0
Bridge,Bridge,20,5
Bridge,Computer/20,0,5
Computer,Software/Jump Control/2,0,0.2
Computer,Software/Maneuver/0,0,0
Computer,Software/Library,0,0
Sensors,Basic Military Sensors,2,1
Crew,Staterooms x10,40,5
Crew,Emergency Low Berths x10,10,10
Cargo,Cargo Hold,550,0
Weapons,Triple Turret (Beam Lasers),1,4
Weapons,Triple Turret (Sandcasters),1,0.75
Weapons,Ammunition (50 canisters),2,0.05
Systems,Fuel Scoops,0,1
Systems,Fuel Processor (40 tons/day),2,0.1
Total,Total,1000,366.1`;

try {
    const result5 = parseCSV(fullCsv);
    console.log('✓ Parsed components:', result5.components.length);
    console.log('✓ Total tons:', result5.totalTons);
    console.log('✓ Total cost:', result5.totalCost);
    console.assert(result5.components.length === 23, 'Should have 23 components');
    console.assert(result5.totalTons === 1000, 'Total tons should be 1000');
    console.assert(result5.totalCost === 366.1, 'Total cost should be 366.1');

    const encodedFull = encodeURIComponent(fullCsv);
    console.log('✓ Encoded URL length:', encodedFull.length, 'characters');
    console.log('Test 5 PASSED\n');
} catch (e) {
    console.error('✗ Test 5 FAILED:', e);
}

console.log('=== All Tests Complete ===');
