import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { FoodDish, FoodOption, RestaurantCatalog, RestaurantDetail } from '../../domain/types';
import { ApiError } from '../../data/api';
import { buildDish, createDishDraft, type DishDraft } from './model';
import { MediaField } from './MediaField';
import { ModifiersEditor } from './ModifiersEditor';
import { DishPreview } from './DishPreview';
import { Action, Input, Message, Panel, Pill, T, Toggle, u } from './ui';

export function DishEditor({ restaurantId, detail, previewCatalog, dish, onSave, onClose, onReload, onDelete }: {
  restaurantId: string; detail: RestaurantDetail; previewCatalog: RestaurantCatalog; dish?: FoodDish;
  onSave: (draft: DishDraft) => Promise<void>; onClose: () => void; onReload: () => Promise<void>; onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => createDishDraft(detail.catalog, dish));
  const original = useRef(JSON.stringify(draft)), lock = useRef(false);
  const [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const [preview, setPreview] = useState<{ dish: FoodDish; options: FoodOption[] }>();
  const [tab, setTab] = useState<'basic' | 'details' | 'modifiers'>('basic');
  const change = (patch: Partial<DishDraft>) => setDraft(current => ({ ...current, ...patch }));
  const close = () => { if (busy || photoBusy) return; if (JSON.stringify(draft) !== original.current) setConfirm('discard'); else onClose(); };
  async function save() {
    if (lock.current || photoBusy) return;
    lock.current = true; setBusy(true); setError(''); setConflict(false);
    try { await onSave(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить блюдо.'); setConflict(cause instanceof ApiError && cause.status === 409); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove() {
    if (!onDelete || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await onDelete(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить блюдо.'); setConfirm(null); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await onReload(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось обновить меню.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <Panel title={dish ? 'Редактор блюда' : 'Новое блюдо'} visible onClose={close} busy={busy || photoBusy} footer={<>
      {!!error && <Message text={error}/>}
      {conflict && <Action label="Отменить изменения и обновить меню" secondary onPress={() => void reload()} busy={busy}/>}
      <Action label={dish ? 'Сохранить изменения' : 'Добавить в меню'} icon="checkmark" onPress={() => void save()} busy={busy} disabled={photoBusy || conflict}/>
    </>}>
      <View pointerEvents={busy || photoBusy ? 'none' : 'auto'} style={{ gap: 20 }}>
        <View style={u.wrap}><Pill label="Основное" selected={tab === 'basic'} onPress={() => setTab('basic')}/><Pill label="Состав и БЖУ" selected={tab === 'details'} onPress={() => setTab('details')}/><Pill label="Модификаторы" selected={tab === 'modifiers'} onPress={() => setTab('modifiers')}/></View>
        {tab === 'basic' && <>
          <MediaField restaurantId={restaurantId} value={draft.imageUrl} imageKey={dish?.imageKey} onChange={imageUrl => change({ imageUrl })} label="Фото в меню" onBusyChange={setPhotoBusy}/>
          <Input label="Название блюда" placeholder="Например, Манты с говядиной" value={draft.name} onChangeText={name => change({ name })} maxLength={150}/>
          <View style={u.row}><Input label="Цена, сом" keyboardType="number-pad" value={draft.price} onChangeText={price => change({ price })}/><Input label="Вес, г" keyboardType="number-pad" value={draft.weightGrams} onChangeText={weightGrams => change({ weightGrams })}/></View>
          <Input label="Размер порции" placeholder="5 шт. / 1 порция / 400 мл" value={draft.portion} onChangeText={portion => change({ portion })} maxLength={100}/>
          <View style={{ gap: 8 }}><T muted style={u.label}>Категория</T><View style={u.wrap}>{detail.catalog.menuCategories.map(category => <Pill key={category} label={category} selected={category === draft.category} onPress={() => change({ category })}/>)}</View></View>
          <Input label="Описание" placeholder="Расскажите о вкусе и приготовлении" value={draft.description} multiline maxLength={3000} onChangeText={description => change({ description })}/>
          <Toggle label="Доступно для заказа" hint="Выключите, если блюдо временно закончилось" value={draft.available} onChange={available => change({ available })}/>
          <MediaField restaurantId={restaurantId} value={draft.heroImageUrl} imageKey={dish?.heroImageKey || dish?.imageKey} onChange={heroImageUrl => change({ heroImageUrl })} label="Фото на странице блюда (необязательно)" aspect={4 / 3} onBusyChange={setPhotoBusy}/>
          <Input label="Короткая подпись (необязательно)" placeholder="Например, Хит" value={draft.badge} onChangeText={badge => change({ badge })} maxLength={60}/>
          <Input label="Старая цена, сом (необязательно)" keyboardType="number-pad" placeholder="Для отображения зачёркнутой цены" value={draft.originalPrice} onChangeText={originalPrice => change({ originalPrice })}/>
        </>}
        {tab === 'details' && <>
          <Input label="Состав" multiline placeholder="Ингредиенты блюда" value={draft.ingredients} maxLength={3000} onChangeText={ingredients => change({ ingredients })}/>
          <Input label="Калорийность порции, ккал" keyboardType="number-pad" value={draft.calories} onChangeText={calories => change({ calories })}/>
          <Toggle label="Пищевая ценность на 100 г" value={draft.nutrition} onChange={nutrition => change({ nutrition })}/>
          {draft.nutrition && <><View style={u.row}><Input label="Калории, ккал" keyboardType="decimal-pad" value={draft.nutritionCalories} onChangeText={nutritionCalories => change({ nutritionCalories })}/><Input label="Белки, г" keyboardType="decimal-pad" value={draft.protein} onChangeText={protein => change({ protein })}/></View><View style={u.row}><Input label="Жиры, г" keyboardType="decimal-pad" value={draft.fat} onChangeText={fat => change({ fat })}/><Input label="Углеводы, г" keyboardType="decimal-pad" value={draft.carbohydrates} onChangeText={carbohydrates => change({ carbohydrates })}/></View><Toggle label="Приблизительные значения" value={draft.estimated} onChange={estimated => change({ estimated })}/></>}
        </>}
        {tab === 'modifiers' && <ModifiersEditor groups={draft.groups} options={detail.catalog.options} onChange={groups => change({ groups })}/>}
        <Action label="Как видит клиент" secondary icon="eye-outline" onPress={() => { try { setPreview(buildDish(draft, detail.catalog)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Заполните данные блюда.'); } }}/>
        {!!onDelete && <Action label="Удалить блюдо" danger icon="trash-outline" onPress={() => setConfirm('delete')}/>}
      </View>
    </Panel>
    {preview && <DishPreview dish={preview.dish} options={preview.options} catalog={previewCatalog} onClose={() => setPreview(undefined)}/>}
    {!!confirm && <Panel title={confirm === 'delete' ? 'Удалить блюдо?' : 'Выйти из редактора?'} visible onClose={() => setConfirm(null)} busy={busy}>
      <T muted>{confirm === 'delete' ? 'Блюдо исчезнет из меню клиентов. Ранее оформленные заказы сохранятся.' : 'Несохранённые изменения будут потеряны.'}</T>
      <Action label={confirm === 'delete' ? 'Удалить блюдо' : 'Выйти без сохранения'} danger onPress={() => confirm === 'delete' ? void remove() : onClose()} busy={busy}/><Action label="Вернуться к редактированию" secondary onPress={() => setConfirm(null)} disabled={busy}/>
    </Panel>}
  </>;
}
