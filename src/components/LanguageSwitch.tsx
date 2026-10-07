import { useTranslation } from 'react-i18next'
export function LanguageSwitch() {
  const { i18n } = useTranslation()
  return (
    <div className="language-switch" role="group" aria-label="Язык / Тіл">
      <button
        type="button"
        lang="ru"
        aria-pressed={i18n.resolvedLanguage === 'ru'}
        onClick={() => void i18n.changeLanguage('ru')}
      >
        RU
      </button>
      <button
        type="button"
        lang="kk"
        aria-pressed={i18n.resolvedLanguage === 'kk'}
        onClick={() => void i18n.changeLanguage('kk')}
      >
        KZ
      </button>
    </div>
  )
}
