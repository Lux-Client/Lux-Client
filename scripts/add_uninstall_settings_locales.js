const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'src', 'locales');

const EN_VALUES = {
    show_modrinth_instances: 'Show Modrinth Instances in Library',
    show_modrinth_instances_desc: 'If disabled, imported Modrinth external instances are hidden in the Library tab.',
    show_curseforge_instances: 'Show CurseForge Instances in Library',
    show_curseforge_instances_desc: 'If disabled, imported CurseForge external instances are hidden in the Library tab.',
    uninstall_title: 'Uninstall Launcher',
    uninstall_desc: 'Starts the system uninstaller for Lux and closes the launcher.',
    uninstall_btn: 'Uninstall Launcher',
    uninstall_modal_title: 'Uninstall Launcher',
    uninstall_modal_msg: 'Do you really want to start the Lux uninstaller now? The launcher will close.',
    uninstall_confirm_btn: 'Start Uninstall',
    uninstall_failed: 'Uninstall could not be started.'
};

const DE_VALUES = {
    show_modrinth_instances: 'Modrinth-Instanzen in der Bibliothek anzeigen',
    show_modrinth_instances_desc: 'Wenn deaktiviert, werden importierte externe Modrinth-Instanzen in der Bibliothek ausgeblendet.',
    show_curseforge_instances: 'CurseForge-Instanzen in der Bibliothek anzeigen',
    show_curseforge_instances_desc: 'Wenn deaktiviert, werden importierte externe CurseForge-Instanzen in der Bibliothek ausgeblendet.',
    uninstall_title: 'Launcher deinstallieren',
    uninstall_desc: 'Startet die System-Deinstallation von Lux und schließt den Launcher.',
    uninstall_btn: 'Launcher deinstallieren',
    uninstall_modal_title: 'Launcher deinstallieren',
    uninstall_modal_msg: 'Möchtest du die Deinstallation von Lux jetzt wirklich starten? Der Launcher wird geschlossen.',
    uninstall_confirm_btn: 'Deinstallation starten',
    uninstall_failed: 'Die Deinstallation konnte nicht gestartet werden.'
};

const LOCALE_VALUES = {
    en_us: EN_VALUES,
    en_uk: EN_VALUES,
    de_de: DE_VALUES,
    de_ch: DE_VALUES,
    es_es: {
        show_modrinth_instances: 'Mostrar instancias de Modrinth en la biblioteca',
        show_modrinth_instances_desc: 'Si se desactiva, las instancias externas importadas de Modrinth se ocultan en la pestana Biblioteca.',
        show_curseforge_instances: 'Mostrar instancias de CurseForge en la biblioteca',
        show_curseforge_instances_desc: 'Si se desactiva, las instancias externas importadas de CurseForge se ocultan en la pestana Biblioteca.',
        uninstall_title: 'Desinstalar launcher',
        uninstall_desc: 'Inicia el desinstalador del sistema de Lux y cierra el launcher.',
        uninstall_btn: 'Desinstalar launcher',
        uninstall_modal_title: 'Desinstalar launcher',
        uninstall_modal_msg: 'Quieres iniciar ahora la desinstalacion de Lux? El launcher se cerrara.',
        uninstall_confirm_btn: 'Iniciar desinstalacion',
        uninstall_failed: 'No se pudo iniciar la desinstalacion.'
    },
    fr_fr: {
        show_modrinth_instances: 'Afficher les instances Modrinth dans la bibliotheque',
        show_modrinth_instances_desc: 'Si desactive, les instances externes Modrinth importees sont masquees dans l\'onglet Bibliotheque.',
        show_curseforge_instances: 'Afficher les instances CurseForge dans la bibliotheque',
        show_curseforge_instances_desc: 'Si desactive, les instances externes CurseForge importees sont masquees dans l\'onglet Bibliotheque.',
        uninstall_title: 'Desinstaller le launcher',
        uninstall_desc: 'Lance le desinstalleur systeme de Lux et ferme le launcher.',
        uninstall_btn: 'Desinstaller le launcher',
        uninstall_modal_title: 'Desinstaller le launcher',
        uninstall_modal_msg: 'Voulez-vous vraiment lancer la desinstallation de Lux maintenant? Le launcher sera ferme.',
        uninstall_confirm_btn: 'Demarrer la desinstallation',
        uninstall_failed: 'Impossible de demarrer la desinstallation.'
    },
    it_it: {
        show_modrinth_instances: 'Mostra istanze Modrinth nella libreria',
        show_modrinth_instances_desc: 'Se disattivato, le istanze esterne Modrinth importate vengono nascoste nella scheda Libreria.',
        show_curseforge_instances: 'Mostra istanze CurseForge nella libreria',
        show_curseforge_instances_desc: 'Se disattivato, le istanze esterne CurseForge importate vengono nascoste nella scheda Libreria.',
        uninstall_title: 'Disinstalla launcher',
        uninstall_desc: 'Avvia il programma di disinstallazione di sistema di Lux e chiude il launcher.',
        uninstall_btn: 'Disinstalla launcher',
        uninstall_modal_title: 'Disinstalla launcher',
        uninstall_modal_msg: 'Vuoi avviare ora la disinstallazione di Lux? Il launcher verra chiuso.',
        uninstall_confirm_btn: 'Avvia disinstallazione',
        uninstall_failed: 'Impossibile avviare la disinstallazione.'
    },
    pl_pl: {
        show_modrinth_instances: 'Pokaz instancje Modrinth w bibliotece',
        show_modrinth_instances_desc: 'Jesli wylaczone, zaimportowane zewnetrzne instancje Modrinth beda ukryte w zakladce Biblioteka.',
        show_curseforge_instances: 'Pokaz instancje CurseForge w bibliotece',
        show_curseforge_instances_desc: 'Jesli wylaczone, zaimportowane zewnetrzne instancje CurseForge beda ukryte w zakladce Biblioteka.',
        uninstall_title: 'Odinstaluj launcher',
        uninstall_desc: 'Uruchamia systemowy deinstalator Lux i zamyka launcher.',
        uninstall_btn: 'Odinstaluj launcher',
        uninstall_modal_title: 'Odinstaluj launcher',
        uninstall_modal_msg: 'Czy na pewno chcesz teraz uruchomic deinstalator Lux? Launcher zostanie zamkniety.',
        uninstall_confirm_btn: 'Rozpocznij odinstalowanie',
        uninstall_failed: 'Nie udalo sie uruchomic odinstalowania.'
    },
    pt_br: {
        show_modrinth_instances: 'Mostrar instancias do Modrinth na biblioteca',
        show_modrinth_instances_desc: 'Se desativado, as instancias externas importadas do Modrinth ficam ocultas na aba Biblioteca.',
        show_curseforge_instances: 'Mostrar instancias do CurseForge na biblioteca',
        show_curseforge_instances_desc: 'Se desativado, as instancias externas importadas do CurseForge ficam ocultas na aba Biblioteca.',
        uninstall_title: 'Desinstalar launcher',
        uninstall_desc: 'Inicia o desinstalador do sistema do Lux e fecha o launcher.',
        uninstall_btn: 'Desinstalar launcher',
        uninstall_modal_title: 'Desinstalar launcher',
        uninstall_modal_msg: 'Deseja iniciar a desinstalacao do Lux agora? O launcher sera fechado.',
        uninstall_confirm_btn: 'Iniciar desinstalacao',
        uninstall_failed: 'Nao foi possivel iniciar a desinstalacao.'
    },
    pt_pt: {
        show_modrinth_instances: 'Mostrar instancias do Modrinth na biblioteca',
        show_modrinth_instances_desc: 'Se desativado, as instancias externas importadas do Modrinth ficam ocultas no separador Biblioteca.',
        show_curseforge_instances: 'Mostrar instancias do CurseForge na biblioteca',
        show_curseforge_instances_desc: 'Se desativado, as instancias externas importadas do CurseForge ficam ocultas no separador Biblioteca.',
        uninstall_title: 'Desinstalar launcher',
        uninstall_desc: 'Inicia o desinstalador do sistema do Lux e fecha o launcher.',
        uninstall_btn: 'Desinstalar launcher',
        uninstall_modal_title: 'Desinstalar launcher',
        uninstall_modal_msg: 'Pretende iniciar agora a desinstalacao do Lux? O launcher sera fechado.',
        uninstall_confirm_btn: 'Iniciar desinstalacao',
        uninstall_failed: 'Nao foi possivel iniciar a desinstalacao.'
    },
    ro_ro: {
        show_modrinth_instances: 'Afiseaza instantele Modrinth in biblioteca',
        show_modrinth_instances_desc: 'Daca este dezactivat, instantele externe Modrinth importate sunt ascunse in fila Biblioteca.',
        show_curseforge_instances: 'Afiseaza instantele CurseForge in biblioteca',
        show_curseforge_instances_desc: 'Daca este dezactivat, instantele externe CurseForge importate sunt ascunse in fila Biblioteca.',
        uninstall_title: 'Dezinstaleaza launcherul',
        uninstall_desc: 'Porneste dezinstalatorul de sistem Lux si inchide launcherul.',
        uninstall_btn: 'Dezinstaleaza launcherul',
        uninstall_modal_title: 'Dezinstaleaza launcherul',
        uninstall_modal_msg: 'Sigur vrei sa pornesti dezinstalarea Lux acum? Launcherul se va inchide.',
        uninstall_confirm_btn: 'Porneste dezinstalarea',
        uninstall_failed: 'Dezinstalarea nu a putut fi pornita.'
    },
    ru_ru: {
        show_modrinth_instances: 'Pokazyvat instansy Modrinth v biblioteke',
        show_modrinth_instances_desc: 'Esli otklyucheno, importirovannye vneshnie instansy Modrinth budut skryty vo vkladke Biblioteka.',
        show_curseforge_instances: 'Pokazyvat instansy CurseForge v biblioteke',
        show_curseforge_instances_desc: 'Esli otklyucheno, importirovannye vneshnie instansy CurseForge budut skryty vo vkladke Biblioteka.',
        uninstall_title: 'Udalit launcher',
        uninstall_desc: 'Zapускает sistemnyy deinstallyator Lux i zakryvaet launcher.',
        uninstall_btn: 'Udalit launcher',
        uninstall_modal_title: 'Udalit launcher',
        uninstall_modal_msg: 'Vy deystvitelno hotite zapustit udaleniye Lux seychas? Launcher budet zakryt.',
        uninstall_confirm_btn: 'Nachat udaleniye',
        uninstall_failed: 'Ne udalos zapustit udaleniye.'
    },
    sk_sk: {
        show_modrinth_instances: 'Zobrazit instancie Modrinth v kniznici',
        show_modrinth_instances_desc: 'Ak je vypnute, importovane externe instancie Modrinth budu skryte na karte Kniznica.',
        show_curseforge_instances: 'Zobrazit instancie CurseForge v kniznici',
        show_curseforge_instances_desc: 'Ak je vypnute, importovane externe instancie CurseForge budu skryte na karte Kniznica.',
        uninstall_title: 'Odinstalovat launcher',
        uninstall_desc: 'Spusti systemovy odinstalator Lux a zatvori launcher.',
        uninstall_btn: 'Odinstalovat launcher',
        uninstall_modal_title: 'Odinstalovat launcher',
        uninstall_modal_msg: 'Naozaj chcete teraz spustit odinstalovanie Lux? Launcher sa zatvori.',
        uninstall_confirm_btn: 'Spustit odinstalovanie',
        uninstall_failed: 'Nepodarilo sa spustit odinstalovanie.'
    },
    sl_si: {
        show_modrinth_instances: 'Prikazi instance Modrinth v knjiznici',
        show_modrinth_instances_desc: 'Ce je onemogoceno, bodo uvozene zunanje instance Modrinth skrite v zavihku Knjiznica.',
        show_curseforge_instances: 'Prikazi instance CurseForge v knjiznici',
        show_curseforge_instances_desc: 'Ce je onemogoceno, bodo uvozene zunanje instance CurseForge skrite v zavihku Knjiznica.',
        uninstall_title: 'Odstrani launcher',
        uninstall_desc: 'Zazene sistemski odstranjevalnik Lux in zapre launcher.',
        uninstall_btn: 'Odstrani launcher',
        uninstall_modal_title: 'Odstrani launcher',
        uninstall_modal_msg: 'Ali zelis zdaj zagnati odstranitev Lux? Launcher se bo zaprl.',
        uninstall_confirm_btn: 'Zazeni odstranitev',
        uninstall_failed: 'Odstranitve ni bilo mogoce zagnati.'
    },
    sv_se: {
        show_modrinth_instances: 'Visa Modrinth-instanser i biblioteket',
        show_modrinth_instances_desc: 'Om avstangt döljs importerade externa Modrinth-instanser i fliken Bibliotek.',
        show_curseforge_instances: 'Visa CurseForge-instanser i biblioteket',
        show_curseforge_instances_desc: 'Om avstangt döljs importerade externa CurseForge-instanser i fliken Bibliotek.',
        uninstall_title: 'Avinstallera launcher',
        uninstall_desc: 'Startar systemets avinstallerare for Lux och stanger launchern.',
        uninstall_btn: 'Avinstallera launcher',
        uninstall_modal_title: 'Avinstallera launcher',
        uninstall_modal_msg: 'Vill du verkligen starta avinstallationen av Lux nu? Launchern kommer att stangas.',
        uninstall_confirm_btn: 'Starta avinstallation',
        uninstall_failed: 'Avinstallationen kunde inte startas.'
    }
};

function ensurePath(obj, key) {
    if (!obj[key] || typeof obj[key] !== 'object' || Array.isArray(obj[key])) {
        obj[key] = {};
    }
    return obj[key];
}

function main() {
    const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));
    let touched = 0;

    for (const file of files) {
        const fullPath = path.join(localesDir, file);
        const raw = fs.readFileSync(fullPath, 'utf8');
        const json = JSON.parse(raw);

        const settings = ensurePath(json, 'settings');
        const instance = ensurePath(settings, 'instance');

        const locale = path.basename(file, '.json');
        const values = LOCALE_VALUES[locale] || EN_VALUES;

        let changed = false;
        for (const [key, value] of Object.entries(values)) {
            if (instance[key] === undefined || (locale !== 'en_us' && locale !== 'en_uk' && instance[key] === EN_VALUES[key])) {
                instance[key] = value;
                changed = true;
            }
        }

        if (changed) {
            fs.writeFileSync(fullPath, `${JSON.stringify(json, null, 4)}\n`, 'utf8');
            touched += 1;
        }
    }

    console.log(`[locales] Updated ${touched} locale file(s).`);
}

main();
