# Manual Test Instructions for Floor Dimension Fix

## Quick Test (2 minutes)

1. **Open the application**
   - Open `index.html` in your browser

2. **Load Transport.csv**
   - Click "Choose File"
   - Select `Transport.csv`

3. **Configure floor settings**
   - Set number of floors: **8**
   - Set floor length: **100 m**
   - Set floor width: **35 m**
   - Set ceiling height: **2.5 m** (should be default)

4. **Test Maneuver Drive M-3**
   - Click on "Maneuver Drive M-3" in the component list
   - Look at the dimension dropdown
   - **EXPECTED**: Should see "12.0 × 35.0 m (full width)"
   - **VERIFY**: The option is clearly labeled with "(full width)"

5. **Verify the math**
   - Component: 75 tons
   - Area: 75 × 14 / 2.5 = 420 m²
   - Width: 35 m (full floor width)
   - Length: 420 / 35 = 12 m
   - Check: 12m × 35m = 420 m² ✓

## Additional Test Cases

### Test 2: Bridge (should show both full width AND full length)
1. Click on "Bridge" (120 tons = 672 m²)
2. **EXPECTED**:
   - "19.2 × 35.0 m (full width)" (672 / 35 = 19.2 m)
   - "100.0 × 6.7 m (full length)" (672 / 100 = 6.7 m)
   - Both should appear!

### Test 3: Small component (ceiling height option)
1. Click on "Autodoc" (1.5 tons = 8.4 m²)
2. **EXPECTED**:
   - Should NOT see floor dimension options (8.4 / 35 = 0.24 m < 1m minimum)
   - Should NOT see ceiling height option (8.4 / 2.5 = 3.36 m < 5m minimum for large, but this is small so would need >= 1m, and 3.36 >= 1 ✓ so it might appear!)

Actually let me recalculate: Autodoc is 1.5 tons = 8.4 m², which is < 40 so isSmall = true, minDim = 1:
- lengthForFullWidth = 8.4 / 35 = 0.24 m < 1 ✗
- widthForFullLength = 8.4 / 100 = 0.084 m < 1 ✗
- lengthForCeilingHeight = 8.4 / 2.5 = 3.36 m >= 1 ✓ and <= 100 ✓
- **EXPECTED**: "3.4 × 2.5 m (ceiling height)" should appear!

### Test 4: Change floor dimensions
1. Change floor width to **50 m** (keeping length at 100 m)
2. Click on "Maneuver Drive M-3" again
3. **EXPECTED**:
   - Should see "8.4 × 50.0 m (full width)" (420 / 50 = 8.4 m)
   - Should NOT see "100.0 × 4.2 m (full length)" (4.2 < 5)

## What to Look For

### Success Indicators
- ✓ Floor dimension options appear with descriptive labels
- ✓ Labels clearly identify "(full width)", "(full length)", "(ceiling height)"
- ✓ Options appear at the top or near the top of the dropdown
- ✓ Math works out: length × width = component area

### Failure Indicators
- ✗ Floor dimension options don't appear at all
- ✗ Options appear with generic labels like "12.0 × 35.0 m" instead of "(full width)"
- ✗ Dimensions don't match expected calculations
- ✗ Options appear but can't be selected

## Debugging

If the options don't appear:

1. **Open browser console** (F12)
2. **Add debug logging** to `component-dimensions.js` after line 76:
   ```javascript
   console.log('Floor width option:', lengthForFullWidth, 'minDim:', minDim);
   ```
3. **Click on component** and check console output
4. **Verify values**:
   - componentArea should be tons × 14 / 2.5
   - lengthForFullWidth should be componentArea / floorWidth
   - minDim should be 5 for components >= 40 m², or 1 for smaller

## Browser Compatibility

Test in multiple browsers if issues occur:
- Chrome/Edge (recommended)
- Firefox
- Safari (if on Mac)

## Files Changed

This fix modified:
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\component-dimensions.js`

## Rollback

If issues occur, revert using:
```bash
git checkout HEAD -- component-dimensions.js
```

## Success Criteria

The fix is successful if:
1. "12.0 × 35.0 m (full width)" appears for Maneuver Drive M-3
2. The label includes "(full width)" text
3. The option can be selected and the component placed
4. The placed component has the correct dimensions (12m × 35m = 420 m²)
