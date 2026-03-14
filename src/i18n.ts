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

