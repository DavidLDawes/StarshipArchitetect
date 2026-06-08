# Large Item Multi-Floor Selection - Test Plan

## Feature Description
Components with greater than 25% of a floor's area now show a different, more suggestive prompt for multi-floor placement.

## Implementation Changes

### 1. HTML (index.html)
- Added `floor-selection-hint` div inside the `multi-floor-section`
- Positioned before the existing `multi-floor-notice` paragraph

### 2. CSS (styles.css)
- Added `.floor-selection-hint` class with blue styling
- Border-left accent in primary color
- Background with transparency
- Hidden by default with `.hidden` class

### 3. JavaScript (component-modal.js)
- Calculate `areaRatio = componentArea / floorArea`
- Categorize components:
  - `isMultiFloorRequired`: areaRatio > 1.0 (>100%)
  - `isLargeItem`: 0.25 < areaRatio <= 1.0 (25-100%)
  - Normal: areaRatio <= 0.25 (<=25%)

- Show multi-floor section for both `dimInfo.isMultiFloor` OR `isLargeItem`

- Display appropriate message:
  - **Multi-floor required (>100%)**: "This component requires X floors."
    - Auto-select minimum required floors
    - Show warning notice
  - **Large item (25-100%)**: "Large items may fit better if split across multiple floors; choose one or more floors for this item."
    - Only check first floor by default
    - Hide warning notice
  - **Normal (<=25%)**: No special message
    - Show single floor dropdown

- Updated validation in `startPlacement()`:
  - Required multi-floor: Must select at least `floorsNeeded` floors
  - Large item: Must select at least 1 floor (user's choice)

## Test Cases

### Prerequisites
1. Open index.html in browser
2. Load transport.csv
3. Configure floors:
   - Number of floors: 4
   - Floor dimensions: 100m x 35m = 3,500 m²
   - Ceiling height: 2.5m

### Test Case 1: Multi-Floor Required (>100% of floor)
**Component**: Fuel Tank (2000 tons)
- Expected area: 2000 × 14 / 2.5 = 11,200 m²
- Ratio: 11,200 / 3,500 = 3.2 (320%)
- **Expected behavior**:
  - Multi-floor section visible
  - Message: "This component requires 4 floors."
  - Warning notice visible: "⚠️ This component requires 4 floors. Select which floors to span:"
  - Auto-selected: Floors 1, 2, 3, 4 checked
  - Validation: Must select at least 4 floors

**Steps**:
1. Click on "Fuel Tank" component
2. Verify message displays correctly
3. Verify floors 1-4 are auto-checked
4. Try to place with only 1-3 floors selected - should show error
5. Select 4 floors and verify placement works

### Test Case 2: Multi-Floor Required (Just Over 100%)
**Component**: Cargo Bay (1035 tons)
- Expected area: 1035 × 14 / 2.5 = 5,796 m²
- Ratio: 5,796 / 3,500 = 1.66 (166%)
- **Expected behavior**:
  - Multi-floor section visible
  - Message: "This component requires 2 floors."
  - Warning notice visible
  - Auto-selected: Floors 1, 2 checked
  - Validation: Must select at least 2 floors

### Test Case 3: Large Item (25-100% of floor)
**Component**: Staterooms (x140) (560 tons)
- Expected area: 560 × 14 / 2.5 = 3,136 m²
- Ratio: 3,136 / 3,500 = 0.896 (89.6%)
- **Expected behavior**:
  - Multi-floor section visible
  - Message: "Large items may fit better if split across multiple floors; choose one or more floors for this item."
  - Warning notice HIDDEN
  - Auto-selected: Only Floor 1 checked
  - Validation: Must select at least 1 floor (can select more)

**Steps**:
1. Click on "Staterooms (x140)" component
2. Verify message displays: "Large items may fit better if split across multiple floors; choose one or more floors for this item."
3. Verify only Floor 1 is checked by default
4. Verify warning notice is HIDDEN (⚠️ text not visible)
5. Try placing with 1 floor - should work
6. Try selecting 2 floors - should work and split the component

### Test Case 4: Large Item (Around 50%)
**Component**: Cold Storage Bay (250 tons)
- Expected area: 250 × 14 / 2.5 = 1,400 m²
- Ratio: 1,400 / 3,500 = 0.4 (40%)
- **Expected behavior**:
  - Multi-floor section visible
  - Message: "Large items may fit better if split across multiple floors; choose one or more floors for this item."
  - Warning notice HIDDEN
  - Auto-selected: Only Floor 1 checked

### Test Case 5: Normal Component (<=25% of floor)
**Component**: Power Plant P-4 (150 tons)
- Expected area: 150 × 14 / 2.5 = 840 m²
- Ratio: 840 / 3,500 = 0.24 (24%)
- **Expected behavior**:
  - Multi-floor section HIDDEN
  - Single floor dropdown visible
  - No special messages

**Steps**:
1. Click on "Power Plant P-4" component
2. Verify no multi-floor section shown
3. Verify single floor dropdown is visible
4. Place on any floor

### Test Case 6: Small Component (Much Less Than 25%)
**Component**: Maneuver Drive M-3 (75 tons)
- Expected area: 75 × 14 / 2.5 = 420 m²
- Ratio: 420 / 3,500 = 0.12 (12%)
- **Expected behavior**:
  - Multi-floor section HIDDEN
  - Single floor dropdown visible
  - No special messages

## Test Case Summary Table

| Component | Tons | Area (m²) | Ratio | Category | Message | Auto-Select | Validation |
|-----------|------|-----------|-------|----------|---------|-------------|------------|
| Fuel Tank | 2000 | 11,200 | 320% | Required Multi | "requires 4 floors" | Floors 1-4 | Min 4 floors |
| Cargo Bay | 1035 | 5,796 | 166% | Required Multi | "requires 2 floors" | Floors 1-2 | Min 2 floors |
| Staterooms | 560 | 3,136 | 89.6% | Large Item | "may fit better..." | Floor 1 only | Min 1 floor |
| Cold Storage | 250 | 1,400 | 40% | Large Item | "may fit better..." | Floor 1 only | Min 1 floor |
| Power Plant | 150 | 840 | 24% | Normal | None | N/A (dropdown) | 1 floor |
| Maneuver Drive | 75 | 420 | 12% | Normal | None | N/A (dropdown) | 1 floor |

## Testing with Different Floor Sizes

### Smaller Floor (50m x 20m = 1,000 m²)
- Fuel Tank: 11,200 / 1,000 = 1,120% (requires 12 floors!)
- Staterooms: 3,136 / 1,000 = 314% (requires 4 floors - now multi-floor required!)
- Cold Storage: 1,400 / 1,000 = 140% (requires 2 floors - now multi-floor required!)
- Power Plant: 840 / 1,000 = 84% (now large item!)
- Maneuver Drive: 420 / 1,000 = 42% (now large item!)

### Larger Floor (150m x 50m = 7,500 m²)
- Fuel Tank: 11,200 / 7,500 = 149% (requires 2 floors - still multi-floor required)
- Staterooms: 3,136 / 7,500 = 41.8% (now large item!)
- Cold Storage: 1,400 / 7,500 = 18.7% (now normal)
- Power Plant: 840 / 7,500 = 11.2% (still normal)

## Visual Verification Checklist

- [ ] Floor selection hint has blue background
- [ ] Floor selection hint has blue left border
- [ ] Text is readable and properly sized
- [ ] Message updates correctly based on component size
- [ ] Warning notice (⚠️) shows/hides appropriately
- [ ] Floor checkboxes auto-select correctly
- [ ] Modal layout looks clean and organized
- [ ] Area display updates when floors are checked/unchecked

## Edge Cases

1. **Component exactly 25% of floor**: Should show large item message
2. **Component exactly 100% of floor**: Should show multi-floor required
3. **Component very large (>5 floors)**: Should auto-select minimum needed
4. **Only 1 floor available**: Should handle gracefully
5. **Changing floor selection**: Message should remain consistent

## Success Criteria

✓ Large items (>25% floor area) show helpful guidance message
✓ Multi-floor required items still enforce minimum floor count
✓ Large items allow flexible floor selection (1 or more)
✓ UI is clear and visually distinct between categories
✓ No regressions in existing functionality
✓ Validation works correctly for both cases
