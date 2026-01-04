# Large Item Multi-Floor Selection - Implementation Summary

## Overview
Implemented a feature to show different messages for large components (>25% of floor area) when selecting floors for placement, providing better user guidance.

## Changes Made

### 1. HTML Changes (`index.html`)
**File**: `C:\Users\David L. Dawes\Play\StarshipArchitetect\index.html`

**Change**: Added floor selection hint element inside multi-floor section (line 151)
```html
<div id="multi-floor-section" class="multi-floor-section hidden">
    <div id="floor-selection-hint" class="floor-selection-hint hidden"></div>
    <p class="multi-floor-notice">
        ⚠️ This component requires <strong id="floors-needed">2</strong> floors.
        Select which floors to span:
    </p>
    ...
</div>
```

### 2. CSS Changes (`styles.css`)
**File**: `C:\Users\David L. Dawes\Play\StarshipArchitetect\styles.css`

**Changes**: Added styling for floor-selection-hint (lines 717-731)
```css
/* Floor selection hint */
.floor-selection-hint {
    background-color: rgba(33, 150, 243, 0.15);
    border-left: 4px solid var(--color-accent-primary);
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-md);
    font-size: 0.9em;
    color: var(--color-accent-primary);
    border-radius: var(--radius-sm);
    line-height: 1.5;
}

.floor-selection-hint.hidden {
    display: none;
}
```

### 3. JavaScript Changes (`component-modal.js`)
**File**: `C:\Users\David L. Dawes\Play\StarshipArchitetect\component-modal.js`

#### Change 1: Size Category Calculation (lines 118-122)
Added logic to calculate component size relative to floor area:
```javascript
// Calculate size category for better user guidance
const areaRatio = dimInfo.componentArea / floorArea;
const isMultiFloorRequired = areaRatio > 1.0;
const isLargeItem = areaRatio > 0.25 && areaRatio <= 1.0;
```

#### Change 2: Show Multi-Floor Section for Large Items (line 124)
Updated condition to show multi-floor section for both required multi-floor AND large items:
```javascript
if (dimInfo.isMultiFloor || isLargeItem) {
```

#### Change 3: Conditional Message Display (lines 128-146)
Added logic to show different messages based on component size:
```javascript
// Show appropriate hint message
const floorHint = document.getElementById('floor-selection-hint');
const multiFloorNotice = document.querySelector('.multi-floor-notice');

if (isMultiFloorRequired) {
    // Component MUST span multiple floors
    floorHint.textContent = `This component requires ${dimInfo.floorsNeeded} floors.`;
    floorHint.classList.remove('hidden');
    multiFloorNotice.classList.remove('hidden');
} else if (isLargeItem) {
    // Large component that COULD span multiple floors
    floorHint.textContent = 'Large items may fit better if split across multiple floors; choose one or more floors for this item.';
    floorHint.classList.remove('hidden');
    multiFloorNotice.classList.add('hidden');
} else {
    // Normal multi-floor handling
    floorHint.classList.add('hidden');
    multiFloorNotice.classList.remove('hidden');
}
```

#### Change 4: Conditional Auto-Selection (lines 166-180)
Updated floor auto-selection logic:
```javascript
// Auto-select floors based on component type
if (isMultiFloorRequired) {
    // Auto-check the minimum required floors
    for (let i = 1; i <= dimInfo.floorsNeeded && i <= shipData.numFloors; i++) {
        const checkbox = document.querySelector(`input[name="component-floors"][value="${i}"]`);
        if (checkbox) checkbox.checked = true;
    }
    // Initialize area display with minimum floors needed
    updateAreaDisplay(dimInfo.componentArea, dimInfo.floorsNeeded, dimInfo.areaPerFloor);
} else {
    // For large items, only check first floor by default (user can add more)
    const firstCheckbox = document.querySelector('input[name="component-floors"][value="1"]');
    if (firstCheckbox) firstCheckbox.checked = true;
    updateAreaDisplay(dimInfo.componentArea, 1, dimInfo.componentArea);
}
```

#### Change 5: Updated Metadata Storage (lines 200-204)
Store additional metadata for placement validation:
```javascript
// Store metadata for placement
modal.dataset.isMultiFloor = dimInfo.isMultiFloor || isLargeItem;
modal.dataset.floorsNeeded = isMultiFloorRequired ? dimInfo.floorsNeeded : 1;
modal.dataset.isLargeItem = isLargeItem;
modal.dataset.componentIndex = componentIndex;
```

#### Change 6: Updated Validation in startPlacement() (lines 236-257)
Modified validation to handle large items differently:
```javascript
// Determine which floors
let selectedFloors = [];
if (modal.dataset.isMultiFloor === 'true') {
    const checkboxes = document.querySelectorAll('input[name="component-floors"]:checked');
    selectedFloors = Array.from(checkboxes).map(cb => parseInt(cb.value));

    const floorsNeeded = parseInt(modal.dataset.floorsNeeded);
    const isLargeItem = modal.dataset.isLargeItem === 'true';

    // For required multi-floor components, enforce minimum floor count
    // For large items, just require at least one floor
    if (!isLargeItem && selectedFloors.length < floorsNeeded) {
        alert(`Please select at least ${floorsNeeded} floors for this component.`);
        return;
    } else if (selectedFloors.length < 1) {
        alert('Please select at least one floor for this component.');
        return;
    }
} else {
    const floorSelect = document.getElementById('component-floor-select');
    selectedFloors = [parseInt(floorSelect.value)];
}
```

## Behavior Summary

### Component Size Categories

1. **Multi-Floor Required (>100% of floor area)**
   - Message: "This component requires X floors."
   - Shows warning notice with ⚠️
   - Auto-selects minimum required floors
   - Validation: Must select at least X floors

2. **Large Item (25-100% of floor area)**
   - Message: "Large items may fit better if split across multiple floors; choose one or more floors for this item."
   - Hides warning notice
   - Auto-selects only first floor
   - Validation: Must select at least 1 floor (user can add more)

3. **Normal Component (≤25% of floor area)**
   - No special message
   - Shows single floor dropdown
   - No multi-floor options

### Threshold: 25%
- Chosen because items this large benefit from being spread across floors for better ship layout
- Balances between suggesting multi-floor for truly large items vs. cluttering UI for medium items

## Test Files Created

1. **TEST_LARGE_ITEMS.md** - Comprehensive test plan with:
   - Detailed test cases for each size category
   - Expected behaviors and validation
   - Test case summary table
   - Examples with different floor sizes
   - Visual verification checklist

## Files Modified

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\index.html`
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\styles.css`
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\component-modal.js`

## Files Created

- `C:\Users\David L. Dawes\Play\StarshipArchitetect\TEST_LARGE_ITEMS.md`
- `C:\Users\David L. Dawes\Play\StarshipArchitetect\IMPLEMENTATION_SUMMARY.md`

## Testing Instructions

1. Open `index.html` in browser
2. Load `transport.csv`
3. Configure floors: 4 floors, 100m × 35m, 2.5m ceiling height
4. Test components from different categories:
   - Fuel Tank (2000t) - Should require 4 floors
   - Staterooms (560t) - Should show large item message
   - Power Plant (150t) - Should show normal single floor dropdown
5. Verify messages, auto-selection, and validation work correctly

## No Breaking Changes

All changes are additive:
- Existing functionality preserved
- Normal components behave as before
- Multi-floor required components behave as before
- Only adds new guidance for large (25-100%) items
