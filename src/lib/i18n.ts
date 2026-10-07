import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import kk from './locales/kk.json'
import ru from './locales/ru.json'
let language = 'ru'
try {
  language = localStorage.getItem('naryad-language') === 'kk' ? 'kk' : 'ru'
} catch {
  /* storage may be disabled */
}
void i18n
  .use(initReactI18next)
  .init({
    resources: { ru: { translation: ru }, kk: { translation: kk } },
    lng: language,
    fallbackLng: 'ru',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  })
function applyLanguage(language: string) {
  document.documentElement.lang = language
  try {
    localStorage.setItem('naryad-language', language)
  } catch {
    /* optional persistence */
  }
}
applyLanguage(language)
i18n.on('languageChanged', applyLanguage)
export const t = (text: string) => i18n.t(text)
export default i18n
