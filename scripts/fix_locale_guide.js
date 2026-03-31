// Script to strip BOM and add guide keys to all locale files
const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'src', 'locales');

const enGuide = {
  prompt_title: "Welcome to Lux!",
  prompt_desc: "Would you like a quick tour of the features in this section?",
  prompt_desc_launcher: "Let us guide you through the Launcher and show you all the features.",
  prompt_desc_server: "Let us guide you through the Server Manager and show you all the features.",
  prompt_desc_client: "Let us guide you through the Client section and show you all the features.",
  prompt_desc_tools: "Let us guide you through the Tools section.",
  start: "Start Guide",
  skip: "Skip",
  step_of: "Step {{current}} of {{total}}",
  next: "Next",
  previous: "Previous",
  finish: "Finish",
  restart_guide: "Restart Guide",
  restart_guide_desc: "Show the interactive guide for the current mode again.",
  restart_guide_queued: "Guide will start next time you open this section.",
  restart_guide_started: "Guide started.",
  dont_show_again: "Don't show this again for this mode",
  mode_switch_title: "Mode Switcher",
  mode_switch_desc: "Switch between Launcher, Server Manager, Client, and Tools using these buttons in the top bar.",
  finish_title: "You're all set!",
  finish_desc: "You've completed the tour. Enjoy using Lux! You can always restart the guide from Settings.",
  launcher_step1_title: "Welcome to the Launcher",
  launcher_step1_desc: "This is the main area where you manage and launch your Minecraft instances. Let's take a quick tour!",
  launcher_step2_title: "Mode Switcher",
  launcher_step2_desc: "Switch between Launcher, Server Manager, Client, and Tools using these buttons in the top bar.",
  launcher_step3_title: "Dashboard",
  launcher_step3_desc: "The Dashboard is your home base. See recent instances, news, and quick actions.",
  launcher_step4_title: "Library",
  launcher_step4_desc: "Browse and manage all your Minecraft instances. Create new ones, edit, or delete existing ones.",
  launcher_step5_title: "Search",
  launcher_step5_desc: "Search for modpacks, mods, resource packs, and more - and install them directly.",
  launcher_step6_title: "Skins",
  launcher_step6_desc: "Manage and change your Minecraft skin.",
  launcher_step7_title: "Extensions",
  launcher_step7_desc: "Extend the launcher with community-made plugins and themes.",
  launcher_step8_title: "Appearance",
  launcher_step8_desc: "Customize the look and feel of Lux - colors, fonts, backgrounds, and more.",
  launcher_step9_title: "Settings",
  launcher_step9_desc: "Configure Java, memory, Discord integration, and all other launcher preferences here.",
  server_step1_title: "Welcome to Server Manager",
  server_step1_desc: "Manage your Minecraft servers right from Lux. Let's see what's available!",
  server_step2_title: "Server Dashboard",
  server_step2_desc: "Your server overview - see all running and stopped servers at a glance.",
  server_step3_title: "Search",
  server_step3_desc: "Find and install server software, modpacks, and plugins.",
  server_step4_title: "Library",
  server_step4_desc: "All your server configurations in one place.",
  server_step5_title: "Appearance",
  server_step5_desc: "Customize the look of Lux from here.",
  server_step6_title: "Settings",
  server_step6_desc: "Server-specific settings and configuration.",
  client_step1_title: "Welcome to the Client",
  client_step1_desc: "The Client section lets you connect to servers and manage client-side features.",
  client_step2_title: "Open Client",
  client_step2_desc: "Connect to Minecraft servers directly from here.",
  client_step3_title: "Skins",
  client_step3_desc: "Manage and change your Minecraft skin.",
  client_step4_title: "Extensions",
  client_step4_desc: "Extend Lux with community-made plugins and themes.",
  client_step5_title: "Appearance",
  client_step5_desc: "Customize the look and feel of Lux.",
  client_step6_title: "Settings",
  client_step6_desc: "Configure client-specific preferences.",
  tools_step1_title: "Welcome to Tools",
  tools_step1_desc: "A collection of useful Minecraft utilities and tools.",
  tools_step2_title: "Tools Dashboard",
  tools_step2_desc: "Access all available tools from here."
};

const deGuide = {
  prompt_title: "Willkommen bei Lux!",
  prompt_desc: "Möchtest du eine Tour durch die Funktionen dieses Bereichs machen?",
  prompt_desc_launcher: "Lass dich durch den Launcher führen und entdecke alle Funktionen.",
  prompt_desc_server: "Lass dich durch den Server-Manager führen und entdecke alle Funktionen.",
  prompt_desc_client: "Lass dich durch den Client führen und entdecke alle Funktionen.",
  prompt_desc_tools: "Lass dich durch den Bereich Tools führen.",
  start: "Guide starten",
  skip: "Überspringen",
  step_of: "Schritt {{current}} von {{total}}",
  next: "Weiter",
  previous: "Zurück",
  finish: "Fertig",
  restart_guide: "Guide neu starten",
  restart_guide_desc: "Den interaktiven Guide für den aktuellen Bereich erneut anzeigen.",
  restart_guide_queued: "Der Guide startet beim nächsten Öffnen dieses Bereichs.",
  restart_guide_started: "Guide gestartet.",
  dont_show_again: "Fuer diesen Modus nicht mehr anzeigen",
  mode_switch_title: "Moduswechsel",
  mode_switch_desc: "Wechsle mit diesen Buttons in der Titelleiste zwischen Launcher, Server-Manager, Client und Tools.",
  finish_title: "Alles bereit!",
  finish_desc: "Du hast die Tour abgeschlossen. Viel Spaß mit Lux! Den Guide kannst du jederzeit über die Einstellungen neu starten.",
  launcher_step1_title: "Willkommen im Launcher",
  launcher_step1_desc: "Hier verwaltest und startest du deine Minecraft-Instanzen. Lass uns eine kurze Tour machen!",
  launcher_step2_title: "Moduswechsel",
  launcher_step2_desc: "Wechsle mit diesen Buttons in der Titelleiste zwischen Launcher, Server-Manager, Client und Tools.",
  launcher_step3_title: "Dashboard",
  launcher_step3_desc: "Das Dashboard ist deine Startseite. Sieh aktuelle Instanzen, News und schnelle Aktionen.",
  launcher_step4_title: "Bibliothek",
  launcher_step4_desc: "Durchsuche und verwalte alle deine Minecraft-Instanzen. Erstelle neue oder bearbeite bestehende.",
  launcher_step5_title: "Suche",
  launcher_step5_desc: "Suche nach Modpacks, Mods, Ressourcenpaketen und mehr und installiere sie direkt.",
  launcher_step6_title: "Skins",
  launcher_step6_desc: "Verwalte und ändere deinen Minecraft-Skin.",
  launcher_step7_title: "Erweiterungen",
  launcher_step7_desc: "Erweitere den Launcher mit community-gemachten Plugins und Themes.",
  launcher_step8_title: "Erscheinungsbild",
  launcher_step8_desc: "Passe das Aussehen von Lux an – Farben, Schriftarten, Hintergründe und mehr.",
  launcher_step9_title: "Einstellungen",
  launcher_step9_desc: "Konfiguriere Java, Speicher, Discord-Integration und alle anderen Launcher-Einstellungen.",
  server_step1_title: "Willkommen im Server-Manager",
  server_step1_desc: "Verwalte deine Minecraft-Server direkt in Lux. Schauen wir uns an, was verfügbar ist!",
  server_step2_title: "Server-Dashboard",
  server_step2_desc: "Deine Server-Übersicht – sieh alle laufenden und gestoppten Server auf einen Blick.",
  server_step3_title: "Suche",
  server_step3_desc: "Finde und installiere Server-Software, Modpacks und Plugins.",
  server_step4_title: "Bibliothek",
  server_step4_desc: "Alle deine Server-Konfigurationen an einem Ort.",
  server_step5_title: "Erscheinungsbild",
  server_step5_desc: "Passe das Aussehen von Lux von hier aus an.",
  server_step6_title: "Einstellungen",
  server_step6_desc: "Server-spezifische Einstellungen und Konfiguration.",
  client_step1_title: "Willkommen im Client",
  client_step1_desc: "Der Client-Bereich ermöglicht es dir, dich mit Servern zu verbinden und Client-seitige Funktionen zu verwalten.",
  client_step2_title: "Client öffnen",
  client_step2_desc: "Verbinde dich von hier aus direkt mit Minecraft-Servern.",
  client_step3_title: "Skins",
  client_step3_desc: "Verwalte und ändere deinen Minecraft-Skin.",
  client_step4_title: "Erweiterungen",
  client_step4_desc: "Erweitere Lux mit community-gemachten Plugins und Themes.",
  client_step5_title: "Erscheinungsbild",
  client_step5_desc: "Passe das Aussehen von Lux an.",
  client_step6_title: "Einstellungen",
  client_step6_desc: "Client-spezifische Einstellungen konfigurieren.",
  tools_step1_title: "Willkommen in den Tools",
  tools_step1_desc: "Eine Sammlung hilfreicher Minecraft-Dienstprogramme und Werkzeuge.",
  tools_step2_title: "Tools-Dashboard",
  tools_step2_desc: "Greife von hier aus auf alle verfügbaren Tools zu."
};

const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
let ok = 0, err = 0;

for (const fname of files) {
  const fpath = path.join(localesDir, fname);
  try {
    // Read as buffer and strip BOM if present
    let buf = fs.readFileSync(fpath);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      buf = buf.slice(3);
    }
    const rawStr = buf.toString('utf8');

    // Parse JSON
    let obj = JSON.parse(rawStr);

    // Remove old/broken guide key if present
    delete obj.guide;

    // Choose DE or EN translations
    const isDE = fname === 'de_de.json' || fname === 'de_ch.json';
    obj.guide = isDE ? deGuide : enGuide;

    // Write back without BOM
    const output = JSON.stringify(obj, null, 4);
    // Validate before writing
    JSON.parse(output);

    fs.writeFileSync(fpath, output, { encoding: 'utf8' });
    console.log('OK: ' + fname);
    ok++;
  } catch (e) {
    console.error('ERR: ' + fname + ' -> ' + e.message);
    err++;
  }
}

console.log(`\nDone: ${ok} OK, ${err} errors`);
