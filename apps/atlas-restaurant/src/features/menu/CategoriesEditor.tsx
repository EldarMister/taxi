import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { RestaurantCatalog } from '../../domain/types';
import { deleteCategory, renameCategory } from './model';
import { Action, IconAction, Input, Message, Panel, T, u } from './ui';

export function CategoriesEditor({ catalog, onSave, onClose, onReload }: { catalog: RestaurantCatalog; onSave: (catalog: RestaurantCatalog) => Promise<void>; onClose: () => void; onReload: () => Promise<void> }) {
  const [draft, setDraft] = useState(catalog), [editing, setEditing] = useState<string | null | undefined>(), [name, setName] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false), [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const used = new Set(draft.dishes.flatMap(dish => dish.optionIds)), unused = draft.options.filter(option => !used.has(option.id));
  const dirty = JSON.stringify(catalog) !== JSON.stringify(draft);
  function close() { if (busy) return; if (dirty || editing !== undefined && name.trim()) setDiscard(true); else onClose(); }
  function rename() { try { setDraft(renameCategory(draft, editing ?? null, name)); setEditing(undefined); setName(''); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Проверьте название.'); } }
  function move(index: number, delta: number) { const menuCategories = [...draft.menuCategories]; [menuCategories[index], menuCategories[index + delta]] = [menuCategories[index + delta], menuCategories[index]]; setDraft({ ...draft, menuCategories }); }
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await onSave(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить категории.'); setConflict(!!cause && typeof cause === 'object' && 'status' in cause && cause.status === 409); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <Panel title="Категории меню" visible onClose={close} busy={busy} footer={<>
      {!!error && <Message text={error}/>}
      {conflict && <Action label="Отменить изменения и обновить меню" secondary onPress={() => { void onReload().then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : 'Ошибка обновления.')); }}/>} 
      <Action label="Сохранить порядок и категории" onPress={() => void save()} busy={busy} disabled={!dirty || conflict || editing !== undefined}/>
    </>}>
      <T muted>Порядок категорий будет таким же в клиентском Atlas. Удалить можно только пустую категорию.</T>
      <View pointerEvents={busy ? 'none' : 'auto'} style={{ gap: 10 }}>
        {draft.menuCategories.map((category, index) => <View key={category} style={[u.card, { backgroundColor: '#F5F6F8', padding: 13, gap: 8 }]}>
          <View style={u.row}><View style={{ flex: 1 }}><T bold>{category}</T><T muted style={u.hint}>{draft.dishes.filter(dish => dish.category === category).length} блюд</T></View><IconAction icon="create-outline" label={`Переименовать ${category}`} onPress={() => { setEditing(category); setName(category); }}/><IconAction icon="trash-outline" label={`Удалить ${category}`} danger onPress={() => { try { setDraft(deleteCategory(draft, category)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Категория занята.'); } }}/></View>
          <View style={u.row}><IconAction icon="arrow-up" label={`Поднять ${category}`} disabled={index === 0 || editing !== undefined} onPress={() => move(index, -1)}/><IconAction icon="arrow-down" label={`Опустить ${category}`} disabled={index === draft.menuCategories.length - 1 || editing !== undefined} onPress={() => move(index, 1)}/><T muted style={{ fontSize: 12 }}>Позиция {index + 1}</T></View>
        </View>)}
        {editing !== undefined ? <View style={[u.card, { borderWidth: 1, borderColor: '#E2EBF7' }]}><Input label={editing === null ? 'Новая категория' : 'Новое название'} value={name} onChangeText={setName} maxLength={100} autoFocus/><Action label={editing === null ? 'Добавить категорию' : 'Применить название'} onPress={rename}/><Action label="Отменить" secondary onPress={() => { setEditing(undefined); setName(''); }}/></View> : <Action label="Добавить категорию" icon="add" secondary onPress={() => { setEditing(null); setName(''); }} disabled={draft.menuCategories.length >= 40}/>}
        {unused.length > 0 && <View style={{ gap: 9, marginTop: 12 }}><T muted style={u.hint}>В меню {unused.length} дополнений, которые не используются ни в одном блюде.</T><Action label={`Убрать неиспользуемые дополнения (${unused.length})`} secondary small onPress={() => setDraft({ ...draft, options: draft.options.filter(option => used.has(option.id)) })}/></View>}
      </View>
    </Panel>
    {discard && <Panel title="Выйти без сохранения?" visible onClose={() => setDiscard(false)}><T muted>Изменения категорий не будут опубликованы.</T><Action label="Выйти без сохранения" danger onPress={onClose}/><Action label="Вернуться" secondary onPress={() => setDiscard(false)}/></Panel>}
  </>;
}
