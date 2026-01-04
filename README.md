# StarshipArchitect

Starship Architect is a tool used to architect Traveler SRD starships. Using this tool you'll layout the floors of your starship as two dimensional plans, splitting your starships tonnage out into floors (and for capital ships, sections) then architecting the floors or sections in detail, putting in engines, fuel, cabins, cargo bays, a bridge or control room, perhaps weapons armor, and shields for military designs as called for in the starships design.

[Traveller Starship Designer](https://srd-tools.com/ShipDesign/index.html), [Traveller Capital Ship Designer](https://srd-tools.com/CapitalShipDesign/index.html), and [Traveller Small Craft Desginer](https://srd-tools.com/CapitalShipDesign/index.html) are available to create the designs for your starships and smallcraft and export them as .CSV files for use by StarshipArchitect. Alternatively, any .CSV file with a list of items and their tonnage can be used to create the design for your starship or smallcraft.

## Features

### CSV Import
- **File Upload**: Upload a .CSV file with columns: Category, Item, Tons, Cost
- **URL Parameters**: Load ship designs directly from URL-encoded CSV data (see below)

### URL Loading & Sharing

You can load ship designs directly via URL parameters, enabling deep linking, bookmarking, and sharing:

```
index.html?csv=<URL_encoded_CSV_data>
```

**Example:**
```
index.html?csv=Category%2CItem%2CTons%2CCost%0AEngine%2CManeuver%20Drive%2C75%2C1000%0APower%2CPower%20Plant%2C50%2C800
```

**Benefits:**
- **Deep Linking**: Share specific ship designs via URL
- **Bookmarking**: Save ship configurations for later
- **Automation**: Launch the app with predefined data
- **No File Upload**: Skip the upload dialog entirely

**Share Button:**
After loading a CSV file, click the "Share Design" button in the Ship Statistics section to automatically generate a shareable URL and copy it to your clipboard.

**Note:** Very large ship designs may exceed browser URL length limits (~2000 characters). The app will warn you if the generated URL is too long.