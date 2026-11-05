'use strict';

const fs = require('fs');
const path = require('path');
const { parseCSVLine, parseConfiguration, parseDesignLine, parseCSV } = require('../../src/csv-parser');

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

  test('quantity parsing: parenthesized "(x140)" variant', () => {
    const csv = 'Category,Item,Tons,Cost\nBerths,Staterooms (x140),560,70\n,Commissary (x2),4,0.4';
    const result = parseCSV(csv);
    expect(result.components[0].quantity).toBe(140);
    expect(result.components[0].tonsPerItem).toBeCloseTo(4);
    expect(result.components[0].itemName).toBe('Staterooms');
    expect(result.components[1].quantity).toBe(2);
    expect(result.components[1].itemName).toBe('Commissary');
  });

  test('quantity parsing: parentheses without a quantity are left alone', () => {
    const csv = 'Category,Item,Tons,Cost\nCargo,Cargo Bay (2 tons),2,0';
    const result = parseCSV(csv);
    expect(result.components[0].quantity).toBe(1);
    expect(result.components[0].itemName).toBe('Cargo Bay (2 tons)');
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

// ============================================================
// parseConfiguration
// ============================================================

describe('parseConfiguration', () => {
  test.each([
    ['Standard rectangular configuration', 'standard', 'rectangular'],
    ['Standard rectangle configuration', 'standard', 'rectangular'],
    ['Standard wedge configuration', 'standard', 'wedge'],
    ['Standard cone configuration', 'standard', 'cone'],
    ['Standard Sphere configuration', 'standard', 'sphere'],
    ['Standard cylinder configuration', 'standard', 'cylinder'],
    ['Streamlined Wing configuration', 'streamlined', 'wing'],
    ['Streamlined Disk configuration', 'streamlined', 'disk'],
    ['Streamlined disc configuration', 'streamlined', 'disk'],
    ['Streamlined Lifting Body configuration', 'streamlined', 'lifting-body'],
    ['streamlined lifting-body configuration', 'streamlined', 'lifting-body'],
    ['Distributed configuration', 'distributed', 'distributed'],
  ])('%s', (text, general, shape) => {
    expect(parseConfiguration(text)).toEqual({ general, shape, text });
  });

  test('a general class alone gets that class default', () => {
    expect(parseConfiguration('Standard configuration').shape).toBe('rectangular');
    expect(parseConfiguration('Streamlined configuration').shape).toBe('lifting-body');
    expect(parseConfiguration('Distributed').shape).toBe('distributed');
  });

  test('no configuration is standard rectangular', () => {
    expect(parseConfiguration()).toEqual({ general: 'standard', shape: 'rectangular', text: '' });
    expect(parseConfiguration('   ')).toEqual({ general: 'standard', shape: 'rectangular', text: '' });
  });

  test('unknown text is standard rectangular but keeps the original text', () => {
    expect(parseConfiguration('Banana configuration'))
      .toEqual({ general: 'standard', shape: 'rectangular', text: 'Banana configuration' });
  });

  test('an unknown shape falls back to the class default', () => {
    expect(parseConfiguration('Streamlined banana configuration').shape).toBe('lifting-body');
  });

  test('a shape named under the wrong class keeps the shape and reports its real class', () => {
    expect(parseConfiguration('Streamlined cone configuration'))
      .toMatchObject({ general: 'standard', shape: 'cone' });
  });
});

// ============================================================
// parseDesignLine
// ============================================================

describe('parseDesignLine', () => {
  const read = line => parseDesignLine(parseCSVLine(line));

  test('reads name, configuration, and tonnage, ignoring later fields', () => {
    expect(read('Courier, Streamlined Lifting Body configuration, 300 tons, Tech Level G')).toEqual({
      shipName: 'Courier',
      configurationText: 'Streamlined Lifting Body configuration',
      tons: 300,
    });
  });

  test('older first lines are not design lines', () => {
    expect(read('Category,Item,Tons,Cost')).toBeNull();
    expect(read('Name,Heavy Fighter')).toBeNull();
    expect(read('Item,Tons,Cost')).toBeNull();
  });

  test('a line with tonnage but no configuration is still a design line', () => {
    expect(read('Courier, 300 tons')).toEqual({ shipName: 'Courier', configurationText: '', tons: 300 });
  });

  test('a configuration without tonnage reports 0 tons', () => {
    expect(read('Courier, Standard cone configuration').tons).toBe(0);
  });

  test('accepts thousands separators, quoted or not', () => {
    expect(read('Liner, Standard sphere configuration, "12,500 tons"').tons).toBe(12500);
    expect(read('Liner, Standard sphere configuration, 12,500 tons, Tech Level F').tons).toBe(12500);
  });

  test('accepts fractional tonnage', () => {
    expect(read('Pod, Standard cone configuration, 12.5 tons').tons).toBe(12.5);
  });

  test('keeps commas in the ship name, quoted or not', () => {
    expect(read('"Trader, Far", Standard cone configuration, 200 tons').shipName).toBe('Trader, Far');
    expect(read('Trader, Far, Standard cone configuration, 200 tons').shipName).toBe('Trader, Far');
  });
});

// ============================================================
// parseCSV: current design format
// ============================================================

describe('parseCSV current design format', () => {
  const courier = fs.readFileSync(path.join(__dirname, '../../data/Courier.csv'), 'utf8');

  test('reads the sample design', () => {
    const result = parseCSV(courier);
    expect(result.shipName).toBe('Courier');
    expect(result.totalTons).toBe(300);
    expect(result.totalCost).toBeCloseTo(296.49);
    expect(result.configuration).toEqual({
      general: 'streamlined',
      shape: 'lifting-body',
      text: 'Streamlined Lifting Body configuration',
    });
  });

  test('the Category row is not treated as a component', () => {
    const result = parseCSV(courier);
    expect(result.components.some(c => c.category === 'Category')).toBe(false);
    expect(result.components[0]).toMatchObject({ category: 'Hull', item: '300 tons (streamlined)', tons: 0 });
    expect(result.components).toHaveLength(30);
  });

  test('the ship name on the line beats the filename', () => {
    expect(parseCSV(courier, 'other_name.csv').shipName).toBe('Courier');
  });

  test('categories carry down and quantities are read', () => {
    const rooms = parseCSV(courier).components.find(c => c.itemName === 'Staterooms');
    expect(rooms).toMatchObject({ category: 'Berths', quantity: 12, tons: 48, tonsPerItem: 4 });
  });

  test('the design line tonnage beats the Total row, which still gives the cost', () => {
    const csv = 'Scout, Standard cone configuration, 100 tons\nCategory,Item,Mass,Cost\n' +
      'Fuel,Tank,90,1\nTotal,,90,55.5';
    const result = parseCSV(csv);
    expect(result.totalTons).toBe(100);
    expect(result.totalCost).toBe(55.5);
  });

  test('the Total row gives the tonnage when the design line has none', () => {
    const csv = 'Scout, Standard cone configuration\nCategory,Item,Mass,Cost\nFuel,Tank,90,1\nTotal,,90,55.5';
    expect(parseCSV(csv).totalTons).toBe(90);
  });

  test('tonnage is kept when there is no Total row', () => {
    const csv = 'Scout, Standard cone configuration, 100 tons\nCategory,Item,Mass,Cost\nFuel,Tank,90,1';
    expect(parseCSV(csv).totalTons).toBe(100);
  });

  test('a totals row with no cost does not erase the cost', () => {
    const csv = 'Scout, Standard cone configuration, 100 tons\nCategory,Item,Mass,Cost\nFuel,Tank,90,1\n' +
      'Total,,,55.5\nTotal,Total Mass,90,';
    expect(parseCSV(csv).totalCost).toBe(55.5);
  });

  test('handles Windows line endings', () => {
    const result = parseCSV(courier.replace(/\n/g, '\r\n'));
    expect(result.shipName).toBe('Courier');
    expect(result.configuration.shape).toBe('lifting-body');
    expect(result.components).toHaveLength(30);
  });
});

// ============================================================
// parseCSV: older formats load as standard rectangular
// ============================================================

describe('parseCSV older formats', () => {
  const rectangular = { general: 'standard', shape: 'rectangular', text: '' };
  const load = name => parseCSV(fs.readFileSync(path.join(__dirname, '../../data', name), 'utf8'), name);

  test('Category header format', () => {
    const result = load('sample-ship.csv');
    expect(result.configuration).toEqual(rectangular);
    expect(result.shipName).toBe('sample ship');
    expect(result.totalTons).toBe(1000);
    expect(result.totalCost).toBeCloseTo(366.1);
  });

  test('Name, format', () => {
    const result = load('Heavy_Fighter.csv');
    expect(result.configuration).toEqual(rectangular);
    expect(result.shipName).toBe('Heavy Fighter');
    expect(result.totalTons).toBe(90);
    expect(result.totalCost).toBeCloseTo(98.1);
  });

  test('Name, format finds its Category row even with no blank line before it', () => {
    const csv = 'Name,Scout\nHull,100 tons,20 MCr\nCategory,Item,Tons,Cost\nFuel,Tank,10,1';
    const result = parseCSV(csv);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].item).toBe('Tank');
  });

  test('Mass column header', () => {
    const result = load('transport.csv');
    expect(result.configuration).toEqual(rectangular);
    expect(result.totalTons).toBe(5000);
  });
});
