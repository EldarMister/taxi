import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../data/api';
import { can, type FoodDish, type Membership, type RestaurantCatalog, type RestaurantDetail } from '../../domain/types';
import { Empty, Photo, Switch, useReducedMotion } from '../../ui';
import { CategoriesEditor } from './CategoriesEditor';
import { DishEditor } from './DishEditor';
import { DishPreview } from './DishPreview';
import { deleteDish, saveDishInCatalog, type DishDraft } from './model';
import { Action, IconAction, Input, Message, Pill, T, c, u } from './ui';

function DishTile({ dish, width, canEdit, pending, disabled, onOpen, onPreview, onToggle }: { dish: FoodDish; width: number; canEdit: boolean; pending: boolean; disabled: boolean; onOpen: () => void; onPreview: () => void; onToggle: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current, reduced = useReducedMotion();
  useEffect(() => { if (reduced) return; opacity.setValue(.45); const animation = Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }); animation.start(); return () => animation.stop(); }, [dish.price, dish.available, reduced, opacity]);
  return <View style={{ width, backgroundColor: c.white, borderRadius: 24, overflow: 'hidden' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${canEdit ? 'Редактировать' : 'Посмотреть'} ${dish.name}`} onPress={onOpen} disabled={disabled} style={({ pressed }) => ({ opacity: pressed ? .86 : 1 })}>
      <Photo imageUrl={dish.imageUrl} imageKey={dish.imageKey} label={dish.name} style={{ width, height: width * .9, borderRadius: 24, opacity: dish.available ? 1 : .62 }}/>
      {!dish.available && <View style={s.unavailable}><T bold style={{ fontSize: 10, color: c.white }}>В стоп-листе</T></View>}
      <View style={{ padding: 13, paddingBottom: 6, gap: 3 }}><Animated.View style={{ opacity }}><T bold style={{ fontSize: 18, lineHeight: 23 }}>{dish.price.toLocaleString('ru-RU')} сом</T></Animated.View><T numberOfLines={2} style={{ minHeight: 40, lineHeight: 20, fontSize: 13 }}>{dish.name}</T><T muted numberOfLines={1} style={{ fontSize: 11 }}>{dish.portion || (dish.weightGrams ? `${dish.weightGrams} г` : dish.category)}</T></View>
    </Pressable>
    <View style={[u.row, { paddingHorizontal: 10, paddingBottom: 8, gap: 4 }]}>
      {canEdit ? <><View style={{ flex: 1 }}>{pending ? <ActivityIndicator color={c.blue} size="small"/> : <T muted style={{ fontSize: 10 }}>{dish.available ? 'В наличии' : 'Нет в наличии'}</T>}</View><Switch accessibilityLabel={`${dish.available ? 'Убрать в стоп-лист' : 'Вернуть в меню'}: ${dish.name}`} disabled={disabled} value={dish.available} onValueChange={onToggle} trackColor={{ false: '#DDE1E7', true: c.blue }} thumbColor={c.white}/></> : <T muted style={{ flex: 1, fontSize: 11 }}>Просмотр</T>}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Как видит клиент: ${dish.name}`} onPress={onPreview} style={[u.row, { minHeight: 42, paddingHorizontal: 13, borderTopWidth: 1, borderTopColor: c.line, gap: 6 }]}><Ionicons name="eye-outline" size={15} color={c.muted}/><T muted style={{ fontSize: 10 }}>Как видит клиент</T></Pressable>
  </View>;
}

export function MenuScreen({ restaurantId, membership, detail, onChanged, initialCreate }: { restaurantId: string; membership: Membership; detail: RestaurantDetail; onChanged: () => void; initialCreate?: boolean }) {
  const [current, setCurrent] = useState(detail), [category, setCategory] = useState<string | null>(null), [search, setSearch] = useState(''), [onlyUnavailable, setOnlyUnavailable] = useState(false);
  const [editing, setEditing] = useState<{ detail: RestaurantDetail; dish?: FoodDish }>(), [categoryDetail, setCategoryDetail] = useState<RestaurantDetail>();
  const [preview, setPreview] = useState<FoodDish>(), [error, setError] = useState(''), [success, setSuccess] = useState(''), [busyId, setBusyId] = useState<string>(), [refreshing, setRefreshing] = useState(false);
  const scope = useRef(restaurantId), lock = useRef(false), initialHandled = useRef(false), generation = useRef(0);
  const allowed = can(membership, 'menu.manage') && membership.restaurantId === restaurantId;
  const windowWidth = useWindowDimensions().width, pageWidth = Math.min(windowWidth, 900), columns = pageWidth >= 720 ? 3 : 2, cardWidth = (pageWidth - 40 - 14 * (columns - 1)) / columns;
  useEffect(() => {
    if (scope.current !== restaurantId) {
      scope.current = restaurantId; generation.current++; lock.current = false; setCurrent(detail); setCategory(null); setSearch(''); setOnlyUnavailable(false); setEditing(undefined); setCategoryDetail(undefined); setPreview(undefined); setError(''); setSuccess(''); setBusyId(undefined); initialHandled.current = false;
    } else setCurrent(previous => detail.updatedAt >= previous.updatedAt ? detail : previous);
  }, [restaurantId, detail]);
  useEffect(() => {
    if (initialCreate && !initialHandled.current && allowed) { initialHandled.current = true; if (current.catalog.menuCategories.length) setEditing({ detail: current }); else setCategoryDetail(current); }
  }, [initialCreate, allowed, current]);
  useEffect(() => { if (!success) return; const timer = setTimeout(() => setSuccess(''), 3500); return () => clearTimeout(timer); }, [success]);
  useEffect(() => { if (category && !current.catalog.menuCategories.includes(category)) setCategory(null); }, [current, category]);
  const dishes = useMemo(() => current.catalog.dishes.filter(dish => (!category || dish.category === category) && (!onlyUnavailable || !dish.available) && (!search.trim() || `${dish.name} ${dish.description} ${dish.ingredients ?? ''}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')))), [current, category, onlyUnavailable, search]);
  const unavailable = current.catalog.dishes.filter(dish => !dish.available).length;
  const reload = useCallback(async () => {
    const id = restaurantId, requestGeneration = generation.current;
    setRefreshing(true);
    try { const next = await api.restaurant(id); if (scope.current === id && generation.current === requestGeneration) { setCurrent(previous => next.updatedAt >= previous.updatedAt ? next : previous); setError(''); } }
    finally { if (scope.current === id && generation.current === requestGeneration) setRefreshing(false); }
  }, [restaurantId]);
  async function persist(catalog: RestaurantCatalog, base: RestaurantDetail, message: string) {
    if (!allowed || catalog.id !== restaurantId || base.catalog.id !== restaurantId) throw new Error('Нет доступа к меню этого ресторана.');
    if (lock.current) throw new Error('Дождитесь завершения предыдущего сохранения.');
    lock.current = true; const requestGeneration = generation.current;
    try { const next = await api.saveCatalog(restaurantId, catalog, base.updatedAt); if (scope.current !== restaurantId || generation.current !== requestGeneration) return; setCurrent(next); setError(''); setSuccess(message); onChanged(); }
    finally { if (generation.current === requestGeneration) lock.current = false; }
  }
  async function toggle(dish: FoodDish) {
    if (lock.current || !allowed) return;
    const requestGeneration = generation.current;
    setBusyId(dish.id); setError('');
    try { await persist({ ...current.catalog, dishes: current.catalog.dishes.map(item => item.id === dish.id ? { ...item, available: !item.available } : item) }, current, dish.available ? 'Блюдо добавлено в стоп-лист' : 'Блюдо снова доступно'); }
    catch (cause) { if (generation.current === requestGeneration) setError(cause instanceof Error ? cause.message : 'Не удалось изменить доступность.'); }
    finally { if (generation.current === requestGeneration) setBusyId(undefined); }
  }
  const refresh = () => { void reload().catch(cause => setError(cause instanceof Error ? cause.message : 'Не удалось обновить меню.')); };
  const create = () => current.catalog.menuCategories.length ? setEditing({ detail: current }) : setCategoryDetail(current);
  if (current.catalog.id !== restaurantId) return <View style={{ padding: 24 }}><ActivityIndicator color={c.blue}/></View>;
  return <View style={{ flex: 1 }}>
    <FlatList key={columns} data={dishes} numColumns={columns} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 20, paddingTop: 10, gap: 16, maxWidth: 900, alignSelf: 'center', width: '100%', paddingBottom: 30 }} columnWrapperStyle={{ gap: 14 }}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.blue}/>}
      ListHeaderComponent={<View style={{ gap: 18, paddingBottom: 5 }}>
        <View style={u.row}><View style={{ flex: 1, gap: 4 }}><T bold style={{ fontSize: 30, lineHeight: 37, letterSpacing: -.8 }}>Меню</T><T muted>{current.catalog.dishes.length} блюд · {current.catalog.dishes.length - unavailable} в наличии</T></View>{allowed && <Action label="Блюдо" icon="add" onPress={create} disabled={!!busyId}/>}</View>
        {!!success && <Message text={success} success/>}
        {!!error && <View style={{ gap: 9 }}><Message text={error}/><Action label="Обновить меню" secondary small onPress={refresh} busy={refreshing}/></View>}
        <Input label="Поиск по меню" placeholder="Название блюда или ингредиент" value={search} onChangeText={setSearch}/>
        <View style={[u.row, { justifyContent: 'space-between' }]}><View style={u.wrap}><Pill label="Все блюда" selected={!onlyUnavailable} onPress={() => setOnlyUnavailable(false)}/><Pill label={`Стоп-лист ${unavailable}`} selected={onlyUnavailable} onPress={() => setOnlyUnavailable(true)}/></View>{allowed && <IconAction icon="options-outline" label="Управлять категориями" onPress={() => setCategoryDetail(current)} disabled={!!busyId}/>}</View>
        <ScrollView horizontal style={{ flexGrow: 0, height: 44 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}><Pill label="Все категории" selected={!category} onPress={() => setCategory(null)}/>{current.catalog.menuCategories.map(name => <Pill key={name} label={name} selected={category === name} onPress={() => setCategory(name)}/>)}</ScrollView>
        {!allowed && <T muted style={{ fontSize: 12 }}>Вы можете просматривать меню. Изменение доступно владельцу и менеджеру с правом «Меню и модификаторы».</T>}
      </View>}
      ListEmptyComponent={<View style={{ gap: 16 }}><Empty title={current.catalog.dishes.length ? 'Блюда не найдены' : 'Ваше меню начинается здесь'} body={current.catalog.dishes.length ? 'Попробуйте другую категорию или измените поиск.' : 'Добавьте категорию, затем первое блюдо с фотографией и вариантами.'}/>{allowed && !current.catalog.dishes.length && <Action label={current.catalog.menuCategories.length ? 'Добавить первое блюдо' : 'Создать категорию'} onPress={create} icon="add"/>}</View>}
      renderItem={({ item }) => <DishTile dish={item} width={cardWidth} canEdit={allowed} pending={busyId === item.id} disabled={!!busyId} onOpen={() => allowed ? setEditing({ detail: current, dish: item }) : setPreview(item)} onPreview={() => setPreview(item)} onToggle={() => void toggle(item)}/>}/>
    {editing && <DishEditor key={`${restaurantId}:${editing.dish?.id ?? 'new'}`} restaurantId={restaurantId} detail={editing.detail} previewCatalog={current.catalog} dish={editing.dish} onClose={() => setEditing(undefined)} onReload={reload}
      onSave={async (draft: DishDraft) => { await persist(saveDishInCatalog(editing.detail.catalog, draft), editing.detail, 'Блюдо сохранено в меню'); setEditing(undefined); }}
      onDelete={editing.dish ? async () => { await persist(deleteDish(editing.detail.catalog, editing.dish!.id), editing.detail, 'Блюдо удалено из меню'); setEditing(undefined); } : undefined}/>}
    {categoryDetail && <CategoriesEditor catalog={categoryDetail.catalog} onClose={() => setCategoryDetail(undefined)} onReload={reload} onSave={async catalog => { await persist(catalog, categoryDetail, 'Категории сохранены'); setCategoryDetail(undefined); }}/>} 
    {preview && <DishPreview dish={preview} options={current.catalog.options} catalog={current.catalog} onClose={() => setPreview(undefined)}/>}
  </View>;
}

const s = StyleSheet.create({ unavailable: { position: 'absolute', top: 12, left: 10, borderRadius: 10, backgroundColor: '#111318CC', paddingHorizontal: 9, paddingVertical: 5 } });

