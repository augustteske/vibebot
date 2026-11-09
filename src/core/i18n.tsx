import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  applyLanguage,
  LANGUAGE_STORAGE_KEY,
  localizedContrastPairs,
  localizedFeatures,
  localizedSteps,
  readLanguage,
  translations,
} from './i18n-data'
import type { ContrastPairItem, FeatureItem, Language, StepItem } from './i18n-data'

export * from './i18n-data'

export interface LanguageContextValue {
  lang: Language
  setLanguage: (lang: Language) => void
  isTransitioning: boolean
  t: typeof translations.ru
  features: FeatureItem[]
  contrastPairs: ContrastPairItem[]
  steps: StepItem[]
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(readLanguage)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    applyLanguage(readLanguage(), false)
  }, [])

  useEffect(() => {
    function handleCustom(event: Event) {
      const custom = event as CustomEvent<{ lang: Language }>
      if (custom.detail?.lang && (custom.detail.lang === 'ru' || custom.detail.lang === 'en')) {
        setLangState(custom.detail.lang)
      }
    }
    window.addEventListener('vibee-language-change', handleCustom)
    return () => window.removeEventListener('vibee-language-change', handleCustom)
  }, [])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== LANGUAGE_STORAGE_KEY) return
      if (event.newValue === 'ru' || event.newValue === 'en') {
        setLangState(event.newValue)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setLanguage = (target: Language) => {
    if (target === lang) return
    setIsTransitioning(true)
    window.setTimeout(() => {
      applyLanguage(target, true)
      setLangState(target)
      window.setTimeout(() => {
        setIsTransitioning(false)
      }, 140)
    }, 120)
  }

  const value: LanguageContextValue = {
    lang,
    setLanguage,
    isTransitioning,
    t: translations[lang],
    features: localizedFeatures[lang],
    contrastPairs: localizedContrastPairs[lang],
    steps: localizedSteps[lang],
  }

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) {
    const fallbackLang = readLanguage()
    return {
      lang: fallbackLang,
      setLanguage: (next) => applyLanguage(next, true),
      isTransitioning: false,
      t: translations[fallbackLang],
      features: localizedFeatures[fallbackLang],
      contrastPairs: localizedContrastPairs[fallbackLang],
      steps: localizedSteps[fallbackLang],
    }
  }
  return context
}
