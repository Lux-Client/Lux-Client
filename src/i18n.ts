import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en_us from './locales/en_us.json';
import en_uk from './locales/en_uk.json';
import de_de from './locales/de_de.json';
import de_ch from './locales/de_ch.json';

import es_es from './locales/es_es.json';
import fr_fr from './locales/fr_fr.json';
import it_it from './locales/it_it.json';
import pl_pl from './locales/pl_pl.json';
import pt_br from './locales/pt_br.json';
import pt_pt from './locales/pt_pt.json';
import ro_ro from './locales/ro_ro.json';
import ru_ru from './locales/ru_ru.json';
import sk_sk from './locales/sk_sk.json';
import sl_si from './locales/sl_si.json';
import sv_se from './locales/sv_se.json';

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en_us: { translation: en_us },
            en_uk: { translation: en_uk },
            de_de: { translation: de_de },
            de_ch: { translation: de_ch },
            es_es: { translation: es_es },
            fr_fr: { translation: fr_fr },
            it_it: { translation: it_it },
            pl_pl: { translation: pl_pl },
            pt_br: { translation: pt_br },
            pt_pt: { translation: pt_pt },
            ro_ro: { translation: ro_ro },
            ru_ru: { translation: ru_ru },
            sk_sk: { translation: sk_sk },
            sl_si: { translation: sl_si },
            sv_se: { translation: sv_se }
        },
        lng: 'en_us',
        fallbackLng: 'en_us',
        interpolation: {
            escapeValue: false
        }
    });

export const languageMap = {
    'en': 'en_us',
    'de': 'de_de'
};

export default i18n;
