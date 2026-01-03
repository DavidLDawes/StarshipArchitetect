# Floor Dimension Options Fix - Summary

## Issue
User reported that the "12 × 35" option was NOT appearing for the Maneuver Drive M-3 component when configured with:
- 8 floors
- 100m × 35m floor dimensions
- 2.5m ceiling height
- Component: Maneuver Drive M-3 (75 tons, 420 m² area)

## Root Cause
The original code had the floor dimension options in the wrong order:
1. It checked for **full floor length** first (100m as X dimension)
2. Then checked for **full floor width** (35m as Y dimension)

For the Maneuver Drive M-3:
- Full length option: 100m × 4.2m - **rejected** because 4.2 < 5 (minimum dimension)
- Full width option: 12m × 35m - should be **accepted** because 12 >= 5

However, the old logic checked `widthForFullLength >= 5` when it should have checked `lengthForFullWidth >= 5`. The dimension being checked was the **other** dimension, not the one being used as the divisor.

## Changes Made

### 1. Reordered Options (Lines 74-94)
Changed the order and logic to prioritize the most common use cases:

**Option 1: Floor Width as Y dimension** (Lines 74-79)
```javascript
const lengthForFullWidth = areaPerFloor / floorWidth;
if (lengthForFullWidth >= minDim) {
    addOption(lengthForFullWidth, floorWidth,
        `${lengthForFullWidth.toFixed(1)} × ${floorWidth.toFixed(1)} m (full width)`);
}
```

**Option 2: Floor Length as X dimension** (Lines 81-86)
```javascript
const widthForFullLength = areaPerFloor / floorLength;
if (widthForFullLength >= minDim) {
    addOption(floorLength, widthForFullLength,
        `${floorLength.toFixed(1)} × ${widthForFullLength.toFixed(1)} m (full length)`);
}
```

**Option 3: Ceiling Height as Y dimension** (Lines 88-94) - NEW!
```javascript
const lengthForCeilingHeight = areaPerFloor / shipData.ceilingHeight;
if (lengthForCeilingHeight >= minDim && lengthForCeilingHeight <= floorLength) {
    addOption(lengthForCeilingHeight, shipData.ceilingHeight,
        `${lengthForCeilingHeight.toFixed(1)} × ${shipData.ceilingHeight.toFixed(1)} m (ceiling height)`);
}
```

### 2. Updated Comments
- Added clear documentation explaining each option
- Noted that these options come FIRST to get descriptive labels before the `seen` Set deduplication kicks in
- Referenced user requirements: "Always add that to the list no matter how many selections are already there"

## Test Results

### Test Case 1: Maneuver Drive M-3 (User's Original Issue)
- Component: 75 tons = 420 m²
- Floor: 100m × 35m
- Ceiling: 2.5m

**Expected Options:**
- ✓ "12.0 × 35.0 m (full width)" - 420 / 35 = 12, and 12 >= 5 ✓
- ✗ "100.0 × 4.2 m (full length)" - 420 / 100 = 4.2, and 4.2 < 5 ✗
- ✗ "168.0 × 2.5 m (ceiling height)" - 420 / 2.5 = 168, but 168 > 100 (floor length) ✗

### Test Case 2: Small Component (10 tons = 56 m²)
- Floor: 100m × 35m
- Ceiling: 2.5m

**Expected Options:**
- ✗ "1.6 × 35.0 m (full width)" - 56 / 35 = 1.6, and 1.6 < 5 ✗
- ✗ "100.0 × 0.56 m (full length)" - 56 / 100 = 0.56, and 0.56 < 5 ✗
- ✓ "22.4 × 2.5 m (ceiling height)" - 56 / 2.5 = 22.4, and 22.4 >= 5 ✓, 22.4 <= 100 ✓

### Test Case 3: Medium Component (50 tons = 280 m²)
- Floor: 100m × 35m
- Ceiling: 2.5m

**Expected Options:**
- ✓ "8.0 × 35.0 m (full width)" - 280 / 35 = 8, and 8 >= 5 ✓
- ✗ "100.0 × 2.8 m (full length)" - 280 / 100 = 2.8, and 2.8 < 5 ✗
- ✗ "112.0 × 2.5 m (ceiling height)" - 280 / 2.5 = 112, but 112 > 100 ✗

## Verification

Run the test file to verify the fix:
```
open test-floor-dimensions-fix.html
```

Or test manually:
1. Load Transport.csv
2. Set to 8 floors, 100m × 35m dimensions
3. Click "Maneuver Drive M3"
4. Verify "12.0 × 35.0 m (full width)" appears in the dropdown

## Technical Details

### minDim Logic
The minimum dimension is calculated as:
```javascript
const minDim = isSmall ? 1 : 5;
```

Where `isSmall = componentArea < 40`. This ensures:
- Small components (< 40 m²) can have dimensions as small as 1m
- Larger components must have dimensions of at least 5m

### addOption Validation
The `addOption` helper function validates:
1. Dimensions are rounded to 1 decimal place
2. Not already seen (deduplication via `seen` Set)
3. Both dimensions meet minimum size requirements
4. Neither dimension exceeds floor dimensions
5. Total area is at least 95% of required area

### Why Order Matters
Floor dimension options are added FIRST (before loops) so they get the descriptive labels like "(full width)" instead of generic labels. Once an option is added to the `seen` Set, duplicate dimensions from later loops will be skipped.

## Files Modified
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\component-dimensions.js` (Lines 67-94)

## Files Created
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\test-floor-dimensions-fix.html` (comprehensive test suite)
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\FLOOR_DIMENSION_FIX_SUMMARY.md` (this file)
