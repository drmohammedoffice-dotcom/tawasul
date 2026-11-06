import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages, type Locale, type MessageKey } from './messages';

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  dir: 'ltr' | 'rtl';
};

/** v2 ignores old `securechat.locale=en` left from earlier builds. */
const STORAGE_KEY = 'securechat.locale.v2';
const LEGACY_KEY = 'securechat.locale';
const I18nContext = createContext<I18nValue | null>(null);

function readInitialLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'ar' || raw === 'en') return raw;
  } catch {
    /* ignore */
  }
  // Product default is Arabic (RTL). English only after explicit user choice.
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.setItem(STORAGE_KEY, 'ar');
  } catch {
    /* ignore */
  }
  return 'ar';
}

function applyDocumentLocale(locale: Locale, dir: 'ltr' | 'rtl') {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = dir;
  root.setAttribute('data-locale', locale);
  try {
    document.body.lang = locale;
    document.body.dir = dir;
  } catch {
    /* ignore */
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  function setLocale(next: Locale) {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    applyDocumentLocale(locale, dir);
  }, [locale, dir]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      dir,
      t: (key) => messages[locale][key] ?? messages.en[key] ?? key
    }),
    [locale, dir]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n requires I18nProvider');
  return ctx;
}
