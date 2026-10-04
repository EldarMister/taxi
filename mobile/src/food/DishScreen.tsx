import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SpringPressable } from '../design/motion';
import { palette } from '../design/tokens';
import { fonts } from '../design/typography';
import { money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { FoodPhoto } from './FoodPhoto';
import { MAX_FOOD_QUANTITY } from './cart';
import { DishCard, dishDiscount } from './DishCard';
import { DishSheet } from './DishSheet';
import { dishLinePrice, dishOptionsValid, initialDishOptions, toggleDishOption } from './dishOptions';
import { NumberTicker } from './NumberTicker';
import type { FoodDish, FoodRestaurant } from './types';
import { useFoodT } from './i18n';

export function DishScreen({ dish, restaurant, onBack, onAdd, onDish, onQuickAdd, onDecrease, dishQuantities = {} }: {
  dish: FoodDish;
  restaurant: FoodRestaurant;
  onBack: () => void;
  onAdd: (dish: FoodDish, quantity: number, optionIds: string[], afterAdd?: (added?: boolean) => void) => void;
  favorite: boolean;
  onFavorite: () => void;
  onDish?: (dish: FoodDish) => void;
  onQuickAdd?: (dish: FoodDish) => void;
  onDecrease?: (dish: FoodDish) => void;
  dishQuantities?: Record<string, number>;
}) {
  const t = useFoodT();
  const s = useFoodStyles(styles);
  const c = useFoodColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [closing, setClosing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const adding = useRef(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<string[]>(() => initialDishOptions(dish, restaurant.options));
  useEffect(() => {
    setQuantity(1);
    setSelectedOptions(initialDishOptions(dish, restaurant.options));
    setClosing(false);
    setDescriptionExpanded(false);
    adding.current = false;
  }, [dish.id]);
  const options = restaurant.options.filter(option => dish.optionIds.includes(option.id));
  const price = dishLinePrice(dish, quantity, options, selectedOptions);
  const discount = dishDiscount(dish);
  const oldPrice = discount ? price + (dish.originalPrice! - dish.price) * quantity : 0;
  const modificationsValid = dishOptionsValid(dish, restaurant.options, selectedOptions);
  const canAdd = restaurant.isOpen !== false && dish.available && modificationsValid && !closing;
  const groups = [...(dish.optionGroups ?? []), {
    id: 'optional', name: 'Дополнительно', minSelected: 0,
    optionIds: dish.optionIds.filter(id => !dish.optionGroups?.some(group => group.optionIds.includes(id))),
  }].filter(group => group.optionIds.length);
  const recommendations = restaurant.dishes.filter(value => value.available && value.id !== dish.id).slice(0, 12);
  const recommendationColumns = width - insets.left - insets.right >= 360 ? 3 : 2;
  const recommendationWidth = (width - Math.max(insets.left, 16) - Math.max(insets.right, 16) - (recommendationColumns - 1) * 10) / recommendationColumns;
  const nutrition = dish.nutritionPer100g;
  const footer = <View testID="dish-fixed-footer" style={[s.footer, { paddingBottom: Math.max(insets.bottom, 14), paddingLeft: Math.max(insets.left, 8), paddingRight: Math.max(insets.right, 8) }]}>
    <View style={s.footerSummary}>
      <Text style={s.footerName} numberOfLines={2}>{dish.name} <Text style={s.footerPortion}>{dish.portion}</Text></Text>
      <View style={s.footerPrices}>
        {!!oldPrice && <Text style={s.oldPrice}>{money(oldPrice)}</Text>}
        <NumberTicker value={price} format={money} style={[s.footerPrice, !!discount && s.discountPrice]} height={22}/>
      </View>
    </View>
    <View style={s.footerActions}>
      <View style={[s.quantity, { width: Math.min(126, Math.max(108, width * .29)) }]}>
        <SpringPressable accessibilityRole="button" accessibilityLabel={t('Уменьшить количество')} accessibilityState={{ disabled: quantity <= 1 }} disabled={quantity <= 1}
          onPress={() => setQuantity(value => Math.max(1, value - 1))} pressScale={.9} style={s.quantityButton}><Ionicons name="remove" color={quantity <= 1 ? c.muted : c.ink} size={23}/></SpringPressable>
        <NumberTicker value={quantity} style={s.quantityValue} height={22} accessibilityLabel={`${quantity} порций`}/>
        <SpringPressable accessibilityRole="button" accessibilityLabel={t('Увеличить количество')} accessibilityState={{ disabled: quantity >= MAX_FOOD_QUANTITY }} disabled={quantity >= MAX_FOOD_QUANTITY}
          onPress={() => setQuantity(value => Math.min(MAX_FOOD_QUANTITY, value + 1))} pressScale={.9} style={s.quantityButton}><Ionicons name="add" color={quantity >= MAX_FOOD_QUANTITY ? c.muted : c.ink} size={23}/></SpringPressable>
      </View>
      <SpringPressable accessibilityRole="button" accessibilityLabel={restaurant.isOpen === false ? t('Сейчас закрыто') : !modificationsValid ? t('Выберите модификации') : `${t('Добавить в корзину')} ${money(price)}`}
        disabled={!canAdd} accessibilityState={{ disabled: !canAdd }} onPress={() => {
          if (!canAdd || adding.current) return;
          adding.current = true;
          onAdd(dish, quantity, selectedOptions, added => { if (added === false) adding.current = false; else setClosing(true); });
        }} pressScale={.985} containerStyle={{ flex: 1 }} style={[s.add, { backgroundColor: palette.blue }, !canAdd && s.addDisabled]}>
        <Text numberOfLines={2} style={[s.addText, { color: '#FFFFFF' }]}>{restaurant.isOpen === false ? t('Сейчас закрыто') : !dish.available ? t('Блюдо временно недоступно') : !modificationsValid ? t('Выберите модификации') : t('Добавить')}</Text>
      </SpringPressable>
    </View>
  </View>;
  return <DishSheet closeRequested={closing} onClose={onBack} label={t('Закрыть блюдо')} footer={footer} contentKey={dish.id}>
    <View style={s.introCard}>
      <View style={[s.hero, { height: width * (groups.length ? .64 : .78) }]}>
        <FoodPhoto fadeDuration={160} imageKey={dish.heroImageKey || dish.id} fallbackKey={dish.imageKey} imageUrl={dish.heroImageUrl || dish.imageUrl} style={s.image} resizeMode="cover"/>
      </View>
      <View style={s.descriptionCard}>
        {!!discount && <View style={s.discountBadge}><Text style={s.discountText}>−{discount}%</Text></View>}
        {!!dish.badge && <View style={s.foodBadge}><Text style={s.foodBadgeText}>{t(dish.badge).toUpperCase()}</Text></View>}
        {!!dish.reviewCount && dish.ratingPercent != null && <View style={s.rating}><Ionicons name="thumbs-up" size={15} color={c.ink}/><Text style={s.ratingText}>{dish.ratingPercent}% ({dish.reviewCount})</Text></View>}
        {!!dish.description && <View>
          <Text numberOfLines={descriptionExpanded ? undefined : 3} style={s.description}>{dish.description}</Text>
          {dish.description.length > 170 && <SpringPressable accessibilityRole="button" accessibilityLabel={t(descriptionExpanded ? 'Свернуть описание' : 'Всё описание')} onPress={() => setDescriptionExpanded(value => !value)} style={s.descriptionToggle}>
            <Text style={s.descriptionToggleText}>{t(descriptionExpanded ? 'Свернуть' : 'Всё описание')}</Text>
          </SpringPressable>}
        </View>}
        {!!dish.ingredients && <View style={s.detailSection}><Text style={s.detailLabel}>{t('Состав')}</Text><Text style={s.description}>{dish.ingredients}</Text></View>}
        {!!nutrition && <View style={s.detailSection}>
          <Text style={s.detailLabel}>{t(nutrition.estimated ? 'На 100 г по открытым данным для подобных блюд' : 'На 100 г')}</Text>
          <View style={s.nutrition}>
            {[{ value: nutrition.calories, label: 'ккал', unit: '' }, { value: nutrition.protein, label: 'белки', unit: 'г' }, { value: nutrition.fat, label: 'жиры', unit: 'г' }, { value: nutrition.carbohydrates, label: 'углеводы', unit: 'г' }].map(item =>
              <View key={item.label} style={s.nutrient}><Text style={s.nutrientValue}>{item.value}{t(item.unit)}</Text><Text style={s.nutrientLabel}>{t(item.label)}</Text></View>)}
          </View>
        </View>}
      </View>
    </View>
    {groups.map(group => <View key={group.id} style={s.optionsCard}>
      <Text style={s.optionHeading}>{t(group.name)}</Text>
      {options.filter(option => group.optionIds.includes(option.id)).map((option, index) => {
        const selected = selectedOptions.includes(option.id);
        const atLimit = !selected && group.maxSelected !== 1 && group.optionIds.filter(id => selectedOptions.includes(id)).length >= (group.maxSelected ?? group.optionIds.length);
        return <SpringPressable key={option.id} accessibilityRole={group.maxSelected === 1 ? 'radio' : 'checkbox'} accessibilityState={{ checked: selected, disabled: atLimit }} disabled={atLimit}
          accessibilityLabel={`${option.name}, ${option.price ? `плюс ${money(option.price)}` : 'бесплатно'}`} onPress={() => setSelectedOptions(current => toggleDishOption(current, option.id, group))}
          pressScale={.995} style={[s.optionRow, atLimit && { opacity: .45 }]}>
          <View style={[s.optionCircle, selected && s.optionSelected]}>{selected && <Ionicons name="checkmark" color="#202020" size={22}/>}</View>
          <View style={[s.optionCopy, index > 0 && s.optionDivider]}>
            <View style={s.optionTitleRow}><Text style={s.optionName}>{option.name}</Text><Text style={s.optionPrice}>+{money(option.price)}</Text></View>
            {option.priceScope === 'PER_ITEM' && <Text style={s.optionScope}>{t('На всю позицию')}</Text>}
          </View>
        </SpringPressable>;
      })}
    </View>)}
    {!!recommendations.length && <View style={s.recommendations}>
      <Text accessibilityRole="header" style={s.recommendationTitle}>{t('Вам может понравиться')}</Text>
      <View style={s.recommendationGrid}>
        {recommendations.map(value => <DishCard key={value.id} dish={value} width={recommendationWidth} format="horizontal" quantity={dishQuantities[value.id] || 0} orderingDisabled={restaurant.isOpen === false}
          onOpen={() => onDish?.(value)} onIncrease={() => onQuickAdd?.(value)} onDecrease={() => onDecrease?.(value)}/>)}
      </View>
    </View>}
  </DishSheet>;
}

const styles = StyleSheet.create({
  introCard: { backgroundColor: palette.white, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: 'hidden' },
  hero: { width: '100%', backgroundColor: palette.surface },
  image: { width: '100%', height: '100%' },
  descriptionCard: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 12 },
  description: { color: palette.ink, fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  descriptionToggle: { alignSelf: 'flex-end', paddingTop: 2, paddingBottom: 4 },
  descriptionToggleText: { color: '#999999', fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  detailSection: { gap: 5 },
  detailLabel: { color: '#999999', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  nutrition: { flexDirection: 'row', gap: 16, paddingTop: 2 },
  nutrient: { gap: 1 },
  nutrientValue: { color: palette.ink, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  nutrientLabel: { color: palette.ink, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  discountBadge: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: '#009B59' },
  discountText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  foodBadge: { alignSelf: 'flex-start', backgroundColor: '#E19336', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  foodBadgeText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 10, lineHeight: 14 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { color: palette.ink, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
  optionsCard: { marginTop: 6, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10, borderRadius: 26, backgroundColor: palette.white },
  optionHeading: { marginBottom: 4, color: '#999999', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 59 },
  optionCircle: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F1EF' },
  optionSelected: { backgroundColor: '#FFE500' },
  optionCopy: { flex: 1, minHeight: 59, justifyContent: 'center', paddingVertical: 12 },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EEEEEE' },
  optionTitleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  optionName: { color: palette.ink, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  optionPrice: { color: '#999999', fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  optionScope: { marginTop: 2, color: '#999999', fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  recommendations: { marginTop: 6, paddingTop: 16, paddingBottom: 18, paddingHorizontal: 16, borderRadius: 26, backgroundColor: palette.white },
  recommendationTitle: { marginBottom: 16, color: palette.ink, fontFamily: 'FoodDisplayBold', fontSize: 25, lineHeight: 32, letterSpacing: -.4 },
  recommendationGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 12 },
  footer: { gap: 10, paddingTop: 10, backgroundColor: palette.white },
  footerSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 8, minHeight: 24 },
  footerName: { flex: 1, color: palette.ink, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  footerPortion: { color: '#B2B2B2', fontFamily: fonts.regular, fontSize: 12 },
  footerPrices: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, maxWidth: '48%' },
  footerPrice: { color: palette.ink, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  discountPrice: { color: '#258B5F' },
  oldPrice: { color: '#999999', fontFamily: fonts.regular, fontSize: 10, lineHeight: 18, textDecorationLine: 'line-through' },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  quantity: { height: 56, borderRadius: 17, backgroundColor: '#F5F4F2', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quantityButton: { width: 40, height: 56, alignItems: 'center', justifyContent: 'center' },
  quantityValue: { color: palette.ink, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, textAlign: 'center', minWidth: 20 },
  add: { height: 56, borderRadius: 17, backgroundColor: '#FFE500', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  addDisabled: { opacity: .5 },
  addText: { color: '#202020', fontFamily: fonts.medium, fontSize: 16, lineHeight: 20, textAlign: 'center' },
});
