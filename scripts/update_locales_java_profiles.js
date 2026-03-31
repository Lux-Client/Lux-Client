const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../src/locales');

const translations = {
    en: {
        profile: "Java Performance Profile",
        desc_global: "Aikar's Flags are recommended for most modded instances to prevent 'micro-stuttering'.",
        desc_instance: "Overrides the global launcher setting for this instance."
    },
    de: {
        profile: "Java-Performance-Profil",
        desc_global: "Aikar's Flags werden für die meisten gemoddeten Instanzen empfohlen, um 'Micro-Stuttering' zu verhindern.",
        desc_instance: "Überschreibt die globale Launcher-Einstellung für diese Instanz."
    },
    es: {
        profile: "Perfil de rendimiento de Java",
        desc_global: "Los parámetros de Aikar se recomiendan para la mayoría de las instancias con mods para evitar micro-tirones.",
        desc_instance: "Sobrescribe el ajuste global del lanzador para esta instancia."
    },
    fr: {
        profile: "Profil de performance Java",
        desc_global: "Les drapeaux d'Aikar sont recommandés pour la plupart des instances moddées pour éviter les micro-saccades.",
        desc_instance: "Remplace le paramètre global du lanceur pour cette instance."
    },
    it: {
        profile: "Profilo di prestazioni Java",
        desc_global: "I parametri di Aikar sono consigliati per la maggior parte delle istanze moddate per prevenire micro-scatti.",
        desc_instance: "Sovrascrive l'impostazione globale del launcher per questa istanza."
    }
};

const searchKeysToRemove = [
    "search_placeholder",
    "no_results",
    "navigate",
    "select",
    "results",
    "press_enter"
];

fs.readdirSync(localesDir).forEach(file => {
    if (!file.endsWith('.json')) return;
    const filePath = path.join(localesDir, file);
    const lang = file.split('_')[0];
    const trans = translations[lang] || translations['en'];

    console.log(`Processing ${file}...`);
    let content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (content.common) {
        searchKeysToRemove.forEach(key => {
            delete content.common[key];
        });
    }

    if (content.settings && content.settings.memory) {
        content.settings.memory.java_profile = trans.profile;
        content.settings.memory.java_profile_desc = trans.desc_global;
    }

    if (content.instance_settings && content.instance_settings.java) {
        content.instance_settings.java.profile_label = trans.profile;
        content.instance_settings.java.profile_desc = trans.desc_instance;
    }

    fs.writeFileSync(filePath, JSON.stringify(content, null, 4), 'utf8');
});

console.log('All locale files updated.');
