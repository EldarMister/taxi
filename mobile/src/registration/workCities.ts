// Expand this list when service becomes available in another city.
import type { RegistrationConfig, RegistrationData } from './types';
export const workCities = ['Шамалды-Сай'];
export const workCityOptions = [
  ...workCities.map(value => ({ value, label: value })),
  { value: 'Кочкор-Ата', label: 'Кочкор-Ата', caption: 'Скоро', disabled: true },
  { value: 'Кербен', label: 'Кербен', caption: 'Скоро', disabled: true },
];

// Older drafts can contain a city in hidden work/courier/location steps.
// Update them only when the user explicitly chooses a current working city.
export function cityOptionsFor(config: RegistrationConfig) {
  if (config.workCities) return config.workCities.map(city => ({ value: city.name, label: city.name, ...(city.status === 'SOON' ? { caption: 'Скоро', disabled: true } : {}) }));
  return [...config.cities.map(value => ({ value, label: value })), ...(config.comingSoonCities || ['Кочкор-Ата', 'Кербен']).filter(value => !config.cities.includes(value)).map(value => ({ value, label: value, caption: 'Скоро', disabled: true }))];
}
export function withWorkCity(data: RegistrationData, city: string, availableCities = workCities): RegistrationData {
  if (!availableCities.includes(city)) return data;
  const followsCity = (value: string) => !value || value === data.personal.city || !availableCities.includes(value);
  return {
    ...data,
    personal: { ...data.personal, city },
    work: { ...data.work, city, districts: data.work.city === city ? data.work.districts : [] },
    courier: followsCity(data.courier.city) ? { ...data.courier, city, districts: data.courier.city === city ? data.courier.districts : [] } : data.courier,
    location: data.location.city && followsCity(data.location.city) ? { ...data.location, city } : data.location,
  };
}
