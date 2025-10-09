import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
//import english from './en/english.json';
//import french from './fr/french.json';
import allFr from './fr';
import allEn from './en';

export function initI18N() {
    i18n.use(initReactI18next).init({
        resources: {
            english: allEn,
            french: allFr,
        },
        fallbackLng: localStorage.getItem('language')?.toLowerCase() || 'english',
        debug: false,
        interpolation: {
            escapeValue: false,
        },
    });
}
