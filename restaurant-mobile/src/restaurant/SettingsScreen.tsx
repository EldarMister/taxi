import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FoodPhoto } from '../food/FoodPhoto';
import { restaurantApi } from './api';
import { chooseRestaurantPhoto } from './photo';
import { restaurantDateInput, restaurantDateValue } from './editorState';
import { Button, Card, Empty, Field, Sheet, Toggle, c, s } from './ui';
import { Catalog, Membership, Profile, Promotion, StaffMember, can, entityId, money, permissions } from './types';

type Props = { catalog: Catalog; membership: Membership; profile: Profile; save: (catalog: Catalog, baseCatalog: Catalog) => Promise<void>; logout: () => void };
type Section = 'info' | 'delivery' | 'promotions' | 'staff' | null;
export function SettingsScreen({ catalog, membership, profile, save, logout }: Props) {
  const [section, setSection] = useState<Section>(null);
  const rows = [
    { id: 'info' as const, permission: 'restaurant.manage' as const, title: 'Информация о ресторане', subtitle: 'Название, адрес, фотографии и часы приёма', icon: 'storefront-outline' as const },
    { id: 'delivery' as const, permission: 'delivery.manage' as const, title: 'Условия доставки', subtitle: 'Стоимость, бесплатная доставка и сроки', icon: 'car-outline' as const },
    { id: 'promotions' as const, permission: 'promotions.manage' as const, title: 'Акции и скидки', subtitle: 'Скидки на блюда и условия заказа', icon: 'pricetag-outline' as const },
    { id: 'staff' as const, permission: 'staff.manage' as const, title: 'Сотрудники', subtitle: 'Менеджеры и права доступа', icon: 'people-outline' as const },
  ];
  return <>
    <Text style={s.title}>Настройки</Text><Card><View style={s.row}><View style={[s.emptyIcon, { width: 54, height: 54, borderRadius: 18 }]}><Ionicons name="person-outline" color={c.blue} size={25}/></View><View style={s.flex}><Text style={s.heading}>{profile.user.name || 'Мой аккаунт'}</Text><Text style={s.caption}>{membership.role === 'OWNER' ? 'Владелец' : 'Менеджер'} · {profile.user.phone}</Text></View></View></Card>
    {rows.filter(row => can(membership, row.permission)).map(row => <Pressable key={row.id} onPress={() => setSection(row.id)}><Card><View style={s.row}><Ionicons name={row.icon} size={24} color={c.blue}/><View style={s.flex}><Text style={s.body}>{row.title}</Text><Text style={s.caption}>{row.subtitle}</Text></View><Ionicons name="chevron-forward" color={c.muted} size={19}/></View></Card></Pressable>)}
    <Card><Text style={s.body}>{catalog.name}</Text><Text style={s.caption}>{catalog.isOpen === false ? 'Приём заказов приостановлен' : 'Принимает заказы'}</Text><Text style={s.caption}>Atlas Restaurant · 1.1.84</Text></Card>
    <Button title="Выйти из аккаунта" secondary onPress={() => Alert.alert('Выйти из аккаунта?', 'Для следующего входа понадобятся телефон и пароль.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Выйти', onPress: logout }])}/>
    {section === 'info' ? <InformationEditor catalog={catalog} save={save} onClose={() => setSection(null)}/> : null}
    {section === 'delivery' ? <DeliveryEditor catalog={catalog} save={save} onClose={() => setSection(null)}/> : null}
    {section === 'promotions' ? <PromotionsEditor catalog={catalog} save={save} onClose={() => setSection(null)}/> : null}
    {section === 'staff' ? <StaffEditor restaurantId={catalog.id} membership={membership} onClose={() => setSection(null)}/> : null}
  </>;
}

type EditorProps = { catalog: Catalog; save: (catalog: Catalog, baseCatalog: Catalog) => Promise<void>; onClose: () => void };
function InformationEditor({ catalog: sourceCatalog, save, onClose }: EditorProps) {
  const [catalog] = useState(sourceCatalog);
  const [draft, setDraft] = useState(catalog);
  const [latitude, setLatitude] = useState(catalog.latitude == null ? '' : String(catalog.latitude));
  const [longitude, setLongitude] = useState(catalog.longitude == null ? '' : String(catalog.longitude));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const change = <K extends keyof Catalog>(key: K, value: Catalog[K]) => setDraft(current => ({ ...current, [key]: value }));
  async function upload() { setUploading(true); setError(''); try { const url = await chooseRestaurantPhoto(catalog.id); if (url) setDraft(current => ({ ...current, imageUrl: url, heroImageUrl: url })); } catch (error) { setError((error as Error).message); } finally { setUploading(false); } }
  async function submit() {
    setBusy(true); setError('');
    try {
      if (!draft.name.trim() || !draft.address.trim()) throw new Error('Укажите название и адрес ресторана.');
      const next = { ...draft, categories: draft.categories.map(item => item.trim()).filter(Boolean) };
      if (latitude.trim() || longitude.trim()) {
        if (!latitude.trim() || !longitude.trim() || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) || Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180) throw new Error('Укажите корректные широту и долготу ресторана.');
        next.latitude = Number(latitude); next.longitude = Number(longitude);
      } else { delete next.latitude; delete next.longitude; }
      await save(next, catalog); onClose();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title="О ресторане" visible onClose={onClose}>
    <FoodPhoto imageKey={draft.imageKey} imageUrl={draft.imageUrl} style={{ width: '100%', height: 170, borderRadius: 23 }}/><Button title="Изменить фотографию" secondary busy={uploading} onPress={upload}/>
    <Field label="Название ресторана" value={draft.name} onChange={value => change('name', value)}/><Field label="Кухня" value={draft.cuisine} onChange={value => change('cuisine', value)} placeholder="Бургеры · Пицца"/>
    <Field label="Категории кухни через запятую" value={draft.categories.join(', ')} onChange={value => change('categories', value.split(',').map(item => item.trim()))}/>
    <Field label="Адрес ресторана" value={draft.address} onChange={value => change('address', value)}/><Field label="Телефон ресторана" value={draft.phone || ''} onChange={value => change('phone', value || null)}/>
    <Toggle title="Принимать заказы" subtitle="Когда выключено, клиент увидит «Сейчас закрыто»" value={draft.isOpen !== false} onChange={value => change('isOpen', value)}/>
    <Text style={s.heading}>Точка выдачи заказа</Text><Text style={s.caption}>Эти координаты нужны водителю Atlas, чтобы забрать заказ. Можно скопировать их из карты.</Text>
    <Field label="Широта ресторана" value={latitude} onChange={setLatitude} numeric placeholder="42.87"/><Field label="Долгота ресторана" value={longitude} onChange={setLongitude} numeric placeholder="74.60"/>
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Сохранить изменения" busy={busy} disabled={uploading} onPress={submit}/>
  </Sheet>;
}

function DeliveryEditor({ catalog: sourceCatalog, save, onClose }: EditorProps) {
  const [catalog] = useState(sourceCatalog);
  const [fee, setFee] = useState(String(catalog.deliveryFee));
  const [free, setFree] = useState((catalog.freeDeliveryThreshold || 0) > 0);
  const [threshold, setThreshold] = useState(String(catalog.freeDeliveryThreshold || 500));
  const [minimum, setMinimum] = useState(String(catalog.minimumOrder));
  const [etaMin, setEtaMin] = useState(String(catalog.etaMin));
  const [etaMax, setEtaMax] = useState(String(catalog.etaMax));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try {
      if ([fee, minimum, etaMin, etaMax, ...(free ? [threshold] : [])].some(value => !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) || Number(etaMax) < Number(etaMin)) throw new Error('Проверьте стоимость и время доставки.');
      if (free && Number(threshold) <= 0) throw new Error('Укажите сумму, с которой доставка станет бесплатной.');
      const next = { ...catalog, deliveryFee: Number(fee), minimumOrder: Number(minimum), etaMin: Number(etaMin), etaMax: Number(etaMax) };
      if (free) next.freeDeliveryThreshold = Number(threshold); else delete next.freeDeliveryThreshold;
      await save(next, catalog); onClose();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title="Условия доставки" visible onClose={onClose}>
    <Card><Ionicons name="car-outline" size={32} color={c.blue}/><Text style={s.heading}>Стоимость для клиента</Text><Text style={s.caption}>Нулевая стоимость означает бесплатную доставку любого заказа.</Text></Card>
    <Field label="Стоимость доставки, сом" value={fee} onChange={setFee} numeric/>
    <Toggle title="Бесплатно от суммы заказа" value={free} onChange={setFree}/>{free ? <Field label="Бесплатная доставка от, сом" value={threshold} onChange={setThreshold} numeric/> : null}
    <Field label="Минимальная сумма заказа, сом" value={minimum} onChange={setMinimum} numeric/>
    <View style={s.row}><View style={s.flex}><Field label="От, минут" value={etaMin} onChange={setEtaMin} numeric/></View><View style={s.flex}><Field label="До, минут" value={etaMax} onChange={setEtaMax} numeric/></View></View>
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Сохранить условия" busy={busy} onPress={submit}/>
  </Sheet>;
}

function PromotionsEditor({ catalog, save, onClose }: EditorProps) {
  const [editing, setEditing] = useState<Promotion | null>(null);
  return <Sheet title="Акции и скидки" visible onClose={onClose}>
    <Button title="Создать акцию" onPress={() => setEditing({ id: entityId('promo'), title: '', type: 'PERCENT', value: 10, minSubtotal: 0, dishIds: [], active: true })}/>
    {catalog.promotions?.length ? catalog.promotions.map(promotion => <Pressable key={promotion.id} onPress={() => setEditing(promotion)}><Card><Text style={s.heading}>{promotion.title}</Text><Text style={[s.body, { color: c.blue }]}>{promotion.type === 'FREE_DELIVERY' ? 'Бесплатная доставка' : promotion.type === 'PERCENT' ? `Скидка ${promotion.value}%` : `Скидка ${money(promotion.value)}`}</Text><Text style={s.caption}>{promotion.active ? 'Включена' : 'Выключена'} · {promotion.minSubtotal ? `от ${money(promotion.minSubtotal)}` : 'Без минимальной суммы'}</Text><Text style={s.caption}>{promotion.dishIds.length ? `${promotion.dishIds.length} выбранных блюд` : 'Все блюда'}</Text></Card></Pressable>) : <Empty icon="pricetag-outline" title="Акций пока нет" body="Создайте скидку на блюда или бесплатную доставку от суммы заказа."/>}
    {editing ? <PromotionEditor initial={editing} catalog={catalog} save={save} onClose={() => setEditing(null)}/> : null}
  </Sheet>;
}
function PromotionEditor({ catalog: sourceCatalog, initial, save, onClose }: EditorProps & { initial: Promotion }) {
  const [catalog] = useState(sourceCatalog);
  const [promotion, setPromotion] = useState(initial);
  const [value, setValue] = useState(String(initial.value));
  const [minimum, setMinimum] = useState(String(initial.minSubtotal));
  const [starts, setStarts] = useState(restaurantDateInput(initial.startsAt));
  const [ends, setEnds] = useState(restaurantDateInput(initial.endsAt));
  const [chooseDishes, setChooseDishes] = useState(initial.dishIds.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(remove = false) {
    setBusy(true); setError('');
    try {
      const next = { ...promotion, value: promotion.type === 'FREE_DELIVERY' ? 0 : Number(value), minSubtotal: Number(minimum), dishIds: chooseDishes && promotion.type !== 'FREE_DELIVERY' ? promotion.dishIds : [] };
      if (!remove && (!next.title.trim() || !Number.isFinite(next.value) || next.value < 0 || !Number.isFinite(next.minSubtotal) || next.minSubtotal < 0 || next.type === 'PERCENT' && next.value > 100)) throw new Error('Укажите название и корректную скидку.');
      if (starts.trim()) next.startsAt = restaurantDateValue(starts.trim()); else delete next.startsAt;
      if (ends.trim()) next.endsAt = restaurantDateValue(ends.trim(), true); else delete next.endsAt;
      if (next.startsAt && next.endsAt && next.endsAt < next.startsAt) throw new Error('Окончание акции не может быть раньше начала.');
      const existing = catalog.promotions || [];
      await save({ ...catalog, promotions: remove ? existing.filter(item => item.id !== next.id) : existing.some(item => item.id === next.id) ? existing.map(item => item.id === next.id ? next : item) : [...existing, next] }, catalog); onClose();
    } catch (error) { setError(error instanceof RangeError ? 'Введите дату в формате ГГГГ-ММ-ДД.' : (error as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title="Настройка акции" visible onClose={onClose}>
    <Field label="Название акции" value={promotion.title} onChange={title => setPromotion({ ...promotion, title })}/>
    <View style={s.chips}>{([['PERCENT', 'Процент'], ['FIXED', 'Сумма'], ['FREE_DELIVERY', 'Доставка']] as const).map(([type, title]) => <Pressable key={type} onPress={() => setPromotion({ ...promotion, type })} style={[s.chip, promotion.type === type && { backgroundColor: c.blue }]}><Text style={[s.label, promotion.type === type && { color: 'white' }]}>{title}</Text></Pressable>)}</View>
    {promotion.type !== 'FREE_DELIVERY' ? <Field label={promotion.type === 'PERCENT' ? 'Размер скидки, %' : 'Размер скидки, сом'} value={value} onChange={setValue} numeric/> : null}
    <Field label="Минимальная сумма заказа, сом" value={minimum} onChange={setMinimum} numeric/>
    <Toggle title="Акция включена" value={promotion.active} onChange={active => setPromotion({ ...promotion, active })}/>
    <Field label="Начало (ГГГГ-ММ-ДД, необязательно)" value={starts} onChange={setStarts} placeholder="2026-10-04"/><Field label="Окончание (ГГГГ-ММ-ДД, необязательно)" value={ends} onChange={setEnds}/>
    {promotion.type !== 'FREE_DELIVERY' ? <><Toggle title="Только выбранные блюда" value={chooseDishes} onChange={setChooseDishes}/>{chooseDishes ? catalog.dishes.map(dish => <Toggle key={dish.id} title={dish.name} value={promotion.dishIds.includes(dish.id)} onChange={checked => setPromotion({ ...promotion, dishIds: checked ? [...promotion.dishIds, dish.id] : promotion.dishIds.filter(id => id !== dish.id) })}/>) : null}</> : null}
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Сохранить акцию" busy={busy} onPress={() => submit()}/>
    {catalog.promotions?.some(item => item.id === initial.id) ? <Button title="Удалить акцию" danger disabled={busy} onPress={() => Alert.alert('Удалить акцию?', 'Скидка перестанет действовать на новые заказы.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => submit(true) }])}/> : null}
  </Sheet>;
}

function StaffEditor({ restaurantId, membership, onClose }: { restaurantId: string; membership: Membership; onClose: () => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<StaffMember | null>(null);
  async function reload() { try { setStaff((await restaurantApi.request<{ staff: StaffMember[] }>(`/${restaurantId}/staff`)).staff); setError(''); } catch (error) { setError((error as Error).message); } finally { setLoading(false); } }
  useEffect(() => { void reload(); }, [restaurantId]);
  return <Sheet title="Сотрудники" visible onClose={onClose}>
    <Button title="Добавить менеджера" onPress={() => setEditing({ id: '', name: '', phone: '+996', role: 'MANAGER', permissions: ['orders.read', 'orders.manage'], active: true })}/>
    <Text style={s.caption}>По умолчанию менеджер работает только с заказами. Владелец выбирает дополнительные права.</Text>
    {error ? <><Text style={s.error}>{error}</Text><Button title="Повторить" secondary onPress={reload}/></> : null}
    {loading ? <Text style={s.caption}>Загружаем сотрудников…</Text> : staff.map(person => <Pressable key={person.id} disabled={person.role === 'OWNER'} onPress={() => setEditing(person)}><Card><View style={s.row}><Ionicons name={person.role === 'OWNER' ? 'shield-checkmark-outline' : 'person-outline'} size={24} color={c.blue}/><View style={s.flex}><Text style={s.body}>{person.name}</Text><Text style={s.caption}>{person.phone} · {person.role === 'OWNER' ? 'Владелец' : 'Менеджер'}</Text><Text style={[s.caption, !person.active && { color: c.danger }]}>{person.active ? 'Доступ открыт' : 'Доступ закрыт'}</Text></View>{person.role !== 'OWNER' ? <Ionicons name="chevron-forward" size={19} color={c.muted}/> : null}</View></Card></Pressable>)}
    {editing ? <StaffForm initial={editing} restaurantId={restaurantId} membership={membership} onClose={() => setEditing(null)} onSaved={async () => { await reload(); setEditing(null); }}/> : null}
  </Sheet>;
}
function StaffForm({ initial, restaurantId, membership, onClose, onSaved }: { initial: StaffMember; restaurantId: string; membership: Membership; onClose: () => void; onSaved: () => Promise<void> }) {
  const [person, setPerson] = useState(initial);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(disable = false) {
    setBusy(true); setError('');
    try {
      if (!disable && (!person.name.trim() || !person.phone.trim() || (!initial.id || password) && password.length < 12)) throw new Error('Укажите имя, телефон и пароль не короче 12 символов.');
      await restaurantApi.request(`/${restaurantId}/staff${initial.id ? `/${initial.id}` : ''}`, disable ? 'DELETE' : initial.id ? 'PATCH' : 'POST', disable ? undefined : { ...(!initial.id || person.name !== initial.name ? { name: person.name.trim() } : {}), ...(!initial.id || person.phone !== initial.phone ? { phone: person.phone } : {}), ...(password ? { password } : {}), permissions: person.permissions, active: person.active });
      await onSaved();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title={initial.id ? 'Доступ менеджера' : 'Новый менеджер'} visible onClose={onClose}>
    <Field label="Имя менеджера" value={person.name} onChange={name => setPerson({ ...person, name })}/><Field label="Телефон" value={person.phone} onChange={phone => setPerson({ ...person, phone })}/><Field label={initial.id ? 'Новый пароль (необязательно)' : 'Пароль'} value={password} onChange={setPassword} secure placeholder="Не менее 12 символов"/>
    <Toggle title="Доступ в приложение" value={person.active} onChange={active => setPerson({ ...person, active })}/><Text style={s.heading}>Права доступа</Text>
    {permissions.filter(([permission]) => can(membership, permission)).map(([permission, title]) => <Toggle key={permission} title={title} value={person.permissions.includes(permission)} onChange={checked => {
      let next = checked ? Array.from(new Set([...person.permissions, permission])) : person.permissions.filter(value => value !== permission);
      if (permission === 'orders.manage' && checked) next = Array.from(new Set([...next, 'orders.read']));
      if (permission === 'orders.read' && !checked) next = next.filter(value => value !== 'orders.manage');
      setPerson({ ...person, permissions: next });
    }}/>)}
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Сохранить сотрудника" busy={busy} onPress={() => submit()}/>
    {initial.id ? <Button title="Закрыть доступ менеджеру" danger disabled={busy} onPress={() => Alert.alert('Закрыть доступ?', 'Менеджер больше не сможет работать с этим рестораном.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Закрыть доступ', style: 'destructive', onPress: () => submit(true) }])}/> : null}
  </Sheet>;
}
