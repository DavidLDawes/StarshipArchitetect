# Floor Dimension Options Fix

## Issue Summary

Floor dimension options (e.g., "12 × 35 m (full width)") were not appearing in the component dimension dropdown, even when components qualified for them.

## Root Cause

The dimension option generation code had sections that generated options in the wrong order:

1. **Section 1-3** generated generic dimension options (e.g., "12 × 35 m")
2. **Section 4** attempted to add floor-specific options (e.g., "12 × 35 m (full width)")

The code uses a `seen` Set to prevent duplicate dimensions. When a dimension like "12 × 35" was already added by Section 1, Section 4's attempt to add the same dimension with a more descriptive label was blocked.

## The Fix

Reordered the dimension option generation so that floor-specific options (with descriptive labels) are generated FIRST:

**Before:**
```
1. Floor width-based options (generic labels)
2. Floor length-based options (generic labels)
3. Square-ish options
4. Floor dimension options (descriptive labels) ← Blocked by seen Set!
5. Multiples of 5m
```

**After:**
```
1. Floor dimension options (descriptive labels) ← Added first!
2. Floor width-based options (generic labels) ← Now blocked if duplicate
3. Floor length-based options (generic labels)
4. Square-ish options
5. Multiples of 5m
```

## Code Changes

**File:** `component-dimensions.js`

Moved the "Floor dimension-based options" section (lines 67-82) to execute before the generic width/length-based loops. Added comments explaining why order matters.

## Test Case Verification

**Component:** Maneuver Drive M-3 (75 tons)
**Configuration:** 8 floors, 100m × 35m floor dimensions
**Component Area:** 75 × 14 / 2.5 = 420 m²

**Expected Calculation:**
- If Y = 35m (full floor width), then X = 420 / 35 = 12m
- 12m >= 5m ✓ (meets minimum requirement)
- Should see: "12.0 × 35.0 m (full width)"

**Result:** ✓ Option now appears correctly

## Additional Test Cases

### Bridge (120 tons = 672 m²)
- Floor: 100m × 35m
- Full width: 19.2m × 35m ✓
- Full length: 100m × 6.7m ✓

### Power Plant P-4 (150 tons = 840 m²)
- Floor: 100m × 35m
- Full width: 24m × 35m ✓
- Full length: 100m × 8.4m ✓

### Jump Drive J-4 (250 tons = 1400 m²)
- Floor: 100m × 35m
- Full width: 40m × 35m ✓
- Full length: 100m × 14m ✓

### Autodoc (1.5 tons = 8.4 m²)
- Floor: 100m × 35m
- Full width: 0.24m × 35m ✗ (< 5m minimum)
- Full length: 100m × 0.084m ✗ (< 5m minimum)
- Correctly excluded

## Testing

Two test pages were created to verify the fix:

1. **test-dimensions.html** - Simple single test case
2. **test-dimensions-comprehensive.html** - Multiple test cases with various component sizes

To test:
```bash
# Start server
python -m http.server 8000

# Open in browser
http://localhost:8000/test-dimensions.html
http://localhost:8000/test-dimensions-comprehensive.html
```

Or test in the main application:
1. Load Transport.csv
2. Configure 8 floors, 100m × 35m
3. Click "Maneuver Drive M-3"
4. Open dimension dropdown
5. Verify "12 × 35 m (full width)" appears

## Technical Details

### Dimension Generation Logic

The `generateComponentDimensionOptions()` function creates dimension options that:
- Meet minimum dimension requirements (5m for large components, 1m for small)
- Fit within floor boundaries
- Provide the correct component area
- Avoid duplicates using a `seen` Set keyed by "lengthxwidth"

### Key Functions

**calculateComponentArea(component)**
- Converts component tonnage to floor area
- Formula: `(tons × 14 m²/ton) / ceilingHeight`

**addOption(length, width, label)**
- Validates dimensions against constraints
- Uses `seen` Set to prevent duplicates
- Only the first matching dimension is added

### Why Order Matters

The `seen` Set uses a key format of `"lengthxwidth"` (e.g., "12x35"). When the floor dimension section tries to add "12 × 35 m (full width)", it checks if "12x35" exists in the Set. If a previous section already added "12 × 35 m", the more descriptive version is blocked.

By generating floor dimensions first, we ensure:
1. Descriptive labels are added ("full width", "full length")
2. Generic versions are blocked as duplicates
3. Users see the most helpful labels in the dropdown

## Files Modified

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\component-dimensions.js`
  - Reordered option generation sections
  - Added explanatory comments

## Files Created

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\test-dimensions.html`
  - Basic test page for the fix

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\test-dimensions-comprehensive.html`
  - Comprehensive test suite with multiple components

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\DIMENSION_FIX.md`
  - This documentation file
