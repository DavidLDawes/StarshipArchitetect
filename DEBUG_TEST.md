# Debug Test Instructions

## Steps to Reproduce Issue

1. Open `index.html` in browser
2. Load `Transport.csv` file
3. Set floors to 8
4. Set floor dimensions to 100m × 35m
5. Click on "Maneuver Drive M-3" component
6. Open browser Developer Console (F12)
7. Look at the console output

## Expected Console Output

You should see:
- `=== Full Width Option Debug ===`
- Values for componentArea, areaPerFloor, floorWidth, etc.
- For each dimension option attempted, you'll see:
  - `--- addOption called: [label] ---`
  - Input values
  - After rounding values
  - Either REJECTED with reason OR ACCEPTED

## What to Look For

1. **Is lengthForFullWidth = 12?** (420 / 35 = 12)
2. **Does the condition pass?** (lengthForFullWidth >= minDim)
3. **Is addOption called with "12 × 35 m (full width)"?**
4. **If called, why is it rejected?** Look for the REJECTED message

## Component Details

- Maneuver Drive M-3: 420 m² (70 tons × 3 sqm/ton ÷ 0.5m ceiling)
- Floor: 100m × 35m = 3500 m²
- Expected dimension: 12m × 35m = 420 m²
- This should appear as "12.0 × 35.0 m (full width)"

## After Finding the Issue

Report back:
1. What was the exact console output?
2. Which check failed (if any)?
3. What were the actual values vs. expected values?
