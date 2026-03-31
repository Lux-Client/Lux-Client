const yaml = require('js-yaml');
const fs = require('fs-extra');
const path = require('path');

const YAML_OPTIONS = {
    indent: 4,
    lineWidth: 0,
    noRefs: true,
    sortKeys: false
};

async function readYaml(filePath) {
    try {
        if (!await fs.pathExists(filePath)) {
            return null;
        }
        const content = await fs.readFile(filePath, 'utf8');
        return yaml.load(content);
    } catch (error) {
        console.error(`[YAML] Failed to read ${filePath}:`, error.message);
        return null;
    }
}

async function writeYaml(filePath, data) {
    try {
        const content = yaml.dump(data, YAML_OPTIONS);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, 'utf8');
        return true;
    } catch (error) {
        console.error(`[YAML] Failed to write ${filePath}:`, error.message);
        return false;
    }
}

function getSettingsPaths(userDataPath) {
    return {
        json: path.join(userDataPath, 'settings.json'),
        yaml: path.join(userDataPath, 'settings.yaml')
    };
}

async function detectSettingsFormat(userDataPath) {
    const { json, yaml: yamlPath } = getSettingsPaths(userDataPath);
    
    if (await fs.pathExists(yamlPath)) {
        return 'yaml';
    }
    if (await fs.pathExists(json)) {
        return 'json';
    }
    return 'json';
}

async function migrateSettings(fromPath, toPath, fromFormat, toFormat) {
    try {
        let data;
        
        if (fromFormat === 'yaml') {
            data = await readYaml(fromPath);
        } else {
            data = await fs.readJson(fromPath);
        }
        
        if (!data) {
            return { success: false, error: 'Failed to read source settings' };
        }
        
        if (toFormat === 'yaml') {
            await writeYaml(toPath, data);
        } else {
            await fs.writeJson(toPath, data, { spaces: 4 });
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    readYaml,
    writeYaml,
    getSettingsPaths,
    detectSettingsFormat,
    migrateSettings,
    YAML_OPTIONS
};
