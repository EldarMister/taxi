import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SpringPressable } from '../design/motion';
import { useTheme } from '../design/theme';
import { fonts } from '../design/typography';
import { Icon, tr } from '../ui';
import { shortAddress } from '../address';
import type { SavedPlaceKind, SavedPlaces } from '../savedPlaces';
import type { Language } from '../types';
import { BannerCarousel } from './BannerCarousel';
import { useFoodStyles } from './foodTheme';
import type { HomeBanner } from './types';

type Props = {
  language?: Language;
  onTaxi: () => void;
  onTruck: () => void;
  onSearch: () => void;
  savedPlaces: SavedPlaces;
  onSavedPlace: (kind: SavedPlaceKind) => void;
  onEditSavedPlace: (kind: SavedPlaceKind) => void;
  onFood: () => void;
  onBanner: (banner: HomeBanner) => void;
  banners: HomeBanner[];
  onMenu: () => void;
  onOrders: () => void;
  hasOrder: boolean;
  active: boolean;
};

const NAVY = '#111B38';
const MUTED = '#50678A';
const BLUE = '#1B75E6';
const SEARCH_PROMPT = 'Куда поедем?';
const savedPlaceLabel = (address: string) => shortAddress(address)
  .replace(/^(улица|ул\.?|проспект|пр-т)\s+/i, '')
  .replace(/,\s*(Бишкек|Ош)$/i, '');
const WRITE_STEP_MS = 135;
const FULL_PROMPT_PAUSE_MS = 3400;

function AnimatedSearchPrompt({ active, prompt }: { active: boolean; prompt: string }) {
  const styles = useFoodStyles(baseStyles);
  const [visibleCount, setVisibleCount] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const appState = AppState.addEventListener('change', state => setForeground(state === 'active'));
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; appState.remove(); motion.remove(); };
  }, []);

  useEffect(() => {
    if (!active || !foreground || reduceMotion) {
      setVisibleCount(prompt.length);
      pulse.setValue(1);
      return;
    }

    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    let pulseAnimation: Animated.CompositeAnimation | undefined;
    setVisibleCount(0);

    const write = () => {
      count += 1;
      setVisibleCount(count);
      if (count < prompt.length) {
        timer = setTimeout(write, WRITE_STEP_MS);
      } else {
        pulseAnimation = Animated.loop(Animated.sequence([
          Animated.timing(pulse, { toValue: 1.035, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]), { iterations: 4 });
        pulseAnimation.start();
        timer = setTimeout(erase, FULL_PROMPT_PAUSE_MS);
      }
    };
    const erase = () => {
      pulseAnimation?.stop();
      pulse.setValue(1);
      count -= 1;
      setVisibleCount(count);
      timer = setTimeout(count > 0 ? erase : write, count > 0 ? 65 : 450);
    };

    timer = setTimeout(write, 180);
    return () => { clearTimeout(timer); pulseAnimation?.stop(); pulse.setValue(1); };
  }, [active, foreground, reduceMotion, pulse, prompt]);

  return <Animated.Text accessible={false} style={[styles.searchText, { transform: [{ scale: pulse }] }]}>{prompt.slice(0, visibleCount)}</Animated.Text>;
}

function ServiceCard({ title, description, source, colors, onPress, comingSoon, imageScale = 1, language = 'ru' }: {
  title: string; description: string; source: number; colors: readonly [string, string];
  onPress?: () => void; comingSoon?: boolean; imageScale?: number; language?: Language;
}) {
  const theme = useTheme();
  const styles = useFoodStyles(baseStyles);
  const card = <View style={[styles.serviceCard, { backgroundColor: theme.isDark ? '#171717' : colors[0] }, theme.isDark && { borderWidth: 1, borderColor: theme.palette.line }]}>
    <View style={styles.serviceArt}><Image source={source} resizeMode="contain" style={[styles.serviceImage, { transform: [{ scale: imageScale }] }]} /></View>
    <Text style={styles.serviceName} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
    <Text style={styles.serviceDescription} numberOfLines={2} adjustsFontSizeToFit>{description}</Text>
    {comingSoon && <View style={styles.soon}><Text style={styles.soonText}>{tr(language)('Скоро появится')}</Text></View>}
  </View>;
  if (comingSoon) return <View accessible accessibilityRole="text" accessibilityLabel={`${title}. ${tr(language)('Скоро появится')}`} style={styles.serviceTouch}>{card}</View>;
  return <SpringPressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} pressScale={.965} containerStyle={styles.serviceTouch} style={{ flex: 1 }}>{card}</SpringPressable>;
}

function SavedPlace({ icon, title, point, onPress, onEdit, language = 'ru' }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; point?: string; onPress: () => void; onEdit?: () => void; language?: Language }) {
  const theme = useTheme();
  const styles = useFoodStyles(baseStyles);
  return <SpringPressable accessibilityRole="button" accessibilityLabel={`${title}: ${point || tr(language)('добавить адрес')}`} accessibilityHint={point ? tr(language)('Удерживайте, чтобы изменить адрес') : undefined} onPress={onPress} onLongPress={onEdit} pressScale={.94} containerStyle={styles.placeTouch} style={styles.place}>
    <View style={styles.placeIcon}><Icon name={icon} color={theme.isDark ? theme.palette.ink : '#2D5E99'} size={25}/></View>
    <Text style={styles.placeTitle}>{title}</Text>
    <Text style={[styles.placeAction, !!point && styles.placeAddress]} numberOfLines={point ? 2 : 1}>{point || tr(language)('Добавить')}</Text>
  </SpringPressable>;
}

export function ServiceHomeScreen({ language = 'ru', onTaxi, onTruck, onSearch, savedPlaces, onSavedPlace, onEditSavedPlace, onFood, onBanner, banners, onMenu, onOrders, hasOrder, active }: Props) {
  const t = tr(language);
  const theme = useTheme();
  const styles = useFoodStyles(baseStyles);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentWidth = width - insets.left - insets.right - 36;
  const availableHeight = height - insets.top - insets.bottom;
  const compact = availableHeight < 730;
  const cardHeight = Math.max(108, Math.min(165, availableHeight * .23));
  const bannerHeight = Math.max(110, Math.min(contentWidth * .75, 245, availableHeight * (hasOrder ? .25 : .33)));

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <View style={styles.heading}><Text style={styles.greeting}>{t('Доброе утро!')}</Text><Text style={styles.subtitle}>{t('Куда отправимся сегодня?')}</Text></View>
        <SpringPressable accessibilityRole="button" accessibilityLabel={t('Меню')} onPress={onMenu} pressScale={.9} style={styles.menu}><Icon name="menu" color={theme.isDark ? theme.palette.ink : NAVY} size={29}/></SpringPressable>
      </View>

      <View style={styles.services}>
        <View style={[styles.serviceColumn, { height: cardHeight }]}><ServiceCard language={language} title={t('Такси')} description={t('Быстро и комфортно')} source={require('../../assets/home/taxi-yellow.png')} colors={['#FFF3D3', '#E2F3FF']} onPress={onTaxi} imageScale={1.13}/></View>
        <View style={[styles.serviceColumn, { height: cardHeight }]}><ServiceCard language={language} title={t('Грузовой')} description={t('Доставка больших грузов')} source={require('../../assets/home/truck-white.png')} colors={['#DBEFFF', '#E8F4FF']} onPress={onTruck} imageScale={1.17}/></View>
        <View style={[styles.serviceColumn, { height: cardHeight }]}><ServiceCard language={language} title={t('Доставка еды')} description={t('Любимые рестораны рядом')} source={require('../../assets/home/food-bag-burger.png')} colors={['#DEF6EC', '#E2FAF5']} onPress={onFood} imageScale={1.05}/></View>
      </View>

      <View>
        <SpringPressable accessibilityRole="button" accessibilityLabel={`${t('Куда поедем?')} ${t('Выбрать адрес')}`} onPress={onSearch} pressScale={.98} style={[styles.search, compact && styles.searchCompact]}>
          <Icon name="location" color={theme.isDark ? theme.palette.ink : '#315F97'} size={26}/>
          <AnimatedSearchPrompt active={active} prompt={t(SEARCH_PROMPT)}/>
          <Icon name="chevron-forward" color={theme.isDark ? theme.palette.muted : '#53739F'} size={24}/>
        </SpringPressable>
      </View>

      <View style={[styles.places, compact && styles.placesCompact]}>
        <SavedPlace language={language} icon="home" title={t('Дом')} point={savedPlaces.home ? savedPlaceLabel(savedPlaces.home.address) : undefined} onPress={() => onSavedPlace('home')} onEdit={() => onEditSavedPlace('home')}/>
        <SavedPlace language={language} icon="briefcase" title={t('Работа')} point={savedPlaces.work ? savedPlaceLabel(savedPlaces.work.address) : undefined} onPress={() => onSavedPlace('work')} onEdit={() => onEditSavedPlace('work')}/>
        <SavedPlace language={language} icon="star" title={t('Избранное')} onPress={onSearch}/>
      </View>

      {hasOrder && <View>
        <SpringPressable accessibilityRole="button" accessibilityLabel={t('Открыть активный заказ еды')} onPress={onOrders} style={styles.activeOrder}>
          <Icon name="bag-handle" color={theme.isDark ? theme.palette.ink : BLUE} size={21}/>
          <View style={{ flex: 1 }}><Text style={styles.activeOrderTitle}>{t('Заказ уже в работе')}</Text><Text style={styles.activeOrderCaption}>{t('Посмотреть статус доставки')}</Text></View>
          <Icon name="chevron-forward" color={theme.isDark ? theme.palette.ink : BLUE} size={19}/>
        </SpringPressable>
      </View>}

      <View style={styles.promoArea}>
        {language !== 'ky' && banners.length > 0 ? <BannerCarousel language={language} banners={banners} width={contentWidth} height={bannerHeight} onBanner={onBanner}/> : <LinearGradient colors={theme.isDark ? ['#171717', '#292929'] : ['#194D70', '#073049']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.promo, { height: bannerHeight }]}>
          <Image source={require('../../assets/home/promo-salad.png')} resizeMode="contain" style={styles.promoImage}/>
          <View style={styles.promoCopy}>
            <Text style={styles.promoTitle}>{t('Вкуснее\nкаждый день')}</Text>
            <Text style={styles.promoSubtitle}>{t('Скидки до 30%\nна доставку еды')}</Text>
            <SpringPressable accessibilityRole="button" accessibilityLabel={t('Заказать еду')} onPress={onFood} pressScale={.96} style={[styles.promoButton, theme.isDark && { backgroundColor: theme.palette.accent }]}>
              <Text style={styles.promoButtonText}>{t('Заказать еду')}</Text>
            </SpringPressable>
          </View>
        </LinearGradient>}
      </View>
    </View>
  </SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F9FF' },
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 18, backgroundColor: '#F2F9FF' },
  header: { paddingTop: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerCompact: { paddingTop: 5 },
  heading: { flex: 1 },
  greeting: { fontFamily: fonts.extraBold, fontSize: 31, lineHeight: 38, letterSpacing: -.8, color: NAVY },
  subtitle: { fontFamily: fonts.regular, fontSize: 18, lineHeight: 25, color: MUTED, marginTop: 2 },
  menu: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
  services: { flexDirection: 'row', gap: 8 },
  serviceColumn: { flex: 1, minWidth: 0 },
  serviceTouch: { flex: 1 },
  serviceCard: { flex: 1, minHeight: 0, borderRadius: 21, alignItems: 'center', paddingHorizontal: 5, paddingBottom: 8 },
  serviceArt: { width: '100%', flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  serviceImage: { width: '113%', height: '113%' },
  serviceName: { width: '100%', textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: NAVY, letterSpacing: -.3 },
  serviceDescription: { width: '100%', minHeight: 29, textAlign: 'center', fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, color: '#3A5A7E', marginTop: 4 },
  soon: { position: 'absolute', top: 5, right: 5, backgroundColor: '#FFFFFFDC', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7 },
  soonText: { color: '#416A95', fontFamily: fonts.semibold, fontSize: 8, lineHeight: 10 },
  search: { height: 58, paddingHorizontal: 21, borderRadius: 22, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 16, shadowColor: '#245B9C', shadowOpacity: .07, shadowOffset: { width: 0, height: 6 }, shadowRadius: 16, elevation: 2 },
  searchCompact: { height: 52 },
  searchText: { flex: 1, fontFamily: fonts.medium, fontSize: 19, color: MUTED },
  places: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 3 },
  placesCompact: { transform: [{ scale: .9 }] },
  placeTouch: { flex: 1 },
  place: { alignItems: 'center', paddingVertical: 5, paddingHorizontal: 3 },
  placeIcon: { width: 57, height: 57, borderRadius: 29, backgroundColor: '#E1F0FF', alignItems: 'center', justifyContent: 'center' },
  placeTitle: { fontFamily: fonts.bold, color: NAVY, fontSize: 15, lineHeight: 20, marginTop: 9 },
  placeAction: { fontFamily: fonts.regular, color: '#356496', fontSize: 14, lineHeight: 19, maxWidth: '100%' },
  placeAddress: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  activeOrder: { flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 14 },
  activeOrderTitle: { color: NAVY, fontFamily: fonts.semibold, fontSize: 14 },
  activeOrderCaption: { color: MUTED, fontFamily: fonts.regular, fontSize: 12 },
  promoArea: { minHeight: 0 },
  promo: { overflow: 'hidden', borderRadius: 23, position: 'relative' },
  promoImage: { position: 'absolute', width: '62%', height: '120%', right: -10, bottom: -22 },
  promoCopy: { flex: 1, width: '55%', paddingLeft: 17, paddingVertical: 17, justifyContent: 'space-between', zIndex: 1 },
  promoTitle: { color: '#FFFFFF', fontFamily: fonts.extraBold, fontSize: 24, lineHeight: 27, letterSpacing: -.5 },
  promoSubtitle: { color: '#E5F6FF', fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  promoButton: { backgroundColor: '#FFD358', borderRadius: 12, paddingHorizontal: 14, height: 39, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start' },
  promoButtonText: { color: NAVY, fontFamily: fonts.bold, fontSize: 14 },
});
