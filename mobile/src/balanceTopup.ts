import type { Language } from './types';

const copy = {
  topup: ['Пополнить', 'Толуктоо', 'Top up'],
  title: ['Пополнение баланса', 'Балансты толуктоо', 'Top up balance'],
  subtitle: ['Выберите способ пополнения', 'Толуктоо ыкмасын тандаңыз', 'Choose a top-up method'],
  kompanion: ['Компаньон', 'Компаньон', 'Kompanion'],
  soon: ['Скоро', 'Жакында', 'Soon'],
  unavailable: ['Скоро станет доступно', 'Жакында жеткиликтүү болот', 'Coming soon'],
  failed: ['Не удалось загрузить баланс и операции', 'Баланс жана операциялар жүктөлгөн жок', 'Could not load balance and transactions'],
  commissionHint: ['Комиссия списывается после завершения поездки.', 'Комиссия сапар аяктагандан кийин алынат.', 'Commission is charged after the trip is completed.'],
} as const;

export function balanceCopy(language: Language, key: keyof typeof copy): string {
  return copy[key][language === 'ky' ? 1 : language === 'en' ? 2 : 0];
}
