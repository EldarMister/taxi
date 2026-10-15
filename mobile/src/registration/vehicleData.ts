import type { VehicleDraft } from './types';

export const vehicleYearRange = () => ({ minimum: 1950, maximum: new Date().getFullYear() + 1 });
export const vehicleColors = [
  { value: 'Белый', color: '#FFFFFF' }, { value: 'Чёрный', color: '#202020' },
  { value: 'Серый', color: '#858585' }, { value: 'Серебристый', color: '#BFC1C4' },
  { value: 'Синий', color: '#1767F5' }, { value: 'Красный', color: '#E51C2A' },
  { value: 'Зелёный', color: '#18A661' }, { value: 'Жёлтый', color: '#FFD20A' },
  { value: 'Коричневый', color: '#662A1C' }, { value: 'Бежевый', color: '#CDA777' },
  { value: 'Оранжевый', color: '#FF7A0A' }, { value: 'Фиолетовый', color: '#7225EF' },
];
export type PlateParts = { format: 'CURRENT' | 'LEGACY'; region: string; digits: string; series: string };
export const plateFormats = [
  { value: 'CURRENT' as const, label: 'Новый образец', description: 'Номерные знаки нового образца' },
  { value: 'LEGACY' as const, label: 'Прежний образец', description: 'Номерные знаки прежнего образца' },
];
export const currentPlateRegions = [
  ['01', 'Бишкек'], ['02', 'Ош'], ['03', 'Баткенская область'], ['04', 'Джалал-Абадская область'],
  ['05', 'Нарынская область'], ['06', 'Ошская область'], ['07', 'Таласская область'],
  ['08', 'Чуйская область'], ['09', 'Иссык-Кульская область'], ['10', 'Легализованные автомобили'],
  ['11', 'Временная регистрация'],
].map(([value, label]) => ({ value, label: `${value} · ${label}` }));
export const legacyPlateRegions = [
  ['B', 'Бишкек'], ['E', 'Бишкек'], ['F', 'Бишкек (нерезиденты)'], ['Z', 'Ош'],
  ['A', 'Баткенская область'], ['D', 'Джалал-Абадская область'], ['N', 'Нарынская область'],
  ['H', 'Нарынская область'], ['O', 'Ошская область'], ['T', 'Таласская область'],
  ['C', 'Чуйская область'], ['S', 'Чуйская область'], ['I', 'Иссык-Кульская область'],
].map(([value, label]) => ({ value, label: `${value} · ${label}` }));
export function plateLetters(value: string) {
  const equivalents: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y' };
  return value.toUpperCase().replace(/[АВСЕНКМОРТХУ]/g, letter => equivalents[letter]).replace(/[^A-Z]/g, '');
}
export function readPlate(vehicle: Pick<VehicleDraft, 'plateNumber' | 'plate'>): PlateParts {
  if (vehicle.plate && ['CURRENT', 'LEGACY'].includes(vehicle.plate.format)
    && [vehicle.plate.region, vehicle.plate.digits, vehicle.plate.series].every(value => typeof value === 'string')) return vehicle.plate;
  const value = vehicle.plateNumber.toUpperCase().replace(/[\s-]/g, '');
  const current = /^(\d{2})(\d{3})([A-Z]{2,3})$/.exec(value);
  if (current) return { format: 'CURRENT', region: current[1], digits: current[2], series: current[3] };
  const legacy = /^([A-Z])(\d{4})([A-Z]{1,2})$/.exec(value);
  if (legacy) return { format: 'LEGACY', region: legacy[1], digits: legacy[2], series: legacy[3] };
  return { format: 'CURRENT', region: '', digits: '', series: '' };
}
export function validPlate(parts: PlateParts) {
  const regions = parts.format === 'CURRENT' ? currentPlateRegions : legacyPlateRegions;
  return regions.some(region => region.value === parts.region)
    && (parts.format === 'CURRENT' ? /^\d{3}$/.test(parts.digits) && /^[A-Z]{2,3}$/.test(parts.series)
      : /^\d{4}$/.test(parts.digits) && /^[A-Z]{1,2}$/.test(parts.series));
}
export function formatPlate(parts: PlateParts) {
  return parts.format === 'CURRENT' ? [parts.region, parts.digits, parts.series].filter(Boolean).join(' ')
    : `${parts.region}${parts.digits}${parts.series}`;
}
export function switchPlate(parts: PlateParts, format: PlateParts['format']): PlateParts {
  if (parts.format === format) return parts;
  return { format, region: '', digits: parts.digits.length <= (format === 'CURRENT' ? 3 : 4) ? parts.digits : '',
    series: parts.series.length <= (format === 'CURRENT' ? 3 : 2) ? parts.series : '' };
}
