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
 * @returns {object} Parsed ship data with components and totals
 */
function parseCSV(csvContent) {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    // Skip header row
    const dataLines = lines.slice(1);
    const components = [];
    let currentCategory = '';
    let totalTons = 0;
    let totalCost = 0;

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
        if (category.toLowerCase() === 'total') {
            totalTons = tons;
            totalCost = cost;
        } else {
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
        totalCost
    };
}
