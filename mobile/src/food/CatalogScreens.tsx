import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomPanel } from '../BottomPanel';
import { Reveal, SpringPressable } from '../design/motion';
import { palette, radii } from '../design/tokens';
import { fonts } from '../design/typography';
import { useTheme } from '../design/theme';
import { FoodButton, FoodFavoriteButton, FoodHeader, FoodIconButton, foodColors as c, money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { foodImage } from './assets';
import { MAX_FOOD_QUANTITY } from './cart';
import type { FoodDish, FoodRestaurant } from './types';

function SearchField({ value, onChange, placeholder, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const theme = useTheme();
  return <View style={s.search}>
    <Ionicons name="search-outline" size={23} color={theme.isDark ? theme.palette.muted : '#94A0B7'} />
    <TextInput ref={inputRef} accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={theme.isDark ? theme.palette.muted : '#7183A4'} value={value} onChangeText={onChange} style={s.searchInput} returnKeyType="search" autoCorrect={false} />
    {!!value && <FoodIconButton name="close-circle" label="Очистить поиск" color={c.muted} size={19} onPress={() => onChange('')} style={s.searchClear} />}
  </View>;
}

function EmptyState({ title, subtitle, dishes = false }: { title: string; subtitle?: string; dishes?: boolean }) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  return <View style={s.empty}>
    {dishes ? <Image source={require('../../assets/food/empty-dishes-3d.png')} resizeMode="contain" style={s.emptyDishesImage} /> : <Ionicons name="restaurant-outline" size={36} color={c.muted} />}
    <Text style={s.emptyTitle}>{title}</Text>
    {!!subtitle && <Text style={s.emptySubtitle}>{subtitle}</Text>}
  </View>;
}

function CartHeaderButton({ count, onPress }: { count: number; onPress: () => void }) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  return <View style={s.cartHeaderWrap}>
    <FoodIconButton name={count ? 'bag-handle' : 'bag-handle-outline'} color={count ? c.blue : c.ink} label={count ? `Открыть корзину, ${count} товаров` : 'Открыть корзину'} onPress={onPress} size={26} />
    {count > 0 && <View style={s.cartBadge}><Text style={s.cartBadgeText}>{count > 99 ? '99+' : count}</Text></View>}
  </View>;
}

function CartDock({ count, total, restaurantName, onPress, bottom = 14 }: { count: number; total: number; restaurantName?: string; onPress: () => void; bottom?: number }) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  if (!count) return null;
  return <Reveal distance={8} style={[s.cartDock, { paddingBottom: bottom }]}>
    <SpringPressable accessibilityRole="button" accessibilityLabel={`Открыть общую корзину, ${count} товаров на сумму ${money(total)}`} onPress={onPress} pressScale={.985} style={s.cartDockButton}>
      <View style={s.cartDockIcon}><Ionicons name="bag-handle" color={c.blue} size={23} /><View style={s.cartDockCount}><Text style={s.cartDockCountText}>{count > 99 ? '99+' : count}</Text></View></View>
      <View style={s.cartDockCopy}><Text style={s.cartDockTitle}>Корзина</Text><Text numberOfLines={1} style={s.cartDockRestaurant}>{restaurantName || 'Ваш заказ'}</Text></View>
      <Text style={s.cartDockTotal}>{money(total)}</Text><Ionicons name="chevron-forward" color={c.blue} size={20} />
    </SpringPressable>
  </Reveal>;
}

function reviewLabel(count: number) {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(count);
}

export function RestaurantsScreen({ restaurants, onBack, onRestaurant, onFavorites, favoriteCount, onCart, cartCount, cartTotal, cartRestaurantName, loading, error, onRetry }: {
  restaurants: FoodRestaurant[];
  onBack: () => void;
  onRestaurant: (restaurant: FoodRestaurant) => void;
  onFavorites: () => void;
  favoriteCount: number;
  onCart: () => void;
  cartCount: number;
  cartTotal: number;
  cartRestaurantName?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Все');
  const categories = useMemo(() => ['Все', ...new Set(['Суши', 'Пицца', 'Фастфуд', 'Национальная кухня', ...restaurants.flatMap(restaurant => restaurant.categories)])], [restaurants]);
  useEffect(() => {
    if (!categories.includes(category)) setCategory('Все');
  }, [categories, category]);
  const filtered = restaurants.filter(restaurant => {
    const matchesText = `${restaurant.name} ${restaurant.cuisine} ${restaurant.categories.join(' ')} ${restaurant.dishes.map(dish => dish.name).join(' ')}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'));
    return matchesText && (category === 'Все' || restaurant.categories.includes(category));
  });
  const restaurantGridWidth = Math.max(0, width - insets.left - insets.right - 32);
  const restaurantTwoColumns = restaurantGridWidth >= 320;
  const restaurantCardWidth = restaurantTwoColumns ? Math.min(228, (restaurantGridWidth - 12) / 2) : restaurantGridWidth;
  const restaurantImageHeight = restaurantTwoColumns ? restaurantCardWidth * .82 : Math.min(210, restaurantCardWidth * .58);

  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <Reveal><FoodHeader title="Рестораны" onBack={onBack} right={<CartHeaderButton count={cartCount} onPress={onCart} />} /></Reveal>
    <Reveal delay={35} style={s.catalogSearch}><SearchField value={search} onChange={setSearch} placeholder="Ресторан, кухня или блюдо" /></Reveal>
    <Reveal delay={50} style={s.favoritesEntryWrap}><SpringPressable accessibilityRole="button" accessibilityLabel={`Избранное: ${favoriteCount} сохранённых ресторанов и блюд`} onPress={onFavorites} pressScale={.98} style={s.favoritesEntry}>
      <View style={s.favoritesEntryIcon}><Ionicons name="heart" size={20} color={c.blue} /></View>
      <Text style={s.favoritesEntryTitle}>Избранное</Text>
      {favoriteCount > 0 && <View style={s.favoritesEntryCount}><Text style={s.favoritesEntryCountText}>{favoriteCount}</Text></View>}
      <Ionicons name="chevron-forward" size={20} color={c.muted} />
    </SpringPressable></Reveal>
    <Reveal delay={65} style={s.filtersWrap}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
      {categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === category }} onPress={() => setCategory(item)} style={[s.filter, item === category && s.filterActive]}>
        <Text style={[s.filterText, item === category && s.filterTextActive]}>{item}</Text>
      </Pressable>)}
    </ScrollView></Reveal>
    {loading && !restaurants.length ? <View style={s.empty}><ActivityIndicator color={c.blue} size="large" /><Text style={s.emptySubtitle}>Ищем рестораны…</Text></View> : error && !restaurants.length ? <View style={s.empty}>
      <Text style={s.emptyTitle}>Не удалось загрузить рестораны</Text><Text style={s.emptySubtitle}>{error}</Text>{onRetry && <FoodButton label="Повторить" onPress={onRetry} />}
    </View> : <ScrollView style={s.flex} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.restaurantList, { paddingBottom: cartCount ? 106 + insets.bottom : Math.max(insets.bottom, 20) }]}>
      <Reveal delay={95} style={s.restaurantGrid}>
        {filtered.map(restaurant => <View key={restaurant.id} style={[s.restaurantCard, { width: restaurantCardWidth }]}>
          <SpringPressable accessibilityRole="button" accessibilityLabel={`Открыть ${restaurant.name}`} onPress={() => onRestaurant(restaurant)} style={s.restaurantCardSurface}>
            <View style={[s.restaurantImageWrap, { height: restaurantImageHeight }]}>
              <Image source={foodImage(restaurant.imageKey, restaurant.imageUrl)} style={s.restaurantImage} resizeMode="cover" />
              {!!restaurant.discountPercent && <View style={s.discountBadge}><Text style={s.discountText}>−{restaurant.discountPercent}%</Text></View>}
            </View>
            <View style={s.restaurantCopy}>
              <Text style={s.restaurantName} numberOfLines={1}>{restaurant.name}</Text>
              <Text style={s.restaurantMuted} numberOfLines={1}>{restaurant.cuisine}</Text>
              <View style={s.restaurantMeta}>
                <View style={s.rating}><Ionicons name="star" size={15} color="#F5A400" /><Text style={s.ratingText}>{restaurant.rating.toFixed(1)}</Text></View>
                <View style={s.metaDot} />
                <Text style={s.restaurantEta}>{restaurant.etaMin}–{restaurant.etaMax} мин</Text>
              </View>
              <Text style={[s.restaurantDelivery, restaurant.deliveryFee === 0 && { color: c.green }]} numberOfLines={1}>{restaurant.deliveryFee === 0 ? 'Бесплатная доставка' : `Доставка ${money(restaurant.deliveryFee)}`}</Text>
            </View>
          </SpringPressable>
        </View>)}
      </Reveal>
      {!filtered.length && <EmptyState title={!restaurants.length ? 'Рестораны скоро появятся' : 'Ничего не найдено'} subtitle={!restaurants.length ? 'Мы готовим каталог. Загляните немного позже.' : 'Попробуйте другую кухню или измените запрос.'} />}
    </ScrollView>}
    <CartDock count={cartCount} total={cartTotal} restaurantName={cartRestaurantName} onPress={onCart} bottom={Math.max(insets.bottom, 14)} />
  </SafeAreaView>;
}

export function RestaurantScreen({ restaurant, onBack, onDish, onAdd, onDecrease, onCart, cartCount, cartTotal, cartRestaurantName, dishQuantities = {}, favorite, onFavorite }: {
  restaurant: FoodRestaurant;
  onBack: () => void;
  onDish: (dish: FoodDish) => void;
  onAdd: (dish: FoodDish) => void;
  onDecrease: (dish: FoodDish) => void;
  onCart: () => void;
  cartCount: number;
  cartTotal: number;
  cartRestaurantName?: string;
  dishQuantities?: Record<string, number>;
  favorite: boolean;
  onFavorite: () => void;
}) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [category, setCategory] = useState(() => restaurant.menuCategories.includes('Роллы') ? 'Роллы' : restaurant.menuCategories[0] || 'Все');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [closingInfo, setClosingInfo] = useState(false);
  useEffect(() => {
    if (!restaurant.menuCategories.includes(category)) setCategory(restaurant.menuCategories[0] || 'Все');
  }, [restaurant.menuCategories, category]);
  const searchInput = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    if (!showSearch) return;
    const focusFrame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [showSearch]);
  const query = search.trim().toLocaleLowerCase('ru');
  const dishes = restaurant.dishes.filter(dish => (query || category === 'Все' || dish.category === category) && `${dish.name} ${dish.description}`.toLocaleLowerCase('ru').includes(query));
  const dishGridWidth = Math.max(0, width - Math.max(insets.left, 20) - Math.max(insets.right, 20));
  const dishTwoColumns = dishGridWidth >= 320;
  const dishCardWidth = dishTwoColumns ? (dishGridWidth - 12) / 2 : dishGridWidth;
  const dishImageHeight = dishTwoColumns ? dishCardWidth * .68 : Math.min(210, dishCardWidth * .56);

  return <View style={s.screen}>
    <View accessibilityElementsHidden={showInfo} importantForAccessibility={showInfo ? 'no-hide-descendants' : 'auto'} style={s.flex}>
    <ScrollView ref={scroll} style={s.flex} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: cartCount ? 10 : Math.max(insets.bottom, 14) }}>
      <View style={{ height: Math.max(width * .62, insets.top + 165), backgroundColor: '#050906' }}>
        {!restaurant.heroImageUrl && !restaurant.imageUrl && restaurant.heroImageKey === 'sushi-hero' && <Image source={foodImage('sushi-hero')} blurRadius={25} style={[s.heroImage, { position: 'absolute', opacity: .2 }]} resizeMode="cover" />}
        <Image fadeDuration={160} source={foodImage(restaurant.heroImageKey || restaurant.imageKey, restaurant.heroImageUrl || restaurant.imageUrl)} style={[s.heroImage, !restaurant.heroImageUrl && !restaurant.imageUrl && restaurant.heroImageKey === 'sushi-hero' && { height: width * 222 / 764 + 20, position: 'absolute', bottom: 0 }]} resizeMode="cover" />
        <View style={[s.heroNav, { top: insets.top + 12, left: Math.max(insets.left, 14), right: Math.max(insets.right, 14) }]}>
          <FoodIconButton name="chevron-back" label="Назад" color="white" backgroundColor="rgba(80,80,80,.55)" onPress={onBack} size={30} />
          <View style={s.heroNavRight}>
            <FoodFavoriteButton favorite={favorite} item="ресторан" onPress={onFavorite} />
            <FoodIconButton name="search-outline" label="Поиск по меню" color="white" backgroundColor="rgba(255,255,255,.45)" onPress={() => { setShowSearch(value => !value); setSearch(''); scroll.current?.scrollTo({ y: width * .4, animated: true }); }} size={29} />
          </View>
        </View>
      </View>
      <Reveal delay={25} style={[s.restaurantSheet, { paddingLeft: Math.max(insets.left, 20), paddingRight: Math.max(insets.right, 20) }]}>
        <Text style={s.restaurantTitle}>{restaurant.name}</Text>
        <View style={s.detailMetaRow}>
          <View style={s.detailRating}><Ionicons name="star" size={18} color={c.ink} /><Text style={s.detailRatingText}>{restaurant.rating.toFixed(1)} <Text style={s.detailReview}>({reviewLabel(restaurant.reviewCount)})</Text></Text></View>
          <View style={s.metaDivider} /><Text style={s.detailEta}>{restaurant.etaMin}–{restaurant.etaMax} мин</Text>
          <FoodIconButton name="information-circle-outline" label="Информация о ресторане" onPress={() => setShowInfo(true)} size={29} style={{ marginLeft: 'auto', marginRight: -5 }} />
        </View>
        <Text style={[s.deliveryLabel, restaurant.deliveryFee === 0 && { color: c.green }]}>{restaurant.deliveryFee === 0 ? 'Бесплатная доставка' : `Доставка ${money(restaurant.deliveryFee)}`}</Text>
        {!!restaurant.deliveryFee && !!restaurant.freeDeliveryThreshold && <Text style={s.freeDeliveryLabel}>Бесплатная доставка от {money(restaurant.freeDeliveryThreshold)}</Text>}
        <View style={s.restaurantAddressRow}><Ionicons name="location-outline" size={17} color={c.muted} /><Text style={s.restaurantAddress} numberOfLines={2}>Адрес: {restaurant.address}</Text></View>
        {showSearch && <View style={{ marginTop: 14 }}><SearchField inputRef={searchInput} value={search} onChange={setSearch} placeholder="Поиск по меню" /></View>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.menuTabs} style={s.menuTabsFrame}>
          {restaurant.menuCategories.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: category === item }} onPress={() => { setCategory(item); setSearch(''); }} style={[s.menuTab, category === item && s.menuTabSelected]}>
            <Text style={[s.menuTabText, category === item && s.menuTabActive]}>{item}</Text>
          </Pressable>)}
        </ScrollView>
        <Reveal delay={55} style={s.dishList}>
          {dishes.map(dish => {
            const quantity = dishQuantities[dish.id] || 0;
            return <View key={dish.id} style={[s.dishCard, { width: dishCardWidth }, !dish.available && { opacity: .5 }]}>
            <SpringPressable accessibilityRole="button" accessibilityLabel={`Открыть ${dish.name}`} onPress={() => onDish(dish)} style={s.dishCardLink}>
              <Image fadeDuration={140} source={foodImage(dish.id, dish.imageUrl, dish.imageKey)} style={[s.dishImage, { height: dishImageHeight }]} resizeMode="cover" />
              <View style={[s.dishCopy, quantity > 0 && s.dishCopyWithStepper]}>
                <Text style={s.dishName} numberOfLines={2}>{dish.name}</Text>
                <Text style={s.dishPortion} numberOfLines={1}>{dish.portion}</Text>
                <Text style={[s.dishPrice, quantity > 0 && { paddingRight: 0 }]}>{money(dish.price)}</Text>
              </View>
            </SpringPressable>
            {quantity > 0 ? <View style={s.dishStepper}>
              <SpringPressable accessibilityRole="button" accessibilityLabel={`Уменьшить ${dish.name}`} onPress={() => onDecrease(dish)} pressScale={.86} style={s.dishStepperButton}><Ionicons name="remove" color={c.white} size={21} /></SpringPressable>
              <Text accessibilityLabel={`${quantity} порций`} style={s.dishStepperCount}>{quantity}</Text>
              <SpringPressable accessibilityRole="button" accessibilityLabel={`Увеличить ${dish.name}`} accessibilityState={{ disabled: quantity >= MAX_FOOD_QUANTITY }} disabled={quantity >= MAX_FOOD_QUANTITY} onPress={() => onAdd(dish)} pressScale={.86} style={s.dishStepperButton}><Ionicons name="add" color={quantity >= MAX_FOOD_QUANTITY ? '#9CC9FF' : c.white} size={21} /></SpringPressable>
            </View> : <SpringPressable accessibilityRole="button" accessibilityLabel={`Добавить ${dish.name} в корзину`} disabled={!dish.available} accessibilityState={{ disabled: !dish.available }} onPress={() => onAdd(dish)} pressScale={.88} containerStyle={s.dishAddTarget} style={[s.dishAdd, !dish.available && { backgroundColor: palette.line }]}><Ionicons name="add" color={dish.available ? c.blue : c.muted} size={24} /></SpringPressable>}
          </View>;
          })}
          {!dishes.length && <EmptyState dishes title="Блюда не найдены" subtitle={query ? 'Измените запрос.' : 'Выберите другую категорию.'} />}
        </Reveal>
      </Reveal>
    </ScrollView>
    <CartDock count={cartCount} total={cartTotal} restaurantName={cartRestaurantName} onPress={onCart} bottom={Math.max(insets.bottom, 14)} />
    </View>
    {showInfo && <BottomPanel closeRequested={closingInfo} onClose={() => { setShowInfo(false); setClosingInfo(false); }} label="Закрыть информацию о ресторане">
      <View style={s.infoCard}>
        <View style={s.infoHeading}><Text style={s.infoTitle}>{restaurant.name}</Text><FoodIconButton name="close" label="Закрыть" onPress={() => setClosingInfo(true)} /></View>
        <Text style={s.infoText}>{restaurant.cuisine}</Text><Text style={s.infoText}>{restaurant.address}</Text>
        {!!restaurant.phone && <Text selectable style={s.infoText}>{restaurant.phone}</Text>}
        <Text style={s.infoText}>Доставка: {restaurant.etaMin}–{restaurant.etaMax} мин{restaurant.deliveryFee === 0 ? ', бесплатно' : `, ${money(restaurant.deliveryFee)}`}</Text>
        <Text style={s.infoText}>{restaurant.minimumOrder ? `Минимальный заказ — ${money(restaurant.minimumOrder)}` : 'Без минимальной суммы заказа'}</Text>
        {restaurant.isDemo && <Text style={s.demoNote}>Демонстрационный ресторан. Заказы не передаются в реальное заведение.</Text>}
      </View>
    </BottomPanel>}
  </View>;
}

export function DishScreen({ dish, restaurant, onBack, onAdd, favorite, onFavorite }: {
  dish: FoodDish;
  restaurant: FoodRestaurant;
  onBack: () => void;
  onAdd: (dish: FoodDish, quantity: number, optionIds: string[]) => void;
  favorite: boolean;
  onFavorite: () => void;
}) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<string[]>(() => dish.optionIds.includes('soy') ? ['soy'] : []);
  const options = restaurant.options.filter(option => dish.optionIds.includes(option.id));
  const price = (dish.price + options.filter(option => selectedOptions.includes(option.id)).reduce((sum, option) => sum + option.price, 0)) * quantity;
  return <View style={s.screen}>
    <ScrollView style={s.flex} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
      <View style={{ height: Math.max(width * .98, insets.top + 265), backgroundColor: '#080A09' }}>
        {!dish.heroImageUrl && !dish.imageUrl && dish.heroImageKey === 'philadelphia-hero' && <Image source={foodImage('philadelphia-hero')} blurRadius={25} style={[s.heroImage, { position: 'absolute', opacity: .22 }]} resizeMode="cover" />}
        <Image fadeDuration={160} source={foodImage(dish.heroImageKey || dish.imageKey, dish.heroImageUrl || dish.imageUrl)} style={s.heroImage} resizeMode="cover" />
        <View style={[s.heroNav, { top: insets.top + 15, left: Math.max(insets.left, 18), right: Math.max(insets.right, 18) }]}>
          <FoodIconButton name="chevron-back" label="Назад" color="white" backgroundColor="rgba(210,210,214,.65)" onPress={onBack} size={30} />
          <FoodFavoriteButton favorite={favorite} item="блюдо" onPress={onFavorite} />
        </View>
      </View>
      <Reveal delay={35} style={[s.dishSheet, { paddingLeft: Math.max(insets.left, 21), paddingRight: Math.max(insets.right, 21) }]}>
        <Text style={s.dishTitle}>{dish.name}</Text>
        <Text style={s.dishDetailPortion}>{dish.portion}{dish.weightGrams ? ` · ${dish.weightGrams} г` : ''}</Text>
        <Text style={s.dishDescription}>{dish.description}</Text>
        <Text style={s.dishDetailPrice}>{money(dish.price)}</Text>
        <View style={s.divider} />
        <Text style={s.quantityTitle}>Выберите количество</Text>
        <View style={s.quantityBar}>
          <SpringPressable accessibilityRole="button" accessibilityLabel="Уменьшить количество" accessibilityState={{ disabled: quantity <= 1 }} disabled={quantity <= 1} onPress={() => setQuantity(value => Math.max(1, value - 1))} pressScale={.88} style={s.quantityMinus}><Ionicons name="remove" color={theme.isDark ? c.ink : '#3B4861'} size={25} /></SpringPressable>
          <Text accessibilityLiveRegion="polite" style={s.quantityValue}>{quantity}</Text>
          <SpringPressable accessibilityRole="button" accessibilityLabel="Увеличить количество" accessibilityState={{ disabled: quantity >= MAX_FOOD_QUANTITY }} disabled={quantity >= MAX_FOOD_QUANTITY} onPress={() => setQuantity(value => Math.min(MAX_FOOD_QUANTITY, value + 1))} pressScale={.88} style={s.quantityPlus}><Ionicons name="add" color={c.white} size={28} /></SpringPressable>
        </View>
        {options.length > 0 && <View style={s.modifierSection}>
          <View style={s.modifierHeader}><Text style={s.modifierTitle}>Комплектация и добавки</Text><Text style={s.modifierHint}>По желанию</Text></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.modifierCards} style={s.modifierFrame}>
            {options.map(option => {
              const selected = selectedOptions.includes(option.id);
              return <SpringPressable key={option.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${option.name}, ${option.price ? `плюс ${money(option.price)}` : 'бесплатно'}`} onPress={() => setSelectedOptions(current => selected ? current.filter(id => id !== option.id) : [...current, option.id])} pressScale={.97} style={[s.modifierCard, selected && s.modifierCardSelected]}>
                <Image source={foodImage(option.imageKey, option.imageUrl)} style={s.modifierImage} resizeMode="cover" />
                {selected && <View style={s.modifierCheck}><Ionicons name="checkmark" color={c.white} size={16} /></View>}
                <Text numberOfLines={2} style={s.modifierName}>{option.name}</Text>
                <Text style={[s.modifierPrice, selected && { color: c.blue }]}>{option.price ? `+ ${money(option.price)}` : 'Бесплатно'}</Text>
              </SpringPressable>;
            })}
          </ScrollView>
        </View>}
      </Reveal>
    </ScrollView>
    <Reveal distance={8} style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16), paddingLeft: Math.max(insets.left, 21), paddingRight: Math.max(insets.right, 21) }]}>
      <FoodButton label={dish.available ? `Добавить в корзину ${money(price)}` : 'Блюдо временно недоступно'} disabled={!dish.available} onPress={() => onAdd(dish, quantity, selectedOptions)} />
    </Reveal>
  </View>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  flex: { flex: 1 },
  search: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radii.large, backgroundColor: palette.surface },
  searchInput: { flex: 1, paddingVertical: 11, color: c.ink, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  searchClear: { width: 26, height: 28 },
  catalogSearch: { paddingHorizontal: 16, paddingTop: 3 },
  favoritesEntryWrap: { paddingHorizontal: 16, paddingTop: 10 },
  favoritesEntry: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 16, backgroundColor: palette.blueSoft },
  favoritesEntryIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.white },
  favoritesEntryTitle: { flex: 1, color: c.ink, fontFamily: fonts.bold, fontSize: 15 },
  favoritesEntryCount: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blue },
  favoritesEntryCountText: { color: c.white, fontFamily: fonts.bold, fontSize: 12 },
  filtersWrap: { paddingTop: 13, paddingBottom: 16 },
  filters: { gap: 8, paddingHorizontal: 16 },
  filter: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: palette.surface },
  filterActive: { backgroundColor: c.ink },
  filterText: { color: c.ink, fontFamily: fonts.semibold, fontSize: 14 },
  filterTextActive: { color: c.white },
  restaurantList: { paddingHorizontal: 16 },
  restaurantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignSelf: 'center', width: '100%' },
  restaurantCard: { position: 'relative' },
  restaurantCardSurface: { minHeight: 276, overflow: 'hidden', borderRadius: radii.large, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  restaurantImageWrap: { width: '100%', overflow: 'hidden', backgroundColor: '#ECECE8' },
  restaurantImage: { width: '100%', height: '100%' },
  restaurantCopy: { flex: 1, paddingHorizontal: 13, paddingTop: 11, paddingBottom: 13 },
  restaurantName: { paddingRight: 5, color: c.ink, fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: -.35 },
  cartHeaderWrap: { position: 'relative' },
  cartBadge: { position: 'absolute', right: -3, top: -2, minWidth: 19, height: 19, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#FF5B56', borderWidth: 2, borderColor: palette.canvas },
  cartBadgeText: { color: c.white, fontFamily: fonts.bold, fontSize: 10, lineHeight: 12 },
  restaurantMeta: { minHeight: 21, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { color: palette.inkSoft, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#BBBDBE' },
  restaurantEta: { color: palette.inkSoft, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  restaurantMuted: { marginTop: 2, color: c.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  restaurantDelivery: { marginTop: 4, color: '#6B737D', fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  discountBadge: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: palette.coral },
  discountText: { color: c.white, fontFamily: fonts.bold, fontSize: 12, lineHeight: 15 },
  empty: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyDishesImage: { width: 190, height: 190, marginBottom: 2 },
  emptyTitle: { color: c.ink, fontFamily: fonts.semibold, fontSize: 19, textAlign: 'center' },
  emptySubtitle: { color: c.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  heroImage: { width: '100%', height: '100%', backgroundColor: '#161916' },
  heroNav: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroNavRight: { flexDirection: 'row', gap: 10 },
  restaurantSheet: { marginTop: -24, paddingTop: 20, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, backgroundColor: palette.canvas },
  restaurantTitle: { marginBottom: 5, color: c.ink, fontFamily: fonts.extraBold, fontSize: 29, lineHeight: 35, letterSpacing: -1 },
  detailMetaRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 11 },
  detailRating: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailRatingText: { color: c.ink, fontFamily: fonts.semibold, fontSize: 15 },
  detailReview: { color: palette.inkSoft, fontFamily: fonts.regular },
  metaDivider: { height: 16, width: 1, backgroundColor: c.line },
  detailEta: { color: palette.inkSoft, fontFamily: fonts.medium, fontSize: 15 },
  deliveryLabel: { marginTop: 2, marginBottom: 3, color: c.muted, fontFamily: fonts.semibold, fontSize: 14 },
  freeDeliveryLabel: { color: c.green, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginBottom: 5 },
  restaurantAddressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 15 },
  restaurantAddress: { flex: 1, color: c.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  menuTabsFrame: { marginHorizontal: -20 },
  menuTabs: { gap: 8, paddingHorizontal: 20, paddingVertical: 5 },
  menuTab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 15, borderRadius: radii.pill, backgroundColor: palette.surface },
  menuTabSelected: { backgroundColor: c.ink },
  menuTabText: { color: palette.inkSoft, fontFamily: fonts.semibold, fontSize: 14 },
  menuTabActive: { color: c.white },
  menuTabUnderline: { display: 'none' },
  dishList: { paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  dishCard: { position: 'relative', overflow: 'hidden', borderRadius: radii.large, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  dishCardLink: { flex: 1 },
  dishImage: { width: '100%', backgroundColor: '#ECECE8' },
  dishCopy: { minHeight: 96, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 10 },
  dishCopyWithStepper: { minHeight: 132, paddingBottom: 53 },
  dishName: { minHeight: 36, paddingRight: 2, color: c.ink, fontFamily: fonts.regular, fontSize: 15, lineHeight: 18 },
  dishPortion: { marginTop: 3, color: c.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  dishPrice: { marginTop: 'auto', paddingTop: 5, paddingRight: 43, color: c.ink, fontFamily: fonts.medium, fontSize: 16, lineHeight: 21 },
  dishAddTarget: { position: 'absolute', right: 10, bottom: 10 },
  dishAdd: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.small, backgroundColor: c.white, shadowColor: '#27313F', shadowOpacity: .05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  dishStepper: { position: 'absolute', left: 9, right: 9, bottom: 9, height: 40, flexDirection: 'row', alignItems: 'center', borderRadius: 13, overflow: 'hidden', backgroundColor: c.blue, shadowColor: c.blue, shadowOpacity: .2, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  dishStepperButton: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center' },
  dishStepperCount: { flex: 1, color: c.white, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  cartDock: { paddingTop: 10, paddingHorizontal: 16, backgroundColor: c.white, borderTopLeftRadius: radii.large, borderTopRightRadius: radii.large, shadowColor: '#132449', shadowOpacity: .1, shadowOffset: { width: 0, height: -5 }, shadowRadius: 18, elevation: 7 },
  cartDockButton: { minHeight: 62, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, backgroundColor: palette.blueSoft, borderWidth: 1, borderColor: '#CFE3FF' },
  cartDockIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: c.white },
  cartDockCount: { position: 'absolute', right: -5, top: -5, minWidth: 20, height: 20, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.blue, borderWidth: 2, borderColor: palette.blueSoft },
  cartDockCountText: { color: c.white, fontFamily: fonts.bold, fontSize: 10 },
  cartDockCopy: { flex: 1 },
  cartDockTitle: { color: c.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  cartDockRestaurant: { marginTop: 1, color: c.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  cartDockTotal: { color: c.blue, fontFamily: fonts.bold, fontSize: 16 },
  footer: { paddingTop: 11, borderTopLeftRadius: radii.large, borderTopRightRadius: radii.large, backgroundColor: c.white, shadowColor: '#132449', shadowOpacity: .08, shadowOffset: { width: 0, height: -5 }, shadowRadius: 18, elevation: 5 },
  infoCard: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18, gap: 12, backgroundColor: c.white },
  infoHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoTitle: { flex: 1, color: c.ink, fontFamily: fonts.bold, fontSize: 23 },
  infoText: { color: palette.inkSoft, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  demoNote: { color: c.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  dishSheet: { marginTop: -24, paddingTop: 20, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, backgroundColor: palette.canvas },
  dishTitle: { color: c.ink, fontFamily: fonts.extraBold, fontSize: 28, letterSpacing: -.9, lineHeight: 34 },
  dishDetailPortion: { marginTop: 4, color: c.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  dishDescription: { marginTop: 8, color: palette.inkSoft, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  dishDetailPrice: { marginTop: 17, marginBottom: 14, color: c.ink, fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  divider: { height: 1, backgroundColor: c.line },
  quantityTitle: { marginTop: 16, marginBottom: 9, color: c.ink, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  quantityBar: { height: 60, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radii.medium, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  quantityMinus: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.small, backgroundColor: palette.surface },
  quantityPlus: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.small, backgroundColor: c.blue },
  quantityValue: { color: c.ink, fontFamily: fonts.semibold, fontSize: 19 },
  modifierSection: { marginTop: 22 },
  modifierHeader: { marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modifierTitle: { flex: 1, color: c.ink, fontFamily: fonts.bold, fontSize: 19, lineHeight: 25 },
  modifierHint: { color: c.muted, fontFamily: fonts.regular, fontSize: 13 },
  modifierFrame: { marginHorizontal: -21 },
  modifierCards: { gap: 10, paddingHorizontal: 21, paddingBottom: 3 },
  modifierCard: { width: 120, minHeight: 164, overflow: 'hidden', borderRadius: 18, backgroundColor: c.white, borderWidth: 1.5, borderColor: palette.line },
  modifierCardSelected: { borderColor: c.blue, backgroundColor: palette.blueSoft },
  modifierImage: { width: '100%', height: 88, backgroundColor: palette.surface },
  modifierCheck: { position: 'absolute', top: 7, right: 7, width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: c.blue, borderWidth: 2, borderColor: c.white },
  modifierName: { minHeight: 38, paddingHorizontal: 10, paddingTop: 8, color: c.ink, fontFamily: fonts.medium, fontSize: 13, lineHeight: 16 },
  modifierPrice: { paddingHorizontal: 10, paddingTop: 2, paddingBottom: 9, color: c.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
});
