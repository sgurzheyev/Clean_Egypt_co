import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      globalMarketplace: 'Global Marketplace',
      startWork: 'Start Work',
      walletBalance: 'Wallet Balance',
      language: 'Language',
      withdraw: 'Withdraw',
      topUpWallet: 'Top Up Wallet',
      arabic: 'Arabic',
      english: 'English',
      russian: 'Russian',
      german: 'German',
    },
  },
  ar: {
    translation: {
      globalMarketplace: 'السوق العالمي',
      startWork: 'ابدأ العمل',
      walletBalance: 'رصيد المحفظة',
      language: 'اللغة',
      withdraw: 'سحب',
      topUpWallet: 'شحن المحفظة',
      arabic: 'العربية',
      english: 'الإنجليزية',
      russian: 'الروسية',
      german: 'الألمانية',
    },
  },
  ru: {
    translation: {
      globalMarketplace: 'Глобальный маркетплейс',
      startWork: 'Начать работу',
      walletBalance: 'Баланс кошелька',
      language: 'Язык',
      withdraw: 'Вывести',
      topUpWallet: 'Пополнить кошелёк',
      arabic: 'Арабский',
      english: 'Английский',
      russian: 'Русский',
      german: 'Немецкий',
    },
  },
  de: {
    translation: {
      globalMarketplace: 'Globaler Marktplatz',
      startWork: 'Arbeit starten',
      walletBalance: 'Wallet-Guthaben',
      language: 'Sprache',
      withdraw: 'Abheben',
      topUpWallet: 'Guthaben aufladen',
      arabic: 'Arabisch',
      english: 'Englisch',
      russian: 'Russisch',
      german: 'Deutsch',
    },
  },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;

