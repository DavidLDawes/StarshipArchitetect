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

/**
 * Parse CSV content into ship components
 * @param {string} csvContent - Raw CSV content
 * @param {string} filename - Optional filename (used as ship name if not in CSV)
 * @returns {object} Parsed ship data with components, totals, and ship name
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
        dataStartIndex = 4; // Skip to data rows

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
            totalTons = tons;
            totalCost = cost;
        } else if (category.toLowerCase() !== 'total' && category.toLowerCase() !== 'totals') {
            // Parse quantity from item name (e.g., "Staterooms x10")
            let quantity = 1;
            let itemName = item;
            const quantityMatch = item.match(/^(.+?)\s*[xX×]\s*(\d+)$/);
            if (quantityMatch) {
                itemName = quantityMatch[1].trim();
                quantity = parseInt(quantityMatch[2]);
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
        totalTons,
        totalCost,
        shipName
    };
}
