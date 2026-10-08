import { esc, money, date, field, area, toggle, select, button, icon, photo, empty } from './ui.js';

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
  return `<div class="form-grid">${field('Название тарифа', 'name', item.name, { required: true, wide: true, maxLength: 80 })}${area('Описание', 'description', item.description).replace('maxlength="1000"', 'maxlength="400"')}${select('Вид заказа', 'kind', [['RIDE', 'Поездка на такси'], ['DELIVERY_CAR', 'Доставка на легковой машине'], ['DELIVERY_TRUCK', 'Грузовая доставка']], item.kind || 'RIDE')}${select('Необходимый класс', 'requiredClass', [['ECONOMY', 'Эконом'], ['COMFORT', 'Комфорт'], ['TRUCK', 'Грузовой']], item.requiredClass || 'ECONOMY')}${numberField('Посадка, сом', 'basePrice', item.basePrice ?? 50)}${numberField('За километр, сом', 'pricePerKm', item.pricePerKm ?? 15)}${numberField('За минуту в пути, сом', 'pricePerMinute', item.pricePerMinute ?? 0)}${numberField('Минимальная стоимость, сом', 'minimumPrice', item.minimumPrice ?? 50)}${numberField('До начала бесплатного ожидания, мин', 'waitingGraceMinutes', item.waitingGraceMinutes ?? 1, 60)}${numberField('Бесплатное ожидание, мин', 'freeWaitingMinutes', item.freeWaitingMinutes ?? 5, 180)}${numberField('Платное ожидание, сом/мин', 'waitingPricePerMinute', item.waitingPricePerMinute ?? item.pricePerMinute ?? 2)}${field('Комиссия сервиса, %', 'commissionPercent', (item.commissionBps ?? 1000) / 100, { type: 'number', required: true, min: 0, max: 100, step: '.01' })}<div>${toggle('Тариф доступен клиентам', 'active', item.active ?? true)}</div></div><div class="notice" style="margin-top:24px">Ожидание начинается после прибытия водителя: сначала пауза, затем бесплатные минуты, после них начисляется плата за каждую начатую минуту. Настройки сохраняются в новом заказе и не меняют уже оформленные заказы.</div>`;
}

export function driverEditor(item) {
  const requested = item.requestedTransportClass === 'TRUCK' ? 'Грузовой' : item.requestedTransportClass === 'ECONOMY' ? 'Легковой' : 'не указан';
  return `<div class="form-grid">${field('Имя водителя', 'name', item.name, { required: true, wide: true, maxLength: 100 })}${field('Телефон', 'phone', item.phone, { required: true, type: 'tel', placeholder: '+996700123456', wide: true })}</div><div class="form-section"><h3>Автомобиль</h3></div><div class="form-grid">${field('Марка и модель', 'carMake', item.carMake, { required: true, maxLength: 80 })}${field('Цвет', 'carColor', item.carColor, { required: true, maxLength: 40 })}${field('Госномер', 'carPlate', item.carPlate, { required: true, wide: true, maxLength: 20 })}${select('Класс, назначенный системой', 'transportClass', [['ECONOMY', 'Эконом'], ['COMFORT', 'Комфорт'], ['TRUCK', 'Грузовой']], item.transportClass || 'ECONOMY')}${item.carPhotoUrl ? `<div class="wide"><label class="field"><span>Фото автомобиля</span></label><div class="image-field">${photo(item.carPhotoUrl, item.carPlate)}</div></div>` : ''}</div>${item.requestedTransportClass ? `<div class="notice" style="margin-top:24px">При регистрации водитель выбрал: <strong>${requested}</strong>. Проверьте автомобиль на фотографии и назначьте фактический класс.</div>` : ''}<div class="form-section">${toggle('Водитель подтверждён', 'verified', item.verified ?? false, 'После подтверждения водитель сможет принимать только разрешённые для класса заказы.')}</div>`;
}

// Restaurant settings intentionally exclude the menu. Menu content is edited on
// the dedicated full-page workspace so a large catalog never lives in a modal.
export function restaurantEditor(item, isNew = false) {
  const c = item.catalog;
  return `<div class="form-grid">${field('Название ресторана', 'name', c.name, { required: true, wide: true, maxLength: 150 })}${field('Кухня', 'cuisine', c.cuisine, { required: true })}${field('Телефон ресторана', 'phone', c.phone || '', { type: 'tel', placeholder: '+996…' })}${field('Адрес', 'address', c.address, { required: true, wide: true, maxLength: 500 })}${field('Широта точки выдачи', 'latitude', c.latitude ?? '', { type: 'number', min: -90, max: 90, step: 'any', hint: 'Например: 42.8746. Нужна для подачи машины Atlas.' })}${field('Долгота точки выдачи', 'longitude', c.longitude ?? '', { type: 'number', min: -180, max: 180, step: 'any', hint: 'Например: 74.5698. Укажите обе координаты.' })}${field('Категории в каталоге', 'categories', c.categories.join(', '), { wide: true, hint: 'Например: Суши, Роллы, Японская кухня' })}${imageField('Фото в каталоге', c.imageUrl, c.imageKey, 'catalog.imageUrl')}${imageField('Обложка ресторана', c.heroImageUrl, c.heroImageKey, 'catalog.heroImageUrl')}</div><div class="form-section"><h3>Доставка и доступность</h3></div><div class="form-grid">${numberField('Доставка от, минут', 'etaMin', c.etaMin, 1440)}${numberField('Доставка до, минут', 'etaMax', c.etaMax, 1440)}${numberField('Стоимость доставки, сом', 'deliveryFee', c.deliveryFee)}${numberField('Бесплатная доставка от, сом (0 — отключено)', 'freeDeliveryThreshold', c.freeDeliveryThreshold ?? 0)}${numberField('Минимальный заказ, сом', 'minimumOrder', c.minimumOrder)}${numberField('Порядок в каталоге', 'sortOrder', item.sortOrder ?? 0, 10000)}${field('Плашка скидки ресторана, %', 'discountPercent', c.discountPercent ?? 0, { type: 'number', required: true, min: 0, max: 100, step: '1', hint: 'Только надпись на карточке. Автоматические скидки настраиваются в разделе «Акции ресторанов».' })}<div class="wide">${toggle('Показывать ресторан в каталоге', 'active', item.active ?? false)}${toggle('Ресторан открыт для заказов', 'isOpen', c.isOpen ?? true)}${toggle('Демонстрационный ресторан', 'isDemo', item.isDemo ?? false, 'Тестовые заказы не отправляются настоящему ресторану.')}</div></div>${isNew ? '<div class="notice" style="margin-top:24px">После сохранения ресторан появится в отдельном разделе «Меню».</div>' : `<div class="settings-menu-link"><div><strong>Меню ресторана</strong><small>${c.dishes.length} блюд · ${c.menuCategories.length} категорий · ${c.options.length} дополнений</small></div>${button('Открыть меню ' + icon('arrow', 15), 'open-menu-from-settings', `data-id="${esc(item.id)}"`)}</div>`}`;
}

export function menuDishEditor(dish, catalog) {
  const categories = catalog.menuCategories.length ? catalog.menuCategories : ['Основное'];
  const selectedOptionIds = new Set((dish.optionIds || []).filter(id => catalog.options.some(option => option.id === id)));
  const selectedCount = selectedOptionIds.size;
  const optionList = catalog.options.length ? catalog.options.map(option => {
    const checked = selectedOptionIds.has(option.id);
    return `<label><input type="checkbox" name="optionIds" value="${esc(option.id)}" ${checked ? 'checked' : ''} ${!checked && selectedCount >= 10 ? 'disabled' : ''}><span>${esc(option.name)}</span><small>+${Number(option.price || 0).toLocaleString('ru-RU')} сом</small></label>`;
  }).join('') : '<div class="inline-empty">Дополнений пока нет. Сначала добавьте их во вкладке «Дополнения».</div>';
  return `<div class="form-grid">${field('Название блюда', 'name', dish.name, { required: true, wide: true, maxLength: 150 })}${select('Категория', 'category', categories.map(category => [category, category]), dish.category || categories[0])}${numberField('Цена, сом', 'price', dish.price)}${field('Цена до скидки, сом', 'originalPrice', dish.originalPrice ?? '', { type: 'number', min: 0, max: 1000000, step: '1', hint: 'Зачёркнутая цена. Оставьте пустым, если скидки нет.' })}${area('Описание', 'description', dish.description)}${field('Порция', 'portion', dish.portion, { required: true, placeholder: '8 шт. / 1 порция' })}${numberField('Вес, г', 'weightGrams', dish.weightGrams, 100000)}<div class="wide">${toggle('Блюдо в наличии', 'available', dish.available ?? true, 'Скрытое блюдо остаётся в каталоге, но клиент не сможет добавить его в корзину.')}</div>${imageField('Фотография блюда', dish.imageUrl, dish.imageKey, 'imageUrl')}<div class="wide"><span class="field-label">Дополнения к блюду</span>${catalog.options.length ? `<div class="menu-option-limit" data-menu-option-limit role="status" aria-live="polite"><strong>Выбрано ${selectedCount} из 10</strong><small>К одному блюду можно назначить не больше 10 дополнений.</small></div>` : ''}<div class="option-checks menu-option-checks">${optionList}</div></div></div>`;
}

export function menuOptionEditor(option) {
  return `<div class="form-grid">${field('Название дополнения', 'name', option.name, { required: true, wide: true, maxLength: 150 })}${numberField('Цена, сом', 'price', option.price)}${imageField('Фотография', option.imageUrl, option.imageKey, 'imageUrl')}</div>`;
}

export function menuCategoryEditor(value = '') {
  return `<div class="form-grid">${field('Название категории', 'name', value, { required: true, wide: true, maxLength: 100, placeholder: 'Например: Горячие блюда' })}</div><div class="notice" style="margin-top:24px">При переименовании все блюда этой категории будут перенесены автоматически.</div>`;
}

export function bannerEditor(item, restaurants = []) {
  return `<div class="form-grid">${field('Заголовок', 'title', item.title, { required: true, wide: true, maxLength: 120 })}${field('Подзаголовок', 'subtitle', item.subtitle, { wide: true, maxLength: 250 })}${imageField('Изображение баннера', item.imageUrl, item.imageKey, 'imageUrl')}${select('При нажатии открыть', 'actionType', [['NONE', 'Без перехода'], ['FOOD', 'Доставку еды'], ['TAXI', 'Заказ такси'], ['RESTAURANT', 'Ресторан']], item.actionType || 'NONE')}${select('Ресторан', 'restaurantId', [['', 'Выберите ресторан'], ...restaurants.map(restaurant => [restaurant.id, restaurant.catalog?.name || restaurant.name])], item.restaurantId || '')}${numberField('Порядок показа', 'sortOrder', item.sortOrder ?? 0, 10000)}</div><div class="notice" style="margin-top:24px">Для каталога еды загрузите один длинный баннер (примерно 2:1) или три квадратных (1:1). После сохранения выберите весь набор на странице «Баннеры» и примените показ.</div>`;
}

export function readMenuDish(form, item, catalog) {
  const { data, string, number, checked } = formReader(form);
  const originalPrice = string('originalPrice') ? number('originalPrice') : undefined;
  return {
    ...item,
    name: string('name'),
    category: string('category'),
    description: string('description'),
    price: number('price'),
    originalPrice,
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
  if (type === 'tariff') return { ...(item.id ? {} : { id: `tariff-${crypto.randomUUID().slice(0, 8)}` }), name: string('name'), description: string('description'), kind: string('kind'), requiredClass: string('requiredClass'), basePrice: number('basePrice'), pricePerKm: number('pricePerKm'), pricePerMinute: number('pricePerMinute'), minimumPrice: number('minimumPrice'), waitingGraceMinutes: number('waitingGraceMinutes'), freeWaitingMinutes: number('freeWaitingMinutes'), waitingPricePerMinute: number('waitingPricePerMinute'), commissionBps: Math.round(number('commissionPercent') * 100), active: checked('active') };
  if (type === 'driver') return { name: string('name'), phone: string('phone').replace(/[\s()-]/g, ''), carMake: string('carMake'), carColor: string('carColor'), carPlate: string('carPlate'), transportClass: string('transportClass'), verified: checked('verified') };
  if (type === 'banner') return { title: string('title'), subtitle: string('subtitle'), imageUrl: item.imageUrl || null, imageKey: item.imageKey || null, actionType: string('actionType'), restaurantId: string('actionType') === 'RESTAURANT' ? string('restaurantId') || null : null, sortOrder: number('sortOrder'), active: item.active ?? false };

  // Preserve menuCategories, dishes and options exactly as they were loaded.
  const catalog = structuredClone(item.catalog);
  if (string('latitude')) catalog.latitude = number('latitude'); else delete catalog.latitude;
  if (string('longitude')) catalog.longitude = number('longitude'); else delete catalog.longitude;
  Object.assign(catalog, {
    name: string('name'),
    cuisine: string('cuisine'),
    address: string('address'),
    phone: string('phone') || null,
    categories: csv('categories'),
    etaMin: number('etaMin'),
    etaMax: number('etaMax'),
    deliveryFee: number('deliveryFee'),
    freeDeliveryThreshold: number('freeDeliveryThreshold'),
    minimumOrder: number('minimumOrder'),
    isOpen: checked('isOpen'),
    discountPercent: number('discountPercent'),
  });
  return { id: item.id, catalog, active: checked('active'), isDemo: checked('isDemo'), sortOrder: number('sortOrder'), ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}) };
}

export function newRestaurant() {
  const id = `restaurant-${crypto.randomUUID().slice(0, 8)}`;
  return { id, active: false, isDemo: false, sortOrder: 0, catalog: { id, isOpen: true, name: '', rating: 0, reviewCount: 0, cuisine: '', categories: [], etaMin: 30, etaMax: 45, deliveryFee: 0, freeDeliveryThreshold: 0, minimumOrder: 0, address: '', phone: null, imageKey: '', heroImageKey: '', menuCategories: ['Основное'], dishes: [], options: [], isDemo: false } };
}


const promotionTypes = { PERCENT: 'Скидка в процентах', FIXED: 'Скидка в сомах', FREE_DELIVERY: 'Бесплатная доставка' };
const restaurantIds = account => account.restaurantIds || (account.restaurants || []).map(item => item.restaurantId || item.id);
const restaurantName = (restaurants, id) => restaurants.find(item => item.id === id)?.catalog?.name || id;

export function restaurantAccountsView(data, restaurants, search = '') {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const accounts = Array.isArray(data) ? data : data?.items || [];
  const rows = accounts.filter(account => [account.name, account.phone, ...restaurantIds(account).map(id => restaurantName(restaurants, id))].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query)));
  return `<section class="panel"><div class="toolbar"><span class="muted">${accounts.length} владельцев</span><label class="search">${icon('search', 17)}<input id="account-search" aria-label="Поиск владельцев" placeholder="Имя, телефон или ресторан" value="${esc(search)}"></label></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Владелец</th><th>Рестораны</th><th>Доступ</th><th>Создан</th><th></th></tr></thead><tbody>${rows.map(account => `<tr><td><strong>${esc(account.name || 'Без имени')}</strong><small>${esc(account.phone)}</small></td><td><div class="account-restaurants">${restaurantIds(account).map(id => `<span>${esc(restaurantName(restaurants, id))}</span>`).join('') || '<span>Не назначены</span>'}</div></td><td><span class="badge ${account.active ? 'good' : 'bad'}">${account.active ? 'Разрешён' : 'Отключён'}</span></td><td>${date(account.createdAt)}</td><td>${button(icon('edit', 16) + ' Изменить', 'edit-owner', `data-id="${esc(account.id)}"`)}</td></tr>`).join('')}</tbody></table></div>` : empty(query ? 'Владельцы не найдены' : 'Добавьте владельца ресторана', query ? 'Измените условия поиска.' : 'Владелец входит в приложение ресторана по телефону и паролю и сам назначает менеджеров.', 'lock')}</section>`;
}

export function restaurantAccountEditor(account, restaurants, isNew) {
  const assigned = new Set(restaurantIds(account));
  return `<div class="notice restaurant-access-notice">Владелец получает полный доступ к выбранным ресторанам. В приложении он сможет добавить менеджеров и назначить им права.</div><div class="form-grid">${field('Имя и фамилия', 'name', account.name || '', { wide: true, maxLength: 100 })}${field('Телефон для входа', 'phone', account.phone, { required: true, type: 'tel', wide: true, placeholder: '+996700123456' })}${field(isNew ? 'Пароль для входа' : 'Новый пароль', 'password', '', { type: 'password', required: isNew, wide: true, maxLength: 128, hint: isNew ? 'От 12 символов. Передайте пароль владельцу.' : 'Оставьте пустым, чтобы сохранить текущий пароль. Новый пароль завершит действующие сеансы.' }).replace('type="password"', 'type="password" autocomplete="new-password" minlength="12"')}<fieldset class="assignment-list wide"><legend>Рестораны владельца *</legend>${restaurants.length ? restaurants.map(restaurant => `<label><input type="checkbox" name="restaurantIds" value="${esc(restaurant.id)}" ${assigned.has(restaurant.id) ? 'checked' : ''}><span><strong>${esc(restaurant.catalog?.name || restaurant.id)}</strong><small>${esc(restaurant.catalog?.address || '')}</small></span><span class="badge ${restaurant.active ? 'good' : ''}">${restaurant.active ? 'В каталоге' : 'Скрыт'}</span></label>`).join('') : '<div class="inline-empty">Сначала создайте ресторан в разделе «Рестораны».</div>'}</fieldset><div class="wide">${toggle('Доступ владельца включён', 'active', account.active ?? true, 'При отключении владелец не сможет войти в приложение ресторана.')}</div></div>`;
}

export function readRestaurantAccount(form, isNew) {
  const data = new FormData(form), password = String(data.get('password') || '');
  const ids = [...new Set(data.getAll('restaurantIds').map(String))];
  if (!ids.length) throw new Error('Выберите хотя бы один ресторан для владельца.');
  if ((isNew || password) && password.length < 12) throw new Error('Пароль должен содержать не меньше 12 символов.');
  const phone = String(data.get('phone') || '').replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Укажите телефон в международном формате, например +996700123456.');
  return { name: String(data.get('name') || '').trim(), phone, active: data.has('active'), restaurantIds: ids, ...(password ? { password } : {}) };
}

export function promotionState(promotion) {
  if (!promotion.active) return ['Отключена', ''];
  if (promotion.startsAt && new Date(promotion.startsAt).getTime() > Date.now()) return ['Запланирована', 'status-UNDER_REVIEW'];
  if (promotion.endsAt && new Date(promotion.endsAt).getTime() <= Date.now()) return ['Завершена', ''];
  return ['Действует', 'good'];
}

export function restaurantPromotionsView(data, restaurants, id) {
  if (!restaurants.length) return empty('Сначала добавьте ресторан', 'Акции настраиваются отдельно для каждого ресторана.', 'food');
  const restaurant = restaurants.find(item => item.id === id), promotions = data?.promotions || [], catalog = restaurant?.catalog;
  return `<section class="panel"><div class="toolbar"><label class="field promotion-restaurant-select"><span>Ресторан</span><select id="promotion-restaurant" aria-label="Ресторан для акций">${restaurants.map(item => `<option value="${esc(item.id)}" ${item.id === id ? 'selected' : ''}>${esc(item.catalog?.name || item.id)}</option>`).join('')}</select></label>${button(icon('plus', 17) + ' Добавить акцию', 'create-promotion', id ? '' : 'disabled', 'primary')}</div><div class="promotion-summary"><span>${promotions.length} акций</span><span>Доставка ${money(catalog?.deliveryFee)}${catalog?.freeDeliveryThreshold > 0 ? ` · бесплатно от ${money(catalog.freeDeliveryThreshold)}` : ''}</span>${catalog?.discountPercent ? `<span>Плашка ресторана: −${Number(catalog.discountPercent)}%</span>` : ''}${button('Настройки ресторана', 'promotion-settings', `data-id="${esc(id)}"`, 'ghost')}</div>${promotions.length ? `<div class="promotion-list">${promotions.map(promotion => {
    const [state, style] = promotionState(promotion);
    const dishNames = (promotion.dishIds || []).map(dishId => catalog?.dishes?.find(dish => dish.id === dishId)?.name || dishId);
    return `<article class="promotion-card"><div class="promotion-card-value">${promotion.type === 'FREE_DELIVERY' ? icon('drivers', 27) : promotion.type === 'PERCENT' ? '−' + Number(promotion.value) + '%' : '−' + Number(promotion.value)}${promotion.type === 'FIXED' ? '<small>сом</small>' : ''}</div><div class="promotion-card-copy"><div class="promotion-card-title"><h3>${esc(promotion.title)}</h3><span class="badge ${style}">${state}</span></div><p>${esc(promotionTypes[promotion.type] || promotion.type)} · ${dishNames.length ? esc(dishNames.join(', ')) : promotion.type === 'FREE_DELIVERY' ? 'Доставка заказа' : 'Все блюда'}</p><div class="promotion-card-meta"><span>${promotion.minSubtotal > 0 ? 'Заказ от ' + money(promotion.minSubtotal) : 'Без минимальной суммы'}</span><span>${promotion.startsAt ? 'С ' + date(promotion.startsAt) : 'Без даты начала'}${promotion.endsAt ? ' · до ' + date(promotion.endsAt) : ' · бессрочно'}</span></div></div><div class="promotion-card-actions">${button(icon('edit', 16) + ' Изменить', 'edit-promotion', `data-id="${esc(promotion.id)}"`)}${button(promotion.active ? 'Отключить' : 'Включить', 'toggle-promotion', `data-id="${esc(promotion.id)}"`, 'ghost')}${button(icon('trash', 16), 'remove-promotion', `data-id="${esc(promotion.id)}" aria-label="Удалить акцию ${esc(promotion.title)}"`, 'danger')}</div></article>`;
  }).join('')}</div>` : empty('У ресторана пока нет акций', 'Добавьте скидку на блюда или бесплатную доставку с условиями.', 'tariffs')}</section><div class="notice promotion-help">Акции применяются автоматически в указанный период. Даты и время указаны по Бишкеку. Для каждого блюда выбирается самая выгодная акция, скидки не складываются. Добавки не уценяются. Минимальная сумма считается до акционных скидок, включая добавки. Базовые цены блюд редактируются в разделе «Меню».</div>`;
}

const bishkekLocalTime = value => {
  if (!value) return '';
  const dateValue = new Date(value);
  if (!Number.isFinite(dateValue.getTime())) return '';
  return new Date(dateValue.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 16);
};

export function restaurantPromotionEditor(promotion, restaurant) {
  const dishIds = new Set(promotion.dishIds || []), free = promotion.type === 'FREE_DELIVERY';
  return `<div class="form-grid">${field('Название акции', 'title', promotion.title, { required: true, wide: true, maxLength: 150, placeholder: 'Например: −20% на роллы' })}${select('Вид акции', 'type', Object.entries(promotionTypes), promotion.type || 'PERCENT')}<div data-promotion-value ${free ? 'hidden' : ''}>${field('Размер скидки', 'value', promotion.value ?? 10, { type: 'number', required: !free, min: 1, max: promotion.type === 'PERCENT' ? 100 : 1000000, step: '1', hint: promotion.type === 'PERCENT' ? 'Процент от стоимости блюда' : 'Сом с каждого подходящего блюда' })}</div>${field('Минимальная сумма заказа, сом', 'minSubtotal', promotion.minSubtotal ?? 0, { type: 'number', required: true, min: 0, max: 1000000, step: '1', wide: true, hint: '0 — без ограничения' })}<div class="wide" data-promotion-scope ${free ? 'hidden' : ''}>${select('На какие блюда действует', 'scope', [['ALL', 'На все блюда'], ['DISHES', 'На выбранные блюда']], dishIds.size ? 'DISHES' : 'ALL')}</div><fieldset class="assignment-list wide promotion-dish-choices" data-promotion-dishes ${free || !dishIds.size ? 'hidden' : ''}><legend>Блюда акции</legend>${(restaurant?.catalog?.dishes || []).map(dish => `<label><input type="checkbox" name="dishIds" value="${esc(dish.id)}" ${dishIds.has(dish.id) ? 'checked' : ''}><span><strong>${esc(dish.name)}</strong><small>${esc(dish.category)}</small></span><span>${money(dish.price)}</span></label>`).join('') || '<div class="inline-empty">Добавьте блюда в меню ресторана.</div>'}</fieldset>${field('Начало, время Бишкека', 'startsAt', bishkekLocalTime(promotion.startsAt), { type: 'datetime-local' })}${field('Окончание, время Бишкека', 'endsAt', bishkekLocalTime(promotion.endsAt), { type: 'datetime-local' })}<div class="wide">${toggle('Акция включена', 'active', promotion.active ?? true)}</div></div><div class="notice promotion-help">Без даты начала акция действует сразу, без даты окончания — до отключения. Изменения не затронут уже оформленные заказы.</div>`;
}

export function updatePromotionFields(form) {
  const type = form.elements.namedItem('type').value, free = type === 'FREE_DELIVERY';
  form.querySelector('[data-promotion-value]').hidden = free;
  const value = form.elements.namedItem('value');
  value.required = !free; value.disabled = free; value.max = type === 'PERCENT' ? '100' : '1000000';
  form.querySelector('[data-promotion-value] small').textContent = type === 'PERCENT' ? 'Процент от стоимости блюда' : 'Сом с каждого подходящего блюда';
  form.querySelector('[data-promotion-scope]').hidden = free;
  form.querySelector('[data-promotion-dishes]').hidden = free || form.elements.namedItem('scope').value !== 'DISHES';
}

export function readRestaurantPromotion(form, id) {
  const data = new FormData(form), type = String(data.get('type')), value = type === 'FREE_DELIVERY' ? 0 : Number(data.get('value'));
  const title = String(data.get('title') || '').trim(), minSubtotal = Number(data.get('minSubtotal') || 0);
  const dishIds = type !== 'FREE_DELIVERY' && data.get('scope') === 'DISHES' ? [...new Set(data.getAll('dishIds').map(String))] : [];
  if (!title) throw new Error('Введите название акции.');
  if (!Object.hasOwn(promotionTypes, type) || !Number.isInteger(value) || value < (type === 'FREE_DELIVERY' ? 0 : 1) || value > (type === 'PERCENT' ? 100 : 1000000)) throw new Error('Укажите корректный размер скидки.');
  if (type !== 'FREE_DELIVERY' && data.get('scope') === 'DISHES' && !dishIds.length) throw new Error('Выберите хотя бы одно блюдо для акции.');
  const startsAt = data.get('startsAt') ? new Date(String(data.get('startsAt')) + ':00+06:00').toISOString() : null;
  const endsAt = data.get('endsAt') ? new Date(String(data.get('endsAt')) + ':00+06:00').toISOString() : null;
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error('Окончание акции должно быть позже начала.');
  return { id, title, type, value, minSubtotal, dishIds, active: data.has('active'), startsAt, endsAt };
}
