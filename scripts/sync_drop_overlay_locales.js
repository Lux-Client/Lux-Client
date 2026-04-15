const fs = require('fs');
const path = require('path');

const localesDir = path.join(process.cwd(), 'src', 'locales');
const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));

const defaults = {
  drop_packs: 'Drag and drop resource packs here to install',
  drop_shaders: 'Drag and drop shader packs here to install',
  accepting_archives: 'Accepting .zip and .rar files'
};

const byLocale = {
  de_de: {
    drop_packs: 'Resource Packs hierher ziehen und ablegen, um sie zu installieren',
    drop_shaders: 'Shader hierher ziehen und ablegen, um sie zu installieren',
    accepting_archives: '.zip- und .rar-Dateien werden akzeptiert'
  },
  de_ch: {
    drop_packs: 'Resource Packs da ahzoge zum Installiere',
    drop_shaders: 'Shader da ahzoge zum Installiere',
    accepting_archives: '.zip und .rar Dateie wäre aktzeptiert'
  }
};

let changed = 0;
for (const file of files) {
  const localeId = file.replace('.json', '');
  const fullPath = path.join(localesDir, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const json = JSON.parse(raw);

  if (!json.instance_details) json.instance_details = {};
  if (!json.instance_details.content) json.instance_details.content = {};

  const values = byLocale[localeId] || defaults;
  let localChanged = false;
  for (const [key, value] of Object.entries(values)) {
    if (json.instance_details.content[key] !== value) {
      json.instance_details.content[key] = value;
      localChanged = true;
    }
  }

  if (localChanged) {
    fs.writeFileSync(fullPath, `${JSON.stringify(json, null, 4)}\n`, 'utf8');
    changed++;
  }
}

console.log(`Updated locale files: ${changed}/${files.length}`);
