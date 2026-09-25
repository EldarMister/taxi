import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { foodImage } from './assets';
import { foodColors as c } from './components';
import { useFoodStyles } from './foodTheme';
import type { HomeBanner } from './types';
import type { Language } from '../types';
import { tr } from '../ui';

export function BannerCarousel({ banners, width, height, onBanner, language = 'ru' }: { banners: HomeBanner[]; width: number; height?: number; onBanner: (banner: HomeBanner) => void; language?: Language }) {
  const t = tr(language);
  const styles = useFoodStyles(baseStyles);
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const identity = banners.map(banner => banner.id).join(':');
  useEffect(() => {
    setPage(0);
    scroll.current?.scrollTo({ x: 0, animated: false });
  }, [identity, width]);
  if (!banners.length) return null;
  return <View style={[styles.frame, height != null && { height }]}>
    <ScrollView ref={scroll} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={event => setPage(Math.min(banners.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width))))}>
      {banners.map((banner, index) => <Pressable key={banner.id}
        accessibilityRole={banner.actionType === 'NONE' ? 'image' : 'button'}
        accessibilityLabel={`${banner.title}${banner.subtitle ? `. ${banner.subtitle}` : ''}. ${index + 1} ${t('из')} ${banners.length}`}
        disabled={banner.actionType === 'NONE'} onPress={() => onBanner(banner)}
        style={({ pressed }) => [styles.banner, { width, height: height ?? width * 446 / 685, opacity: pressed ? .85 : 1 }]}>
        {banner.imageUrl || banner.imageKey
          ? <Image source={foodImage(banner.imageKey, banner.imageUrl)} resizeMode="cover" style={StyleSheet.absoluteFill} />
          : <View style={styles.copy}><Text style={styles.title}>{banner.title}</Text>{!!banner.subtitle && <Text style={styles.subtitle}>{banner.subtitle}</Text>}</View>}
      </Pressable>)}
    </ScrollView>
    {banners.length > 1 && <View style={styles.dots}>
      {banners.map((banner, index) => <Pressable key={banner.id} accessibilityRole="button" accessibilityLabel={`${t('Баннер')} ${index + 1} ${t('из')} ${banners.length}`}
        accessibilityState={{ selected: page === index }} onPress={() => { setPage(index); scroll.current?.scrollTo({ x: index * width, animated: true }); }} style={styles.dotTarget}>
        <View style={[styles.dot, page === index && styles.activeDot]} />
      </Pressable>)}
    </View>}
  </View>;
}

const baseStyles = StyleSheet.create({
  frame: { overflow: 'hidden', borderRadius: 23 },
  banner: { borderRadius: 28, overflow: 'hidden', backgroundColor: '#E9F2FF', borderWidth: 1, borderColor: '#E7E7E3' },
  copy: { flex: 1, justifyContent: 'center', padding: 26, gap: 12 },
  title: { color: c.ink, fontFamily: 'Inter_800ExtraBold', fontSize: 27, lineHeight: 32, letterSpacing: -.7 },
  subtitle: { color: '#556179', fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23 },
  dots: { position: 'absolute', bottom: 0, flexDirection: 'row', alignSelf: 'center', minHeight: 26, alignItems: 'center', backgroundColor: '#FFFFFFBB', borderRadius: 15, paddingHorizontal: 4 },
  dotTarget: { minWidth: 22, height: 34, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: '#C8CBCF' },
  activeDot: { width: 20, backgroundColor: c.blue },
});
