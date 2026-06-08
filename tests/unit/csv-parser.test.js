'use strict';

const { parseCSVLine, parseCSV } = require('../../src/csv-parser');

// ============================================================
// parseCSVLine
// ============================================================

describe('parseCSVLine', () => {
  test('simple comma-separated values', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('single value, no comma', () => {
    expect(parseCSVLine('hello')).toEqual(['hello']);
  });

  test('empty string produces single empty field', () => {
    expect(parseCSVLine('')).toEqual(['']);
  });

  test('trailing comma produces empty last field', () => {
    expect(parseCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });

  test('leading comma produces empty first field', () => {
    expect(parseCSVLine(',a,b')).toEqual(['', 'a', 'b']);
  });

  test('quoted field containing comma', () => {
    expect(parseCSVLine('"hello, world",b')).toEqual(['hello, world', 'b']);
  });

  test('quoted field at end of line', () => {
    expect(parseCSVLine('a,"b,c"')).toEqual(['a', 'b,c']);
  });

  test('multiple quoted fields', () => {
    expect(parseCSVLine('"a,b","c,d"')).toEqual(['a,b', 'c,d']);
  });

  test('toggle-quote behavior: double quote inside quoted field strips the quotes', () => {
    // Parser toggles on each quote: "a""b" → inQuotes starts false, " → true, a added,
    // second " → false (adds nothing), third " → true, b added, fourth " → false.
    // Result: 'ab'
    expect(parseCSVLine('"a""b",c')).toEqual(['ab', 'c']);
  });

  test('field with only whitespace', () => {
    expect(parseCSVLine('a, ,c')).toEqual(['a', ' ', 'c']);
  });

  test('numeric-looking fields are returned as strings', () => {
    expect(parseCSVLine('1,2.5,3')).toEqual(['1', '2.5', '3']);
  });

  test('two commas produce three fields, middle empty', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

// ============================================================
// parseCSV
// ============================================================

describe('parseCSV', () => {
  // ---- error cases ----

  test('throws when CSV has fewer than 2 lines', () => {
    expect(() => parseCSV('header only')).toThrow();
  });

  test('throws on empty string', () => {
    expect(() => parseCSV('')).toThrow();
  });

  // ---- standard format (Category,Item,Tons,Cost header) ----

  test('standard format: basic two-row CSV', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Hull,Standard Hull,200,10'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      category: 'Hull',
      item: 'Standard Hull',
      tons: 200,
      cost: 10,
      quantity: 1,
      tonsPerItem: 200
    });
  });

  test('standard format: returns shipName empty when no Name row', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,100,5';
    const result = parseCSV(csv);
    expect(result.shipName).toBe('');
  });

  test('standard format: filename used as shipName when CSV has none', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,100,5';
    const result = parseCSV(csv, 'my_cool_ship.csv');
    expect(result.shipName).toBe('my cool ship');
  });

  test('filename with dashes converted to spaces', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,100,5';
    const result = parseCSV(csv, 'free-trader.csv');
    expect(result.shipName).toBe('free trader');
  });

  test('filename without .csv extension still works', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,100,5';
    const result = parseCSV(csv, 'scout_ship');
    expect(result.shipName).toBe('scout ship');
  });

  test('category inheritance: empty category uses previous category', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Drive,Jump Drive,10,5',
      ',Maneuver Drive,5,3'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components).toHaveLength(2);
    expect(result.components[1].category).toBe('Drive');
  });

  test('category inheritance: chains across multiple empty rows', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Drive,Jump Drive,10,5',
      ',Maneuver Drive,5,3',
      ',Power Plant,4,8'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components[1].category).toBe('Drive');
    expect(result.components[2].category).toBe('Drive');
  });

  test('quantity parsing: "Staterooms x10" sets quantity=10 and tonsPerItem', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Quarters,Staterooms x10,40,2'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components[0].quantity).toBe(10);
    expect(result.components[0].tonsPerItem).toBeCloseTo(4);
    expect(result.components[0].tons).toBe(40);
    expect(result.components[0].itemName).toBe('Staterooms');
  });

  test('quantity parsing: uppercase X variant', () => {
    const csv = 'Category,Item,Tons,Cost\nQuarters,Cabins X4,20,1';
    const result = parseCSV(csv);
    expect(result.components[0].quantity).toBe(4);
    expect(result.components[0].tonsPerItem).toBeCloseTo(5);
  });

  test('quantity parsing: unicode × variant', () => {
    const csv = 'Category,Item,Tons,Cost\nWeapons,Turrets ×3,6,9';
    const result = parseCSV(csv);
    expect(result.components[0].quantity).toBe(3);
    expect(result.components[0].tonsPerItem).toBeCloseTo(2);
  });

  test('single-item component: tonsPerItem equals tons', () => {
    const csv = 'Category,Item,Tons,Cost\nBridge,Control Room,20,1';
    const result = parseCSV(csv);
    expect(result.components[0].quantity).toBe(1);
    expect(result.components[0].tonsPerItem).toBe(20);
  });

  test('Total line sets totalTons and totalCost (standard format)', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Hull,Standard Hull,200,10',
      'Total,Total,400,50'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.totalTons).toBe(400);
    expect(result.totalCost).toBe(50);
    // Total line should NOT appear in components
    expect(result.components).toHaveLength(1);
  });

  test('Totals (plural) line also sets totalTons and totalCost', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Hull,Hull,100,5',
      'Totals,All,200,30'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.totalTons).toBe(200);
    expect(result.totalCost).toBe(30);
  });

  test('rows with fewer than 4 fields are skipped', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Hull,Hull',  // only 2 fields - skipped
      'Drive,Jump,10,5'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].category).toBe('Drive');
  });

  test('field with commas in quotes is parsed correctly', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      '"Weapons, Military","Beam Laser, Turret",2,1.5'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components[0].category).toBe('Weapons, Military');
    expect(result.components[0].item).toBe('Beam Laser, Turret');
  });

  test('tons string with non-numeric chars is cleaned up', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,200 tons,10 MCr';
    const result = parseCSV(csv);
    expect(result.components[0].tons).toBe(200);
    expect(result.components[0].cost).toBe(10);
  });

  test('multi-quantity items have tonsPerItem = tons / quantity', () => {
    const csv = 'Category,Item,Tons,Cost\nQuarters,Staterooms x5,20,10';
    const result = parseCSV(csv);
    expect(result.components[0].tonsPerItem).toBeCloseTo(4);
    expect(result.components[0].tonsPerItem * result.components[0].quantity).toBeCloseTo(result.components[0].tons);
  });

  // ---- small craft format ----

  test('small craft format: first line "Name,<shipname>" sets shipName', () => {
    const csv = [
      'Name,Heavy Fighter',
      'Hull,90 tons,98.1 MCr',
      '',
      'Category,Item,Tons,Cost (MCr)',
      'Drive,Jump Drive,10,5'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.shipName).toBe('Heavy Fighter');
  });

  test('small craft format: reads totalTons and totalCost from Hull line', () => {
    const csv = [
      'Name,Heavy Fighter',
      'Hull,90 tons,98.1 MCr',
      '',
      'Category,Item,Tons,Cost (MCr)',
      'Drive,Jump Drive,10,5'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.totalTons).toBe(90);
    expect(result.totalCost).toBeCloseTo(98.1);
  });

  test('small craft format: ignores TOTALS rows', () => {
    const csv = [
      'Name,Scout',
      'Hull,100 tons,50 MCr',
      '',
      'Category,Item,Tons,Cost (MCr)',
      'Drive,Jump Drive,10,5',
      'Totals,All,100,50'
    ].join('\n');
    const result = parseCSV(csv);
    // Totals row should not appear in components; totalTons from Hull line
    const totalsRows = result.components.filter(c => c.category.toLowerCase() === 'totals');
    expect(totalsRows).toHaveLength(0);
    expect(result.totalTons).toBe(100); // from Hull line, not Totals
  });

  test('small craft format: data rows correctly parsed', () => {
    const csv = [
      'Name,Scout',
      'Hull,100 tons,50 MCr',
      '',
      'Category,Item,Tons,Cost (MCr)',
      'Bridge,Control Room,10,1',
      ',Sensors,5,0.5'
    ].join('\n');
    const result = parseCSV(csv);
    expect(result.components).toHaveLength(2);
    expect(result.components[0].item).toBe('Control Room');
    // Category inheritance works in small craft format too
    expect(result.components[1].category).toBe('Bridge');
  });

  test('small craft format: shipName from CSV takes priority over filename', () => {
    const csv = [
      'Name,Heavy Fighter',
      'Hull,90 tons,98.1 MCr',
      '',
      'Category,Item,Tons,Cost (MCr)',
      'Drive,Jump Drive,10,5'
    ].join('\n');
    const result = parseCSV(csv, 'something_else.csv');
    expect(result.shipName).toBe('Heavy Fighter');
  });

  test('small craft format: empty ship name falls back to filename', () => {
    const csv = [
      'Name,',
      'Hull,90 tons,98.1 MCr',
      '',
      'Category,Item,Tons,Cost (MCr)',
      'Drive,Jump Drive,10,5'
    ].join('\n');
    const result = parseCSV(csv, 'my_fighter.csv');
    expect(result.shipName).toBe('my fighter');
  });

  test('standard format returns components array', () => {
    const csv = [
      'Category,Item,Tons,Cost',
      'Hull,Hull,200,10',
      'Drive,Jump Drive,10,5',
      'Bridge,Bridge,20,1'
    ].join('\n');
    const result = parseCSV(csv);
    expect(Array.isArray(result.components)).toBe(true);
    expect(result.components).toHaveLength(3);
  });

  test('each component has required fields', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,100,5';
    const result = parseCSV(csv);
    const comp = result.components[0];
    expect(comp).toHaveProperty('category');
    expect(comp).toHaveProperty('item');
    expect(comp).toHaveProperty('itemName');
    expect(comp).toHaveProperty('tons');
    expect(comp).toHaveProperty('tonsPerItem');
    expect(comp).toHaveProperty('cost');
    expect(comp).toHaveProperty('quantity');
  });

  test('CRLF line endings are handled correctly', () => {
    const csv = 'Category,Item,Tons,Cost\r\nHull,Hull,200,10\r\nDrive,Jump Drive,10,5';
    const result = parseCSV(csv);
    expect(result.components).toHaveLength(2);
  });

  test('returns result object with all expected top-level keys', () => {
    const csv = 'Category,Item,Tons,Cost\nHull,Hull,100,5';
    const result = parseCSV(csv);
    expect(result).toHaveProperty('components');
    expect(result).toHaveProperty('totalTons');
    expect(result).toHaveProperty('totalCost');
    expect(result).toHaveProperty('shipName');
  });
});
