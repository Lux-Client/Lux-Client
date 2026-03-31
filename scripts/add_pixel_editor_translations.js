const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../src/locales');
const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));

const pixelEditorTranslations = {
    en: {
        dashboard: { pixel_editor_btn: "Pixel Editor" },
        pixel_editor: {
            title: "Pixel Editor",
            brush: "Brush",
            eraser: "Eraser",
            fill: "Fill",
            clear: "Clear",
            use_as_icon: "Use as Icon",
            download: "Download PNG",
            grid_toggle: "Toggle Grid",
            brush_size: "Brush Size",
            palette: "Palette",
            recent_colors: "Recent Colors"
        }
    },
    de: {
        dashboard: { pixel_editor_btn: "Pixel-Editor" },
        pixel_editor: {
            title: "Pixel-Editor",
            brush: "Pinsel",
            eraser: "Radiergummi",
            fill: "Füllen",
            clear: "Leeren",
            use_as_icon: "Als Icon verwenden",
            download: "PNG herunterladen",
            grid_toggle: "Raster umschalten",
            brush_size: "Pinselgröße",
            palette: "Palette",
            recent_colors: "Zuletzt verwendet"
        }
    },
    es: {
        dashboard: { pixel_editor_btn: "Editor de Píxeles" },
        pixel_editor: {
            title: "Editor de Píxeles",
            brush: "Pincel",
            eraser: "Borrador",
            fill: "Rellenar",
            clear: "Limpiar",
            use_as_icon: "Usar como icono",
            download: "Descargar PNG",
            grid_toggle: "Alternar cuadrícula",
            brush_size: "Tamaño del pincel",
            palette: "Paleta",
            recent_colors: "Colores recientes"
        }
    },
    fr: {
        dashboard: { pixel_editor_btn: "Éditeur de Pixels" },
        pixel_editor: {
            title: "Éditeur de Pixels",
            brush: "Pinceau",
            eraser: "Gomme",
            fill: "Remplir",
            clear: "Effacer",
            use_as_icon: "Utiliser comme icône",
            download: "Télécharger PNG",
            grid_toggle: "Afficher la grille",
            brush_size: "Taille du pinceau",
            palette: "Palette",
            recent_colors: "Couleurs récentes"
        }
    },
    it: {
        dashboard: { pixel_editor_btn: "Editor di Pixel" },
        pixel_editor: {
            title: "Editor di Pixel",
            brush: "Pennello",
            eraser: "Gomma",
            fill: "Riempi",
            clear: "Pulisci",
            use_as_icon: "Usa come icona",
            download: "Scarica PNG",
            grid_toggle: "Griglia",
            brush_size: "Dimensione pennello",
            palette: "Tavolozza",
            recent_colors: "Colori recenti"
        }
    },
    pt: {
        dashboard: { pixel_editor_btn: "Editor de Pixels" },
        pixel_editor: {
            title: "Editor de Pixels",
            brush: "Pincel",
            eraser: "Borracha",
            fill: "Preencher",
            clear: "Limpar",
            use_as_icon: "Usar como ícone",
            download: "Baixar PNG",
            grid_toggle: "Alternar grade",
            brush_size: "Tamanho do pincel",
            palette: "Paleta",
            recent_colors: "Cores recentes"
        }
    },
    pl: {
        dashboard: { pixel_editor_btn: "Edytor Pikseli" },
        pixel_editor: {
            title: "Edytor Pikseli",
            brush: "Pędzel",
            eraser: "Gumka",
            fill: "Wypełnij",
            clear: "Wyczyść",
            use_as_icon: "Użyj jako ikony",
            download: "Pobierz PNG",
            grid_toggle: "Siatka",
            brush_size: "Rozmiar pędzla",
            palette: "Paleta",
            recent_colors: "Ostatnie kolory"
        }
    },
    ru: {
        dashboard: { pixel_editor_btn: "Пиксельный редактор" },
        pixel_editor: {
            title: "Пиксельный редактор",
            brush: "Кисть",
            eraser: "Ластик",
            fill: "Заливка",
            clear: "Очистить",
            use_as_icon: "Использовать как иконку",
            download: "Скачать PNG",
            grid_toggle: "Сетка",
            brush_size: "Размер кисти",
            palette: "Палитра",
            recent_colors: "Последние цвета"
        }
    }
};

files.forEach(file => {
    const filePath = path.join(localesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const langCode = file.split('_')[0];
    const trans = pixelEditorTranslations[langCode] || pixelEditorTranslations['en'];

    // Update dashboard.pixel_editor_btn
    if (!data.dashboard) data.dashboard = {};
    data.dashboard.pixel_editor_btn = trans.dashboard.pixel_editor_btn;

    // Update pixel_editor section
    data.pixel_editor = trans.pixel_editor;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
    console.log(`Updated ${file} with ${pixelEditorTranslations[langCode] ? langCode : 'en (fallback)'} translations`);
});
