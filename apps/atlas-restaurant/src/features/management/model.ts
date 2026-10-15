import {
  can,
  permissions,
  type Catalog,
  type Membership,
  type Promotion,
  type StaffInput,
  type StaffMember,
} from '../../domain/types';
export function positiveNumber(value: string, label: string, max = 1_000_000) {
  const number = Number(value.trim());
  if (
    !/^\d+$/.test(value.trim()) ||
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > max
  )
    throw new Error(`«${label}»: укажите целое число от 0 до ${max}.`);
  return number;
}
/** Explicit Bishkek UTC+6; date fields must not depend on device timezone. */
export function promotionDate(value: string, end = false): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error('Такой даты не существует.');
  return new Date(
    `${value}T${end ? '23:59:59.999' : '00:00:00.000'}+06:00`,
  ).toISOString();
}
export function dateInput(value?: string | null) {
  return value
    ? new Date(new Date(value).getTime() + 6 * 3_600_000)
        .toISOString()
        .slice(0, 10)
    : '';
}
/** Preserve precise existing timestamps when only other promotion fields are edited. */
export function promotionDateValue(
  value: string,
  initial?: string | null,
  end = false,
) {
  return initial && value === dateInput(initial)
    ? initial
    : promotionDate(value, end);
}
export function validatePromotion(promotion: Promotion, chooseDishes: boolean) {
  boundedText(promotion.title, 'Название акции', 150, true);
  const maximum =
    promotion.type === 'PERCENT'
      ? 100
      : promotion.type === 'FREE_DELIVERY'
        ? 0
        : 1_000_000;
  if (
    !Number.isSafeInteger(promotion.value) ||
    promotion.value < 0 ||
    promotion.value > maximum ||
    (promotion.type !== 'FREE_DELIVERY' && promotion.value === 0)
  )
    throw new Error('Укажите корректный размер скидки.');
  if (
    !Number.isSafeInteger(promotion.minSubtotal) ||
    promotion.minSubtotal < 0 ||
    promotion.minSubtotal > 1_000_000
  )
    throw new Error('Минимальный заказ: целое число от 0 до 1000000.');
  if (
    new Set(promotion.dishIds).size !== promotion.dishIds.length ||
    promotion.dishIds.length > 500
  )
    throw new Error('Проверьте выбранные блюда.');
  if (promotion.type === 'FREE_DELIVERY' && promotion.dishIds.length)
    throw new Error('Бесплатная доставка применяется ко всему заказу.');
  if (
    chooseDishes &&
    promotion.type !== 'FREE_DELIVERY' &&
    !promotion.dishIds.length
  )
    throw new Error('Выберите хотя бы одно блюдо.');
  if (
    [promotion.startsAt, promotion.endsAt].some(
      (date) => date && !Number.isFinite(Date.parse(date)),
    )
  )
    throw new Error('Проверьте даты акции.');
  if (
    promotion.startsAt &&
    promotion.endsAt &&
    Date.parse(promotion.startsAt) >= Date.parse(promotion.endsAt)
  )
    throw new Error('Окончание акции должно быть позже начала.');
  return promotion;
}
export function grantPermission(
  current: string[],
  permission: string,
  checked: boolean,
) {
  const next = new Set(current);
  checked ? next.add(permission) : next.delete(permission);
  if (permission === 'orders.manage' && checked) next.add('orders.read');
  if (permission === 'orders.read' && !checked) next.delete('orders.manage');
  return [...next];
}

function boundedText(
  value: string,
  label: string,
  max: number,
  required = false,
) {
  const trimmed = value.trim();
  if (
    (required && !trimmed) ||
    trimmed.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)
  )
    throw new Error(
      `«${label}»: ${required ? 'заполните поле, ' : ''}не более ${max} символов.`,
    );
  return trimmed;
}

export type DeliveryFields = {
  deliveryFee: string;
  minimumOrder: string;
  freeDeliveryThreshold: string;
  etaMin: string;
  etaMax: string;
};
export function deliveryFields(catalog: Catalog): DeliveryFields {
  return {
    deliveryFee: String(catalog.deliveryFee),
    minimumOrder: String(catalog.minimumOrder),
    freeDeliveryThreshold: String(catalog.freeDeliveryThreshold ?? 0),
    etaMin: String(catalog.etaMin),
    etaMax: String(catalog.etaMax),
  };
}
export function saveDeliveryFields(
  catalog: Catalog,
  fields: DeliveryFields,
): Catalog {
  const next = {
    ...catalog,
    deliveryFee: positiveNumber(fields.deliveryFee, 'Стоимость доставки'),
    minimumOrder: positiveNumber(fields.minimumOrder, 'Минимальный заказ'),
    freeDeliveryThreshold: positiveNumber(
      fields.freeDeliveryThreshold,
      'Порог бесплатной доставки',
    ),
    etaMin: positiveNumber(fields.etaMin, 'Минимальное время', 1440),
    etaMax: positiveNumber(fields.etaMax, 'Максимальное время', 1440),
  };
  if (next.etaMax < next.etaMin)
    throw new Error('Максимальное время должно быть не меньше минимального.');
  return next;
}

export function saveProfileFields(
  current: Catalog,
  draft: Catalog,
  categoryText: string,
  latitude: string,
  longitude: string,
): Catalog {
  const categories = categoryText
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    categories.length > 40 ||
    categories.some((value) => value.length > 100) ||
    new Set(categories).size !== categories.length
  )
    throw new Error(
      'Укажите до 40 разных категорий кухни, не более 100 символов каждая.',
    );
  const phone = draft.phone?.trim() || null;
  if (phone && !/^\+?[\d ()-]{5,30}$/.test(phone))
    throw new Error('Проверьте телефон ресторана.');
  const next: Catalog = {
    ...current,
    name: boundedText(draft.name, 'Название ресторана', 150, true),
    address: boundedText(draft.address, 'Адрес', 500, true),
    cuisine: boundedText(draft.cuisine, 'Кухня', 200),
    phone,
    categories,
    imageUrl: draft.imageUrl,
    heroImageUrl: draft.heroImageUrl,
    isOpen: draft.isOpen,
  };
  if (latitude.trim() || longitude.trim()) {
    const latitudeText = latitude.trim().replace(',', '.'),
      longitudeText = longitude.trim().replace(',', '.');
    const lat = Number(latitudeText),
      lng = Number(longitudeText);
    if (
      !/^-?\d+(?:\.\d+)?$/.test(latitudeText) ||
      !/^-?\d+(?:\.\d+)?$/.test(longitudeText) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      throw new Error('Укажите корректные широту и долготу.');
    next.latitude = lat;
    next.longitude = lng;
  } else {
    delete next.latitude;
    delete next.longitude;
  }
  return next;
}

export function staffEditable(
  member: Membership,
  staff: StaffMember,
  ownId: string,
) {
  return (
    staff.role === 'MANAGER' &&
    staff.id !== ownId &&
    can(member, 'staff.manage') &&
    (member.role === 'OWNER' ||
      staff.permissions.every((permission) =>
        member.permissions.includes(permission),
      ))
  );
}
export function initialManagerPermissions(member: Membership) {
  return ['orders.read', 'orders.manage'].filter(
    (permission) =>
      member.role === 'OWNER' || member.permissions.includes(permission),
  );
}
export function staffInput(
  draft: StaffMember,
  initial: StaffMember,
  password: string,
  member: Membership,
): StaffInput {
  const name = boundedText(draft.name, 'Имя менеджера', 150, true);
  const phone = draft.phone.trim().replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error('Введите телефон с кодом страны.');
  if (
    (!initial.id || password) &&
    (password.length < 12 || password.length > 256)
  )
    throw new Error('Пароль должен содержать от 12 до 256 символов.');
  const known = new Set<string>(permissions.map(([permission]) => permission));
  if (
    !can(member, 'staff.manage') ||
    draft.permissions.some(
      (permission) =>
        !known.has(permission) ||
        (member.role !== 'OWNER' && !member.permissions.includes(permission)),
    )
  )
    throw new Error('Нельзя выдать права, которых у вас нет.');
  if (
    draft.permissions.includes('orders.manage') &&
    !draft.permissions.includes('orders.read')
  )
    throw new Error('Для управления заказами нужен просмотр заказов.');
  if (new Set(draft.permissions).size !== draft.permissions.length)
    throw new Error('Права доступа не должны повторяться.');
  return {
    ...(!initial.id || name !== initial.name ? { name } : {}),
    ...(!initial.id || phone !== initial.phone ? { phone } : {}),
    ...(password ? { password } : {}),
    permissions: draft.permissions,
    active: draft.active,
  };
}
