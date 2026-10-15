export const popularVehicleBrands = ['Toyota', 'Honda', 'Hyundai', 'Kia', 'Chevrolet', 'Daewoo', 'BMW', 'Mercedes-Benz', 'Audi', 'Lada', 'Mazda', 'Lexus', 'Nissan', 'Volkswagen', 'GAZ', 'Volvo', 'Ford', 'Subaru'];

export function brandLabel(brand: string) {
  if (brand.toLowerCase() === 'lada') return 'Лада (ВАЗ)';
  if (brand.toLowerCase() === 'gaz') return 'ГАЗ';
  return brand;
}
export function brandMatches(brand: string, query: string) {
  const aliases = brand.toLowerCase() === 'lada' ? 'lada vaz ваз лада' : brand.toLowerCase() === 'gaz' ? 'gaz газ' : '';
  return `${brand} ${brandLabel(brand)} ${aliases}`.toLocaleLowerCase().replace(/ё/g, 'е').includes(query.trim().toLocaleLowerCase().replace(/ё/g, 'е'));
}
// Reuse one collator: constructing an Intl collator for every comparison is
// particularly expensive on Android/Hermes with a large offline catalog.
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
export const compareVehicleNames = (a: string, b: string) => collator.compare(a, b);
export function brandSections(values: string[], query: string) {
  const all = values.filter(brand => brandMatches(brand, query)).sort((a, b) => compareVehicleNames(brandLabel(a), brandLabel(b)));
  if (query.trim()) return [{ title: '', values: all }];
  const popular = popularVehicleBrands.flatMap(brand => {
    const existing = values.find(value => value.toLowerCase() === brand.toLowerCase());
    return existing ? [existing] : [];
  });
  return [{ title: 'Популярные', values: popular }, { title: 'Все', values: all }];
}
