import { API, api, apiBlob, session, signIn, signOut, refresh, upload, rememberedUsername, rememberEnabled } from './api.js';
import { esc, money, date, shortId, statuses, badge, icon, button, field, empty, loading, errorBox, photo, pager } from './ui.js';
import { tariffEditor, driverEditor, restaurantEditor, bannerEditor, menuDishEditor, menuOptionEditor, menuCategoryEditor, readEditor, readMenuDish, readMenuOption, readMenuCategory, newRestaurant } from './editors.js';

const app = document.querySelector('#app'), modalRoot = document.querySelector('#modal-root');
const sections = { dashboard: ['Обзор', 'grid', 'Сервис сегодня'], orders: ['Заказы', 'orders', 'Все поездки и заказы еды'], applications: ['Заявки исполнителей', 'audit', 'Регистрация водителей и курьеров'], drivers: ['Водители', 'drivers', 'Водители, автомобили и баланс'], tariffs: ['Тарифы', 'tariffs', 'Стоимость поездок и комиссия'], restaurants: ['Рестораны', 'food', 'Каталог и настройки заведений'], menu: ['Меню', 'food', 'Категории, блюда и дополнения'], banners: ['Баннеры', 'banner', 'Главный экран приложения'], audit: ['Журнал действий', 'audit', 'Изменения и действия администраторов'] };
function parseHash() { const raw = location.hash.replace(/^#/, ''), [name, encodedId] = raw.split('/'); let id = ''; try { id = encodedId ? decodeURIComponent(encodedId) : ''; } catch {} return { route: sections[name] ? name : 'dashboard', restaurantId: name === 'menu' ? id : '' }; }
const initialLocation = parseHash();
let route = initialLocation.route;
let kind = 'taxi', page = 1, search = '', filter = '', roleFilter = '', data = null, loadError = '', busy = false, sequence = 0, editor = null, socket = null, connected = false, toastTimer, liveTimer, filterTimer, dialogReturnFocus;
let restaurants = [], refreshingSocket = false;
let menuRestaurantId = initialLocation.restaurantId, menuDraft = null, menuDirty = false, menuSaving = false, menuError = '', menuSearch = '', menuCategory = 'all', menuTab = 'dishes', menuGeneration = 0, menuBaseSignature = '';
const items = value => Array.isArray(value) ? value : value?.items || [];
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
const params = () => new URLSearchParams({ page, pageSize: 25, ...(search ? { search } : {}), ...(route === 'orders' ? { kind, ...(filter ? { status: filter } : {}) } : {}), ...(route === 'drivers' ? { filter: filter || 'all' } : {}), ...(route === 'applications' ? { ...(filter ? { status: filter } : {}), ...(roleFilter ? { role: roleFilter } : {}) } : {}) });
function toast(text) { const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 4000); }
function brand() { return `<div class="brand"><span class="brand-symbol">${icon('drivers', 23)}</span><span>Taxi <em>GO</em></span></div>`; }
function connectionStatus() { document.querySelectorAll('[data-connection]').forEach(n => { n.className = `connection ${connected ? 'online' : ''}`; n.textContent = connected ? 'В реальном времени' : 'Обновление каждые 30 с'; }); }
function loginView() {
  app.innerHTML = `<main class="auth-page"><section class="auth-box"><h1>Панель управления</h1><form id="login-form" autocomplete="on">${field('Логин', 'username', rememberedUsername(), { required: true, maxLength: 64 })}${field('Пароль', 'password', '', { type: 'password', required: true })}<label class="remember-login"><input type="checkbox" name="remember" ${rememberEnabled() ? 'checked' : ''}><span>Запомнить вход на этом устройстве</span></label><div class="auth-error" id="login-error" role="alert"></div><button class="button primary" type="submit">Войти ${icon('arrow', 17)}</button></form></section></main>`;
  app.querySelector('[name=username]').autocomplete = 'username'; app.querySelector('[name=password]').autocomplete = 'current-password';
}
function shell() {
  if (!session()) { loginView(); return; }
  app.innerHTML = `<div class="layout"><aside class="sidebar">${brand()}<div class="workspace-label">Панель управления</div><nav class="navigation" aria-label="Главное меню">${Object.entries(sections).map(([id, [title, image]], index) => `${index === 3 ? '<div class="nav-section">Управление сервисом</div>' : ''}<button class="nav-item ${route === id ? 'active' : ''}" data-nav="${id}">${icon(image)}${title}</button>`).join('')}</nav><div class="sidebar-footer"><div class="user"><span class="avatar">${esc(initials(session().user?.name || 'Администратор'))}</span><div>${esc(session().user?.name || 'Администратор')}<small>Управление сервисом</small></div></div><button class="logout" data-action="logout">${icon('logout', 16)} Выйти</button></div></aside><main class="main"><header class="topbar"><button class="button ghost menu-toggle" data-action="toggle-menu" aria-label="Открыть меню">${icon('menu')}</button><div class="breadcrumb">Рабочее пространство &nbsp; / &nbsp; <strong id="breadcrumb">${sections[route][0]}</strong></div><div class="top-right"><span data-connection class="connection">Подключение…</span><time>${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek' }).format(new Date())}</time>${button(icon('refresh', 18), 'reload', 'aria-label="Обновить данные"', 'ghost')}</div></header><div class="content" id="view"></div></main></div>`;
  connectionStatus(); renderPage();
}
function heading() { const [title, , subtitle] = sections[route]; const creation = { drivers: ['Водитель', 'driver'], tariffs: ['Тариф', 'tariff'], restaurants: ['Ресторан', 'restaurant'], banners: ['Баннер', 'banner'] }[route]; return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${creation ? button(icon('plus', 17) + ` ${creation[0]}`, 'create', `data-type="${creation[1]}"`, 'primary') : ''}</div>`; }
function toolbar(tabs = false) { const choices = route === 'orders' ? (kind === 'taxi' ? ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_DRIVER'] : ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED']) : []; return `<div class="toolbar">${tabs ? `<div class="tabs" aria-label="Вид заказов"><button data-kind="taxi" class="${kind === 'taxi' ? 'active' : ''}">Такси</button><button data-kind="food" class="${kind === 'food' ? 'active' : ''}">Доставка еды</button></div>` : '<span class="muted" style="font-size:.84rem">' + (data?.total ?? items(data).length) + ' записей</span>'}<div class="filters"><label class="search">${icon('search', 17)}<input id="search" aria-label="Поиск" placeholder="${route === 'drivers' ? 'Имя, телефон или госномер' : 'Поиск по имени, телефону…'}" value="${esc(search)}"></label>${route === 'orders' ? `<select id="filter" aria-label="Статус заказа"><option value="">Все статусы</option>${choices.map(s => `<option value="${s}" ${filter === s ? 'selected' : ''}>${statuses[s]}</option>`).join('')}</select>` : route === 'drivers' ? `<select id="filter" aria-label="Фильтр водителей">${[['', 'Все водители'], ['online', 'На линии'], ['offline', 'Не на линии'], ['unverified', 'Не подтверждены']].map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}</div></div>`; }
function orderTable(rows, orderKind, compact = false) { if (!rows.length) return empty('Заказов пока нет', 'Новые заказы будут появляться здесь автоматически.'); return `<div class="table-wrap"><table><thead><tr><th>Заказ</th><th>Клиент / маршрут</th>${compact ? '' : `<th>${orderKind === 'food' ? 'Ресторан' : 'Водитель'}</th>`}<th>Статус</th><th>Сумма</th><th></th></tr></thead><tbody>${rows.map(o => `<tr data-action="order" data-id="${esc(o.id)}" data-kind="${orderKind}" tabindex="0" role="button" aria-label="Открыть заказ ${esc(shortId(o.id))}"><td><strong>#${esc(shortId(o.id))}</strong><small>${date(o.createdAt)}</small></td><td><strong>${esc(o.client?.name || o.client?.phone || 'Клиент')}</strong><small>${esc(orderKind === 'taxi' ? o.pickup?.address || 'Адрес подачи' : o.fulfillment === 'PICKUP' ? 'Самовывоз' : o.address || 'Доставка')}</small></td>${compact ? '' : `<td><strong>${esc(orderKind === 'food' ? o.restaurant?.name : o.driver?.name || o.driver?.phone || 'Не назначен')}</strong><small>${esc(orderKind === 'taxi' ? o.tariff?.name || o.quote?.tariff?.name || '' : '')}</small></td>`}<td>${badge(o.status)}</td><td><span class="money">${money(o.total ?? o.price)}</span></td><td style="color:#9eafc5">${icon('arrow', 16)}</td></tr>`).join('')}</tbody></table></div>`; }
function dashboard() { const m = data?.metrics || {}, r = data?.recentOrders || {}; return `<div class="stats">${[[m.activeTaxiOrders, 'Активные поездки', 'Заказы такси прямо сейчас', 'drivers', true], [m.activeFoodOrders, 'Заказы еды', 'В работе у ресторанов', 'food'], [m.onlineDrivers, 'Водители на линии', `Всего водителей: ${m.totalDrivers ?? 0}`, 'drivers'], [money((m.todayTaxiRevenue || 0) + (m.todayFoodRevenue || 0)), 'Выручка за сегодня', 'Завершённые заказы · сом', 'tariffs']].map(([value, label, foot, image, emphasis]) => `<article class="stat ${emphasis ? 'emphasis' : ''}"><span class="stat-icon">${icon(image)}</span><div class="stat-label">${label}</div><div class="stat-value">${value ?? 0}</div><div class="stat-foot">${foot}</div></article>`).join('')}</div><div class="dashboard-grid"><div><section class="panel"><div class="panel-heading"><div><h2 class="live-title">Последние поездки</h2><p>Новые и текущие заказы такси</p></div>${button('Все заказы ' + icon('arrow', 15), 'all-orders', 'data-kind="taxi"', 'ghost')}</div>${orderTable(r.taxi || [], 'taxi', true)}</section><section class="panel"><div class="panel-heading"><div><h2>Доставка еды</h2><p>Последние заказы в ресторанах</p></div>${button('Все заказы ' + icon('arrow', 15), 'all-orders', 'data-kind="food"', 'ghost')}</div>${orderTable(r.food || [], 'food', true)}</section></div><aside class="dashboard-aside"><section class="panel"><div class="panel-heading"><h2>Сегодня</h2>${icon('clock', 18)}</div><div class="panel-body"><div class="mini-grid"><div class="mini-stat"><span>Поездок</span><strong>${m.todayTaxiOrders ?? 0}</strong></div><div class="mini-stat"><span>Заказов еды</span><strong>${m.todayFoodOrders ?? 0}</strong></div></div><div class="summary-line"><span>Такси</span><strong>${money(m.todayTaxiRevenue)}</strong></div><div class="summary-line"><span>Доставка</span><strong>${money(m.todayFoodRevenue)}</strong></div><div class="summary-line"><span>Комиссия сервиса</span><strong>${money(m.commissionToday)}</strong></div><small>Время Бишкека · с 00:00</small></div></section><section class="panel"><div class="panel-heading"><h2>Сервис</h2></div><div class="panel-body"><div class="summary-line"><span>Ресторанов открыто</span><strong>${m.activeRestaurants ?? 0}</strong></div><div class="summary-line"><span>Ожидают проверки</span><strong>${m.unverifiedDrivers ?? 0} водителей</strong></div><div style="margin-top:18px">${button('Управление водителями ' + icon('arrow', 15), 'go-drivers', '', 'ghost')}</div></div></section></aside></div>`; }
function driversView() { const rows = items(data); return `<section class="panel">${toolbar()}${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Водитель</th><th>Автомобиль</th><th>Статус</th><th>Проверка</th><th>Депозит</th><th></th></tr></thead><tbody>${rows.map(d => `<tr data-action="driver-detail" data-id="${esc(d.id)}" tabindex="0" role="button"><td><div class="cell-flex"><span class="cell-avatar">${esc(initials(d.name))}</span><div><strong>${esc(d.name)}</strong><small>${esc(d.phone)}</small></div></div></td><td><strong>${esc(d.carMake || 'Не указан')}</strong><small>${esc(d.carPlate)} · ${esc(d.carColor)}</small></td><td><span class="badge ${d.online ? 'good' : ''}">${d.online ? 'На линии' : 'Не на линии'}</span></td><td><span class="badge ${d.verified ? 'good' : 'bad'}">${d.verified ? 'Подтверждён' : 'Ожидает проверки'}</span></td><td><span class="money">${money(d.deposit)}</span></td><td>${icon('arrow', 16)}</td></tr>`).join('')}</tbody></table></div>` : empty('Водителей не найдено', 'Добавьте первого водителя или измените условия поиска.', 'drivers')}${pager(data, busy)}</section>`; }
const applicationRoles = { TAXI_DRIVER: 'Водитель такси', CARGO_DRIVER: 'Грузовой водитель', COURIER: 'Курьер' };
const applicationKinds = { PROFILE_PHOTO: 'Фото профиля', IDENTITY_DOCUMENT: 'Удостоверение личности', DRIVER_LICENSE: 'Водительское удостоверение', VEHICLE_DOCUMENT: 'Документ транспорта', VEHICLE_PHOTO: 'Фото транспорта', ADDITIONAL_DOCUMENT: 'Дополнительный документ' };
const applicationSections = { personal: 'Личные данные', identity: 'Удостоверение личности', driverLicense: 'Водительское удостоверение', taxiVehicle: 'Автомобиль такси', cargoVehicle: 'Грузовой транспорт', courierVehicle: 'Транспорт курьера', courier: 'Условия доставки', work: 'Работа', workPreferences: 'Рабочие предпочтения', location: 'География работы', payment: 'Выплаты', vehicles: 'Дополнительный транспорт', documentExpiries: 'Сроки документов' };
const applicationFields = { firstName: 'Имя', lastName: 'Фамилия', middleName: 'Отчество', birthDate: 'Дата рождения', citizenship: 'Гражданство', phone: 'Телефон', email: 'Электронная почта', number: 'Номер', issuedAt: 'Дата выдачи', expiresAt: 'Действителен до', issuedBy: 'Кем выдан', categories: 'Категории', experienceYears: 'Стаж', brand: 'Марка', make: 'Марка', model: 'Модель', year: 'Год выпуска', color: 'Цвет', plate: 'Госномер', plateNumber: 'Госномер', bodyType: 'Кузов', ownership: 'Владение', vehicleType: 'Тип транспорта', transportModes: 'Способы доставки', orderTypes: 'Типы заказов', city: 'Город', district: 'Район', address: 'Адрес', method: 'Способ выплаты', cardNumber: 'Номер карты', bankAccount: 'Банковский счёт', accountNumber: 'Номер счёта', language: 'Язык', languages: 'Языки', tariffs: 'Тарифы', clientId: 'Идентификатор', usage: 'Назначение', useExistingVehicle: 'Использует имеющийся транспорт', existingVehicleUsage: 'Выбранный транспорт' };
const truthText = value => value === true ? 'Да' : value === false ? 'Нет' : value === null || value === undefined || value === '' ? '—' : Array.isArray(value) ? value.map(truthText).join(', ') : String(value);
function applicationFieldLabel(path) { const key = path.split('.').at(-1); return applicationFields[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); }
function applicationEntries(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === 'uploads' || child === undefined || child === null || child === '') return [];
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(child)) {
      if (child.every(item => item === null || typeof item !== 'object')) return [[path, truthText(child)]];
      return child.flatMap((item, index) => item && typeof item === 'object' ? applicationEntries(item, `${path}.${index + 1}`) : [[`${path}.${index + 1}`, truthText(item)]]);
    }
    return typeof child === 'object' ? applicationEntries(child, path) : [[path, truthText(child)]];
  });
}
function applicationToolbar() {
  const states = ['', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'BLOCKED', 'DRAFT'];
  return `<div class="toolbar"><span class="muted" style="font-size:.84rem">${data?.total ?? 0} заявок</span><div class="filters"><label class="search">${icon('search', 17)}<input id="search" aria-label="Поиск заявок" placeholder="Имя, телефон или номер" value="${esc(search)}"></label><select id="filter" aria-label="Статус заявки">${states.map(value => `<option value="${value}" ${filter === value ? 'selected' : ''}>${value ? statuses[value] : 'Все статусы'}</option>`).join('')}</select><select id="role-filter" aria-label="Направление работы"><option value="">Все направления</option>${Object.entries(applicationRoles).map(([value, label]) => `<option value="${value}" ${roleFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>`;
}
function applicationsView() {
  const rows = items(data);
  return `<section class="panel">${applicationToolbar()}${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Заявка</th><th>Исполнитель</th><th>Направления</th><th>Статус</th><th>Документы</th><th>Отправлена</th><th></th></tr></thead><tbody>${rows.map(item => `<tr data-action="application-detail" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Открыть заявку ${esc(item.applicationNumber)}"><td><strong>${esc(item.applicationNumber)}</strong><small>Обновлена ${date(item.updatedAt)}</small></td><td><div class="cell-flex"><span class="cell-avatar">${esc(initials(item.user?.name))}</span><div><strong>${esc(item.user?.name || 'Без имени')}</strong><small>${esc(item.user?.phone || 'Телефон не указан')}</small></div></div></td><td><div class="application-role-list">${(item.roles || []).map(role => `<span>${esc(applicationRoles[role.role] || role.role)}</span>`).join('')}</div></td><td>${badge(item.status)}</td><td><strong>${item.uploadCount || 0}</strong><small>файлов</small></td><td>${date(item.submittedAt)}</td><td>${icon('arrow', 16)}</td></tr>`).join('')}</tbody></table></div>` : empty('Заявок не найдено', 'Новые анкеты водителей и курьеров появятся здесь после отправки.', 'audit')}${pager(data, busy)}</section>`;
}
function uploadTitle(upload) {
  const known = { profile_photo: 'Фото профиля', identity_front: 'Удостоверение — лицевая сторона', identity_back: 'Удостоверение — обратная сторона', license_front: 'Водительские права — лицевая сторона', license_back: 'Водительские права — обратная сторона', taxi_registration: 'Свидетельство о регистрации авто', taxi_insurance: 'Страховой полис авто', cargo_registration: 'Свидетельство о регистрации грузового авто', cargo_insurance: 'Страховой полис грузового авто', courier_registration: 'Документы транспорта курьера', courier_insurance: 'Страховой полис курьера', courier_photo: 'Фото транспорта курьера' };
  return known[upload.slotKey] || upload.slotKey.replace(/^vehicle_[^_]+_/, '').replace(/_/g, ' ');
}
function applicationDataView(value) {
  const dataValue = value.data || {}, order = Object.keys(applicationSections);
  const keys = [...order.filter(key => dataValue[key] !== undefined), ...Object.keys(dataValue).filter(key => !order.includes(key) && key !== 'uploads')];
  return keys.map(key => {
    const entries = applicationEntries(dataValue[key], key);
    if (!entries.length) return '';
    return `<section class="application-data-card"><h4>${esc(applicationSections[key] || applicationFieldLabel(key))}</h4><div class="application-data-grid">${entries.map(([path, fieldValue]) => `<div><span>${esc(applicationFieldLabel(path))}</span><strong>${esc(fieldValue)}</strong></div>`).join('')}</div></section>`;
  }).join('') || '<p class="muted">Данные анкеты не заполнены.</p>';
}
function applicationDetail(value) {
  const canReview = !['NOT_STARTED', 'DRAFT', 'SUBMITTED'].includes(value.status);
  return `<div class="application-summary"><div>${badge(value.status)}<h3>${esc(value.user?.name || 'Исполнитель')}</h3><p>${esc(value.user?.phone || 'Телефон не указан')}</p></div><div class="application-summary-meta"><span>Отправлена<strong>${date(value.submittedAt)}</strong></span><span>Обновлена<strong>${date(value.updatedAt)}</strong></span><span>Версия<strong>${value.version}</strong></span></div></div>${value.status === 'SUBMITTED' ? `<div class="notice application-start"><span>Заявка готова к проверке. После начала документы и направления перейдут в работу.</span>${button(icon('check', 16) + ' Начать проверку', 'application-start', '', 'primary')}</div>` : ''}<div class="form-section"><h3>Направления работы</h3><p>Каждое направление можно проверить независимо.</p></div><div class="application-review-grid">${(value.roles || []).map(role => `<article class="application-review-card"><div class="application-card-head"><div><h4>${esc(applicationRoles[role.role] || role.role)}</h4>${role.projectionIssueText ? `<p>${esc(role.projectionIssueText)}</p>` : role.reasonText ? `<p>${esc(role.reasonText)}</p>` : ''}</div>${badge(role.status)}</div>${role.operational ? '<span class="application-operational">Активировано для заказов</span>' : ''}${canReview ? `<div class="application-card-actions">${button('Одобрить', 'application-role-approve', `data-role="${esc(role.role)}"`, 'primary')}${button('На исправление', 'application-role-correction', `data-role="${esc(role.role)}"`)}${button('Отклонить', 'application-role-reject', `data-role="${esc(role.role)}"`, 'danger')}${button('Заблокировать', 'application-role-block', `data-role="${esc(role.role)}"`, 'ghost')}</div>` : ''}</article>`).join('')}</div><div class="form-section"><h3>Документы и фотографии</h3><p>${(value.uploads || []).length} файлов в анкете. Файл открывается только для вошедшего администратора.</p></div><div class="application-files">${(value.uploads || []).map(upload => `<article class="application-file"><div class="application-file-copy"><span class="application-file-icon">${icon(upload.mimeType === 'application/pdf' ? 'orders' : 'banner', 20)}</span><div><h4>${esc(uploadTitle(upload))}</h4><p>${esc(applicationKinds[upload.kind] || upload.kind)} · ${Math.max(1, Math.round((upload.byteSize || 0) / 1024))} КБ${upload.expiresAt ? ` · до ${date(upload.expiresAt)}` : ''}</p>${upload.reasonText ? `<small>${esc(upload.reasonText)}</small>` : ''}</div></div><div class="application-file-review">${badge(upload.status)}<div class="application-card-actions">${button('Открыть', 'application-file-open', `data-upload-id="${esc(upload.id)}" data-url="${esc(upload.url)}"`)}${canReview ? `${button('Одобрить', 'application-upload-approve', `data-upload-id="${esc(upload.id)}"`, 'primary')}${button('Исправить', 'application-upload-correction', `data-upload-id="${esc(upload.id)}"`)}${button('Отклонить', 'application-upload-reject', `data-upload-id="${esc(upload.id)}"`, 'danger')}${button('Блокировать', 'application-upload-block', `data-upload-id="${esc(upload.id)}"`, 'ghost')}` : ''}</div></div></article>`).join('') || '<p class="muted">Файлы не загружены.</p>'}</div><div class="form-section"><h3>Данные анкеты</h3><p>Сведения, которые исполнитель указал при регистрации.</p></div><div class="application-data">${applicationDataView(value)}</div><div class="form-section"><h3>Согласия</h3></div>${detailLine('Версия условий', value.legalTermsVersion)}${detailLine('Принятые согласия', (value.acceptedConsentIds || []).join(', '))}${detailLine('Достоверность подтверждена', date(value.truthConfirmedAt))}${detailLine('Условия приняты', date(value.termsAcceptedAt))}`;
}
function tariffsView() { const rows = items(data); return `<section class="panel"><div class="panel-heading"><h2>Тарифы поездок</h2><span class="muted" style="font-size:.82rem">Все суммы в сомах</span></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Тариф</th><th>Посадка</th><th>За км</th><th>За минуту</th><th>Минимум</th><th>Комиссия</th><th>Статус</th><th></th></tr></thead><tbody>${rows.map(t => `<tr><td><strong>${esc(t.name)}</strong><small>${esc(t.description)}</small></td><td>${money(t.basePrice)}</td><td>${money(t.pricePerKm)}</td><td>${money(t.pricePerMinute)}</td><td>${money(t.minimumPrice)}</td><td>${t.commissionBps / 100}%</td><td><span class="badge ${t.active ? 'good' : ''}">${t.active ? 'Включён' : 'Выключен'}</span></td><td>${button(icon('edit', 16), 'edit', `data-type="tariff" data-id="${esc(t.id)}" aria-label="Редактировать ${esc(t.name)}"`, 'ghost')}</td></tr>`).join('')}</tbody></table></div>` : empty('Тарифов пока нет', 'Добавьте тариф, чтобы клиенты могли рассчитать поездку.', 'tariffs')}</section>`; }
function restaurantsView() { const rows = items(data); return rows.length ? `<div class="restaurant-grid">${rows.map(r => { const c = r.catalog; return `<article class="restaurant-card">${photo(c.imageUrl, c.imageKey, c.name)}<div class="card-body"><h3>${esc(c.name)}</h3><p>${esc(c.cuisine)}</p><div class="card-meta"><span>${c.dishes.length} блюд</span><span>${c.menuCategories.length} категорий</span><span>${c.etaMin}–${c.etaMax} мин</span><span>${r.isDemo ? 'Демо' : 'Ресторан'}</span></div><div class="card-footer"><span class="badge ${r.active ? 'good' : ''}">${r.active ? 'Открыт' : 'Скрыт'}</span><div class="card-actions">${button(icon('edit', 16) + ' Настройки', 'edit', `data-type="restaurant" data-id="${esc(r.id)}"`)}${button('Меню ' + icon('arrow', 15), 'open-menu', `data-id="${esc(r.id)}"`, 'primary')}</div></div></div></article>`; }).join('')}</div>` : empty('Добавьте первый ресторан', 'Укажите адрес, затем наполните отдельный раздел меню.', 'food'); }
function bannersView() { const rows = items(data), active = rows.filter(b => b.active).length; return `<div class="notice">${active} из 3 баннеров включено. Баннеры появляются в приложении в заданном порядке.</div><div class="banner-grid">${rows.map(b => `<article class="banner-card"><div class="banner-preview">${b.imageUrl || b.imageKey ? photo(b.imageUrl, b.imageKey) : ''}<div class="banner-copy"><h3>${esc(b.title)}</h3><p>${esc(b.subtitle)}</p></div></div><div class="card-body"><div class="card-meta"><span>Позиция: ${b.sortOrder}</span><span>${esc({ NONE: 'Без перехода', TAXI: 'Такси', FOOD: 'Доставка', RESTAURANT: 'Ресторан' }[b.actionType])}</span></div><div class="card-footer"><span class="badge ${b.active ? 'good' : ''}">${b.active ? 'Показывается' : 'Скрыт'}</span>${button('Изменить', 'edit', `data-type="banner" data-id="${esc(b.id)}"`)}</div></div></article>`).join('')}${rows.length < 3 ? `<button class="banner-slot" data-action="create" data-type="banner">${icon('plus', 28)}<strong>Добавить баннер</strong><small>Изображение, текст и переход в нужный раздел</small></button>` : ''}</div>`; }
const actionNames = { 'driver.create': 'Регистрация водителя', 'driver.update': 'Изменение водителя', 'driver.verify': 'Проверка водителя', 'driver.topup': 'Пополнение депозита', 'tariff.create': 'Создание тарифа', 'tariff.update': 'Изменение тарифа', 'restaurant.create': 'Добавление ресторана', 'restaurant.update': 'Изменение ресторана', 'restaurant.archive': 'Скрытие ресторана', 'banner.create': 'Добавление баннера', 'banner.update': 'Изменение баннера', 'banner.delete': 'Удаление баннера', 'taxi.cancel': 'Отмена поездки', 'food-order.status': 'Статус заказа еды', 'auth.login': 'Вход в панель', 'media.upload': 'Загрузка изображения', 'admin.bootstrap': 'Создание администратора', 'admin.password-reset': 'Изменение пароля' };
function auditView() { const rows = items(data); return `<section class="panel">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Время</th><th>Администратор</th><th>Действие</th><th>Объект</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr data-action="audit-detail" data-index="${i}" tabindex="0" role="button"><td>${date(r.createdAt)}</td><td><strong>${esc(r.actor?.name || r.actor?.adminCredential?.username || 'Администратор')}</strong></td><td>${esc(actionNames[r.action] || r.action)}</td><td>#${esc(shortId(r.entityId || r.resourceId))}</td><td>${icon('arrow', 16)}</td></tr>`).join('')}</tbody></table></div>` : empty('Журнал пока пуст', 'Изменения тарифов, водителей и каталога будут сохраняться здесь.', 'audit')}${pager(data, busy)}</section>`; }

function menuRouteHash(id = menuRestaurantId) { return '#menu' + (id ? '/' + encodeURIComponent(id) : ''); }
function currentRouteHash() { return route === 'menu' ? menuRouteHash() : '#' + route; }
function selectedRestaurant(id = menuRestaurantId) { return restaurants.find(restaurant => restaurant.id === id) || null; }
function menuSignature(catalog) { return JSON.stringify([catalog.menuCategories, catalog.dishes, catalog.options], (_, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value); }
function mergeMenuCatalog(latest, draft) {
  return { ...structuredClone(latest), menuCategories: structuredClone(draft.menuCategories), dishes: structuredClone(draft.dishes), options: structuredClone(draft.options) };
}
function initializeMenuDraft(id = menuRestaurantId, updateHash = true, resetUi = true) {
  const restaurant = selectedRestaurant(id) || restaurants[0] || null;
  menuGeneration += 1;
  menuRestaurantId = restaurant?.id || '';
  menuDraft = restaurant ? structuredClone(restaurant) : null;
  menuBaseSignature = restaurant ? menuSignature(restaurant.catalog) : '';
  menuDirty = false;
  menuSaving = false;
  menuError = '';
  if (resetUi) {
    menuSearch = '';
    menuCategory = 'all';
    menuTab = 'dishes';
  } else if (menuCategory !== 'all' && !menuDraft?.catalog.menuCategories.includes(menuCategory)) menuCategory = 'all';
  if (updateHash) history.replaceState(null, '', menuRouteHash());
}
function confirmMenuDiscard() {
  if (menuSaving) { toast('Дождитесь завершения сохранения меню.'); return false; }
  if (!menuDirty) return true;
  if (!confirm('В меню есть несохранённые изменения. Закрыть их без сохранения?')) return false;
  menuDirty = false;
  menuGeneration += 1;
  return true;
}
function markMenuDirty() { menuDirty = true; menuError = ''; menuGeneration += 1; }
function menuEmpty(title, text) { return `<div class="menu-empty">${icon('food', 30)}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`; }
function menuDishRow(dish, index) {
  return `<article class="menu-dish-row" data-menu-dish data-index="${index}"><div class="menu-dish-media">${photo(dish.imageUrl, dish.imageKey, dish.name, 'menu-dish-photo')}</div><div class="menu-dish-copy"><div class="menu-dish-title"><strong>${esc(dish.name || 'Без названия')}</strong><span class="badge ${dish.available ? 'good' : ''}">${dish.available ? 'В наличии' : 'Скрыто'}</span></div><p>${esc(dish.description || 'Описание не добавлено')}</p><div class="menu-dish-meta"><span>${esc(dish.category)}</span><span>${esc(dish.portion || 'Порция не указана')}</span><span>${Number(dish.weightGrams || 0).toLocaleString('ru-RU')} г</span></div></div><div class="menu-dish-price">${money(dish.price)}</div><div class="menu-row-actions">${button(dish.available ? 'Скрыть' : 'Включить', 'menu-toggle-dish', `data-index="${index}"`, 'ghost')}${button(icon('edit', 16) + ' Изменить', 'menu-edit-dish', `data-index="${index}"`)}${button(icon('trash', 16), 'menu-remove-dish', `data-index="${index}" aria-label="Удалить ${esc(dish.name)}"`, 'danger')}</div></article>`;
}
function menuOptionCard(option, index, catalog) {
  const assigned = catalog.dishes.filter(dish => dish.optionIds?.includes(option.id)).length;
  return `<article class="menu-option-card"><div class="menu-option-photo">${photo(option.imageUrl, option.imageKey, option.name, 'menu-dish-photo')}</div><div class="menu-option-copy"><strong>${esc(option.name || 'Без названия')}</strong><span>+${money(option.price)}</span><small>${assigned ? `Доступно для ${assigned} блюд` : 'Пока не назначено блюдам'}</small></div><div class="menu-row-actions">${button(icon('edit', 16) + ' Изменить', 'menu-edit-option', `data-index="${index}"`)}${button(icon('trash', 16), 'menu-remove-option', `data-index="${index}" aria-label="Удалить ${esc(option.name)}"`, 'danger')}</div></article>`;
}
function menuView() {
  if (!restaurants.length) return empty('Сначала добавьте ресторан', 'После создания ресторана здесь появятся категории, блюда и дополнения.', 'food');
  if (!menuDraft) initializeMenuDraft(menuRestaurantId, false);
  const catalog = menuDraft.catalog;
  if (menuCategory !== 'all' && !catalog.menuCategories.includes(menuCategory)) menuCategory = 'all';
  const query = menuSearch.trim().toLocaleLowerCase('ru-RU');
  const visibleDishes = catalog.dishes.map((dish, index) => ({ dish, index })).filter(({ dish }) => (menuCategory === 'all' || dish.category === menuCategory) && (!query || [dish.name, dish.description, dish.category, dish.portion].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query))));
  const unavailable = catalog.dishes.filter(dish => !dish.available).length;
  const restaurantPhoto = photo(catalog.imageUrl, catalog.imageKey, catalog.name, 'menu-restaurant-photo');
  const interactionLock = menuSaving ? ' inert' : '';
  const categoryList = catalog.menuCategories.map((category, index) => {
    const count = catalog.dishes.filter(dish => dish.category === category).length;
    return `<div class="menu-category-row ${menuCategory === category ? 'active' : ''}"><button type="button" class="menu-category-main" data-action="menu-select-category" data-category="${esc(category)}"><span>${esc(category)}</span><small>${count}</small></button><div class="menu-category-actions"><button type="button" data-action="menu-move-category" data-direction="up" data-index="${index}" aria-label="Поднять категорию" ${index === 0 ? 'disabled' : ''}>${icon('back', 14)}</button><button type="button" data-action="menu-move-category" data-direction="down" data-index="${index}" aria-label="Опустить категорию" ${index === catalog.menuCategories.length - 1 ? 'disabled' : ''}>${icon('arrow', 14)}</button><button type="button" data-action="menu-edit-category" data-index="${index}" aria-label="Переименовать ${esc(category)}">${icon('edit', 14)}</button><button type="button" data-action="menu-remove-category" data-index="${index}" aria-label="Удалить ${esc(category)}" ${catalog.menuCategories.length === 1 ? 'disabled' : ''}>${icon('trash', 14)}</button></div></div>`;
  }).join('');
  return `<section class="menu-workspace ${menuSaving ? 'saving' : ''}" aria-busy="${menuSaving}">
    <div class="menu-commandbar">
      <div class="menu-restaurant-picker">${restaurantPhoto}<label><span>Ресторан</span><select id="menu-restaurant" aria-label="Выберите ресторан" ${menuSaving ? 'disabled' : ''}>${restaurants.map(restaurant => `<option value="${esc(restaurant.id)}" ${restaurant.id === menuRestaurantId ? 'selected' : ''}>${esc(restaurant.catalog?.name || restaurant.id)}</option>`).join('')}</select></label><span class="badge ${menuDraft.active ? 'good' : ''}">${menuDraft.active ? 'Открыт' : 'Скрыт'}</span></div>
      <div class="menu-command-actions">${menuDirty ? '<span class="menu-unsaved">Есть изменения</span>' : '<span class="menu-saved">Все сохранено</span>'}${button('Сбросить', 'menu-reset', menuDirty && !menuSaving ? '' : 'disabled', 'ghost')}${button(menuSaving ? 'Сохраняем…' : icon('check', 17) + ' Сохранить меню', 'menu-save', menuDirty && !menuSaving ? '' : 'disabled', 'primary')}</div>
      ${menuError ? `<div class="menu-error" role="alert">${esc(menuError)}</div>` : ''}
    </div>
    <div class="menu-overview"${interactionLock}><div><span>Блюда</span><strong>${catalog.dishes.length}</strong></div><div><span>Категории</span><strong>${catalog.menuCategories.length}</strong></div><div><span>Дополнения</span><strong>${catalog.options.length}</strong></div><div><span>Скрыто</span><strong>${unavailable}</strong></div><div class="menu-overview-copy"><strong>${esc(catalog.name)}</strong><span>${esc(catalog.cuisine)} · доставка ${catalog.etaMin}–${catalog.etaMax} мин</span></div>${button(icon('back', 15) + ' К ресторанам', 'menu-back', '', 'ghost')}</div>
    <div class="menu-tabs" role="tablist"${interactionLock}><button type="button" role="tab" aria-selected="${menuTab === 'dishes'}" class="${menuTab === 'dishes' ? 'active' : ''}" data-action="menu-tab" data-tab="dishes">Блюда <span>${catalog.dishes.length}</span></button><button type="button" role="tab" aria-selected="${menuTab === 'options'}" class="${menuTab === 'options' ? 'active' : ''}" data-action="menu-tab" data-tab="options">Дополнения <span>${catalog.options.length}</span></button></div>
    ${menuTab === 'dishes' ? `<div class="menu-layout"${interactionLock}><aside class="menu-categories"><div class="menu-section-heading"><div><strong>Категории</strong><small>Порядок показа в приложении</small></div>${button(icon('plus', 16), 'menu-add-category', 'aria-label="Добавить категорию"', 'ghost')}</div><button type="button" class="menu-category-all ${menuCategory === 'all' ? 'active' : ''}" data-action="menu-select-category" data-category="all"><span>Все блюда</span><strong>${catalog.dishes.length}</strong></button>${categoryList || '<div class="inline-empty">Добавьте первую категорию.</div>'}</aside><div class="menu-catalog"><div class="menu-catalog-toolbar"><label class="search">${icon('search', 17)}<input id="menu-search" aria-label="Поиск блюд" placeholder="Название, категория или описание" value="${esc(menuSearch)}"></label>${button(icon('plus', 17) + ' Добавить блюдо', 'menu-add-dish', '', 'primary')}</div><div class="menu-dish-list">${visibleDishes.length ? visibleDishes.map(({ dish, index }) => menuDishRow(dish, index)).join('') : menuEmpty(query || menuCategory !== 'all' ? 'Ничего не найдено' : 'Добавьте первое блюдо', query || menuCategory !== 'all' ? 'Измените поиск или выберите другую категорию.' : 'Карточка блюда появится здесь после заполнения.')}</div></div></div>` : `<div class="menu-options"${interactionLock}><div class="menu-catalog-toolbar"><div><h2>Дополнения</h2><p>Соусы, топпинги и другие позиции, которые можно назначать блюдам.</p></div>${button(icon('plus', 17) + ' Добавить дополнение', 'menu-add-option', '', 'primary')}</div><div class="menu-option-grid">${catalog.options.length ? catalog.options.map((option, index) => menuOptionCard(option, index, catalog)).join('') : menuEmpty('Дополнений пока нет', 'Добавьте соус, топпинг или другую дополнительную позицию.')}</div></div>`}
  </section>`;
}
function renderPage() {
  const node = document.querySelector('#view');
  if (!node) return;
  const active = document.activeElement;
  const focused = ['search', 'menu-search'].includes(active?.id) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const views = { dashboard, orders: () => `<section class="panel">${toolbar(true)}${orderTable(items(data), kind)}${pager(data, busy)}</section>`, applications: applicationsView, drivers: driversView, tariffs: tariffsView, restaurants: restaurantsView, menu: menuView, banners: bannersView, audit: auditView };
  node.innerHTML = heading() + (busy && !data ? loading() : loadError ? errorBox(loadError) : views[route]());
  document.querySelector('#breadcrumb').textContent = route === 'menu' && menuDraft ? `Меню · ${menuDraft.catalog.name}` : sections[route][0];
  document.querySelectorAll('[data-nav]').forEach(item => item.classList.toggle('active', item.dataset.nav === route));
  if (focused) { const input = document.querySelector('#' + focused.id); input?.focus({ preventScroll: true }); input?.setSelectionRange(focused.start, focused.end); }
}
async function load(quiet = false) {
  if (!session()) return;
  if (quiet && route === 'menu' && (menuDirty || editor?.type?.startsWith('menu-'))) return;
  const version = ++sequence, menuGenerationAtStart = menuGeneration, resource = route === 'menu' ? 'restaurants' : route;
  const path = resource === 'dashboard' ? '/admin/dashboard' : resource === 'applications' ? `/admin/performer-applications?${params()}` : `/admin/${resource}${['orders', 'drivers', 'audit'].includes(resource) ? '?' + params() : ''}`;
  busy = true;
  if (!quiet) renderPage();
  try {
    const result = await api(path);
    if (version !== sequence) return;
    // A refresh that started before the first local edit must not replace the
    // newly-created draft when its response arrives later.
    if (route === 'menu' && (menuGeneration !== menuGenerationAtStart || menuDirty || editor?.type?.startsWith('menu-'))) return;
    data = result;
    loadError = '';
    if (socket && !socket.connected && session()) socket.connect();
    if (route === 'restaurants' || route === 'menu') restaurants = items(result);
    if (route === 'menu') initializeMenuDraft(menuRestaurantId, true, !quiet);
  } catch (e) {
    if (version !== sequence) return;
    loadError = e.message;
  } finally {
    if (version === sequence) { busy = false; renderPage(); }
  }
}
async function navigate(next, restaurantId = '') {
  if (!sections[next]) return;
  const targetRestaurantId = next === 'menu' ? (restaurantId || (route === 'menu' ? menuRestaurantId : '')) : '';
  if (next === route && (next !== 'menu' || !targetRestaurantId || targetRestaurantId === menuRestaurantId)) { document.querySelector('.layout')?.classList.remove('menu-open'); return; }
  if (!closeEditor()) { history.replaceState(null, '', currentRouteHash()); return; }
  if (route === 'menu' && !confirmMenuDiscard()) { history.replaceState(null, '', currentRouteHash()); return; }
  route = next;
  menuRestaurantId = targetRestaurantId;
  page = 1;
  search = '';
  filter = '';
  roleFilter = '';
  data = null;
  loadError = '';
  history.replaceState(null, '', currentRouteHash());
  document.querySelector('.layout')?.classList.remove('menu-open');
  await load();
}
function openDialog(type, value, title, subtitle = '', isNew = false) { dialogReturnFocus = document.activeElement; editor = { type, value: structuredClone(value), title, subtitle, isNew, dirty: false, saving: false, error: '' }; drawDialog(); }
function dialogBody() { const e = editor; if (e.type === 'tariff') return tariffEditor(e.value); if (e.type === 'driver') return driverEditor(e.value); if (e.type === 'restaurant') return restaurantEditor(e.value, e.isNew); if (e.type === 'banner') return bannerEditor(e.value, restaurants); if (e.type === 'menu-dish') return menuDishEditor(e.value, menuDraft.catalog); if (e.type === 'menu-option') return menuOptionEditor(e.value); if (e.type === 'menu-category') return menuCategoryEditor(e.value.name); if (e.type === 'order') return orderDetail(e.value); if (e.type === 'application') return applicationDetail(e.value); if (e.type === 'driver-detail') return driverDetail(e.value); if (e.type === 'topup') return `<div class="form-grid">${field('Сумма пополнения, сом', 'amount', '', { type: 'number', required: true, min: 1, max: 1000000, wide: true })}${field('Комментарий', 'note', '', { required: true, wide: true, maxLength: 250, placeholder: 'Например: наличные в офисе' })}</div>`; if (e.type === 'audit') return `<div class="detail-row"><span>Время</span><strong>${date(e.value.createdAt)}</strong></div><div class="detail-row"><span>Действие</span><strong>${esc(actionNames[e.value.action] || e.value.action)}</strong></div><pre class="audit-details">${esc(JSON.stringify(e.value.details || e.value.metadata || {}, null, 2))}</pre>`; return ''; }
function drawDialog() { if (!editor) return; const readOnly = ['order', 'application', 'driver-detail', 'audit'].includes(editor.type); modalRoot.innerHTML = `<div class="modal-shade"><section class="drawer ${['restaurant', 'application'].includes(editor.type) ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="drawer-head"><div><h2 id="dialog-title">${esc(editor.title)}</h2>${editor.subtitle ? `<p>${esc(editor.subtitle)}</p>` : ''}</div>${button(icon('close'), 'close-dialog', 'aria-label="Закрыть"', 'ghost')}</div><form id="editor-form" style="display:contents"><div class="drawer-body">${dialogBody()}</div><footer class="drawer-footer"><div class="error-inline" role="alert">${esc(editor.error)}</div>${!editor.isNew && ['restaurant', 'banner'].includes(editor.type) ? button(editor.type === 'banner' ? 'Удалить' : 'Скрыть ресторан', 'archive', '', 'danger') : ''}${button(readOnly ? 'Закрыть' : 'Отмена', 'close-dialog')}${readOnly ? '' : `<button class="button primary" type="submit" ${editor.saving ? 'disabled' : ''}>${editor.saving ? 'Сохраняем…' : editor.type === 'topup' ? 'Пополнить' : 'Сохранить'}</button>`}</footer></form></section></div>`; document.body.style.overflow = 'hidden'; if (editor.type === 'menu-dish') updateMenuOptionLimit(modalRoot.querySelector('#editor-form')); const first = modalRoot.querySelector('input:not([type=checkbox]):not([type=file]),button'); first?.focus({ preventScroll: true }); }
function closeEditor(force = false) { if (!editor) return true; if (editor.saving && !force) return false; if (editor.dirty && !force && !confirm('Закрыть без сохранения изменений?')) return false; editor = null; modalRoot.innerHTML = ''; document.body.style.overflow = ''; dialogReturnFocus?.focus?.(); return true; }
function captureDraft() {
  const form = modalRoot.querySelector('#editor-form');
  if (!editor || !form) return;
  if (['restaurant', 'banner'].includes(editor.type)) editor.value = { ...editor.value, ...readEditor(editor.type, form, editor.value) };
  if (editor.type === 'menu-dish') editor.value = readMenuDish(form, editor.value, menuDraft.catalog);
  if (editor.type === 'menu-option') editor.value = readMenuOption(form, editor.value);
  if (editor.type === 'menu-category') editor.value = { ...editor.value, name: readMenuCategory(form) };
}
function detailLine(label, value) { return `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value || '—')}</strong></div>`; }
function orderDetail(o) { const food = o.kind === 'food', finished = ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(o.status); const next = { PLACED: ['CONFIRMED', 'Подтвердить заказ'], CONFIRMED: ['PREPARING', 'Начать приготовление'], PREPARING: ['READY', 'Готов к выдаче'], READY: o.fulfillment === 'PICKUP' ? ['COMPLETED', 'Выдан клиенту'] : ['DELIVERING', 'Передан в доставку'], DELIVERING: ['COMPLETED', 'Заказ доставлен'] }[o.status]; return `<div style="margin-bottom:25px">${badge(o.status)}</div>${detailLine('Клиент', o.client?.name)}${detailLine('Телефон', o.client?.phone)}${detailLine('Создан', date(o.createdAt))}${food ? `${detailLine('Ресторан', o.restaurant?.name)}${detailLine('Получение', o.fulfillment === 'PICKUP' ? 'Самовывоз' : 'Доставка')}${detailLine('Адрес', o.address || o.restaurant?.address)}` : `${detailLine('Откуда', o.pickup?.address)}${detailLine('Куда', o.dropoff?.address)}${detailLine('Водитель', o.driver?.name || o.driver?.phone || 'Не назначен')}${detailLine('Тариф', o.tariff?.name || o.quote?.tariff?.name)}${detailLine('Расстояние', o.distanceMeters ? (o.distanceMeters / 1000).toFixed(1) + ' км' : '')}`}${o.comment ? `<div class="notice">${esc(o.comment)}</div>` : ''}${food ? `<div class="form-section"><h3>Состав заказа</h3></div><div class="detail-products">${(o.items || []).map(i => `<div class="detail-product"><div><strong>${esc(i.name)} × ${i.quantity}</strong>${i.options?.length ? `<small>${i.options.map(v => esc(v.name)).join(', ')}</small>` : ''}</div><strong>${money(i.lineTotal)}</strong></div>`).join('')}</div>${detailLine('Блюда', money(o.subtotal))}${detailLine('Доставка', money(o.deliveryFee))}` : ''}${detailLine('Итого', money(o.total ?? o.price))}${detailLine('Оплата', 'Наличными')}${!finished ? `<div class="detail-actions">${food && next ? button(next[1], 'food-status', `data-status="${next[0]}"`, 'primary') : ''}${food || ['SEARCHING', 'ASSIGNED', 'ARRIVED'].includes(o.status) ? button('Отменить заказ', 'cancel-order', '', 'danger') : ''}</div>` : ''}<div class="form-section"><h3>История заказа</h3></div><div class="timeline">${(o.history || []).map(h => `<div class="timeline-item"><strong>${esc(statuses[h.status] || h.status)}</strong><small>${date(h.createdAt)}${h.reason ? ' · ' + esc(h.reason) : ''}</small></div>`).join('')}</div>`; }
function driverDetail(d) { return `<div class="detail-actions" style="margin-top:0;margin-bottom:27px">${button('Редактировать', 'edit-driver-detail', '', 'primary')}${button('Пополнить депозит', 'topup')}${d.online ? button('Снять с линии', 'driver-offline', '', 'danger') : ''}</div>${detailLine('Телефон', d.phone)}${detailLine('Автомобиль', d.carMake)}${detailLine('Госномер', d.carPlate)}${detailLine('Цвет', d.carColor)}${detailLine('Проверка', d.verified ? 'Подтверждён' : 'Ожидает подтверждения')}${detailLine('Статус', d.online ? 'На линии' : 'Не на линии')}${detailLine('Депозит', money(d.deposit))}${detailLine('Завершено поездок', String(d.completedOrders || 0))}${detailLine('Доход наличными', money(d.cashIncome))}<div class="form-section"><h3>Операции по депозиту</h3></div>${(d.operations || []).map(o => `<div class="summary-line"><div><strong>${o.kind === 'TOPUP' ? 'Пополнение' : 'Комиссия'}</strong><small style="display:block">${date(o.createdAt)} · ${esc(o.note)}</small></div><strong>${money(o.amount)}</strong></div>`).join('') || '<p class="muted">Операций пока нет.</p>'}<div class="form-section"><h3>Последние поездки</h3></div>${orderTable(d.recentOrders || [], 'taxi', true)}`; }
function showEditorError(message) { if (!editor) return; editor.error = message; const node = modalRoot.querySelector('.error-inline'); if (node) node.textContent = message; }
function updateMenuOptionLimit(form) {
  if (!form) return;
  const inputs = [...form.querySelectorAll('input[name="optionIds"]')];
  const selected = inputs.filter(input => input.checked).length;
  inputs.forEach(input => { input.disabled = !input.checked && selected >= 10; });
  const status = form.querySelector('[data-menu-option-limit]');
  if (status) {
    status.classList.toggle('limit-exceeded', selected > 10);
    status.querySelector('strong').textContent = `Выбрано ${selected} из 10`;
  }
}
function openMenuDish(index = -1) {
  if (!menuDraft) return;
  const catalog = menuDraft.catalog;
  if (index < 0 && catalog.dishes.length >= 500) return toast('В одном ресторане может быть не больше 500 блюд.');
  const category = catalog.menuCategories[0] || 'Основное';
  const value = index < 0 ? { id: `dish-${crypto.randomUUID().slice(0, 8)}`, name: '', category, description: '', portion: '1 порция', weightGrams: 0, price: 0, imageKey: '', available: true, optionIds: [] } : structuredClone(catalog.dishes[index]);
  openDialog('menu-dish', value, index < 0 ? 'Новое блюдо' : 'Редактирование блюда', catalog.name, index < 0);
  editor.menuIndex = index;
}
function openMenuOption(index = -1) {
  if (!menuDraft) return;
  if (index < 0 && menuDraft.catalog.options.length >= 100) return toast('В одном ресторане может быть не больше 100 дополнений.');
  const value = index < 0 ? { id: `option-${crypto.randomUUID().slice(0, 8)}`, name: '', price: 0, imageKey: '' } : structuredClone(menuDraft.catalog.options[index]);
  openDialog('menu-option', value, index < 0 ? 'Новое дополнение' : 'Редактирование дополнения', menuDraft.catalog.name, index < 0);
  editor.menuIndex = index;
}
function openMenuCategory(index = -1) {
  if (!menuDraft) return;
  if (index < 0 && menuDraft.catalog.menuCategories.length >= 40) return toast('В одном ресторане может быть не больше 40 категорий.');
  openDialog('menu-category', { name: index < 0 ? '' : menuDraft.catalog.menuCategories[index] }, index < 0 ? 'Новая категория' : 'Переименование категории', menuDraft.catalog.name, index < 0);
  editor.menuIndex = index;
}
function saveMenuEditor(form) {
  if (!editor || !menuDraft) return false;
  const wasNew = editor.isNew;
  const catalog = menuDraft.catalog;
  if (editor.type === 'menu-dish') {
    const value = readMenuDish(form, editor.value, catalog);
    if (value.optionIds.length > 10) { showEditorError('К одному блюду можно назначить не больше 10 дополнений.'); updateMenuOptionLimit(form); return true; }
    if (!catalog.menuCategories.includes(value.category)) catalog.menuCategories.push(value.category);
    if (editor.menuIndex < 0) catalog.dishes.push(value); else catalog.dishes[editor.menuIndex] = value;
  } else if (editor.type === 'menu-option') {
    const value = readMenuOption(form, editor.value);
    if (editor.menuIndex < 0) catalog.options.push(value); else catalog.options[editor.menuIndex] = value;
  } else if (editor.type === 'menu-category') {
    const name = readMenuCategory(form);
    const normalized = name.toLocaleLowerCase('ru-RU');
    const duplicate = catalog.menuCategories.some((category, index) => index !== editor.menuIndex && category.toLocaleLowerCase('ru-RU') === normalized);
    if (duplicate) { showEditorError('Категория с таким названием уже существует.'); return true; }
    if (editor.menuIndex < 0) catalog.menuCategories.push(name);
    else {
      const previous = catalog.menuCategories[editor.menuIndex];
      catalog.menuCategories[editor.menuIndex] = name;
      catalog.dishes.forEach(dish => { if (dish.category === previous) dish.category = name; });
      if (menuCategory === previous) menuCategory = name;
    }
  } else return false;
  markMenuDirty();
  closeEditor(true);
  renderPage();
  toast(wasNew ? 'Добавлено в черновик меню' : 'Изменено в черновике меню');
  return true;
}
async function saveMenu() {
  if (!menuDraft || !menuDirty || menuSaving) return;
  const restaurantId = menuDraft.id;
  const draftCatalog = structuredClone(menuDraft.catalog);
  const baseSignature = menuBaseSignature;
  const saveGeneration = ++menuGeneration;
  ++sequence;
  busy = false;
  menuSaving = true;
  menuError = '';
  renderPage();
  try {
    const latestResult = await api('/admin/restaurants');
    if (menuGeneration !== saveGeneration || menuDraft?.id !== restaurantId || route !== 'menu') return;
    const latestRestaurants = items(latestResult);
    const latest = latestRestaurants.find(restaurant => restaurant.id === restaurantId);
    if (!latest) throw new Error('Ресторан больше не доступен. Обновите страницу.');
    if (menuSignature(latest.catalog) !== baseSignature) throw new Error('Меню уже изменено на сервере. Обновите страницу и повторите изменения, чтобы не перезаписать чужую работу.');
    const catalog = mergeMenuCatalog(latest.catalog, draftCatalog);
    const saved = await api(`/admin/restaurants/${encodeURIComponent(restaurantId)}`, { method: 'PATCH', body: { catalog } });
    if (menuGeneration !== saveGeneration || menuDraft?.id !== restaurantId || route !== 'menu') return;
    restaurants = latestRestaurants.map(restaurant => restaurant.id === saved.id ? saved : restaurant);
    data = { ...latestResult, items: restaurants, total: restaurants.length };
    menuDraft = structuredClone(saved);
    menuBaseSignature = menuSignature(saved.catalog);
    menuDirty = false;
    menuSaving = false;
    menuError = '';
    menuGeneration += 1;
    toast('Меню сохранено');
  } catch (e) {
    if (menuGeneration !== saveGeneration || menuDraft?.id !== restaurantId || route !== 'menu') return;
    menuSaving = false;
    menuError = e.message;
  }
  renderPage();
}
async function saveEditor(form) {
  if (!editor || editor.saving || !form.reportValidity()) return;
  if (editor.type.startsWith('menu-') && saveMenuEditor(form)) return;
  const original = editor, type = editor.type;
  let body, path, method = editor.isNew ? 'POST' : 'PATCH';
  if (type === 'topup') {
    const fields = new FormData(form);
    body = { amount: Number(fields.get('amount')), note: String(fields.get('note')).trim(), idempotencyKey: editor.value.requestId };
    path = `/admin/drivers/${editor.value.id}/topup`;
    method = 'POST';
  } else {
    body = readEditor(type, form, editor.value);
    path = `/admin/${{ tariff: 'tariffs', driver: 'drivers', restaurant: 'restaurants', banner: 'banners' }[type]}${editor.isNew ? '' : '/' + encodeURIComponent(editor.value.id)}`;
    if (type === 'restaurant' && !editor.isNew) delete body.id;
  }
  editor.saving = true;
  editor.error = '';
  const locked = [...form.elements].filter(control => !control.disabled);
  locked.forEach(control => { control.disabled = true; });
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  submit.textContent = 'Сохраняем…';
  try {
    await api(path, { method, body });
    if (editor === original) closeEditor(true);
    toast(type === 'topup' ? 'Депозит пополнен' : 'Изменения сохранены');
    await load(true);
  } catch (e) {
    if (editor === original) {
      editor.saving = false;
      editor.error = e.message;
      locked.forEach(control => { control.disabled = false; });
      form.querySelector('.error-inline').textContent = e.message;
      submit.disabled = false;
      submit.textContent = 'Повторить сохранение';
    }
  }
}
async function openOrder(id, orderKind) { const value = await api(`/admin/orders/${orderKind}/${id}`); openDialog('order', { ...value, kind: orderKind }, `Заказ #${shortId(id)}`, orderKind === 'food' ? 'Доставка еды' : 'Поездка на такси'); }
async function openApplication(id) { const value = await api(`/admin/performer-applications/${encodeURIComponent(id)}`); openDialog('application', value, value.applicationNumber || `Заявка #${shortId(id)}`, `${value.user?.name || 'Исполнитель'} · ${value.user?.phone || 'телефон не указан'}`); }
async function updateApplication(path, options, successText) {
  if (!editor || editor.type !== 'application' || editor.saving) return;
  const original = editor, scrollTop = modalRoot.querySelector('.drawer-body')?.scrollTop || 0;
  editor.saving = true; editor.error = ''; drawDialog();
  try {
    const value = await api(path, options);
    if (editor !== original) return;
    editor.value = value; editor.saving = false; drawDialog();
    const body = modalRoot.querySelector('.drawer-body'); if (body) body.scrollTop = scrollTop;
    toast(successText);
    await load(true);
  } catch (error) {
    if (editor === original) { editor.saving = false; editor.error = error.message; drawDialog(); const body = modalRoot.querySelector('.drawer-body'); if (body) body.scrollTop = scrollTop; }
  }
}
function requestedReason(message) { const value = prompt(message); return value === null ? null : value.trim(); }
async function decideApplicationRole(action, role) {
  const value = editor.value, path = `/admin/performer-applications/${encodeURIComponent(value.id)}/roles/${encodeURIComponent(role)}`;
  if (action === 'approve') return updateApplication(path, { method: 'PATCH', body: { expectedVersion: value.version, status: 'APPROVED' } }, 'Направление одобрено');
  const reason = requestedReason(action === 'correction' ? 'Что нужно исправить?' : action === 'reject' ? 'Укажите причину отказа:' : 'Укажите причину блокировки:');
  if (!reason) return;
  if (action === 'correction') {
    const fields = prompt('Какие поля разрешить исправить? Укажите через запятую, например: personal, identity, taxiVehicle', 'personal');
    if (fields === null || !fields.split(',').map(item => item.trim()).filter(Boolean).length) return toast('Укажите хотя бы одно поле для исправления.');
    return updateApplication(path, { method: 'PATCH', body: { expectedVersion: value.version, status: 'CORRECTION_REQUIRED', reasonCode: 'ADMIN_REVIEW', reasonText: reason, canResubmit: true, correctionFields: fields.split(',').map(item => item.trim()).filter(Boolean) } }, 'Заявка возвращена на исправление');
  }
  if (action === 'reject') {
    const canResubmit = confirm('Разрешить исполнителю исправить анкету и подать её повторно?');
    let correctionFields = [];
    if (canResubmit) {
      const fields = prompt('Какие поля разрешить исправить? Укажите через запятую.', 'personal');
      if (fields === null || !fields.split(',').map(item => item.trim()).filter(Boolean).length) return toast('Укажите хотя бы одно поле для повторной подачи.');
      correctionFields = fields.split(',').map(item => item.trim()).filter(Boolean);
    }
    return updateApplication(path, { method: 'PATCH', body: { expectedVersion: value.version, status: 'REJECTED', reasonCode: 'ADMIN_REVIEW', reasonText: reason, canResubmit, correctionFields } }, 'Решение по направлению сохранено');
  }
  const blockedUntil = prompt('До какой даты заблокировать? Формат ГГГГ-ММ-ДД. Можно оставить пустым.', '');
  if (blockedUntil === null) return;
  const blockedDate = blockedUntil.trim();
  if (blockedDate && !/^\d{4}-\d{2}-\d{2}$/.test(blockedDate)) return toast('Используйте формат даты ГГГГ-ММ-ДД.');
  return updateApplication(path, { method: 'PATCH', body: { expectedVersion: value.version, status: 'BLOCKED', reasonCode: 'ADMIN_REVIEW', reasonText: reason, ...(blockedDate ? { blockedUntil: new Date(`${blockedDate}T23:59:59.999+06:00`).toISOString() } : {}) } }, 'Направление заблокировано');
}
async function decideApplicationUpload(action, uploadId) {
  const value = editor.value, upload = value.uploads.find(item => item.id === uploadId);
  if (!upload) return toast('Файл больше не найден. Обновите заявку.');
  const path = `/admin/performer-applications/${encodeURIComponent(value.id)}/uploads/${encodeURIComponent(uploadId)}`;
  if (action === 'approve') {
    const requiresExpiry = ['identity_front', 'identity_back', 'license_front', 'license_back', 'taxi_insurance', 'cargo_insurance', 'courier_insurance'].includes(upload.slotKey) || /^vehicle_v-[a-z0-9]+_insurance$/.test(upload.slotKey);
    let expiresAt = upload.expiresAt ? new Date(upload.expiresAt).toISOString().slice(0, 10) : '';
    if (requiresExpiry) { const answer = prompt('Укажите срок действия документа в формате ГГГГ-ММ-ДД:', expiresAt); if (answer === null || !answer.trim()) return toast('Для этого документа нужен срок действия.'); expiresAt = answer.trim(); }
    return updateApplication(path, { method: 'PATCH', body: { expectedVersion: value.version, status: 'APPROVED', ...(expiresAt ? { expiresAt } : {}) } }, 'Документ одобрен');
  }
  const reason = requestedReason(action === 'correction' ? 'Что нужно исправить или загрузить заново?' : action === 'reject' ? 'Укажите причину отказа по документу:' : 'Укажите причину блокировки документа:');
  if (!reason) return;
  const status = { correction: 'CORRECTION_REQUIRED', reject: 'REJECTED', block: 'BLOCKED' }[action];
  const canReupload = action === 'correction' ? true : action === 'reject' ? confirm('Разрешить загрузить документ повторно?') : false;
  return updateApplication(path, { method: 'PATCH', body: { expectedVersion: value.version, status, reasonCode: 'ADMIN_REVIEW', reasonText: reason, canReupload } }, action === 'correction' ? 'Документ возвращён на исправление' : 'Решение по документу сохранено');
}
async function openApplicationFile(path) {
  const preview = window.open('', '_blank');
  if (preview) preview.document.body.innerHTML = '<p style="font:16px sans-serif;padding:24px">Загружаем защищённый файл…</p>';
  try {
    const { blob } = await apiBlob(path), url = URL.createObjectURL(blob);
    if (preview) { preview.opener = null; preview.location.replace(url); }
    else { const link = document.createElement('a'); link.href = url; link.download = 'document'; document.body.append(link); link.click(); link.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  } catch (error) { preview?.close(); throw error; }
}
async function editItem(type, id) { let item = items(data).find(i => i.id === id); if (type === 'driver') item = await api(`/admin/drivers/${id}`); if (!item) throw new Error('Запись не найдена. Обновите страницу.'); if (type === 'banner') restaurants = items(await api('/admin/restaurants')); openDialog(type, item, { tariff: 'Настройки тарифа', driver: 'Редактирование водителя', restaurant: item.catalog?.name || 'Ресторан', banner: 'Редактирование баннера' }[type], '', false); }
async function createItem(type) { if (type === 'banner') restaurants = items(await api('/admin/restaurants')); openDialog(type, type === 'restaurant' ? newRestaurant() : {}, { driver: 'Новый водитель', tariff: 'Новый тариф', restaurant: 'Новый ресторан', banner: 'Новый баннер' }[type], '', true); }
async function handleAction(target) {
  const action = target.dataset.action;
  if (menuSaving && action.startsWith('menu-')) { toast('Дождитесь завершения сохранения меню.'); return; }
  if (action === 'reload') { if (route === 'menu' && !confirmMenuDiscard()) return; return load(); }
  if (action === 'logout') { if (route === 'menu' && !confirmMenuDiscard()) return; await signOut(); return; }
  if (action === 'toggle-menu') return document.querySelector('.layout').classList.toggle('menu-open');
  if (action === 'page-prev' || action === 'page-next') { page += action === 'page-prev' ? -1 : 1; return load(); }
  if (action === 'go-drivers') return navigate('drivers');
  if (action === 'all-orders') { kind = target.dataset.kind; return navigate('orders'); }
  if (action === 'create') return createItem(target.dataset.type);
  if (action === 'edit') return editItem(target.dataset.type, target.dataset.id);
  if (action === 'open-menu') return navigate('menu', target.dataset.id);
  if (action === 'open-menu-from-settings') { const id = target.dataset.id; if (!closeEditor()) return; return navigate('menu', id); }
  if (action === 'menu-back') return navigate('restaurants');
  if (action === 'menu-save') return saveMenu();
  if (action === 'menu-reset') { if (menuDirty && !confirm('Сбросить все несохранённые изменения меню?')) return; initializeMenuDraft(menuRestaurantId, false); renderPage(); return; }
  if (action === 'menu-tab') { menuTab = target.dataset.tab === 'options' ? 'options' : 'dishes'; renderPage(); return; }
  if (action === 'menu-select-category') { menuCategory = target.dataset.category || 'all'; renderPage(); return; }
  if (action === 'menu-add-dish') return openMenuDish();
  if (action === 'menu-edit-dish') return openMenuDish(Number(target.dataset.index));
  if (action === 'menu-add-option') return openMenuOption();
  if (action === 'menu-edit-option') return openMenuOption(Number(target.dataset.index));
  if (action === 'menu-add-category') return openMenuCategory();
  if (action === 'menu-edit-category') return openMenuCategory(Number(target.dataset.index));
  if (action === 'menu-toggle-dish' && menuDraft) {
    const dish = menuDraft.catalog.dishes[Number(target.dataset.index)];
    if (dish) { dish.available = !dish.available; markMenuDirty(); renderPage(); }
    return;
  }
  if (action === 'menu-remove-dish' && menuDraft) {
    const index = Number(target.dataset.index), dish = menuDraft.catalog.dishes[index];
    if (dish && confirm(`Удалить блюдо «${dish.name}»?`)) { menuDraft.catalog.dishes.splice(index, 1); markMenuDirty(); renderPage(); }
    return;
  }
  if (action === 'menu-remove-option' && menuDraft) {
    const index = Number(target.dataset.index), option = menuDraft.catalog.options[index];
    if (option && confirm(`Удалить дополнение «${option.name}»? Оно будет убрано из всех блюд.`)) {
      menuDraft.catalog.options.splice(index, 1);
      menuDraft.catalog.dishes.forEach(dish => { dish.optionIds = (dish.optionIds || []).filter(id => id !== option.id); });
      markMenuDirty(); renderPage();
    }
    return;
  }
  if (action === 'menu-remove-category' && menuDraft) {
    const index = Number(target.dataset.index), category = menuDraft.catalog.menuCategories[index];
    if (!category) return;
    const count = menuDraft.catalog.dishes.filter(dish => dish.category === category).length;
    if (count) { toast(`Сначала перенесите ${count} блюд в другую категорию.`); return; }
    if (confirm(`Удалить пустую категорию «${category}»?`)) { menuDraft.catalog.menuCategories.splice(index, 1); if (menuCategory === category) menuCategory = 'all'; markMenuDirty(); renderPage(); }
    return;
  }
  if (action === 'menu-move-category' && menuDraft) {
    const index = Number(target.dataset.index), next = target.dataset.direction === 'up' ? index - 1 : index + 1;
    if (index >= 0 && next >= 0 && next < menuDraft.catalog.menuCategories.length) {
      const [category] = menuDraft.catalog.menuCategories.splice(index, 1);
      menuDraft.catalog.menuCategories.splice(next, 0, category);
      markMenuDirty(); renderPage();
    }
    return;
  }
  if (action === 'close-dialog') return closeEditor();
  if (action === 'order') { if (editor?.dirty && !closeEditor()) return; return openOrder(target.dataset.id, target.dataset.kind); }
  if (action === 'application-detail') { if (editor?.dirty && !closeEditor()) return; return openApplication(target.dataset.id); }
  if (action === 'application-file-open') return openApplicationFile(target.dataset.url);
  if (action === 'driver-detail') { const driver = await api(`/admin/drivers/${target.dataset.id}`); return openDialog('driver-detail', driver, driver.name || 'Водитель', driver.phone); }
  if (action === 'audit-detail') { const value = items(data)[Number(target.dataset.index)]; return openDialog('audit', value, 'Запись журнала'); }
  if (!editor || editor.saving) return;
  if (action === 'application-start') return updateApplication(`/admin/performer-applications/${encodeURIComponent(editor.value.id)}/start-review`, { method: 'POST', body: { expectedVersion: editor.value.version } }, 'Проверка начата');
  if (action.startsWith('application-role-')) return decideApplicationRole(action.replace('application-role-', ''), target.dataset.role);
  if (action.startsWith('application-upload-')) return decideApplicationUpload(action.replace('application-upload-', ''), target.dataset.uploadId);
  if (action === 'edit-driver-detail') return openDialog('driver', editor.value, 'Редактирование водителя');
  if (action === 'topup') return openDialog('topup', { id: editor.value.id, requestId: crypto.randomUUID() }, 'Пополнение депозита', editor.value.name);
  if (action === 'driver-offline') { if (!confirm('Снять водителя с линии?')) return; await api(`/admin/drivers/${editor.value.id}`, { method: 'PATCH', body: { online: false } }); closeEditor(true); toast('Водитель снят с линии'); return load(true); }
  if (action === 'food-status') { if (!confirm(`Изменить статус заказа на «${statuses[target.dataset.status]}»?`)) return; const id = editor.value.id; await api(`/admin/food/orders/${id}/status`, { method: 'PATCH', body: { status: target.dataset.status } }); await openOrder(id, 'food'); toast('Статус заказа обновлён'); return load(true); }
  if (action === 'cancel-order') { const reason = prompt('Укажите причину отмены заказа:'); if (!reason) return; if (reason.trim().length < 3) throw new Error('Укажите причину отмены, минимум 3 символа.'); const order = editor.value; await api(order.kind === 'food' ? `/admin/food/orders/${order.id}/status` : `/admin/orders/taxi/${order.id}/cancel`, { method: order.kind === 'food' ? 'PATCH' : 'POST', body: order.kind === 'food' ? { status: 'CANCELLED', reason: reason.trim() } : { reason: reason.trim() } }); await openOrder(order.id, order.kind); toast('Заказ отменён'); return load(true); }
  if (action === 'archive') { if (!confirm(editor.type === 'banner' ? 'Удалить этот баннер?' : 'Скрыть ресторан из приложения? История заказов сохранится.')) return; await api(`/admin/${editor.type === 'banner' ? 'banners' : 'restaurants'}/${editor.value.id}`, { method: 'DELETE' }); closeEditor(true); toast('Изменения сохранены'); return load(true); }
  if (action === 'clear-image') {
    captureDraft();
    setPath(editor.value, target.dataset.path, undefined);
    editor.dirty = true;
    const scrollTop = modalRoot.querySelector('.drawer-body').scrollTop;
    drawDialog();
    modalRoot.querySelector('.drawer-body').scrollTop = scrollTop;
  }
}
function setPath(object, path, value) { const keys = path.split('.'); let current = object; for (const key of keys.slice(0, -1)) current = current[key]; if (value === undefined) delete current[keys.at(-1)]; else current[keys.at(-1)] = value; }
document.addEventListener('click', event => { const navigation = event.target.closest('[data-nav]'), tab = event.target.closest('[data-kind]:not([data-action])'), target = event.target.closest('[data-action]'); if (navigation) void navigate(navigation.dataset.nav); else if (tab) { kind = tab.dataset.kind; filter = ''; page = 1; data = null; loadError = ''; void load(); } else if (target && !target.disabled) void handleAction(target).catch(e => toast(e.message)); });
document.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'login-form') { const form = event.target, f = new FormData(form), b = form.querySelector('button'); b.disabled = true; b.textContent = 'Входим…'; document.querySelector('#login-error').textContent = ''; void signIn(String(f.get('username')).trim(), String(f.get('password')), f.get('remember') === 'on').then(() => { shell(); connect(); return load(); }).catch(e => { document.querySelector('#login-error').textContent = e.message; b.disabled = false; b.textContent = 'Войти'; }); } else if (event.target.id === 'editor-form') void saveEditor(event.target); });
document.addEventListener('input', event => {
  if (event.target.closest('#editor-form') && editor) editor.dirty = true;
  if (event.target.matches('#editor-form input[name="optionIds"]')) updateMenuOptionLimit(event.target.form);
  if (event.target.id === 'menu-search') { if (menuSaving) return; menuSearch = event.target.value; renderPage(); return; }
  if (event.target.id === 'search') {
    search = event.target.value;
    page = 1;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { const selection = event.target.selectionStart; void load(true).then(() => { const next = document.querySelector('#search'); next?.focus(); next?.setSelectionRange(selection, selection); }); }, 350);
  }
});
document.addEventListener('change', async event => {
  if (event.target.id === 'menu-restaurant') {
    if (menuSaving) { renderPage(); return; }
    const id = event.target.value;
    if (id === menuRestaurantId) return;
    if (!confirmMenuDiscard()) { renderPage(); return; }
    initializeMenuDraft(id, true);
    renderPage();
    return;
  }
  if (event.target.id === 'filter') { filter = event.target.value; page = 1; void load(); }
  if (event.target.id === 'role-filter') { roleFilter = event.target.value; page = 1; void load(); }
  if (event.target.dataset.upload && editor) {
    const file = event.target.files[0];
    if (!file) return;
    const original = editor, path = event.target.dataset.upload;
    captureDraft();
    editor.saving = true;
    const controls = modalRoot.querySelectorAll('button,input,select,textarea');
    controls.forEach(control => { control.disabled = true; });
    try {
      toast('Загружаем изображение…');
      const result = await upload(file);
      if (editor === original) { setPath(editor.value, path, result.url); editor.dirty = true; }
    } catch (e) {
      if (editor === original) editor.error = e.message;
    } finally {
      if (editor === original) {
        editor.saving = false;
        const scrollTop = modalRoot.querySelector('.drawer-body').scrollTop;
        drawDialog();
        modalRoot.querySelector('.drawer-body').scrollTop = scrollTop;
      }
    }
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && editor) closeEditor(); if (event.key === 'Enter' && event.target.matches('tr[data-action]')) { event.preventDefault(); void handleAction(event.target).catch(e => toast(e.message)); } if (event.key === 'Tab' && editor) { const nodes = [...modalRoot.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(n => n.offsetParent && !n.classList.contains('file-input')); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } });
window.addEventListener('beforeunload', event => { if (editor?.dirty || menuDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('admin:signed-out', () => { socket?.disconnect(); socket = null; connected = false; data = null; menuGeneration += 1; menuDraft = null; menuDirty = false; menuSaving = false; menuBaseSignature = ''; closeEditor(true); loginView(); });
window.addEventListener('hashchange', () => { const next = parseHash(); if (route === 'menu' && next.route === 'menu' && !next.restaurantId && menuRestaurantId) { history.replaceState(null, '', menuRouteHash()); return; } if (next.route !== route || (next.route === 'menu' && next.restaurantId !== menuRestaurantId)) void navigate(next.route, next.restaurantId); });
function connect() { socket?.disconnect(); if (!session() || !window.io) return; socket = window.io(new URL(API).origin, { auth: callback => callback({ token: session()?.accessToken }), transports: ['websocket'], reconnection: true, reconnectionDelay: 1500, reconnectionDelayMax: 10000 }); socket.on('session:ready', () => { connected = true; connectionStatus(); void load(true); }); socket.on('disconnect', reason => { connected = false; connectionStatus(); if(reason === 'io server disconnect' && session()) void reconnectAuthenticated(); }); socket.on('connect_error', () => { connected = false; connectionStatus(); }); socket.on('admin:changed', () => { clearTimeout(liveTimer); liveTimer = setTimeout(() => { void load(true); if (editor?.type === 'order') { const old = editor; void api(`/admin/orders/${old.value.kind}/${old.value.id}`).then(value => { if (editor === old) { editor.value = { ...value, kind: old.value.kind }; drawDialog(); } }).catch(() => {}); } if (editor?.type === 'application' && !editor.saving) { const old = editor; void api(`/admin/performer-applications/${encodeURIComponent(old.value.id)}`).then(value => { if (editor === old) { editor.value = value; drawDialog(); } }).catch(() => {}); } }, 300); }); socket.on('session:expired', () => { void reconnectAuthenticated(); }); }
async function reconnectAuthenticated() { if(refreshingSocket || !session()) return; refreshingSocket=true; try { await refresh(); if(session()) socket?.connect(); } catch { connected=false; connectionStatus(); } finally { refreshingSocket=false; } }
setInterval(() => { if (session() && document.visibilityState === 'visible') void load(true); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session()) { void load(true); if (!socket?.connected) socket?.connect(); } });
shell(); if (session()) { connect(); void load(); }
