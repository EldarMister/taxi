import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { FoodDish, FoodOption, FoodOptionGroup, RestaurantCatalog } from '../../domain/types';
import { Photo } from '../../ui';
import { customerPreviewPricing, previewOptionsValid, previewPrice } from './model';
import { IconAction, Panel, T, c, u } from './ui';

export function DishPreview({ dish: sourceDish, options, catalog, onClose }: { dish: FoodDish; options: FoodOption[]; catalog: Pick<RestaurantCatalog, 'promotions' | 'isOpen'>; onClose: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => setNow(Date.now()), [catalog.promotions]);
  useEffect(() => {
    const changesAt = (catalog.promotions ?? []).flatMap(promotion => [promotion.startsAt, promotion.endsAt]).filter((value): value is string => !!value).map(Date.parse).filter(time => time > now);
    if (!changesAt.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.min(...changesAt) - now + 5, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [catalog.promotions, now]);
  const { dish, discountPercent, hasBasketOffers } = customerPreviewPricing(sourceDish, catalog, now);
  const restaurantOpen = catalog.isOpen !== false;
  const [selected, setSelected] = useState(dish.defaultOptionIds ?? (dish.optionIds.includes('soy') ? ['soy'] : []));
  const [quantity, setQuantity] = useState(1);
  const groups: FoodOptionGroup[] = [...(dish.optionGroups ?? [])];
  const used = new Set(groups.flatMap(group => group.optionIds));
  const loose = dish.optionIds.filter(id => !used.has(id));
  if (loose.length) groups.push({ id: 'loose', name: 'Дополнения', optionIds: loose });
  const valid = previewOptionsValid(dish, selected);
  const total = previewPrice(dish, options, selected, quantity);
  return <Panel title="Как видит клиент" visible onClose={onClose} footer={<View style={{ gap: 10 }}>
    <View style={u.row}><View style={[u.row, { borderRadius: 20, backgroundColor: c.pale }]}><IconAction icon="remove" label="Уменьшить количество" disabled={quantity <= 1} onPress={() => setQuantity(quantity - 1)}/><T bold>{quantity}</T><IconAction icon="add" label="Увеличить количество" disabled={quantity >= 99} onPress={() => setQuantity(quantity + 1)}/></View><View style={{ flex: 1, backgroundColor: valid && dish.available && restaurantOpen ? c.blue : c.pale, borderRadius: 18, padding: 14 }}><T bold style={{ color: valid && dish.available && restaurantOpen ? c.white : c.muted, textAlign: 'center' }}>{!restaurantOpen ? 'Сейчас закрыто' : dish.available ? valid ? `${total.toLocaleString('ru-RU')} сом` : 'Выберите варианты' : 'Временно нет'}</T></View></View>
    <T muted style={{ fontSize: 11, textAlign: 'center' }}>Предпросмотр страницы блюда. Заказ не создаётся.{hasBasketOffers ? ' Акции от суммы заказа рассчитываются в корзине.' : ''}</T>
  </View>}>
    <Photo imageUrl={dish.heroImageUrl || dish.imageUrl} imageKey={dish.heroImageKey || dish.imageKey} label={dish.name} style={{ height: 270, borderRadius: 26, width: '100%' }}/>
    <View style={{ gap: 6 }}><View style={u.row}><T bold style={{ fontSize: 28, lineHeight: 34, color: discountPercent ? c.green : c.ink }}>{dish.price.toLocaleString('ru-RU')} сом</T>{dish.originalPrice != null && dish.originalPrice > dish.price && <T muted style={{ textDecorationLine: 'line-through' }}>{dish.originalPrice} сом</T>}</View>{discountPercent > 0 && <View style={{ alignSelf: 'flex-start', backgroundColor: '#009B59', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}><T bold style={{ color: c.white, fontSize: 12 }}>−{discountPercent}%</T></View>}<T bold style={{ fontSize: 23, lineHeight: 30 }}>{dish.name}</T><T muted>{[dish.portion, dish.weightGrams ? `${dish.weightGrams} г` : '', dish.calories != null ? `${dish.calories} ккал` : ''].filter(Boolean).join(' · ')}</T></View>
    {!!dish.description && <T>{dish.description}</T>}
    {!!dish.ingredients && <View style={{ gap: 5 }}><T bold>Состав</T><T muted>{dish.ingredients}</T></View>}
    {dish.nutritionPer100g && <View style={{ gap: 12 }}><T bold>На 100 г{dish.nutritionPer100g.estimated ? ' · примерно' : ''}</T><View style={[u.row, { justifyContent: 'space-between', borderRadius: 20, backgroundColor: c.pale, padding: 15 }]}>{[[dish.nutritionPer100g.calories, 'ккал'], [dish.nutritionPer100g.protein, 'белки'], [dish.nutritionPer100g.fat, 'жиры'], [dish.nutritionPer100g.carbohydrates, 'углеводы']].map(([value, label]) => <View key={label} style={{ alignItems: 'center' }}><T bold>{value}</T><T muted style={{ fontSize: 10 }}>{label}</T></View>)}</View></View>}
    {groups.map(group => <View key={group.id} style={{ gap: 10 }}><T bold style={{ fontSize: 18 }}>{group.name}</T><T muted style={u.hint}>{group.minSelected ? `Обязательно · от ${group.minSelected}` : 'По желанию'} · до {group.maxSelected ?? group.optionIds.length}</T>
      {group.optionIds.map(id => { const option = options.find(item => item.id === id); if (!option) return null; const checked = selected.includes(id);
        return <Pressable key={id} accessibilityRole={group.maxSelected === 1 ? 'radio' : 'checkbox'} accessibilityLabel={`${option.name}, ${option.price} сом`} accessibilityState={{ checked }} onPress={() => {
          if (checked) setSelected(selected.filter(value => value !== id));
          else if (group.maxSelected === 1) setSelected([...selected.filter(value => !group.optionIds.includes(value)), id]);
          else if (selected.length < 10 && group.optionIds.filter(value => selected.includes(value)).length < (group.maxSelected ?? group.optionIds.length)) setSelected([...selected, id]);
        }} style={[u.row, { borderRadius: 18, padding: 14, backgroundColor: checked ? '#EBF4FF' : c.pale }]}><Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={checked ? c.blue : '#CBD0D8'}/><View style={{ flex: 1 }}><T bold>{option.name}</T><T muted style={{ fontSize: 11 }}>{option.priceScope === 'PER_ITEM' ? 'За позицию заказа' : 'За каждую порцию'}</T></View><T bold>+{option.price} сом</T></Pressable>;
      })}
    </View>)}
  </Panel>;
}

