/**
 * Starship Architect - Layout UI Module
 * Save / open layout files, apply a layout (to its own ship design or, tolerantly,
 * to the design loaded now), report what couldn't be restored, autosave to the
 * browser, and download SVG exports.
 *
 * Dependencies:
 * - layout-io.js (serializeLayout, parseLayout, restorePlacements, ...)
 * - layout-export.js (exportLayoutSvg)
 * - rec-health.js (canCombineRecHealth, setRecHealthCombined)
 * - app.js (shipData, uiState, elements, loadCsvFromString, showSections, refreshUI)
 */

// ========================================
// Constants and State
// ========================================

/** localStorage key for the autosaved layout */
const AUTOSAVE_KEY = 'starshipArchitect.autosave.v1';

/** How often to check for changes worth autosaving (ms) */
const AUTOSAVE_INTERVAL_MS = 3000;

const layoutUiState = {
    lastAutosaveSignature: null,
    dismissedAutosave: null // savedAt of an autosave the user chose not to restore
};

// ========================================
// Helpers
// ========================================

/**
 * Ship state plus the derived floor width, as serializeLayout expects
 */
function getLayoutState() {
    const { floorWidth } = getCurrentFloorDimensions();
    return { ...shipData, floorWidth };
}

/**
 * Whether a ship design is loaded
 */
function hasShipLoaded() {
    return Array.isArray(shipData.components) && shipData.components.length > 0;
}

/**
 * File name based on the ship name: "transport-layout.starship.json"
 */
function layoutFileName(suffix) {
    const base = (shipData.shipName || 'ship').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'ship';
    return `${base}${suffix}`;
}

/**
 * Offer text as a file download
 */
function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Leave any placement, selection, resize, or region-picking in progress
 */
function endInteractiveModes() {
    if (typeof resizeState !== 'undefined' && resizeState.isResizing) cancelResize();
    if (uiState.selectedPlacement) cancelSelection();
    if (uiState.regionFill) cancelRegionFill();
    if (uiState.isPlacingComponent) cancelPlacement();
    closeComponentModal();
}

/**
 * Count placed items in a layout
 */
function countLayoutItems(layout) {
    return layout.placements.reduce((sum, p) =>
        sum + (p.entries || []).reduce((s, e) => s + ((e && e.count) || 1), 0), 0);
}

// ========================================
// Layout Modal (choices and reports)
// ========================================

/**
 * Show the layout modal
 * @param {string} title
 * @param {string} bodyHtml - Already escaped HTML
 * @param {Array<{label, primary, onClick}>} actions - Buttons; each closes the modal first
 */
function showLayoutModal(title, bodyHtml, actions) {
    const modal = document.getElementById('layout-modal');
    document.getElementById('layout-modal-title').textContent = title;
    document.getElementById('layout-modal-body').innerHTML = bodyHtml;
    const footer = document.getElementById('layout-modal-actions');
    footer.innerHTML = '';
    for (const action of actions) {
        const btn = document.createElement('button');
        btn.className = `btn ${action.primary ? 'btn-primary' : 'btn-secondary'}`;
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            closeLayoutModal();
            if (action.onClick) action.onClick();
        });
        footer.appendChild(btn);
    }
    modal.classList.remove('hidden');
}

/**
 * Hide the layout modal
 */
function closeLayoutModal() {
    document.getElementById('layout-modal').classList.add('hidden');
}

/**
 * Show a list of messages
 */
function showLayoutReport(title, intro, messages) {
    let html = intro ? `<p>${escapeHtml(intro)}</p>` : '';
    if (messages.length > 0) {
        html += `<ul class="layout-report">${messages.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`;
    }
    showLayoutModal(title, html, [{ label: 'OK', primary: true }]);
}

// ========================================
// Saving
// ========================================

/**
 * Download the current layout as a .starship.json file
 */
function saveLayoutToFile() {
    if (!hasShipLoaded()) {
        showLayoutReport('Nothing to save', 'Load a ship design first.', []);
        return;
    }
    const layout = serializeLayout(getLayoutState());
    downloadText(layoutFileName('-layout.starship.json'), JSON.stringify(layout, null, 2), 'application/json');
}

/**
 * Download the floor plan as an SVG drawing
 */
function exportSvgToFile() {
    if (!hasShipLoaded()) {
        showLayoutReport('Nothing to export', 'Load a ship design first.', []);
        return;
    }
    downloadText(layoutFileName('-deck-plan.svg'), exportLayoutSvg(getLayoutState()), 'image/svg+xml');
}

// ========================================
// Opening
// ========================================

/**
 * Read a layout file chosen by the user
 */
function openLayoutFile(file) {
    const reader = new FileReader();
    reader.onload = e => handleLayoutText(e.target.result, file.name);
    reader.onerror = () => showLayoutReport('Could not open layout', `${file.name} could not be read.`, []);
    reader.readAsText(file);
}

/**
 * Parse layout text and apply it, asking which ship design to use when the
 * design loaded now differs from the one saved in the layout
 */
function handleLayoutText(text, sourceName = 'layout') {
    let layout;
    try {
        layout = parseLayout(text);
    } catch (error) {
        showLayoutReport('Could not open layout', `${sourceName}: ${error.message}`, []);
        return;
    }

    if (!hasShipLoaded() || sameDesignCsv(shipData.originalCsv, layout.ship.csv)) {
        applyLayout(layout, { useSavedDesign: true, sourceName });
        return;
    }

    const savedName = layout.ship.name || 'the saved ship';
    const currentName = shipData.shipName || 'the current ship';
    showLayoutModal('This layout is for a different ship design',
        `<p>The layout was saved with <strong>${escapeHtml(savedName)}</strong> (${escapeHtml(layout.ship.totalTons)} t). ` +
        `The design loaded now is <strong>${escapeHtml(currentName)}</strong> (${escapeHtml(shipData.totalTons)} t).</p>` +
        '<p><strong>Apply to current design</strong> keeps the components that still match in their saved places ' +
        'and lists anything that could not be restored. <strong>Load saved design</strong> replaces the current ' +
        'design with the one stored in the layout.</p>',
        [
            { label: 'Cancel' },
            { label: 'Load saved design', onClick: () => applyLayout(layout, { useSavedDesign: true, sourceName }) },
            { label: 'Apply to current design', primary: true, onClick: () => applyLayout(layout, { useSavedDesign: false, sourceName }) }
        ]);
}

/**
 * Apply a parsed layout
 * @param {object} layout - From parseLayout
 * @param {object} options
 * @param {boolean} options.useSavedDesign - Rebuild the ship from the layout's CSV
 * @param {string} options.sourceName - For messages
 * @param {boolean} options.quiet - Don't show a report when everything restored
 * @returns {object|null} restorePlacements result, or null if the design failed to load
 */
function applyLayout(layout, { useSavedDesign, sourceName = 'layout', quiet = false }) {
    endInteractiveModes();

    if (useSavedDesign) {
        try {
            loadCsvFromString(layout.ship.csv, `layout: ${sourceName}`, layout.ship.name ? `${layout.ship.name}.csv` : '');
        } catch (error) {
            showLayoutReport('Could not open layout', `The ship design saved in ${sourceName} could not be read: ${error.message}`, []);
            return null;
        }
        if (layout.ship.name) shipData.shipName = layout.ship.name;
    }

    // Floor settings (set directly: the floor controls' handlers clear placements)
    shipData.numFloors = layout.floors.count;
    shipData.floorLength = layout.floors.length;
    shipData.ceilingHeight = layout.floors.ceilingHeight;
    const dims = getCurrentFloorDimensions();
    shipData.armorThickness = calculateArmorThickness(shipData.armorTons, shipData.numFloors,
        shipData.floorLength, dims.floorArea, shipData.ceilingHeight);

    // Options that change component sizes go before the placements
    const problems = [];
    const wantCombine = !!layout.options.combineRecHealth;
    const canCombine = canCombineRecHealth(shipData.components);
    if (wantCombine && !canCombine) {
        problems.push('The layout combined rec/health with staterooms, but this design has nothing to combine.');
    }
    shipData.combineRecHealth = wantCombine && canCombine;
    setRecHealthCombined(shipData.components, shipData.combineRecHealth);

    const floor = {
        count: shipData.numFloors,
        length: shipData.floorLength,
        width: dims.floorWidth,
        armorThickness: shipData.armorThickness
    };
    const notes = compareFloorGeometry(layout, floor);
    const result = restorePlacements(layout, shipData.components, floor);
    shipData.componentPlacements = result.placements;
    uiState.placementHistory = [];
    uiState.redoHistory = [];

    // Floor controls and display
    const slider = elements.floorSlider;
    if (shipData.numFloors > parseInt(slider.max, 10)) slider.max = shipData.numFloors;
    slider.value = shipData.numFloors;
    elements.fileName.textContent = `Layout: ${sourceName}`;
    showSections();
    refreshUI();

    // Remember this as the latest work
    autosaveNow();

    const messages = [...notes, ...problems, ...result.problems];
    if (messages.length > 0) {
        const total = countLayoutItems(layout);
        showLayoutReport(
            result.dropped > 0 ? 'Layout loaded with some changes' : 'Layout loaded',
            `Restored ${result.restored} of ${result.restored + result.dropped} placements ` +
            `(${total} items saved). Not everything could be restored exactly:`,
            messages);
    } else if (!quiet) {
        console.log(`Layout loaded from ${sourceName}: ${result.restored} placements restored`);
    }
    return result;
}

// ========================================
// Autosave (browser storage)
// ========================================

/**
 * Read the autosaved layout, if any
 * @returns {object|null} Parsed layout
 */
function readAutosave() {
    try {
        const text = localStorage.getItem(AUTOSAVE_KEY);
        return text ? parseLayout(text) : null;
    } catch (error) {
        console.warn('Ignoring unreadable autosave:', error.message);
        return null;
    }
}

/**
 * Save the current layout to browser storage when it has changed.
 * Only layouts with at least one placement are saved, so changing floors or
 * loading another design (which clears placements) never overwrites the last
 * real work; it can be restored from the banner.
 */
function autosaveNow() {
    if (!hasShipLoaded()) return;
    const layout = serializeLayout(getLayoutState());
    if (layout.placements.length === 0) {
        updateAutosaveBanner();
        return;
    }
    const signature = JSON.stringify({ ...layout, savedAt: '' });
    if (signature === layoutUiState.lastAutosaveSignature) return;
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(layout));
        layoutUiState.lastAutosaveSignature = signature;
    } catch (error) {
        console.warn('Autosave failed:', error.message);
    }
    updateAutosaveBanner();
}

/**
 * Show the "restore autosave" banner when there is saved work and nothing is
 * placed right now (startup, or after placements were cleared)
 */
function updateAutosaveBanner() {
    const banner = document.getElementById('autosave-banner');
    if (!banner) return;
    const saved = readAutosave();
    const placedNow = hasShipLoaded() &&
        Object.values(shipData.componentPlacements).some(p => p && p.floors && p.floors.length > 0);
    const show = !!saved && !placedNow && saved.savedAt !== layoutUiState.dismissedAutosave;
    banner.classList.toggle('hidden', !show);
    if (!show) return;

    const when = new Date(saved.savedAt);
    const whenText = isNaN(when) ? '' : ` (autosaved ${when.toLocaleString()})`;
    const name = saved.ship.name || 'unnamed ship';
    document.getElementById('autosave-text').textContent =
        `Restore your last layout: ${name}, ${saved.floors.count} floors, ${countLayoutItems(saved)} items placed${whenText}?`;
    banner.dataset.savedAt = saved.savedAt;
}

/**
 * Restore the autosaved layout with its own ship design
 */
function restoreAutosave() {
    const saved = readAutosave();
    if (!saved) {
        updateAutosaveBanner();
        return;
    }
    applyLayout(saved, { useSavedDesign: true, sourceName: 'autosave' });
    updateAutosaveBanner();
}

/**
 * Hide the banner for this autosave
 */
function dismissAutosave() {
    const banner = document.getElementById('autosave-banner');
    layoutUiState.dismissedAutosave = banner ? banner.dataset.savedAt : null;
    updateAutosaveBanner();
}

// ========================================
// Event Setup
// ========================================

/**
 * Wire up layout buttons, the layout modal, and autosave (called once at startup)
 */
function setupLayoutEvents() {
    const bind = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

    bind('save-layout-button', 'click', saveLayoutToFile);
    bind('export-svg-button', 'click', exportSvgToFile);
    bind('layout-input', 'change', event => {
        const file = event.target.files[0];
        if (file) openLayoutFile(file);
        event.target.value = ''; // allow opening the same file again
    });
    bind('layout-modal-close', 'click', closeLayoutModal);
    bind('layout-modal', 'click', e => {
        if (e.target.id === 'layout-modal') closeLayoutModal();
    });
    document.addEventListener('keydown', e => {
        const modal = document.getElementById('layout-modal');
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeLayoutModal();
    });
    bind('autosave-restore', 'click', restoreAutosave);
    bind('autosave-dismiss', 'click', dismissAutosave);

    // Autosave: poll for changes (moves, fills, undo... all change placements)
    // and save when the page is hidden or closed
    setInterval(autosaveNow, AUTOSAVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') autosaveNow();
    });
    window.addEventListener('pagehide', autosaveNow);
    updateAutosaveBanner();
}
