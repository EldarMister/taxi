import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FoodPhoto } from '../food/FoodPhoto';
import type { FoodOptionGroup } from '../food/types';
import { chooseRestaurantPhoto } from './photo';
import { Button, Card, Empty, Field, Sheet, Toggle, c, s } from './ui';
import { Catalog, FoodDish, FoodOption, entityId, money } from './types';

type Props = { catalog: Catalog; save: (catalog: Catalog, baseCatalog: Catalog) => Promise<void> };
export function MenuScreen({ catalog, save }: Props) {
  const [category, setCategory] = useState('Все');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FoodDish | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const filtered = catalog.dishes.filter(dish => (category === 'Все' || dish.category === category) && dish.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const addDish = () => setEditing({ id: entityId('dish'), name: '', description: '', category: category !== 'Все' ? category : catalog.menuCategories[0] || 'Основное меню', portion: '1 порция', weightGrams: 0, price: 0, imageKey: '', available: true, optionIds: [], optionGroups: [], defaultOptionIds: [] });
  return <>
    <View style={s.row}><View style={s.flex}><Text style={s.title}>Меню</Text><Text style={s.caption}>{catalog.dishes.length} блюд · {catalog.menuCategories.length} категорий</Text></View><Pressable accessibilityLabel="Добавить блюдо" onPress={addDish} style={[s.iconButton, { backgroundColor: c.blue }]}><Ionicons name="add" size={27} color="white"/></Pressable></View>
    <Field label="Поиск блюда" value={search} onChange={setSearch} placeholder="Название блюда"/>
    <View style={s.chips}>{['Все', ...catalog.menuCategories].map(item => <Pressable key={item} onPress={() => setCategory(item)} style={[s.chip, category === item && { backgroundColor: c.blue }]}><Text style={[s.label, category === item && { color: 'white' }]}>{item}</Text></Pressable>)}</View>
    <Button title="Управлять категориями" secondary onPress={() => setCategoriesOpen(true)}/>
    {!filtered.length ? <Empty title="Здесь пока нет блюд" body="Добавьте первое блюдо или выберите другую категорию."/> : filtered.map(dish => <Pressable key={dish.id} onPress={() => setEditing(dish)}><Card><View style={s.row}><FoodPhoto imageKey={dish.imageKey} imageUrl={dish.imageUrl} style={{ width: 75, height: 75, borderRadius: 18 }}/><View style={s.flex}><Text style={s.body}>{dish.name}</Text><Text style={s.caption}>{dish.category} · {dish.portion}</Text><Text style={[s.body, { color: c.blue, marginTop: 5 }]}>{money(dish.price)}</Text></View><Ionicons name="chevron-forward" size={19} color={c.muted}/></View>{!dish.available ? <Text style={[s.caption, { color: c.danger }]}>В стоп-листе</Text> : null}</Card></Pressable>)}
    {editing ? <DishEditor catalog={catalog} initial={editing} onClose={() => setEditing(null)} save={save}/> : null}
    {categoriesOpen ? <CategoryEditor catalog={catalog} save={save} onClose={() => setCategoriesOpen(false)}/> : null}
  </>;
}

function CategoryEditor({ catalog: sourceCatalog, save, onClose }: Props & { onClose: () => void }) {
  const [catalog] = useState(sourceCatalog);
  const [names, setNames] = useState(catalog.menuCategories);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try {
      const finalNames = names.map(name => (renames[name] ?? name).trim());
      if (finalNames.some(name => !name) || new Set(finalNames).size !== finalNames.length) throw new Error('Названия категорий должны быть заполнены и отличаться.');
      await save({ ...catalog, menuCategories: finalNames, dishes: catalog.dishes.map(dish => ({ ...dish, category: renames[dish.category]?.trim() || dish.category })) }, catalog); onClose();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title="Категории меню" visible onClose={onClose}>
    <Text style={s.caption}>Порядок категорий определяет порядок разделов в приложении клиента.</Text>
    {names.map((name, index) => <Card key={name}><Field label={`Категория ${index + 1}`} value={renames[name] ?? name} onChange={value => setRenames({ ...renames, [name]: value })}/><View style={s.row}><View style={s.flex}><Button title="Выше" secondary disabled={index === 0} onPress={() => { const next = [...names]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setNames(next); }}/></View><View style={s.flex}><Button title="Удалить" danger onPress={() => { if (catalog.dishes.some(dish => dish.category === name)) return Alert.alert('В категории есть блюда', 'Сначала перенесите блюда в другую категорию.'); setNames(names.filter(item => item !== name)); }}/></View></View></Card>)}
    <Field label="Новая категория" value={newName} onChange={setNewName}/><Button title="Добавить категорию" secondary disabled={!newName.trim() || names.includes(newName.trim())} onPress={() => { setNames([...names, newName.trim()]); setNewName(''); }}/>
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Сохранить порядок и названия" busy={busy} onPress={submit}/>
  </Sheet>;
}

function DishEditor({ catalog: sourceCatalog, initial, save, onClose }: Props & { initial: FoodDish; onClose: () => void }) {
  const [catalog] = useState(sourceCatalog);
  const [dish, setDish] = useState(initial);
  const [price, setPrice] = useState(String(initial.price));
  const [weight, setWeight] = useState(String(initial.weightGrams));
  const [originalPrice, setOriginalPrice] = useState(initial.originalPrice ? String(initial.originalPrice) : '');
  const [options, setOptions] = useState(catalog.options);
  const [groups, setGroups] = useState<FoodOptionGroup[]>(() => {
    const present = initial.optionGroups || [];
    const loose = initial.optionIds.filter(id => !present.some(group => group.optionIds.includes(id)));
    return [...present, ...(loose.length ? [{ id: entityId('extras'), name: 'Добавки', optionIds: loose, minSelected: 0, maxSelected: loose.length }] : [])];
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const patch = <K extends keyof FoodDish>(key: K, value: FoodDish[K]) => setDish(current => ({ ...current, [key]: value }));
  const updateGroup = (index: number, update: Partial<FoodOptionGroup>) => setGroups(current => current.map((group, i) => i === index ? { ...group, ...update } : group));
  const updateOption = (id: string, update: Partial<FoodOption>) => setOptions(current => current.map(option => option.id === id ? { ...option, ...update } : option));
  const optionCount = groups.reduce((sum, group) => sum + group.optionIds.length, 0);
  async function submit(remove = false) {
    setError(''); setBusy(true);
    try {
      if (remove && catalog.promotions?.some(promotion => promotion.dishIds.includes(dish.id))) throw new Error('Блюдо участвует в акции. Сначала уберите его из акции в разделе «Акции и скидки». Если этот раздел недоступен, обратитесь к владельцу.');
      if (!remove && (!dish.name.trim() || !dish.category.trim() || !Number.isFinite(Number(price)) || Number(price) < 0)) throw new Error('Укажите название, категорию и корректную цену.');
      const optionIds = groups.flatMap(group => group.optionIds);
      const nextOptions = options.filter(option => catalog.options.some(existing => existing.id === option.id) || optionIds.includes(option.id));
      if (!remove && (groups.some(group => !group.name.trim() || !group.optionIds.length) || nextOptions.some(option => !option.name.trim() || option.price < 0 || !Number.isFinite(option.price)))) throw new Error('Заполните названия и варианты модификаторов.');
      const normalizedGroups = groups.map(group => ({ ...group, minSelected: Math.min(group.minSelected || 0, group.optionIds.length), maxSelected: Math.min(group.maxSelected || 1, group.optionIds.length) }));
      const defaults = normalizedGroups.flatMap(group => group.optionIds.filter(id => dish.defaultOptionIds?.includes(id)).slice(0, group.maxSelected));
      const nextDish: FoodDish = { ...dish, name: dish.name.trim(), price: Number(price), weightGrams: Number(weight) || 0, optionIds, optionGroups: normalizedGroups, defaultOptionIds: defaults };
      if (originalPrice.trim()) nextDish.originalPrice = Number(originalPrice); else delete nextDish.originalPrice;
      const existing = catalog.dishes.some(item => item.id === dish.id);
      const dishes = remove ? catalog.dishes.filter(item => item.id !== dish.id) : existing ? catalog.dishes.map(item => item.id === dish.id ? nextDish : item) : [...catalog.dishes, nextDish];
      await save({ ...catalog, dishes, options: remove ? catalog.options : nextOptions, menuCategories: Array.from(new Set([...catalog.menuCategories, ...dishes.map(item => item.category)])) }, catalog); onClose();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function upload() { setUploading(true); setError(''); try { const url = await chooseRestaurantPhoto(catalog.id); if (url) patch('imageUrl', url); } catch (error) { setError((error as Error).message); } finally { setUploading(false); } }
  return <Sheet title={catalog.dishes.some(item => item.id === initial.id) ? 'Редактировать блюдо' : 'Новое блюдо'} visible onClose={onClose}>
    <FoodPhoto imageKey={dish.imageKey} imageUrl={dish.imageUrl} style={{ width: '100%', height: 190, borderRadius: 23 }}/>
    <Button title="Выбрать фото из галереи" secondary busy={uploading} onPress={upload}/>
    <Field label="Название блюда" value={dish.name} onChange={value => patch('name', value)}/>
    <Field label="Описание и состав" value={dish.description} onChange={value => patch('description', value)} multiline/>
    <Field label="Категория" value={dish.category} onChange={value => patch('category', value)}/>
    <View style={s.chips}>{catalog.menuCategories.map(name => <Pressable key={name} onPress={() => patch('category', name)} style={[s.chip, dish.category === name && { backgroundColor: c.soft }]}><Text style={s.label}>{name}</Text></Pressable>)}</View>
    <View style={s.row}><View style={s.flex}><Field label="Цена, сом" value={price} onChange={setPrice} numeric/></View><View style={s.flex}><Field label="Старая цена, сом" value={originalPrice} onChange={setOriginalPrice} numeric placeholder="Без скидки"/></View></View>
    <View style={s.row}><View style={s.flex}><Field label="Порция / объём" value={dish.portion} onChange={value => patch('portion', value)} placeholder="300 мл / 8 шт."/></View><View style={s.flex}><Field label="Вес, г" value={weight} onChange={setWeight} numeric/></View></View>
    <Toggle title="Доступно для заказа" subtitle="Выключите, чтобы добавить блюдо в стоп-лист" value={dish.available} onChange={value => patch('available', value)}/>
    <Text style={s.heading}>Размеры и добавки</Text><Text style={s.caption}>Обязательная группа попросит клиента выбрать вариант. Доплата прибавляется к цене блюда. У общих добавок цена меняется во всех блюдах.</Text>
    {groups.map((group, index) => <Card key={group.id}>
      <Field label="Название группы" value={group.name} onChange={value => updateGroup(index, { name: value })} placeholder="Размер, объём, соусы"/>
      <Toggle title="Обязательный выбор" value={(group.minSelected || 0) > 0} onChange={value => updateGroup(index, { minSelected: value ? 1 : 0 })}/>
      <Toggle title="Можно выбрать несколько" value={(group.maxSelected || 1) > 1} onChange={value => updateGroup(index, { maxSelected: value ? Math.max(2, group.optionIds.length) : 1 })}/>
      {group.optionIds.map(id => { const option = options.find(item => item.id === id); if (!option) return null; return <View key={id} style={{ paddingVertical: 9, borderTopWidth: 1, borderColor: c.line, gap: 8 }}>
        <Field label="Вариант" value={option.name} onChange={value => updateOption(id, { name: value })}/>
        <View style={s.row}><View style={s.flex}><Field label="Доплата, сом" value={String(option.price)} onChange={value => updateOption(id, { price: Number(value) || 0 })} numeric/></View><Pressable accessibilityLabel={`Удалить ${option.name}`} onPress={() => updateGroup(index, { optionIds: group.optionIds.filter(item => item !== id) })} style={s.iconButton}><Ionicons name="trash-outline" size={20} color={c.danger}/></Pressable></View>
        <Toggle title="Выбрано по умолчанию" value={dish.defaultOptionIds?.includes(id) || false} onChange={value => {
          const previous = dish.defaultOptionIds || [];
          patch('defaultOptionIds', value ? [...previous.filter(item => (group.maxSelected || 1) > 1 || !group.optionIds.includes(item)), id] : previous.filter(item => item !== id));
        }}/>
        <Toggle title="Считать доплату один раз" subtitle="Независимо от количества порций в позиции" value={option.priceScope === 'PER_ITEM'} onChange={value => updateOption(id, { priceScope: value ? 'PER_ITEM' : 'PER_PORTION' })}/>
      </View>; })}
      <Button title="Добавить вариант" secondary disabled={optionCount >= 10} onPress={() => { const id = entityId('option'); setOptions([...options, { id, name: '', price: 0, imageKey: '' }]); updateGroup(index, { optionIds: [...group.optionIds, id], maxSelected: (group.maxSelected || 1) > 1 ? Math.max(group.maxSelected || 1, group.optionIds.length + 1) : 1 }); }}/>
      <Button title="Удалить группу" danger onPress={() => setGroups(groups.filter((_, i) => i !== index))}/>
    </Card>)}
    <Button title="Добавить группу модификаторов" secondary disabled={optionCount >= 10} onPress={() => setGroups([...groups, { id: entityId('group'), name: '', optionIds: [], minSelected: 0, maxSelected: 1 }])}/>
    <Text style={s.caption}>{optionCount} из 10 вариантов для блюда</Text>
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Сохранить блюдо" busy={busy} disabled={uploading} onPress={() => submit()}/>
    {catalog.dishes.some(item => item.id === initial.id) ? <Button title="Удалить блюдо" danger disabled={busy} onPress={() => Alert.alert('Удалить блюдо?', 'Его больше нельзя будет добавить в новый заказ.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => submit(true) }])}/> : null}
  </Sheet>;
}
