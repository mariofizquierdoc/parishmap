import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import esAdmin from './locales/es-admin.json';
import es from './locales/es.json';

void i18n.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  resources: { es: { translation: { ...es, admin: esAdmin } } },
  interpolation: { escapeValue: false },
});

export default i18n;
