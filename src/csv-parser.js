/**
 * Starship Architect - CSV Parser Module
 * Handles parsing of ship design CSV files
 */

/**
 * Parse a single CSV line handling quoted fields
 * @param {string} line - CSV line
 * @returns {string[]} Array of field values
 */
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);

    return fields;
}

// ========================================
// Ship Configuration
// ========================================

/**
 * Specific hull shapes and the general class each belongs to. The first pattern
 * found in the configuration text wins.
 */
const CONFIGURATION_SHAPES = [
    { shape: 'rectangular', general: 'standard', pattern: /\brectang(?:le|ular)\b/i },
    { shape: 'wedge', general: 'standard', pattern: /\bwedge\b/i },
    { shape: 'cone', general: 'standard', pattern: /\bcon(?:e|ical)\b/i },
    { shape: 'sphere', general: 'standard', pattern: /\bspher(?:e|ical)\b/i },
    { shape: 'cylinder', general: 'standard', pattern: /\bcylind(?:er|rical)\b/i },
    { shape: 'wing', general: 'streamlined', pattern: /\bwing(?:ed)?\b/i },
    { shape: 'disk', general: 'streamlined', pattern: /\bdis[ck]\b/i },
    { shape: 'lifting-body', general: 'streamlined', pattern: /\blifting(?:[\s-]*bod(?:y|ies))?\b/i }
];

/** Shape used when the text names a general class but no specific shape */
const CONFIGURATION_DEFAULTS = {
    standard: 'rectangular',
    streamlined: 'lifting-body',
    distributed: 'distributed'
};

/**
 * Read a ship configuration such as "Streamlined Lifting Body configuration".
 * Designs with no configuration, or one that can't be understood, are standard
 * rectangular, which is how every older design has always been laid out.
 * @param {string} text - Configuration text from the design file
 * @returns {{general: string, shape: string, text: string}} General class, specific
 *   shape, and the original text
 */
function parseConfiguration(text = '') {
    const original = String(text).trim();

    const named = CONFIGURATION_SHAPES.find(s => s.pattern.test(original));
    if (named) {
        return { general: named.general, shape: named.shape, text: original };
    }

    const generalMatch = original.match(/\b(standard|streamlined|distributed)\b/i);
    const general = generalMatch ? generalMatch[1].toLowerCase() : 'standard';
    return { general, shape: CONFIGURATION_DEFAULTS[general], text: original };
}

/**
 * Read the first line of the current design format:
 *   Courier, Streamlined Lifting Body configuration, 300 tons, Tech Level G
 * @param {string[]} fields - Fields of the first line
 * @returns {{shipName: string, configurationText: string, tons: number}|null}
 *   Null if this line is not a design line (older formats start with a header
 *   row or "Name,"). Tons is 0 if the line doesn't give a tonnage.
 */
function parseDesignLine(fields) {
    const first = fields[0].trim().toLowerCase();
    if (!first || first === 'category' || first === 'name') return null;

    const configIndex = fields.findIndex((field, i) => i > 0 && /\bconfiguration\b/i.test(field));
    // A thousands separator may have split the tonnage across fields, so search them rejoined
    const tonsMatch = fields.slice(1).join(',').match(/(\d[\d,]*(?:\.\d+)?)\s*d?tons?\b/i);
    if (configIndex === -1 && !tonsMatch) return null;

    // An unquoted comma in the ship name leaves the name spread over several fields
    const nameEnd = configIndex === -1 ? 1 : configIndex;
    return {
        shipName: fields.slice(0, nameEnd).join(',').trim(),
        configurationText: configIndex === -1 ? '' : fields[configIndex].trim(),
        tons: tonsMatch ? parseFloat(tonsMatch[1].replace(/,/g, '')) : 0
    };
}

/**
 * Index of the "Category,Item,..." row, searching from a given line
 * @param {string[]} lines - CSV lines
 * @param {number} start - Line to start from
 * @returns {number} Line index, or -1 if there is no such row
 */
function findCategoryRow(lines, start) {
    for (let i = start; i < lines.length; i++) {
        if (parseCSVLine(lines[i])[0].trim().toLowerCase() === 'category') return i;
    }
    return -1;
}

// ========================================
// CSV Parsing
// ========================================

/**
 * Parse CSV content into ship components
 * @param {string} csvContent - Raw CSV content
 * @param {string} filename - Optional filename (used as ship name if not in CSV)
 * @returns {object} Parsed ship data with components, totals, ship name, and
 *   configuration ({general, shape, text} from parseConfiguration)
 */
function parseCSV(csvContent, filename = '') {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    let shipName = '';
    let dataStartIndex = 1; // Default: skip header row (line 0)
    let totalTons = 0;
    let totalCost = 0;
    let isSmallCraftFormat = false; // Track if using small craft format
    let configurationText = '';
    let hullTons = 0; // Tonnage stated on a design line; takes priority over the Total row

    // Detect small craft format (starts with "Name,")
    const firstLine = parseCSVLine(lines[0]);
    if (firstLine[0] && firstLine[0].trim().toLowerCase() === 'name') {
        isSmallCraftFormat = true;
        // Small craft format
        shipName = firstLine[1] ? firstLine[1].trim() : '';
        // Line 0: Name,[ship name]
        // Line 1: Hull,[tonnage],[cost]
        // Line 2: blank
        // Line 3: Category,Item,Tons,Cost (MCr)
        // Line 4+: data rows
        const categoryRow = findCategoryRow(lines, 1);
        dataStartIndex = categoryRow === -1 ? 4 : categoryRow + 1; // Skip to data rows

        // Extract total tonnage and cost from Hull line (line 1)
        if (lines.length > 1) {
            const hullLine = parseCSVLine(lines[1]);
            if (hullLine.length >= 3 && hullLine[0].trim().toLowerCase() === 'hull') {
                // Parse tonnage from "90 tons" format
                const tonnageStr = hullLine[1].trim();
                const tonnageMatch = tonnageStr.match(/([0-9.]+)/);
                if (tonnageMatch) {
                    totalTons = parseFloat(tonnageMatch[1]);
                }

                // Parse cost from "98.1 MCr" format
                const costStr = hullLine[2].trim();
                const costMatch = costStr.match(/([0-9.]+)/);
                if (costMatch) {
                    totalCost = parseFloat(costMatch[1]);
                }
            }
        }
    }

    // Current design format: name, configuration, tonnage, ...
    const designLine = isSmallCraftFormat ? null : parseDesignLine(firstLine);
    if (designLine) {
        shipName = designLine.shipName;
        configurationText = designLine.configurationText;
        hullTons = designLine.tons;
        const categoryRow = findCategoryRow(lines, 1);
        dataStartIndex = categoryRow === -1 ? 1 : categoryRow + 1;
    }

    // If no ship name from CSV, use filename (without extension)
    if (!shipName && filename) {
        shipName = filename.replace(/\.csv$/i, '').replace(/[_-]/g, ' ');
    }

    // Skip to data rows
    const dataLines = lines.slice(dataStartIndex);
    const components = [];
    let currentCategory = '';

    for (const line of dataLines) {
        // Parse CSV line (handles quoted fields)
        const fields = parseCSVLine(line);
        if (fields.length < 4) continue;

        let [category, item, tons, cost] = fields;

        // Clean up values
        category = category.trim();
        item = item.trim();
        tons = parseFloat(tons.replace(/[^0-9.-]/g, '')) || 0;
        cost = parseFloat(cost.replace(/[^0-9.-]/g, '')) || 0;

        // Handle category inheritance
        if (category) {
            currentCategory = category;
        } else {
            category = currentCategory;
        }

        // Check if this is the total line
        // For small craft format, skip TOTALS lines since we got totals from Hull line
        if ((category.toLowerCase() === 'total' || category.toLowerCase() === 'totals') && !isSmallCraftFormat) {
            totalTons = hullTons || tons;
            // Designs may split totals over several rows; a row without a cost keeps the last one
            if (!designLine || cost) totalCost = cost;
        } else if (category.toLowerCase() !== 'total' && category.toLowerCase() !== 'totals') {
            // Parse quantity from item name: "Staterooms x10" or "Staterooms (x140)"
            let quantity = 1;
            let itemName = item;
            const quantityMatch = item.match(/^(.+?)\s*(?:\(\s*[xX×]\s*(\d+)\s*\)|[xX×]\s*(\d+))$/);
            if (quantityMatch) {
                itemName = quantityMatch[1].trim();
                quantity = parseInt(quantityMatch[2] || quantityMatch[3], 10);
            }

            // Calculate per-item tonnage
            const tonsPerItem = tons / quantity;

            components.push({
                category: category,
                item: item,
                itemName: itemName,  // Name without quantity
                tons: tons,
                tonsPerItem: tonsPerItem,
                cost: cost,
                quantity: quantity
            });
        }
    }

    return {
        components,
        totalTons: totalTons || hullTons,
        totalCost,
        shipName,
        configuration: parseConfiguration(configurationText)
    };
}

// CommonJS export for Jest (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined') {
    module.exports = { parseCSVLine, parseConfiguration, parseDesignLine, parseCSV };
}
