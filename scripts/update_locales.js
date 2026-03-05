const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../src/locales');
const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));

const translationsMap = {
    en: {
        settings: {
            integration: {
                smart_log_analytics: "Smart Log Analytics",
                smart_log_analytics_desc: "Automatically analyze crashes and suggest fixes."
            }
        },
        crash: {
            title: "Game Crash Detected",
            analysis: "Log Analysis",
            no_issues: "We couldn't automatically identify the cause of this crash.",
            view_log: "View Uploaded Log",
            check_manually: "Please check the latest.log file manually."
        }
    },
    de: {
        settings: {
            integration: {
                smart_log_analytics: "Smart Log Analytics",
                smart_log_analytics_desc: "Analysiert Abstürze automatisch und schlägt Lösungen vor."
            }
        },
        crash: {
            title: "Spielabsturz erkannt",
            analysis: "Log-Analyse",
            no_issues: "Wir konnten die Ursache dieses Absturzes nicht automatisch identifizieren.",
            view_log: "Hochgeladenes Protokoll ansehen",
            check_manually: "Bitte überprüfe die Datei latest.log manuell."
        }
    },
    es: {
        settings: {
            integration: {
                smart_log_analytics: "Análisis inteligente de registros",
                smart_log_analytics_desc: "Analiza automáticamente los fallos y sugiere soluciones."
            }
        },
        crash: {
            title: "Fallo del juego detectado",
            analysis: "Análisis del registro",
            no_issues: "No pudimos identificar automáticamente la causa de este fallo.",
            view_log: "Ver registro subido",
            check_manually: "Por favor, comprueba el archivo latest.log manualmente."
        }
    },
    fr: {
        settings: {
            integration: {
                smart_log_analytics: "Analyse intelligente des logs",
                smart_log_analytics_desc: "Analyse automatiquement les crashs et suggère des corrections."
            }
        },
        crash: {
            title: "Crash du jeu détecté",
            analysis: "Analyse du log",
            no_issues: "Nous n'avons pas pu identifier automatiquement la cause de ce crash.",
            view_log: "Voir le log téléversé",
            check_manually: "Veuillez vérifier le fichier latest.log manuellement."
        }
    },
    it: {
        settings: {
            integration: {
                smart_log_analytics: "Analisi intelligente dei log",
                smart_log_analytics_desc: "Analizza automaticamente i crash e suggerisce correzioni."
            }
        },
        crash: {
            title: "Rilevato crash del gioco",
            analysis: "Analisi dei log",
            no_issues: "Non è stato possibile identificare automaticamente la causa di questo crash.",
            view_log: "Visualizza log caricato",
            check_manually: "Controlla manualmente il file latest.log."
        }
    },
    pl: {
        settings: {
            integration: {
                smart_log_analytics: "Inteligentna analiza logów",
                smart_log_analytics_desc: "Automatycznie analizuj awarie i sugeruj poprawki."
            }
        },
        crash: {
            title: "Wykryto awarię gry",
            analysis: "Analiza logów",
            no_issues: "Nie udało się automatycznie zidentyfikować przyczyny tej awarii.",
            view_log: "Zobacz przesłany log",
            check_manually: "Sprawdź plik latest.log ręcznie."
        }
    },
    pt: {
        settings: {
            integration: {
                smart_log_analytics: "Análise inteligente de logs",
                smart_log_analytics_desc: "Analisa automaticamente falhas e sugere correções."
            }
        },
        crash: {
            title: "Falha no jogo detectada",
            analysis: "Análise de log",
            no_issues: "Não conseguimos identificar automaticamente a causa desta falha.",
            view_log: "Ver log enviado",
            check_manually: "Por favor, verifique o arquivo latest.log manualmente."
        }
    },
    ro: {
        settings: {
            integration: {
                smart_log_analytics: "Analiză inteligentă a log-urilor",
                smart_log_analytics_desc: "Analizează automat erorile și sugerează remedieri."
            }
        },
        crash: {
            title: "Eroare de joc detectată",
            analysis: "Analiza log-ului",
            no_issues: "Nu am putut identifica automat cauza acestei erori.",
            view_log: "Vezi log-ul încărcat",
            check_manually: "Te rugăm să verifici fișierul latest.log manual."
        }
    },
    ru: {
        settings: {
            integration: {
                smart_log_analytics: "Умная аналитика логов",
                smart_log_analytics_desc: "Автоматический анализ сбоев и предложение исправлений."
            }
        },
        crash: {
            title: "Обнаружен сбой игры",
            analysis: "Анализ логов",
            no_issues: "Мы не смогли автоматически определить причину этого сбоя.",
            view_log: "Просмотреть загруженный лог",
            check_manually: "Пожалуйста, проверьте файл latest.log вручную."
        }
    },
    sk: {
        settings: {
            integration: {
                smart_log_analytics: "Inteligentná analýza logov",
                smart_log_analytics_desc: "Automaticky analyzujte pády a navrhujte opravy."
            }
        },
        crash: {
            title: "Zistený pád hry",
            analysis: "Analýza logov",
            no_issues: "Nepodarilo sa nám automaticky identifikovať príčinu tohto pádu.",
            view_log: "Zobraziť nahraný log",
            check_manually: "Skontrolujte súbor latest.log manuálne."
        }
    },
    sl: {
        settings: {
            integration: {
                smart_log_analytics: "Pametna analiza dnevnikov",
                smart_log_analytics_desc: "Samodejno analizirajte sesutja in predlagajte popravke."
            }
        },
        crash: {
            title: "Zaznano sesutje igre",
            analysis: "Analiza dnevnika",
            no_issues: "Vzroka tega sesutja nismo mogli samodejno prepoznati.",
            view_log: "Ogled naloženega dnevnika",
            check_manually: "Ročno preverite datoteko latest.log."
        }
    },
    sv: {
        settings: {
            integration: {
                smart_log_analytics: "Smart logganalys",
                smart_log_analytics_desc: "Analysera krascher automatiskt och föreslå åtgärder."
            }
        },
        crash: {
            title: "Spelkrasch upptäckt",
            analysis: "Logganalys",
            no_issues: "Vi kunde inte automatiskt identifiera orsaken till denna krasch.",
            view_log: "Visa uppladdad logg",
            check_manually: "Kontrollera filen latest.log manuellt."
        }
    },
    de_ch: {
        settings: {
            integration: {
                smart_log_analytics: "Smart Log Analytics",
                smart_log_analytics_desc: "Analysiert Abstürz automatisch und schlaat Lösige vor."
            }
        },
        crash: {
            title: "Spielabsturz erchannt",
            analysis: "Log-Analyse",
            no_issues: "Mir händ d'Ursach vo dem Absturz nöd automatisch chöne identifiziere.",
            view_log: "Ufegladnes Protokoll aaluege",
            check_manually: "Bitte überprüef d'Datei latest.log manuell."
        }
    }
};

files.forEach(file => {
    const filePath = path.join(localesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const fileName = file.replace('.json', '');
    const langCode = fileName.split('_')[0];

    // Check for specific filename match first (e.g. de_ch), then generic lang (e.g. de), then English
    const source = translationsMap[fileName] || translationsMap[langCode] || translationsMap['en'];

    // Update settings.integration
    if (!data.settings) data.settings = {};
    if (!data.settings.integration) data.settings.integration = {};

    data.settings.integration.smart_log_analytics = source.settings.integration.smart_log_analytics;
    data.settings.integration.smart_log_analytics_desc = source.settings.integration.smart_log_analytics_desc;

    // Update crash object
    data.crash = source.crash;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
    console.log(`Updated ${file} with ${source === translationsMap[fileName] ? fileName : langCode} translations`);
});
