import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomPanel } from '../BottomPanel';
import { SpringPressable } from '../design/motion';
import { palette } from '../design/tokens';
import { fonts } from '../design/typography';
import { useTheme } from '../design/theme';
import { FoodButton, FoodIconButton, foodColors as c, money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { RestaurantAdvertisements } from './RestaurantAdvertisements';
import { FoodPhoto } from './FoodPhoto';
import { cartSummary } from './cart';
import { DishCard } from './DishCard';
import { NumberTicker } from './NumberTicker';
import { CategoryArtwork } from './CategoryArtwork';
import { FoodFiltersSheet } from './FoodFiltersSheet';
import { RestaurantReviewsSheet } from './RestaurantReviewsSheet';
import { FoodDeliveryStatus } from './FoodDeliveryStatus';
import type { CartLine, FoodDish, FoodRestaurant, HomeBanner } from './types';
import { emptyRestaurantFilters, filterRestaurants, restaurantCategories, type RestaurantFilters } from './restaurantDiscovery';
import { useFoodT } from './i18n';

export { DishScreen } from './DishScreen';

const emptyDishQuantities: Record<string, number> = {};

const MenuDishes = memo(function MenuDishes({ dishes, width, quantities, orderingDisabled, onDish, onAdd, onDecrease }: {
  dishes: FoodDish[]; width: number; quantities: Record<string, number>; orderingDisabled: boolean;
  onDish: (dish: FoodDish) => void; onAdd: (dish: FoodDish) => void; onDecrease: (dish: FoodDish) => void;
}) {
  const s = useFoodStyles(baseStyles);
  return <View style={s.dishList}>{dishes.map(dish => <DishCard key={dish.id} dish={dish} width={width} format="grid"
    quantity={quantities[dish.id] || 0} orderingDisabled={orderingDisabled}
    onOpen={() => onDish(dish)} onIncrease={() => onAdd(dish)} onDecrease={() => onDecrease(dish)}/>)}</View>;
});

function EmptyState({ title, subtitle, dishes = false }: { title: string; subtitle?: string; dishes?: boolean }) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  return <View style={s.empty}>
    {dishes ? <Image source={require('../../assets/food/empty-dishes-3d.png')} resizeMode="contain" style={s.emptyDishesImage}/> : <Ionicons name="restaurant-outline" size={36} color={c.muted}/>}
    <Text style={s.emptyTitle}>{title}</Text>{!!subtitle && <Text style={s.emptySubtitle}>{subtitle}</Text>}
  </View>;
}

function CartDock({ lines, restaurant, onPress, onDeliveryInfo, bottom = 14, catalog = false, deliveryRestaurant, cartRestaurantCount = 1 }: {
  lines: CartLine[]; restaurant?: FoodRestaurant; onPress: () => void; onDeliveryInfo: () => void; bottom?: number; catalog?: boolean; deliveryRestaurant?: FoodRestaurant; cartRestaurantCount?: number;
}) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  const summary = cartSummary(restaurant, lines);
  const subtotal = restaurant?.id === deliveryRestaurant?.id ? summary.subtotal : 0;
  if (!lines.length && !deliveryRestaurant) return null;
  return <View pointerEvents="box-none" style={[s.cartDock, !catalog && { backgroundColor: 'transparent', paddingTop: lines.length ? 70 : 8 }, { paddingBottom: bottom }]}>
    {!catalog && <View pointerEvents="none" style={[s.restaurantDeliverySurface, { top: lines.length ? 62 : 0 }]}/>}
    {!!deliveryRestaurant && <FoodDeliveryStatus restaurant={deliveryRestaurant} subtotal={subtotal} subtotalBeforeDiscount={restaurant?.id === deliveryRestaurant.id ? summary.subtotalBeforeDiscount : 0} onPress={onDeliveryInfo}/>}
    {!!lines.length && <SpringPressable accessibilityRole="button" accessibilityLabel={`${t('Открыть корзину')}, ${summary.count} ${t('товаров')} · ${money(summary.total)}`} onPress={onPress} pressScale={.985} containerStyle={!catalog ? s.restaurantCartFloat : undefined} style={[catalog ? s.cartDockButton : s.restaurantCartPill, { backgroundColor: palette.blue }]}>
      {catalog ? <Text style={[s.cartDockTitle, { color: '#FFFFFF' }]}>{t('Корзины')} · {cartRestaurantCount}</Text> : <><NumberTicker value={summary.total} format={money} style={[s.cartDockTotal, { color: '#FFFFFF' }]} height={24}/><Ionicons name="basket" size={24} color="#FFFFFF"/></>}
    </SpringPressable>}
  </View>;
}

function RestaurantCard({ restaurant, width, favorite, onFavorite, onPress }: { restaurant: FoodRestaurant; width: number; favorite: boolean; onFavorite?: () => void; onPress: () => void }) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const [page, setPage] = useState(0);
  const slides = useMemo(() => {
    const seen = new Set([restaurant.imageUrl || restaurant.imageKey]);
    const dishes = restaurant.dishes.filter(dish => { const key = dish.imageUrl || dish.imageKey; if (!dish.available || !key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 2);
    return [{ key: restaurant.id, imageKey: restaurant.imageKey, imageUrl: restaurant.imageUrl, dish: undefined as FoodDish | undefined }, ...dishes.map(dish => ({ key: dish.id, imageKey: dish.imageKey, imageUrl: dish.imageUrl, dish }))];
  }, [restaurant]);
  const selectedPage = Math.min(page, slides.length - 1);
  const photoHeight = selectedPage === 0 ? width / 2.04 : width * .95;
  return <View testID={`restaurant-card-${restaurant.id}`} style={s.discoveryRestaurantCard}>
    <View style={[s.discoveryRestaurantPhoto, { height: photoHeight }]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={event => setPage(Math.round(event.nativeEvent.contentOffset.x / width))}>
        {slides.map(slide => <Pressable key={slide.key} accessibilityRole="button" accessibilityLabel={`${t('Открыть')} ${restaurant.name}${slide.dish ? `, ${slide.dish.name}` : ''}`} onPress={onPress} style={{ width, height: photoHeight }}>
          <FoodPhoto imageKey={slide.imageKey} imageUrl={slide.imageUrl} resizeMode="cover" style={s.restaurantImage}/>
          {!!slide.dish && <View style={s.discoveryDishCaption}><Text style={s.discoveryDishPrice}>{money(slide.dish.price)}</Text><Text style={s.discoveryDishName}>{slide.dish.name}</Text></View>}
        </Pressable>)}
      </ScrollView>
      {selectedPage === 0 && !!restaurant.discountPercent && restaurant.discountPercent > 0 && <View style={s.discoveryDiscount}><Text style={s.discoveryDiscountText}>−{restaurant.discountPercent}%</Text></View>}
      {onFavorite && <Pressable accessibilityRole="button" accessibilityLabel={`${t(favorite ? 'Убрать из избранного' : 'Добавить в избранное')}: ${restaurant.name}`} accessibilityState={{ selected: favorite }} onPress={onFavorite} style={s.discoveryFavorite}>
        {favorite && <Ionicons name="heart" size={29} color="#FFFFFF" style={s.discoveryHeartOutline}/>}<Ionicons name={favorite ? 'heart' : 'heart-outline'} size={25} color={favorite ? '#FF4D40' : '#FFFFFF'} style={s.discoveryHeartShadow}/>
      </Pressable>}
      {slides.length > 1 && <View pointerEvents="none" style={s.discoveryPagination}>{slides.map((slide, index) => <View key={slide.key} style={[s.discoveryDot, index === selectedPage && s.discoveryDotSelected]}/>)}</View>}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('Открыть')} ${restaurant.name}`} onPress={onPress} style={s.discoveryRestaurantCopy}>
      <View style={s.discoveryRestaurantHeading}><Text numberOfLines={2} style={s.discoveryRestaurantName}>{restaurant.name}</Text>{restaurant.rating > 0 && <View style={s.discoveryRating}><Ionicons name="star" size={16} color={c.ink}/><Text style={s.discoveryRatingText}>{restaurant.rating.toFixed(1)}</Text></View>}</View>
      <View style={s.discoveryRestaurantMeta}><View style={s.discoveryEta}><Ionicons name="walk" size={17} color={c.ink}/><Text style={s.discoveryMetaText}>{restaurant.etaMin}–{restaurant.etaMax} {t('мин')}</Text></View><Text numberOfLines={2} style={s.discoveryCuisine}>{t(restaurant.categories.join(', ') || restaurant.cuisine)}</Text></View>
      {restaurant.deliveryFee === 0 && <View style={s.discoveryFreeDelivery}><Text style={s.discoveryFreeDeliveryText}>{t('Бесплатная доставка')}</Text></View>}
    </Pressable>
  </View>;
}

export function RestaurantsScreen({ restaurants, onBack, onRestaurant, onFavorites, favoriteCount, onCart, onDeliveryInfo, cartLines = [], cartRestaurant, cartRestaurantCount = 1, loading, error, onRetry, banners = [], onBanner, favoriteIds = [], onToggleFavorite }: {
  restaurants: FoodRestaurant[]; onBack: () => void; onRestaurant: (restaurant: FoodRestaurant) => void; onFavorites: () => void; favoriteCount: number; onCart: () => void; onDeliveryInfo: () => void;
  cartCount: number; cartTotal: number; cartRestaurantName?: string; cartLines?: CartLine[]; cartRestaurant?: FoodRestaurant; cartRestaurantCount?: number; loading?: boolean; error?: string | null; onRetry?: () => void;
  banners?: HomeBanner[]; onBanner?: (banner: HomeBanner) => void; favoriteIds?: string[]; onToggleFavorite?: (restaurant: FoodRestaurant) => void; currentAddress?: string; onChangeAddress?: () => void;
}) {
  const t = useFoodT(); const s = useFoodStyles(baseStyles); const c = useFoodColors(); const theme = useTheme();
  const insets = useSafeAreaInsets(); const { width } = useWindowDimensions();
  const [category, setCategory] = useState('Все');
  const [filters, setFilters] = useState<RestaurantFilters>(emptyRestaurantFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const categories = useMemo(() => restaurantCategories(restaurants), [restaurants]);
  useEffect(() => { if (category !== 'Все' && !categories.some(item => item.name === category)) setCategory('Все'); }, [categories, category]);
  const filtered = filterRestaurants(restaurants, '', category, filters);
  const contentWidth = Math.max(1, width - insets.left - insets.right - 32);
  const activeCount = (category === 'Все' ? 0 : 1) + filters.dishes.length + filters.cuisines.length + Number(filters.sort !== 'default');
  return <SafeAreaView style={[s.screen, { backgroundColor: theme.isDark ? theme.palette.background : '#FFFFFF' }]} edges={['top', 'left', 'right']}>
    <View style={s.flex} accessibilityElementsHidden={filtersOpen} importantForAccessibility={filtersOpen ? 'no-hide-descendants' : 'auto'}>
      <ScrollView testID="restaurants-list" style={s.flex} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: cartLines.length ? 88 + Math.max(insets.bottom, 14) : Math.max(insets.bottom, 24) }}>
        <View style={s.discoveryNav}>
          <FoodIconButton name="arrow-back" label={t('Назад')} onPress={onBack} size={27} style={s.discoveryNavButton}/>
          <FoodIconButton name="heart-outline" label={`${t('Избранное')}${favoriteCount ? `: ${favoriteCount}` : ''}`} onPress={onFavorites} size={28} style={s.discoveryNavButton}/>
        </View>
        <Text accessibilityRole="header" style={s.discoveryTitle}>{t('Рестораны')}</Text>
        <RestaurantAdvertisements restaurants={restaurants} banners={banners} width={contentWidth} onBanner={onBanner} onRestaurant={onRestaurant}/>
        {!!categories.length && <ScrollView testID="restaurant-categories" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.discoveryCategories}>
          {categories.map(item => <Pressable key={item.name} accessibilityRole="button" accessibilityLabel={t(item.name)} accessibilityState={{ selected: item.name === category }} onPress={() => setCategory(value => value === item.name ? 'Все' : item.name)} style={s.discoveryCategory}>
            <CategoryArtwork name={item.name} imageKey={item.imageKey} imageUrl={item.imageUrl} size={70}/><Text numberOfLines={1} style={[s.discoveryCategoryName, item.name === category && s.discoveryCategorySelected]}>{t(item.name)}</Text>
          </Pressable>)}
        </ScrollView>}
        <View style={s.discoveryFilterRow}>
          <View><FoodIconButton name="options" label={activeCount ? `${t('Фильтры')}: ${activeCount}` : t('Фильтры')} onPress={() => setFiltersOpen(true)} size={23} style={s.discoveryFilterButton}/>{activeCount > 0 && <View pointerEvents="none" style={s.filterCount}><Text style={s.filterCountText}>{activeCount}</Text></View>}</View>
          {activeCount > 0 && <Pressable accessibilityRole="button" onPress={() => { setFilters(emptyRestaurantFilters()); setCategory('Все'); }} style={s.discoverySelectedFilter}><Text style={s.discoverySelectedFilterText}>{t('Сбросить')}</Text><Ionicons name="close" size={16} color={c.ink}/></Pressable>}
        </View>
        {loading && !restaurants.length ? <View style={s.empty}><ActivityIndicator color={c.ink} size="large"/><Text style={s.emptySubtitle}>{t('Ищем рестораны…')}</Text></View>
          : error && !restaurants.length ? <View style={s.empty}><Text style={s.emptyTitle}>{t('Не удалось загрузить рестораны')}</Text><Text style={s.emptySubtitle}>{error}</Text>{onRetry && <FoodButton label={t('Повторить')} onPress={onRetry}/>}</View>
          : <View style={s.discoveryRestaurantList}>
            {filtered.map(restaurant => <RestaurantCard key={restaurant.id} restaurant={restaurant} width={contentWidth} favorite={favoriteIds.includes(restaurant.id)} onFavorite={onToggleFavorite ? () => onToggleFavorite(restaurant) : undefined} onPress={() => onRestaurant(restaurant)}/>)}
            {!filtered.length && <EmptyState title={t(!restaurants.length ? 'Рестораны скоро появятся' : 'Ничего не найдено')} subtitle={t(!restaurants.length ? 'Мы готовим каталог. Загляните немного позже.' : 'Попробуйте другую кухню или измените фильтры.')}/>}
          </View>}
      </ScrollView>
      <CartDock catalog lines={cartLines} restaurant={cartRestaurant} cartRestaurantCount={cartRestaurantCount} onPress={onCart} onDeliveryInfo={onDeliveryInfo} bottom={Math.max(insets.bottom, 12)}/>
    </View>
    {filtersOpen && <FoodFiltersSheet value={{ ...filters, dishes: category === 'Все' ? filters.dishes : [...new Set([...filters.dishes, category])] }} onApply={next => { setCategory('Все'); setFilters(next); }} onClose={() => setFiltersOpen(false)}/>}
  </SafeAreaView>;
}

export function RestaurantScreen({ restaurant, onBack, onDish, onAdd, onDecrease, onCart, onDeliveryInfo, cartLines = [], cartRestaurant, cartRestaurantCount = 1, dishQuantities = emptyDishQuantities, favorite, onFavorite, currentAddress, onChangeAddress }: {
  restaurant: FoodRestaurant; onBack: () => void; onDish: (dish: FoodDish) => void; onAdd: (dish: FoodDish) => void; onDecrease: (dish: FoodDish) => void; onCart: () => void; onDeliveryInfo: () => void;
  cartCount: number; cartTotal: number; cartRestaurantName?: string; cartLines?: CartLine[]; cartRestaurant?: FoodRestaurant; cartRestaurantCount?: number; dishQuantities?: Record<string, number>; favorite: boolean; onFavorite: () => void;
  currentAddress?: string; onChangeAddress?: () => void;
}) {
  const t = useFoodT(); const s = useFoodStyles(baseStyles); const c = useFoodColors(); const theme = useTheme();
  const insets = useSafeAreaInsets(); const { width } = useWindowDimensions();
  const offerDishes = useMemo(() => restaurant.dishes.filter(dish => dish.category === 'Акции' || (dish.originalPrice ?? 0) > dish.price), [restaurant.dishes]);
  const offerPercent = restaurant.discountPercent || Math.max(0, ...offerDishes.map(dish => dish.originalPrice ? Math.round((1 - dish.price / dish.originalPrice) * 100) : 0));
  const menuSections = useMemo(() => [...new Set([
    ...(offerDishes.length ? ['Акции'] : []), ...restaurant.menuCategories, ...restaurant.dishes.map(dish => dish.category || 'Все'),
  ])].map(name => ({ name, dishes: name === 'Акции' ? offerDishes : restaurant.dishes.filter(dish => (dish.category || 'Все') === name) })).filter(section => section.dishes.length), [restaurant.menuCategories, restaurant.dishes, offerDishes]);
  const menuCategories = useMemo(() => menuSections.map(section => section.name), [menuSections]);
  const [category, setCategory] = useState(() => menuCategories[0] || 'Все'); const [search, setSearch] = useState(''); const [showSearch, setShowSearch] = useState(false);
  const [showInfo, setShowInfo] = useState(false); const [closingInfo, setClosingInfo] = useState(false); const searchInput = useRef<TextInput>(null);
  const [showReviews, setShowReviews] = useState(false);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const menuTabsRef = useRef<ScrollView>(null); const stickyTabsRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({}); const tabOffsets = useRef<Record<string, number>>({});
  const sheetOffset = useRef(0); const stickyHeight = useRef(105); const pendingCategoryScroll = useRef<string | null>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  const introHeight = useSharedValue(280);
  const menuTop = useSharedValue(0);
  const fixedHeaderHeight = useSharedValue(105);
  const sectionPositions = useSharedValue<{ name: string; y: number }[]>([]);
  const scrollCategory = useSharedValue(menuCategories[0] || 'Все');
  const scrollCompact = useSharedValue(false);
  const scrollToCategory = (item: string) => {
    const sectionY = sectionOffsets.current[item];
    if (sectionY == null) return;
    pendingCategoryScroll.current = null;
    scrollRef.current?.scrollTo({ y: Math.max(0, sheetOffset.current + sectionY - stickyHeight.current - 6), animated: true });
  };
  const chooseCategory = (item: string) => {
    setCategory(item);
    if (search.trim()) { pendingCategoryScroll.current = item; setSearch(''); }
    else scrollToCategory(item);
  };
  const openSearch = () => { setShowSearch(value => !value); setSearch(''); scrollRef.current?.scrollTo({ y: 0, animated: true }); };
  useEffect(() => { if (!menuCategories.includes(category)) setCategory(menuCategories[0] || 'Все'); }, [menuCategories, category]);
  useEffect(() => {
    const x = Math.max(0, (tabOffsets.current[category] || 0) - 40);
    menuTabsRef.current?.scrollTo({ x, animated: true }); stickyTabsRef.current?.scrollTo({ x, animated: true });
  }, [category]);
  useEffect(() => {
    if (search.trim() || !pendingCategoryScroll.current) return;
    const frame = requestAnimationFrame(() => { if (pendingCategoryScroll.current) scrollToCategory(pendingCategoryScroll.current); });
    return () => cancelAnimationFrame(frame);
  }, [search]);
  useEffect(() => { if (!showSearch) return; const frame = requestAnimationFrame(() => searchInput.current?.focus()); return () => cancelAnimationFrame(frame); }, [showSearch]);
  const query = search.trim().toLocaleLowerCase('ru');
  const visibleSections = useMemo(() => query ? menuSections.map(section => ({ ...section, dishes: section.dishes.filter(dish => `${dish.name} ${dish.description}`.toLocaleLowerCase('ru').includes(query)) })).filter(section => section.dishes.length) : menuSections, [menuSections, query]);
  const firstSection = visibleSections[0]?.name || 'Все';
  const lastSection = visibleSections[visibleSections.length - 1]?.name || firstSection;
  const onMenuScroll = useAnimatedScrollHandler(event => {
    const y = event.contentOffset.y;
    const compact = y >= introHeight.value - 52;
    if (scrollCompact.value !== compact) {
      scrollCompact.value = compact;
      runOnJS(setCompactHeader)(compact);
    }
    const visibleY = y + fixedHeaderHeight.value + 12 - menuTop.value;
    let currentSection = firstSection;
    for (const section of sectionPositions.value) {
      if (section.y <= visibleY) currentSection = section.name;
    }
    if (event.contentSize && event.layoutMeasurement && y + event.layoutMeasurement.height >= event.contentSize.height - 4) currentSection = lastSection;
    // Scroll frames stay on the UI thread. React only updates at a section or
    // sticky-header boundary, so the dish grid is never rerendered per frame.
    if (scrollCategory.value !== currentSection) {
      scrollCategory.value = currentSection;
      runOnJS(setCategory)(currentSection);
    }
  });
  useEffect(() => {
    sectionPositions.value = visibleSections.flatMap(section => sectionOffsets.current[section.name] == null ? [] : [{ name: section.name, y: sectionOffsets.current[section.name] }]);
  }, [sectionPositions, visibleSections]);
  const dishGridWidth = Math.max(1, width - insets.left - insets.right - 32); const dishCardWidth = (dishGridWidth - 12) / 2;
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <View accessibilityElementsHidden={showInfo || showReviews} importantForAccessibility={showInfo || showReviews ? 'no-hide-descendants' : 'auto'} style={s.flex}>
      <Animated.ScrollView ref={scrollRef} testID="restaurant-menu" style={s.flex} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={onMenuScroll} contentContainerStyle={{ paddingBottom: (cartLines.length ? 168 : 100) + Math.max(insets.bottom, 12) }}>
        <View onLayout={event => { introHeight.value = event.nativeEvent.layout.height; }} accessibilityElementsHidden={compactHeader} importantForAccessibility={compactHeader ? 'no-hide-descendants' : 'auto'} style={s.restaurantIntro}>
          <View style={s.discoveryNav}><FoodIconButton name="arrow-back" label={t('Назад')} onPress={onBack} size={27} style={s.discoveryNavButton}/><View style={s.discoveryNavRight}>
            <FoodIconButton name="search-outline" label={t('Поиск по меню')} onPress={openSearch} size={28} style={s.discoveryNavButton}/>
            <FoodIconButton name={favorite ? 'heart' : 'heart-outline'} label={t(favorite ? 'Убрать из избранного' : 'Добавить в избранное')} color={favorite ? '#FF4D40' : c.ink} onPress={onFavorite} size={28} style={s.discoveryNavButton}/>
          </View></View>
          <Text accessibilityRole="header" style={s.restaurantTitle}>{restaurant.name}</Text>
          <View style={s.detailMetaRow}>
            {restaurant.rating > 0 && <><Pressable accessibilityRole="button" accessibilityLabel={t('Отзывы о ресторане')} onPress={() => setShowReviews(true)} style={s.detailRating}>
              <Ionicons name="star" size={28} color={c.ink}/><View><Text style={s.detailRatingText}>{restaurant.rating.toFixed(1)}{restaurant.reviewCount > 0 ? ` (${restaurant.reviewCount})` : ''}</Text><View style={s.detailMetaLink}><Text style={s.detailMetaCaption}>{t('Смотреть')}</Text><Ionicons name="chevron-forward" size={14} color={c.muted}/></View></View>
            </Pressable><View style={s.metaDivider}/></>}
            <Pressable accessibilityRole="button" accessibilityLabel={t('Условия доставки')} onPress={onDeliveryInfo} style={s.detailRating}><Ionicons name="walk" size={28} color={c.ink}/><View><Text style={s.detailRatingText}>{restaurant.etaMin}–{restaurant.etaMax} {t('минут')}</Text><Text style={s.detailMetaCaption}>{t('Доставка')}</Text></View></Pressable>
            <View style={s.metaDivider}/><FoodIconButton name="ellipsis-vertical" label={t('Информация о ресторане')} onPress={() => setShowInfo(true)} size={23} style={s.detailInfoButton}/>
          </View>
          {showSearch && <View style={s.restaurantSearch}><View style={s.search}><Ionicons name="search-outline" size={22} color={c.muted}/><TextInput ref={searchInput} accessibilityLabel={t('Поиск по меню')} placeholder={t('Поиск по меню')} placeholderTextColor={c.muted} value={search} onChangeText={setSearch} style={s.searchInput} returnKeyType="search" autoCorrect={false}/>{!!search && <FoodIconButton name="close-circle" label={t('Очистить поиск')} color={c.muted} size={19} onPress={() => setSearch('')}/>}</View></View>}
          <View testID="restaurant-service-summary" style={s.restaurantServiceSummary}>
            {offerPercent > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`${t('Акции')}: −${offerPercent}%`} hitSlop={10} onPress={() => { if (offerDishes.length) chooseCategory('Акции'); else setShowInfo(true); }} style={s.restaurantOfferBadge}>
              <Text style={s.discoveryFreeDeliveryText}>−{offerPercent}%</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={t('Условия доставки')} hitSlop={10} onPress={onDeliveryInfo} style={restaurant.deliveryFee === 0 ? s.restaurantOfferBadge : s.restaurantDeliverySummary}>
              <Text style={restaurant.deliveryFee === 0 ? s.discoveryFreeDeliveryText : s.restaurantDeliveryText}>{restaurant.deliveryFee === 0 ? t('Бесплатная доставка') : `${t('Доставка')} ${money(restaurant.deliveryFee)}`}</Text>
            </Pressable>
            {restaurant.deliveryFee > 0 && !!restaurant.freeDeliveryThreshold && <Text style={s.restaurantDeliveryNote}>{t('Бесплатно от')} {money(restaurant.freeDeliveryThreshold)}</Text>}
          </View>
        </View>
        <View onLayout={event => { sheetOffset.current = event.nativeEvent.layout.y; menuTop.value = sheetOffset.current; }} style={s.restaurantSheet}><ScrollView ref={menuTabsRef} horizontal accessibilityElementsHidden={compactHeader} importantForAccessibility={compactHeader ? 'no-hide-descendants' : 'auto'} showsHorizontalScrollIndicator={false} contentContainerStyle={s.menuTabs}>
          {menuCategories.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityLabel={t(item)} accessibilityState={{ selected: category === item }} onLayout={event => { tabOffsets.current[item] = event.nativeEvent.layout.x; }} onPress={() => chooseCategory(item)} style={[s.menuTab, category === item && s.menuTabSelected]}><Text style={[s.menuTabText, category === item && s.menuTabActive]}>{t(item)}</Text></Pressable>)}
        </ScrollView>
          {visibleSections.map(section => <View key={section.name} testID={`restaurant-menu-section-${section.name}`} onLayout={event => {
            sectionOffsets.current[section.name] = event.nativeEvent.layout.y;
            sectionPositions.value = visibleSections.flatMap(item => sectionOffsets.current[item.name] == null ? [] : [{ name: item.name, y: sectionOffsets.current[item.name] }]);
            if (pendingCategoryScroll.current === section.name) scrollToCategory(section.name);
          }} style={s.menuSection}>
            <Text accessibilityRole="header" style={s.menuSectionTitle}>{t(section.name)}</Text>
            <MenuDishes dishes={section.dishes} width={dishCardWidth} quantities={dishQuantities} orderingDisabled={restaurant.isOpen === false} onDish={onDish} onAdd={onAdd} onDecrease={onDecrease}/>
          </View>)}
          {!visibleSections.length && <EmptyState dishes title={t('Блюда не найдены')} subtitle={t(query ? 'Измените запрос.' : 'Выберите другую категорию.')}/>}
        </View>
      </Animated.ScrollView>
      {compactHeader && <View testID="restaurant-sticky-header" onLayout={event => { stickyHeight.current = event.nativeEvent.layout.height; fixedHeaderHeight.value = stickyHeight.current; stickyTabsRef.current?.scrollTo({ x: Math.max(0, (tabOffsets.current[category] || 0) - 40), animated: false }); }} style={s.stickyHeader}>
        <View style={s.compactNav}><FoodIconButton name="arrow-back" label={t('Назад')} onPress={onBack} size={27} style={s.discoveryNavButton}/><Text numberOfLines={1} style={s.compactTitle}>{restaurant.name}</Text><View style={s.discoveryNavRight}>
          <FoodIconButton name="search-outline" label={t('Поиск по меню')} onPress={openSearch} size={27} style={s.discoveryNavButton}/><FoodIconButton name={favorite ? 'heart' : 'heart-outline'} label={t(favorite ? 'Убрать из избранного' : 'Добавить в избранное')} color={favorite ? '#FF4D40' : c.ink} onPress={onFavorite} size={27} style={s.discoveryNavButton}/>
        </View></View>
        <ScrollView ref={stickyTabsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.menuTabs}>{menuCategories.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityLabel={t(item)} accessibilityState={{ selected: category === item }} onPress={() => chooseCategory(item)} style={[s.menuTab, category === item && s.menuTabSelected]}><Text style={[s.menuTabText, category === item && s.menuTabActive]}>{t(item)}</Text></Pressable>)}</ScrollView>
      </View>}
      <CartDock lines={cartLines} restaurant={cartRestaurant} deliveryRestaurant={restaurant} cartRestaurantCount={cartRestaurantCount} onPress={onCart} onDeliveryInfo={onDeliveryInfo} bottom={Math.max(insets.bottom, 12)}/>
    </View>
    {showReviews && <RestaurantReviewsSheet restaurant={restaurant} onClose={() => setShowReviews(false)}/>}
    {showInfo && <BottomPanel closeRequested={closingInfo} onClose={() => { setShowInfo(false); setClosingInfo(false); }} label={t('Закрыть информацию о ресторане')}>
      <View style={[s.infoCard, { backgroundColor: theme.isDark ? theme.palette.surface : '#FFFFFF' }]}><View style={s.infoHeading}><Text style={s.infoTitle}>{restaurant.name}</Text><FoodIconButton name="close" label={t('Закрыть')} onPress={() => setClosingInfo(true)}/></View>
        <Text style={s.infoText}>{t(restaurant.cuisine)}</Text><Text style={s.infoText}>{restaurant.address}</Text>{!!restaurant.phone && <Text selectable style={s.infoText}>{restaurant.phone}</Text>}
        <Text style={s.infoText}>{t('Доставка')}: {restaurant.etaMin}–{restaurant.etaMax} {t('мин')}{restaurant.deliveryFee === 0 ? `, ${t('бесплатно')}` : `, ${money(restaurant.deliveryFee)}`}</Text>
        <Text style={s.infoText}>{restaurant.minimumOrder ? `${t('Минимальный заказ')} — ${money(restaurant.minimumOrder)}` : t('Без минимальной суммы заказа')}</Text>
        {onChangeAddress && <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить адрес доставки')} onPress={() => { setShowInfo(false); onChangeAddress(); }} style={s.infoAddress}><Ionicons name="location-outline" size={20} color={c.ink}/><Text style={s.infoAddressText}>{currentAddress || t('Указать адрес доставки')}</Text><Ionicons name="chevron-forward" size={18} color={c.muted}/></Pressable>}
        {restaurant.isDemo && <Text style={s.demoNote}>{t('Демонстрационный ресторан. Заказы не передаются в реальное заведение.')}</Text>}
      </View>
    </BottomPanel>}
  </SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F7F5' }, flex: { flex: 1 },
  discoveryNav: { minHeight: 52, paddingHorizontal: 10, paddingTop: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  discoveryNavRight: { flexDirection: 'row', gap: 3 }, discoveryNavButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  discoveryTitle: { marginHorizontal: 16, marginTop: 3, marginBottom: 14, color: c.ink, fontFamily: 'FoodDisplayBold', fontSize: 31, lineHeight: 40, letterSpacing: -.6 },
  discoveryBanners: { paddingHorizontal: 16, gap: 8, paddingBottom: 20 }, discoveryBanner: { overflow: 'hidden', borderRadius: 17, backgroundColor: '#E9F7F0' },
  discoveryBannerCopy: { flex: 1, justifyContent: 'center', padding: 14, gap: 4 }, discoveryBannerTitle: { color: c.ink, fontFamily: fonts.extraBold, fontSize: 20, lineHeight: 24 }, discoveryBannerSubtitle: { color: c.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  discoveryCategories: { paddingHorizontal: 12, paddingTop: 5, paddingBottom: 13, gap: 3 }, discoveryCategory: { width: 74, alignItems: 'center', gap: 6 },
  discoveryCategoryName: { color: c.ink, fontFamily: fonts.medium, fontSize: 12, lineHeight: 19, textAlign: 'center', paddingHorizontal: 4, borderRadius: 6, overflow: 'hidden' }, discoveryCategorySelected: { color: '#FFFFFF', backgroundColor: palette.blue },
  discoveryFilterRow: { marginHorizontal: 14, marginTop: 1, marginBottom: 28, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9 }, discoveryFilterButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surface },
  filterCount: { position: 'absolute', top: -2, right: -2, minWidth: 17, height: 17, paddingHorizontal: 3, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blue }, filterCountText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 10 },
  discoverySelectedFilter: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: palette.surface }, discoverySelectedFilterText: { color: c.ink, fontFamily: fonts.medium, fontSize: 13 },
  discoveryRestaurantList: { paddingHorizontal: 16, gap: 26 }, discoveryRestaurantCard: { position: 'relative' }, discoveryRestaurantPhoto: { width: '100%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#ECECE8' }, restaurantImage: { width: '100%', height: '100%' },
  discoveryRestaurantCopy: { paddingHorizontal: 7, paddingTop: 7, gap: 3 }, discoveryRestaurantHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  discoveryRestaurantName: { flex: 1, color: c.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, letterSpacing: -.25 }, discoveryRating: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 21 }, discoveryRatingText: { color: c.ink, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  discoveryRestaurantMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, discoveryEta: { flexDirection: 'row', alignItems: 'center', gap: 3 }, discoveryMetaText: { color: c.ink, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }, discoveryCuisine: { flex: 1, color: c.ink, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'right' },
  discoveryDiscount: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: '#009B61' }, discoveryDiscountText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  discoveryFreeDelivery: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: '#009B61' }, discoveryFreeDeliveryText: { color: '#FFFFFF', fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  discoveryFavorite: { position: 'absolute', top: 5, right: 5, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, discoveryHeartOutline: { position: 'absolute' }, discoveryHeartShadow: { textShadowColor: 'rgba(0,0,0,.18)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  discoveryPagination: { position: 'absolute', bottom: 9, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, height: 21, borderRadius: 12, backgroundColor: 'rgba(0,0,0,.30)' }, discoveryDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF', opacity: .9 }, discoveryDotSelected: { width: 8, height: 8, borderRadius: 4, opacity: 1 },
  discoveryDishCaption: { position: 'absolute', left: 13, right: 55, bottom: 14, gap: 3 }, discoveryDishPrice: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 21, lineHeight: 28, textShadowColor: 'rgba(0,0,0,.3)', textShadowRadius: 6 }, discoveryDishName: { color: '#FFFFFF', fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, textShadowColor: 'rgba(0,0,0,.3)', textShadowRadius: 6 },
  search: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderRadius: 16, backgroundColor: palette.surface }, searchInput: { flex: 1, paddingVertical: 11, color: c.ink, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  empty: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 12 }, emptyDishesImage: { width: 190, height: 190 }, emptyTitle: { color: c.ink, fontFamily: fonts.semibold, fontSize: 19, textAlign: 'center' }, emptySubtitle: { color: c.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  restaurantIntro: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 26, borderBottomRightRadius: 26, paddingBottom: 22 }, restaurantTitle: { marginHorizontal: 16, marginTop: 6, marginBottom: 14, color: c.ink, fontFamily: 'FoodDisplayBold', fontSize: 34, lineHeight: 42, letterSpacing: -.6 },
  detailMetaRow: { marginHorizontal: 16, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10 }, detailRating: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }, detailRatingText: { color: c.ink, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  detailMetaLink: { flexDirection: 'row', alignItems: 'center' }, detailMetaCaption: { color: c.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }, metaDivider: { height: 25, width: 1, backgroundColor: '#D4D6DA' }, detailInfoButton: { width: 30, height: 36 },
  restaurantSearch: { marginHorizontal: 16, marginTop: 16 },
  restaurantServiceSummary: { marginHorizontal: 16, marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  restaurantOfferBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: '#009B61' },
  restaurantDeliverySummary: { paddingVertical: 4 }, restaurantDeliveryText: { color: c.ink, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 }, restaurantDeliveryNote: { color: '#169B62', fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  stickyHeader: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', paddingBottom: 8, zIndex: 3 }, compactNav: { height: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }, compactTitle: { flex: 1, paddingLeft: 35, color: c.ink, fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  restaurantSheet: { marginTop: 4, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#FFFFFF', paddingTop: 12, paddingBottom: 20 }, menuTabs: { gap: 22, paddingHorizontal: 16, paddingBottom: 7 }, menuTab: { height: 38, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  menuSection: { paddingTop: 12, paddingBottom: 4 }, menuSectionTitle: { marginHorizontal: 16, marginBottom: 10, color: c.ink, fontFamily: 'FoodDisplayBold', fontSize: 25, lineHeight: 32 },
  menuTabSelected: { borderBottomColor: '#111318' }, menuTabText: { color: c.muted, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 }, menuTabActive: { color: c.ink, fontFamily: fonts.medium }, dishList: { paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18, columnGap: 12 },
  cartDock: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 8, paddingHorizontal: 8, backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }, cartDockButton: { minHeight: 58, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, borderRadius: 18, backgroundColor: '#FFE500' },
  cartDockTitle: { color: '#242424', fontFamily: fonts.medium, fontSize: 17, lineHeight: 24 }, cartDockTotal: { color: '#242424', fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  restaurantCartFloat: { position: 'absolute', right: 8, top: 0 }, restaurantCartPill: { minHeight: 54, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 30, backgroundColor: '#FFE500' }, restaurantDeliverySurface: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#FFFFFF' },
  infoCard: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18, gap: 12, backgroundColor: '#FFFFFF' }, infoHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, infoTitle: { flex: 1, color: c.ink, fontFamily: 'FoodDisplayBold', fontSize: 24 }, infoText: { color: palette.inkSoft, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 }, demoNote: { color: c.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  infoAddress: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, infoAddressText: { flex: 1, color: c.ink, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
});
