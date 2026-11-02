/**
 * Starship Architect - Accommodations Panel Module
 * UI for "combine rec/health with staterooms": the toggle, the per-floor
 * accommodations summary, and component-list entries for combined items.
 *
 * Dependencies:
 * - rec-health.js (classification, combination, per-floor summary)
 * - placement-geometry.js (getPlacedCountByFloor)
 * - app.js (shipData, uiState, renderComponents)
 */

// ========================================
// Formatting
// ========================================

/**
 * Escape text for insertion into HTML
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Tons for display: at most one decimal, no trailing ".0"
 */
function formatTons(tons) {
    return `${Number(tons.toFixed(1))} t`;
}

/**
 * Tonnage line for a component in the list or modal; staterooms carrying
 * rec/health overhead show it separately
 * @param {object} component
 * @returns {string} HTML
 */
function formatComponentTons(component) {
    const qty = component.quantity || 1;
    const each = qty > 1 ? ` (${component.tonsPerItem} each)` : '';
    if (!(component.overheadPerItem > 0)) {
        return `📦 ${component.tons} tons${each}`;
    }
    const overhead = component.overheadPerItem * qty;
    return `📦 ${component.tons} tons${each} <span class="rec-overhead">+ ${formatTons(overhead)} rec/health` +
        `${qty > 1 ? ` (${Number(component.overheadPerItem.toFixed(2))} each)` : ''}</span>`;
}

/**
 * "Garden ×2, Gym, Spa ×2"
 */
function formatRecItems(items) {
    return items.map(i => `${escapeHtml(i.name)}${i.count > 1 ? ` ×${i.count}` : ''}`).join(', ');
}

// ========================================
// Toggle
// ========================================

/**
 * Whether stateroom or rec/health items are already on the floor plan; the
 * combination can't be switched then, because placed staterooms were sized
 * with (or without) the overhead
 */
function hasCombinablePlacements() {
    const { staterooms, recHealth } = findCombinableComponents(shipData.components);
    return [...staterooms, ...recHealth].some(i => getPlacedCount(shipData.componentPlacements[i]) > 0);
}

/**
 * Show, enable, and describe the "combine rec/health with staterooms" toggle
 */
function updateCombineRecHealthToggle() {
    const row = document.getElementById('combine-rec-health-row');
    const checkbox = document.getElementById('combine-rec-health');
    const hint = document.getElementById('combine-rec-health-hint');
    if (!row) return;

    const available = canCombineRecHealth(shipData.components);
    row.classList.toggle('hidden', !available);
    if (!available) return;

    checkbox.checked = !!shipData.combineRecHealth;
    const locked = hasCombinablePlacements();
    checkbox.disabled = locked;

    const { recTons, stateroomCount, overheadPerItem } = computeRecHealthOverhead(shipData.components);
    let text = `Adds the ${formatTons(recTons)} of rec/health items (spas, gyms, kitchens…) to the ` +
        `${stateroomCount} staterooms (+${Number(overheadPerItem.toFixed(2))} t each), so filling floors ` +
        'with staterooms reserves that space. The items are spread over the floors with the staterooms.';
    if (locked) {
        text = (shipData.combineRecHealth
            ? 'Remove the placed staterooms to separate rec/health again.'
            : 'Remove the placed staterooms and rec/health items to combine them.') + ' ' + text;
    }
    hint.textContent = text;
}

/**
 * Switch the combination on or off
 */
function setCombineRecHealth(enabled) {
    if (hasCombinablePlacements()) return;
    if (uiState.regionFill) cancelRegionFill();
    if (uiState.isPlacingComponent) cancelPlacement();
    if (uiState.selectedPlacement) cancelSelection();

    shipData.combineRecHealth = !!enabled;
    setRecHealthCombined(shipData.components, shipData.combineRecHealth);
    renderComponents();
}

/**
 * Wire up the toggle (called once at startup)
 */
function setupCombineRecHealthEvents() {
    const checkbox = document.getElementById('combine-rec-health');
    if (checkbox) {
        checkbox.addEventListener('change', e => setCombineRecHealth(e.target.checked));
    }
}

// ========================================
// Per-Floor Summary
// ========================================

/**
 * Render the accommodations-by-floor table
 * @returns {object|null} The summary (see summarizeAccommodations), or null when off
 */
function renderAccommodationsPanel() {
    updateCombineRecHealthToggle();
    const panel = document.getElementById('accommodations-summary');
    if (!panel) return null;

    const summary = shipData.combineRecHealth
        ? summarizeAccommodations(shipData.components, shipData.componentPlacements, getPlacedCountByFloor)
        : null;
    panel.classList.toggle('hidden', !summary);
    if (!summary) {
        panel.innerHTML = '';
        return null;
    }

    const { floors, unassigned, totals } = summary;
    let html = '<h3>🛏️ Staterooms + rec/health by floor</h3>';

    if (floors.length === 0) {
        html += `<p class="accommodations-empty">Place staterooms to spread the ${formatTons(totals.recTotal)} ` +
            'of rec/health items over the floors.</p>';
        panel.innerHTML = html;
        return summary;
    }

    html += `<table class="accommodations-table">
        <thead><tr><th>Floor</th><th>Staterooms</th><th>Rec/health items</th><th>Tons</th></tr></thead>
        <tbody>`;
    for (const f of floors) {
        html += `<tr>
            <td>F${f.floor}</td>
            <td>${f.staterooms} <span class="accommodations-sub">${formatTons(f.stateroomTons)}</span></td>
            <td>${f.recItems.length ? formatRecItems(f.recItems) : '—'}
                <span class="accommodations-sub">${formatTons(f.recTons)}</span></td>
            <td>${formatTons(f.totalTons)}</td>
        </tr>`;
    }
    html += `<tr class="accommodations-total">
            <td>Total</td>
            <td>${totals.staterooms} of ${totals.stateroomTotal}</td>
            <td>${formatTons(totals.recTons)} of ${formatTons(totals.recTotal)}</td>
            <td>${formatTons(totals.totalTons)}</td>
        </tr>
        </tbody></table>`;

    if (unassigned.length > 0) {
        html += `<p class="accommodations-pending">Waiting for more staterooms: ${formatRecItems(unassigned)}</p>`;
    }
    panel.innerHTML = html;
    return summary;
}

// ========================================
// Component List Entries
// ========================================

/**
 * List entry for a rec/health component that rides along with the staterooms.
 * It is not placed by hand, so it isn't clickable.
 * @returns {HTMLElement}
 */
function createCombinedRecHealthItem(component, index, summary) {
    const total = component.quantity || 1;
    const info = summary && summary.recPlaced[index];
    const assigned = info ? info.total : 0;
    const breakdown = info
        ? Object.keys(info.byFloor).sort((a, b) => a - b).map(f => `F${f}: ${info.byFloor[f]}`).join(', ')
        : '';

    const item = document.createElement('div');
    item.className = 'component-item combined-rec-health';
    if (assigned > 0) item.classList.add('placed');
    if (assigned >= total) item.classList.add('fully-placed');
    item.title = 'Combined with staterooms: spread over the floors as staterooms are placed';
    item.style.cursor = 'default';

    const status = total > 1 ? `${assigned} of ${total} assigned` : (assigned ? 'Assigned' : 'Not assigned yet');
    item.innerHTML = `
        <div class="component-category">${escapeHtml(component.category)}</div>
        <div class="component-name">${escapeHtml(component.item)}</div>
        <div class="component-stats">
            <span>📦 ${component.tons} tons${total > 1 ? ` (${component.tonsPerItem} each)` : ''}</span>
            <span>💰 ${component.cost.toLocaleString()} MCr</span>
        </div>
        <div class="component-placement-info">🔗 With staterooms · ${status}` +
            `${breakdown ? ` <span class="component-floor-breakdown">(${breakdown})</span>` : ''}</div>
    `;
    return item;
}
