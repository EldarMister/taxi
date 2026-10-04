import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SpringPressable } from '../design/motion';
import { fonts } from '../design/typography';
import { LinearGradient } from 'expo-linear-gradient';
import { foodImage } from './assets';
import { FoodPhoto } from './FoodPhoto';
import { foodPhotoRegion } from './foodPhotography';
import type { FoodRestaurant, HomeBanner } from './types';

const campaigns: Record<string, { title: string; label: string; color: string }> = {
  'sushi-roll': { title: 'Роллы на\nхороший вечер', label: 'SUSHI ROLL', color: '#174C39' },
  'kfc': { title: 'Хрустящий\nперерыв', label: 'KFC', color: '#981B17' },
  'halva': { title: 'Любимые\nблюда Востока', label: 'ХАЛВА', color: '#315344' },
  'ali-burger': { title: 'Сочные\nбургеры', label: 'АЛИ БУРГЕР', color: '#AF4715' },
};

/** Merchant-supplied creatives take priority; the seeded demo also has its own ad designs. */
export function RestaurantAdvertisements({ restaurants, banners, width, onBanner, onRestaurant }: {
  restaurants: FoodRestaurant[]; banners: HomeBanner[]; width: number;
  onBanner?: (banner: HomeBanner) => void; onRestaurant: (restaurant: FoodRestaurant) => void;
}) {
  const available = banners.filter(banner => banner.active && banner.actionType === 'RESTAURANT' && restaurants.some(restaurant => restaurant.id === banner.restaurantId))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id.localeCompare(b.id));
  // Older servers may send two creatives while their administrator changes a set.
  // A complete row always contains three; otherwise keep one full-width creative.
  const configured = available.length >= 3 ? available.slice(0, 3) : available.slice(0, 1);
  const availableDemos = configured.length ? [] : restaurants.filter(restaurant => restaurant.isDemo && campaigns[restaurant.id]);
  const demos = availableDemos.length >= 3 ? availableDemos.slice(0, 3) : availableDemos.slice(0, 1);
  if (!configured.length && !demos.length) return null;
  const ads = configured.length ? configured.map(banner => {
    const restaurant = restaurants.find(item => item.id === banner.restaurantId)!;
    return { id: banner.id, restaurant, banner, designed: !banner.imageUrl && !!foodPhotoRegion(banner.imageKey),
      title: banner.title, label: banner.subtitle || restaurant.name, color: campaigns[restaurant.id]?.color || '#174C39' };
  }) : demos.map(restaurant => ({ id: restaurant.id, restaurant, banner: undefined, designed: true, ...campaigns[restaurant.id] }));
  const square = ads.length === 3;
  const cardWidth = square ? Math.max(1, (width - 16) / 3) : width;
  const height = square ? cardWidth : cardWidth / 2.04;
  return <View testID="restaurant-promotions" style={s.rail}>
    {ads.map(campaign => {
      const { restaurant, banner } = campaign;
      const label = banner ? `${banner.title}${banner.subtitle ? `. ${banner.subtitle}` : ''}` : `${campaign.title.replace('\n', ' ')}. ${restaurant.name}`;
      return <SpringPressable key={campaign.id} accessibilityRole="button" accessibilityLabel={label} onPress={() => banner && onBanner ? onBanner(banner) : onRestaurant(restaurant)} pressScale={.985} style={[s.card, { width: cardWidth, height, backgroundColor: campaign.color }]}>
        {campaign.designed ? <>
        <FoodPhoto imageKey={banner?.imageKey || restaurant.imageKey} imageUrl={banner ? undefined : restaurant.imageUrl} style={[StyleSheet.absoluteFill, { width: cardWidth, height }]}/>
        <LinearGradient pointerEvents="none" colors={[`${campaign.color}F5`, `${campaign.color}BB`, `${campaign.color}00`]} locations={[0, .44, 1]} start={{ x: 0, y: 0 }} end={{ x: square ? .4 : 1, y: square ? 1 : .6 }} style={StyleSheet.absoluteFill}/>
        <View pointerEvents="none" style={s.copy}>
          <Text numberOfLines={2} style={[s.title, { fontSize: square ? height * .13 : cardWidth * .075, lineHeight: square ? height * .145 : cardWidth * .085 }]}>{campaign.title}</Text>
          <View style={s.label}><Text numberOfLines={1} style={[s.labelText, { fontSize: Math.min(17, cardWidth * .08), lineHeight: square ? 13 : 21 }]}>{campaign.label}</Text></View>
          <View style={s.brand}><Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.75} style={s.brandText}>{restaurant.name}</Text></View>
        </View>
        </> : banner && (banner.imageUrl || banner.imageKey) ? <Image source={foodImage(banner.imageKey, banner.imageUrl)} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: cardWidth, height }]}/> : <View style={s.configuredCopy}><Text numberOfLines={2} style={s.title}>{campaign.title}</Text><Text numberOfLines={2} style={s.subtitle}>{campaign.label}</Text></View>}
      </SpringPressable>;
    })}
  </View>;
}

const s = StyleSheet.create({
  rail: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingBottom: 20 },
  card: { overflow: 'hidden', borderRadius: 17, backgroundColor: '#174C39' },
  copy: { flex: 1, paddingHorizontal: 11, paddingVertical: 10, alignItems: 'flex-start' },
  title: { fontFamily: fonts.semibold, fontSize: 23, lineHeight: 24, letterSpacing: -.75, color: '#FFFFFF' },
  label: { marginTop: 4, borderRadius: 5, backgroundColor: '#FFE500', paddingHorizontal: 4, paddingVertical: 1, maxWidth: '78%' },
  labelText: { color: '#151515', fontFamily: 'FoodDisplayBold', lineHeight: 21, letterSpacing: -.2 },
  brand: { marginTop: 'auto', width: 27, height: 27, backgroundColor: '#FFFFFF', padding: 2, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: '#242424', fontFamily: fonts.bold, fontSize: 7, lineHeight: 8, textAlign: 'center' },
  configuredCopy: { flex: 1, justifyContent: 'center', padding: 12, gap: 5 },
  subtitle: { color: '#FFFFFF', fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
});
