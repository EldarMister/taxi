import { esc, field, area, toggle, select, button, icon, photo } from './ui.js';

const numberField = (label, name, value, max = 1000000) => field(label, name, value, { type: 'number', min: 0, max, required: true });
const formReader = form => {
  const data = new FormData(form);
  return {
    data,
    string: key => String(data.get(key) || '').trim(),
    number: key => Number(data.get(key) || 0),
    checked: key => data.has(key),
    csv: key => [...new Set(String(data.get(key) || '').split(',').map(value => value.trim()).filter(Boolean))],
  };
};

export function imageField(label, url, key, path) {
  return `<div class="wide"><label class="field"><span>${esc(label)}</span></label><div class="image-field">${photo(url, key)}<div><label class="button secondary">${icon('upload', 17)} Загрузить изображение<input type="file" class="file-input" accept="image/jpeg,image/png,image/webp" data-upload="${esc(path)}"></label><small>JPG, PNG или WebP, до 5 МБ</small></div>${url ? button(icon('close', 16), 'clear-image', `data-path="${esc(path)}" aria-label="Удалить изображение"`, 'ghost') : ''}</div></div>`;
}

export function tariffEditor(item) {
  return `<div class="form-grid">${field('Название тарифа', 'name', item.name, { required: true, wide: true, maxLength: 80 })}${area('Описание', 'description', item.description).replace('maxlength="1000"', 'maxlength="400"')}${select('Вид заказа', 'kind', [['RIDE', 'Поездка на такси'], ['DELIVERY_CAR', 'Доставка на легковой машине'], ['DELIVERY_TRUCK', 'Грузовая доставка']], item.kind || 'RIDE')}${select('Необходимый класс', 'requiredClass', [['ECONOMY', 'Эконом'], ['COMFORT', 'Комфорт'], ['TRUCK', 'Грузовой']], item.requiredClass || 'ECONOMY')}${numberField('Посадка, сом', 'basePrice', item.basePrice ?? 50)}${numberField('За километр, сом', 'pricePerKm', item.pricePerKm ?? 15)}${numberField('За минуту, сом', 'pricePerMinute', item.pricePerMinute ?? 0)}${numberField('Минимальная стоимость, сом', 'minimumPrice', item.minimumPrice ?? 50)}${field('Комиссия сервиса, %', 'commissionPercent', (item.commissionBps ?? 1000) / 100, { type: 'number', required: true, min: 0, max: 100, step: '.01' })}<div>${toggle('Тариф доступен клиентам', 'active', item.active ?? true)}</div></div><div class="notice" style="margin-top:24px">Новые цены применяются при расчёте новых поездок и доставок. Сумма уже оформленного заказа сохраняется.</div>`;
}

export function driverEditor(item) {
  const requested = item.requestedTransportClass === 'TRUCK' ? 'Грузовой' : item.requestedTransportClass === 'ECONOMY' ? 'Легковой' : 'не указан';
  return `<div class="form-grid">${field('Имя водителя', 'name', item.name, { required: true, wide: true, maxLength: 100 })}${field('Телефон', 'phone', item.phone, { required: true, type: 'tel', placeholder: '+996700123456', wide: true })}</div><div class="form-section"><h3>Автомобиль</h3></div><div class="form-grid">${field('Марка и модель', 'carMake', item.carMake, { required: true, maxLength: 80 })}${field('Цвет', 'carColor', item.carColor, { required: true, maxLength: 40 })}${field('Госномер', 'carPlate', item.carPlate, { required: true, wide: true, maxLength: 20 })}${select('Класс, назначенный системой', 'transportClass', [['ECONOMY', 'Эконом'], ['COMFORT', 'Комфорт'], ['TRUCK', 'Грузовой']], item.transportClass || 'ECONOMY')}${item.carPhotoUrl ? `<div class="wide"><label class="field"><span>Фото автомобиля</span></label><div class="image-field">${photo(item.carPhotoUrl, item.carPlate)}</div></div>` : ''}</div>${item.requestedTransportClass ? `<div class="notice" style="margin-top:24px">При регистрации водитель выбрал: <strong>${requested}</strong>. Проверьте автомобиль на фотографии и назначьте фактический класс.</div>` : ''}<div class="form-section">${toggle('Водитель подтверждён', 'verified', item.verified ?? false, 'После подтверждения водитель сможет принимать только разрешённые для класса заказы.')}</div>`;
}

// Restaurant settings intentionally exclude the menu. Menu content is edited on
// the dedicated full-page workspace so a large catalog never lives in a modal.
export function restaurantEditor(item, isNew = false) {
  const c = item.catalog;
  return `<div class="form-grid">${field('Название ресторана', 'name', c.name, { required: true, wide: true, maxLength: 150 })}${field('Кухня', 'cuisine', c.cuisine, { required: true })}${field('Телефон ресторана', 'phone', c.phone || '', { type: 'tel', placeholder: '+996…' })}${field('Адрес', 'address', c.address, { required: true, wide: true, maxLength: 500 })}${field('Категории в каталоге', 'categories', c.categories.join(', '), { wide: true, hint: 'Например: Суши, Роллы, Японская кухня' })}${imageField('Фото в каталоге', c.imageUrl, c.imageKey, 'catalog.imageUrl')}${imageField('Обложка ресторана', c.heroImageUrl, c.heroImageKey, 'catalog.heroImageUrl')}</div><div class="form-section"><h3>Доставка и доступность</h3></div><div class="form-grid">${numberField('Доставка от, минут', 'etaMin', c.etaMin, 1440)}${numberField('Доставка до, минут', 'etaMax', c.etaMax, 1440)}${numberField('Стоимость доставки, сом', 'deliveryFee', c.deliveryFee)}${numberField('Минимальный заказ, сом', 'minimumOrder', c.minimumOrder)}${numberField('Порядок в каталоге', 'sortOrder', item.sortOrder ?? 0, 10000)}${numberField('Скидка, %', 'discountPercent', c.discountPercent ?? 0, 100)}<div class="wide">${toggle('Ресторан открыт для заказов', 'active', item.active ?? false)}${toggle('Демонстрационный ресторан', 'isDemo', item.isDemo ?? false, 'Тестовые заказы не отправляются настоящему ресторану.')}</div></div>${isNew ? '<div class="notice" style="margin-top:24px">После сохранения ресторан появится в отдельном разделе «Меню».</div>' : `<div class="settings-menu-link"><div><strong>Меню ресторана</strong><small>${c.dishes.length} блюд · ${c.menuCategories.length} категорий · ${c.options.length} дополнений</small></div>${button('Открыть меню ' + icon('arrow', 15), 'open-menu-from-settings', `data-id="${esc(item.id)}"`)}</div>`}`;
}

export function menuDishEditor(dish, catalog) {
  const categories = catalog.menuCategories.length ? catalog.menuCategories : ['Основное'];
  const selectedOptionIds = new Set((dish.optionIds || []).filter(id => catalog.options.some(option => option.id === id)));
  const selectedCount = selectedOptionIds.size;
  const optionList = catalog.options.length ? catalog.options.map(option => {
    const checked = selectedOptionIds.has(option.id);
    return `<label><input type="checkbox" name="optionIds" value="${esc(option.id)}" ${checked ? 'checked' : ''} ${!checked && selectedCount >= 10 ? 'disabled' : ''}><span>${esc(option.name)}</span><small>+${Number(option.price || 0).toLocaleString('ru-RU')} сом</small></label>`;
  }).join('') : '<div class="inline-empty">Дополнений пока нет. Сначала добавьте их во вкладке «Дополнения».</div>';
  return `<div class="form-grid">${field('Название блюда', 'name', dish.name, { required: true, wide: true, maxLength: 150 })}${select('Категория', 'category', categories.map(category => [category, category]), dish.category || categories[0])}${numberField('Цена, сом', 'price', dish.price)}${area('Описание', 'description', dish.description)}${field('Порция', 'portion', dish.portion, { required: true, placeholder: '8 шт. / 1 порция' })}${numberField('Вес, г', 'weightGrams', dish.weightGrams, 100000)}<div class="wide">${toggle('Блюдо в наличии', 'available', dish.available ?? true, 'Скрытое блюдо остаётся в каталоге, но клиент не сможет добавить его в корзину.')}</div>${imageField('Фотография блюда', dish.imageUrl, dish.imageKey, 'imageUrl')}<div class="wide"><span class="field-label">Дополнения к блюду</span>${catalog.options.length ? `<div class="menu-option-limit" data-menu-option-limit role="status" aria-live="polite"><strong>Выбрано ${selectedCount} из 10</strong><small>К одному блюду можно назначить не больше 10 дополнений.</small></div>` : ''}<div class="option-checks menu-option-checks">${optionList}</div></div></div>`;
}

export function menuOptionEditor(option) {
  return `<div class="form-grid">${field('Название дополнения', 'name', option.name, { required: true, wide: true, maxLength: 150 })}${numberField('Цена, сом', 'price', option.price)}${imageField('Фотография', option.imageUrl, option.imageKey, 'imageUrl')}</div>`;
}

export function menuCategoryEditor(value = '') {
  return `<div class="form-grid">${field('Название категории', 'name', value, { required: true, wide: true, maxLength: 100, placeholder: 'Например: Горячие блюда' })}</div><div class="notice" style="margin-top:24px">При переименовании все блюда этой категории будут перенесены автоматически.</div>`;
}

export function bannerEditor(item, restaurants = []) {
  return `<div class="form-grid">${field('Заголовок', 'title', item.title, { required: true, wide: true, maxLength: 120 })}${field('Подзаголовок', 'subtitle', item.subtitle, { wide: true, maxLength: 250 })}${imageField('Изображение баннера', item.imageUrl, item.imageKey, 'imageUrl')}${select('При нажатии открыть', 'actionType', [['NONE', 'Без перехода'], ['FOOD', 'Доставку еды'], ['TAXI', 'Заказ такси'], ['RESTAURANT', 'Ресторан']], item.actionType || 'NONE')}${select('Ресторан', 'restaurantId', [['', 'Выберите ресторан'], ...restaurants.map(restaurant => [restaurant.id, restaurant.catalog?.name || restaurant.name])], item.restaurantId || '')}${numberField('Порядок показа', 'sortOrder', item.sortOrder ?? 0, 10000)}<div>${toggle('Показывать на главном экране', 'active', item.active ?? true)}</div></div><div class="notice" style="margin-top:24px">Одновременно можно включить до трёх баннеров. Изменения появятся в приложении автоматически.</div>`;
}

export function readMenuDish(form, item, catalog) {
  const { data, string, number, checked } = formReader(form);
  return {
    ...item,
    name: string('name'),
    category: string('category'),
    description: string('description'),
    price: number('price'),
    portion: string('portion'),
    weightGrams: number('weightGrams'),
    available: checked('available'),
    optionIds: data.getAll('optionIds').filter(id => catalog.options.some(option => option.id === id)),
  };
}

export function readMenuOption(form, item) {
  const { string, number } = formReader(form);
  return { ...item, name: string('name'), price: number('price') };
}

export function readMenuCategory(form) {
  return formReader(form).string('name');
}

export function readEditor(type, form, item) {
  const { string, number, checked, csv } = formReader(form);
  if (type === 'tariff') return { ...(item.id ? {} : { id: `tariff-${crypto.randomUUID().slice(0, 8)}` }), name: string('name'), description: string('description'), kind: string('kind'), requiredClass: string('requiredClass'), basePrice: number('basePrice'), pricePerKm: number('pricePerKm'), pricePerMinute: number('pricePerMinute'), minimumPrice: number('minimumPrice'), commissionBps: Math.round(number('commissionPercent') * 100), active: checked('active') };
  if (type === 'driver') return { name: string('name'), phone: string('phone').replace(/[\s()-]/g, ''), carMake: string('carMake'), carColor: string('carColor'), carPlate: string('carPlate'), transportClass: string('transportClass'), verified: checked('verified') };
  if (type === 'banner') return { title: string('title'), subtitle: string('subtitle'), imageUrl: item.imageUrl || null, imageKey: item.imageKey || null, actionType: string('actionType'), restaurantId: string('actionType') === 'RESTAURANT' ? string('restaurantId') || null : null, sortOrder: number('sortOrder'), active: checked('active') };

  // Preserve menuCategories, dishes and options exactly as they were loaded.
  const catalog = structuredClone(item.catalog);
  Object.assign(catalog, {
    name: string('name'),
    cuisine: string('cuisine'),
    address: string('address'),
    phone: string('phone') || null,
    categories: csv('categories'),
    etaMin: number('etaMin'),
    etaMax: number('etaMax'),
    deliveryFee: number('deliveryFee'),
    minimumOrder: number('minimumOrder'),
    discountPercent: number('discountPercent'),
  });
  return { id: item.id, catalog, active: checked('active'), isDemo: checked('isDemo'), sortOrder: number('sortOrder') };
}

export function newRestaurant() {
  const id = `restaurant-${crypto.randomUUID().slice(0, 8)}`;
  return { id, active: false, isDemo: false, sortOrder: 0, catalog: { id, name: '', rating: 0, reviewCount: 0, cuisine: '', categories: [], etaMin: 30, etaMax: 45, deliveryFee: 0, minimumOrder: 0, address: '', phone: null, imageKey: '', heroImageKey: '', menuCategories: ['Основное'], dishes: [], options: [], isDemo: false } };
}
