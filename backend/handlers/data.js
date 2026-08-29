// @ts-nocheck
const axios = require('axios');
const { app } = require('electron');

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader';
const QUILT_META = 'https://meta.quiltmc.org/v3/versions/loader';
const FORGE_PROMO = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

module.exports = (ipcMain) => {
    ipcMain.handle('data:get-vanilla-versions', async () => {
        try {
            const response = await axios.get(MOJANG_MANIFEST);
            return { success: true, versions: response.data.versions };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('data:get-loaders', async (_, mcVersion, loaderType) => {
        try {
            if (loaderType === 'fabric') {
                const url = `${FABRIC_META}/${mcVersion}`;
                const response = await axios.get(url);
                return { success: true, loaders: response.data };
            } else if (loaderType === 'quilt') {
                const url = `${QUILT_META}/${mcVersion}`;
                const response = await axios.get(url);
                return { success: true, loaders: response.data };
            } else if (loaderType === 'forge') {
                const response = await axios.get(FORGE_PROMO);
                const promos = response.data.promos;

                const relevant = Object.entries(promos).filter(([key]) => key.startsWith(mcVersion + '-'));
                return { success: true, loaders: relevant.map(([k, v]) => ({ version: v, name: k })) };
            }
            return { success: true, loaders: [] };
        } catch (e) {
            console.error("Loader fetch error", e);
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('data:get-news', async () => {
        try {
            const NEWS_URL = 'https://lux.pluginhub.de/news.json';

            console.log(`[News] Fetching from ${NEWS_URL}...`);
            const response = await axios.get(NEWS_URL, { timeout: 30000 });
            console.log(`[News] Fetched ${response.data.length} items.`);
            return { success: true, news: response.data };
        } catch (e) {
            console.error("[News] Fetch Error:", e.message);
            if (e.response) {
                console.error("[News] Status:", e.response.status);
                console.error("[News] Data:", e.response.data);
            }
            return { success: false, error: e.message };
        }
    });
};
