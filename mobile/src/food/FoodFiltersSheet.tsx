import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel } from '../BottomPanel';
import { fonts } from '../design/typography';
import { palette } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useFoodStyles } from './foodTheme';
import { CategoryArtwork, filterCuisines, filterDishCategories } from './CategoryArtwork';
import { emptyRestaurantFilters, isFoodFilterCategoryAllowed, type RestaurantFilters } from './restaurantDiscovery';
import { useFoodT } from './i18n';

export function FoodFiltersSheet({ value, onApply, onClose }: { value: RestaurantFilters; onApply: (filters: RestaurantFilters) => void; onClose: () => void }) {
  const t = useFoodT();
  const s = useFoodStyles(styles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<RestaurantFilters>(() => ({ ...value, dishes: value.dishes.filter(isFoodFilterCategoryAllowed), cuisines: value.cuisines.filter(isFoodFilterCategoryAllowed) }));
  const [closing, setClosing] = useState(false);
  const tileSize = Math.min(88, (width - insets.left - insets.right - 36) / 4 - 8);
  const toggle = (field: 'dishes' | 'cuisines', name: string) => setDraft(current => ({ ...current, [field]: current[field].includes(name) ? current[field].filter(item => item !== name) : [...current[field], name] }));
  const grid = (title: string, field: 'dishes' | 'cuisines', names: string[]) => <View style={s.section}>
    <Text accessibilityRole="header" style={s.heading}>{t(title)}</Text>
    <View style={s.grid}>{[...names, ...draft[field].filter(name => !names.includes(name))].filter(isFoodFilterCategoryAllowed).map(name => <Pressable key={name} accessibilityRole="checkbox" accessibilityLabel={t(name)} accessibilityState={{ checked: draft[field].includes(name) }}
      onPress={() => toggle(field, name)} style={s.tile}>
      <CategoryArtwork name={name} size={tileSize}/>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.85} style={[s.tileLabel, draft[field].includes(name) && s.selectedLabel]}>{t(name)}</Text>
    </Pressable>)}</View>
  </View>;
  return <BottomPanel expanded closeRequested={closing} onClose={onClose} label={t('Закрыть фильтры')} topGap={insets.top + 24} bottomPadding={0}>
    <View style={s.body}>
      <ScrollView testID="food-filters-scroll" showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {grid('Блюда', 'dishes', filterDishCategories)}
        {grid('Кухни', 'cuisines', filterCuisines)}
        <View style={s.section}>
          <Text accessibilityRole="header" style={s.heading}>{t('Сортировать')}</Text>
          {([{ id: 'default', label: 'По умолчанию' }, { id: 'rating', label: 'С высоким рейтингом' }, { id: 'fast', label: 'Быстрые' }] as const).map((item, index) => <Pressable key={item.id}
            accessibilityRole="radio" accessibilityLabel={t(item.label)} accessibilityState={{ checked: draft.sort === item.id }} onPress={() => setDraft(current => ({ ...current, sort: item.id }))} style={[s.sortRow, index > 0 && s.sortDivider]}>
            <Text style={s.sortLabel}>{t(item.label)}</Text><View style={[s.radio, theme.isDark && { backgroundColor: theme.palette.elevated }, draft.sort === item.id && s.radioChecked]}>{draft.sort === item.id && <Ionicons name="checkmark" size={20} color="#FFFFFF"/>}</View>
          </Pressable>)}
        </View>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: theme.isDark ? theme.palette.surface : '#FFFFFF' }]}>
        <Pressable accessibilityRole="button" onPress={() => setDraft(emptyRestaurantFilters())} style={s.reset}><Text style={s.actionLabel}>{t('Сбросить')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => { onApply(draft); setClosing(true); }} style={[s.apply, { backgroundColor: palette.blue }]}><Text style={[s.actionLabel, { color: '#FFFFFF' }]}>{t('Применить')}</Text></Pressable>
      </View>
    </View>
  </BottomPanel>;
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: '#F7F7F5' },
  scrollContent: { gap: 6, paddingBottom: 10 },
  section: { backgroundColor: '#FFFFFF', borderRadius: 24, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18 },
  heading: { color: '#111318', fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, marginBottom: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 15 },
  tile: { width: '25%', alignItems: 'center', gap: 9, paddingBottom: 6 },
  tileLabel: { color: '#111318', fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, paddingHorizontal: 5, borderRadius: 7, overflow: 'hidden' },
  selectedLabel: { color: '#FFFFFF', backgroundColor: palette.blue },
  sortRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sortDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E7E3' },
  sortLabel: { color: '#111318', fontFamily: fonts.regular, fontSize: 15 },
  radio: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#EEEEEE', alignItems: 'center', justifyContent: 'center' },
  radioChecked: { backgroundColor: palette.blue },
  footer: { flexDirection: 'row', paddingTop: 8, paddingHorizontal: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E7E3' },
  reset: { flex: 1, minHeight: 58, backgroundColor: '#F1F1EF', borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  apply: { flex: 1, minHeight: 58, backgroundColor: palette.blue, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: '#111318', fontFamily: fonts.medium, fontSize: 17, lineHeight: 24 },
});
