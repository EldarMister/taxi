import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomPanel } from '../BottomPanel';
import { useTheme } from '../design/theme';
import { fonts } from '../design/typography';
import { palette as brand } from '../design/tokens';
import { FoodButton } from './components';
import { useFoodLanguage, useFoodT } from './i18n';
import { sortRestaurantReviews, type RestaurantReviewSort } from './restaurantReviews';
import type { FoodRestaurant } from './types';

const sorts: { id: RestaurantReviewSort; label: string }[] = [
  { id: 'default', label: 'По умолчанию' }, { id: 'newest', label: 'Сначала новые' },
  { id: 'highest', label: 'Сначала хорошие' }, { id: 'lowest', label: 'Сначала плохие' },
];

export function RestaurantReviewsSheet({ restaurant, onClose, loading, error, onRetry }: {
  restaurant: FoodRestaurant; onClose: () => void; loading?: boolean; error?: string | null; onRetry?: () => void;
}) {
  const t = useFoodT();
  const language = useFoodLanguage();
  const { palette, isDark } = useTheme();
  const [sort, setSort] = useState<RestaurantReviewSort>('default');
  const [sortOpen, setSortOpen] = useState(false);
  const [contentTop, setContentTop] = useState(0);
  const [headingHeight, setHeadingHeight] = useState(0);
  const reviews = useMemo(() => sortRestaurantReviews(restaurant.reviews, sort), [restaurant.reviews, sort]);
  const sortLabel = sorts.find(item => item.id === sort)!.label;
  const ratingCount = restaurant.ratingCount ?? restaurant.reviewCount;
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(language === 'en' ? 'en-GB' : language === 'ky' ? 'ky-KG' : 'ru-RU', { day: 'numeric', month: 'long' });
  };

  return <BottomPanel expanded onClose={onClose} bottomPadding={0} label={t('Закрыть отзывы ресторана')}>
    <View testID="restaurant-reviews-panel" style={[s.panel, { backgroundColor: isDark ? palette.background : '#F5F6F3' }]}>
      <View style={[s.summary, { backgroundColor: palette.surface }]}>
        <Text style={[s.rating, { color: palette.ink }]}>{restaurant.rating > 0 ? restaurant.rating.toFixed(1) : '—'}</Text>
        <Text style={[s.ratingCaption, { color: palette.muted }]}>{ratingCount} {t('оценок')} · {reviews.length} {t('отзывов')}</Text>
      </View>
      <View onLayout={event => setContentTop(event.nativeEvent.layout.y)} style={[s.content, { backgroundColor: palette.surface }]}>
        <View onLayout={event => setHeadingHeight(event.nativeEvent.layout.height)} style={s.heading}><Text accessibilityRole="header" style={[s.title, { color: palette.ink }]}>{t('Отзывы')}</Text>
          <Pressable testID="review-sort-button" accessibilityRole="button" accessibilityLabel={t('Сортировка отзывов')} accessibilityState={{ expanded: sortOpen }} onPress={() => setSortOpen(value => !value)} style={[s.sortButton, { backgroundColor: palette.elevated }]}>
            <Text style={[s.sortButtonText, { color: palette.ink }]}>{t(sortLabel)}</Text><Ionicons name={sortOpen ? 'chevron-up' : 'chevron-down'} size={14} color={palette.ink}/>
          </Pressable>
        </View>
        <ScrollView testID="restaurant-reviews-list" style={s.list} showsVerticalScrollIndicator={false} contentContainerStyle={s.listContent}>
          {loading ? <View style={s.empty}><ActivityIndicator color={brand.blue}/><Text style={[s.emptyText, { color: palette.muted }]}>{t('Загружаем отзывы…')}</Text></View>
            : error ? <View style={s.empty}><Text style={[s.emptyTitle, { color: palette.ink }]}>{t('Не удалось загрузить отзывы')}</Text><Text style={[s.emptyText, { color: palette.muted }]}>{error}</Text>{onRetry && <FoodButton label={t('Повторить')} onPress={onRetry}/>}</View>
            : reviews.length ? reviews.map(review => <View key={review.id} testID={`restaurant-review-${review.id}`} style={[s.review, { borderTopColor: palette.line }]}>
              <View style={s.reviewHeading}><View style={s.authorCopy}><Text style={[s.author, { color: palette.ink }]}>{review.authorName}</Text><Text style={[s.date, { color: palette.muted }]}>{[date(review.createdAt), review.source].filter(Boolean).join(' · ')}</Text></View>
                <View accessibilityLabel={`${review.rating} ${t('из 5')}`} style={s.stars}>{Array.from({ length: 5 }, (_, index) => <Ionicons key={index} name={review.rating >= index + 1 ? 'star' : review.rating > index ? 'star-half' : 'star-outline'} size={20} color="#FFE500"/>)}</View>
              </View><Text style={[s.reviewText, { color: palette.ink }]}>{review.text}</Text>
            </View>) : <View testID="restaurant-reviews-empty" style={[s.empty, { borderTopColor: palette.line, borderTopWidth: StyleSheet.hairlineWidth }]}><Text style={[s.emptyTitle, { color: palette.ink }]}>{t('Отзывов пока нет')}</Text><Text style={[s.emptyText, { color: palette.muted }]}>{t('Здесь появятся отзывы клиентов о ресторане.')}</Text></View>}
        </ScrollView>
      </View>
      {sortOpen && <View pointerEvents="box-none" accessibilityViewIsModal style={s.sortOverlay}>
        <Pressable testID="review-sort-dismiss" accessible={false} onPress={() => setSortOpen(false)} style={StyleSheet.absoluteFill}/>
        <View testID="review-sort-options" style={[s.sortOptions, { top: contentTop + headingHeight - 4, backgroundColor: palette.surface }]}>
          <View style={s.sortOptionList}>{sorts.map((item, index) => <Pressable key={item.id} testID={`review-sort-${item.id}`} accessibilityRole="radio" accessibilityState={{ checked: item.id === sort }} onPress={() => { setSort(item.id); setSortOpen(false); }} style={[s.sortOption, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }]}>
            <Text style={[s.sortOptionText, { color: palette.ink }]}>{t(item.label)}</Text>{sort === item.id && <Ionicons name="checkmark" size={22} color={brand.blue}/>}</Pressable>)}
          </View>
        </View>
      </View>}
    </View>
  </BottomPanel>;
}

const s = StyleSheet.create({
  panel: { flex: 1, gap: 6 },
  summary: { alignItems: 'center', paddingTop: 7, paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, gap: 7 },
  rating: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 40 },
  ratingCaption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  content: { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 18, paddingBottom: 17 },
  title: { fontFamily: fonts.black, fontSize: 26, lineHeight: 32, letterSpacing: -.7 },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 19, paddingHorizontal: 10, paddingVertical: 9 },
  sortButtonText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  sortOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  sortOptions: { position: 'absolute', right: 12, width: 232, maxWidth: '80%', borderRadius: 24, shadowColor: '#000', shadowOpacity: .16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 12 },
  sortOptionList: { borderRadius: 24, overflow: 'hidden' },
  sortOption: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sortOptionText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  list: { flex: 1 }, listContent: { paddingBottom: 32 },
  review: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 26, paddingBottom: 22 },
  reviewHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  authorCopy: { flex: 1 }, author: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  date: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 1 },
  stars: { flexDirection: 'row', gap: 2 },
  reviewText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, marginTop: 8 },
  empty: { paddingVertical: 36, gap: 10, alignItems: 'center' },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
