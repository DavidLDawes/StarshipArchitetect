# Zero-Ton Item Filtering

## What It Does

Automatically filters out components with 0 tons when loading CSV files. These items (like software, virtual components, and configuration entries) don't need physical placement on ship floors.

## Files Modified

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\app.js`
  - Function: `loadCsvFromString()`
  - Lines: 313-332 (filtering logic)

## How It Works

When a CSV is loaded (via file upload or URL parameter):

1. CSV is parsed normally by `parseCSV()`
2. Components are filtered to remove items where `tons <= 0`
3. Console logs show which items were filtered
4. Error is thrown if ALL items are filtered (invalid CSV)
5. Only placeable components appear in the UI

## Example Output

```
Skipping zero-ton item: Hull - Hull Configuration (0 tons)
Skipping zero-ton item: Computer - Software/Library (0 tons)
Filtered out 6 zero-ton items
Loaded 16 components from file: sample-ship.csv (1000 tons)
```

## Items Typically Filtered

From `sample-ship.csv`:
- Hull Configuration (0 tons)
- Computer/20 (0 tons)
- Software/Jump Control/2 (0 tons)
- Software/Maneuver/0 (0 tons)
- Software/Library (0 tons)
- Fuel Scoops (0 tons)

## Testing

### Browser Test
Open `test-zero-ton-filtering.html` in a browser to run interactive tests.

### Command Line Test
```bash
node test-filtering-integration.js
```

Expected result: All 5 tests pass.

## Implementation Details

```javascript
// Filter out zero-ton items
const filteredComponents = parsed.components.filter(component => {
    if (!component.tons || component.tons <= 0) {
        console.log(`Skipping zero-ton item: ${component.category} - ${component.item}`);
        return false;
    }
    return true;
});

// Error if nothing remains
if (filteredComponents.length === 0) {
    throw new Error('No valid components found after filtering (all items had 0 tons)');
}
```

## Edge Cases Handled

- Zero as number: `0`
- Zero as string: `"0"`
- Negative values: `-5`
- Undefined/null tonnage
- Empty CSV after filtering (error)
- All valid items (no filtering needed)

## Backward Compatibility

- Total tons and total cost remain accurate (from CSV totals row)
- Existing placement logic unchanged
- URL sharing works as before
- No breaking changes

## Verification

Test results (from `test-filtering-integration.js`):

```
[TEST 1] Sample Ship CSV: PASS
  - Original: 22 components
  - Filtered: 16 components (6 removed)

[TEST 2] Mixed Items: PASS ✓
  - Expected: 3 components
  - Actual: 3 components

[TEST 3] All Zero-Ton: PASS ✓
  - Correctly throws error

[TEST 4] Transport CSV: PASS
  - No zero-ton items (all 37 components valid)

[TEST 5] Only Valid Items: PASS ✓
  - No filtering needed
```

All tests pass successfully.

## See Also

- `IMPLEMENTATION-SUMMARY.md` - Detailed implementation documentation
- `test-zero-ton-filtering.html` - Interactive browser tests
- `test-filtering-integration.js` - Automated Node.js tests
