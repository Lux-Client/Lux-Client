const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../src/locales');
const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));

const newKeys = {
    common: {
        "theme_marketplace": "Theme Marketplace"
    },
    extensions: {
        "theme_marketplace": "Theme Marketplace",
        "theme_marketplace_desc": "Discover and install custom themes built by the community."
    }
};

for (const file of files) {
    const filePath = path.join(localesDir, file);
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);

        // Add to common
        if (json.common) {
            for (const [key, val] of Object.entries(newKeys.common)) {
                if (!json.common[key]) {
                    json.common[key] = val;
                }
            }
        }

        // Add to extensions
        if (json.extensions) {
            for (const [key, val] of Object.entries(newKeys.extensions)) {
                if (!json.extensions[key]) {
                    json.extensions[key] = val;
                }
            }
        }

        fs.writeFileSync(filePath, JSON.stringify(json, null, 4));
        console.log(`Updated ${file}`);
    } catch (e) {
        console.error(`Error updating ${file}:`, e);
    }
}
