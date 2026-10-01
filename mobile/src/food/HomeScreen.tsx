import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel } from '../BottomPanel';
import { api, messageOf } from '../api';
import { shortAddress } from '../address';
import { SpringPressable } from '../design/motion';
import { useTheme } from '../design/theme';
import { fonts } from '../design/typography';
import type { SavedPlaceKind, SavedPlaces } from '../savedPlaces';
import type { Language } from '../types';
import { Icon, tr } from '../ui';
import { foodImage } from './assets';
import type { HomeBanner } from './types';

type NotificationItem = { id: string; title: string; body: string; createdAt: string; readAt: string | null };
type NotificationFeed = { asOf: string; hasUnread: boolean; items: NotificationItem[] };
type Props = {
  userId: string; language?: Language; currentAddress: string; onChangeAddress: () => void;
  onTaxi: () => void; onDelivery: () => void; onTruck: () => void; onSearch: () => void;
  savedPlaces: SavedPlaces; onSavedPlace: (kind: SavedPlaceKind) => void; onEditSavedPlace: (kind: SavedPlaceKind) => void;
  onFood: () => void; onBanner: (banner: HomeBanner) => void; banners: HomeBanner[];
  onMenu: () => void; onOrders: () => void; hasOrder: boolean; active: boolean;
};

const INK = '#0D1119';
const BG = '#EAF5FF';
const CARDS = [
  { key: 'taxi', title: 'Такси', image: require('../../assets/home/service-taxi.png'), tint: '#FFF5CF' },
  { key: 'delivery', title: 'Доставка', image: require('../../assets/home/service-delivery.png'), tint: '#DCEEFF' },
  { key: 'truck', title: 'Грузовой', image: require('../../assets/home/service-truck.png'), tint: '#E4ECFF' },
  { key: 'food', title: 'Еда', image: require('../../assets/home/service-food.png'), tint: '#DBFAE9' },
] as const;
const WRITE_STEP_MS = 210;
const BLINK_HALF_CYCLE_MS = 850;

function AnimatedSearchPrompt({ active, prompt, color }: { active: boolean; prompt: string; color: string }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(false);
  const completedPrompt = useRef<string | null>(null);
  const blink = useRef(new Animated.Value(1)).current;
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
      if (reduceMotion || !foreground) completedPrompt.current = prompt;
      blink.setValue(1);
      return;
    }
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    let blinkAnimation: Animated.CompositeAnimation | undefined;
    const startBlink = () => {
      blinkAnimation = Animated.loop(Animated.sequence([
        Animated.timing(blink, { toValue: .45, duration: BLINK_HALF_CYCLE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: BLINK_HALF_CYCLE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      blinkAnimation.start();
    };
    if (completedPrompt.current === prompt) {
      setVisibleCount(prompt.length);
      startBlink();
      return () => { blinkAnimation?.stop(); blink.setValue(1); };
    }
    setVisibleCount(0);
    const write = () => {
      count += 1;
      setVisibleCount(count);
      if (count < prompt.length) {
        timer = setTimeout(write, WRITE_STEP_MS);
      } else {
        completedPrompt.current = prompt;
        startBlink();
      }
    };
    timer = setTimeout(write, 180);
    return () => { clearTimeout(timer); blinkAnimation?.stop(); blink.setValue(1); };
  }, [active, foreground, reduceMotion, blink, prompt]);
  return <Animated.Text accessible={false} style={[styles.searchTitle, { color, opacity: blink }]}>{prompt.slice(0, visibleCount)}</Animated.Text>;
}

export function ServiceHomeScreen({ userId, language = 'ru', currentAddress, onChangeAddress, onTaxi, onDelivery, onTruck, onSearch,
  savedPlaces, onSavedPlace, onEditSavedPlace, onFood, onBanner, banners, onMenu, onOrders, hasOrder, active }: Props) {
  const t = tr(language);
  const { isDark, palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState('');
  const contentWidth = width - insets.left - insets.right - 36;
  const availableHeight = height - insets.top - insets.bottom;
  const compact = availableHeight < 720;
  const tight = availableHeight < 620;
  const promoBanner = banners[0];
  const cardHeight = Math.max(82, Math.min(128, (availableHeight - (hasOrder ? 475 : 425)) / 2 - 3));
  const promoHeight = tight ? 100 : compact ? 126 : 145;
  const ink = isDark ? palette.ink : INK;
  const muted = isDark ? palette.muted : '#4D5663';

  useEffect(() => {
    if (!active) return;
    let live = true;
    const refresh = () => { void api.request<NotificationFeed>('/users/me/notifications')
      .then(next => { if (live) setFeed(next); }).catch(() => undefined); };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { live = false; clearInterval(timer); };
  }, [active, userId]);

  async function openInbox() {
    setInboxOpen(true);
    setInboxLoading(true);
    setInboxError('');
    try {
      const next = await api.request<NotificationFeed>('/users/me/notifications');
      setFeed(next);
      if (next.hasUnread) {
        await api.post('/users/me/notifications/read', { through: next.asOf });
        setFeed(current => current ? { ...current, hasUnread: false,
          items: current.items.map(item => ({ ...item, readAt: item.readAt || next.asOf })) } : current);
      }
    } catch (error) { setInboxError(messageOf(error)); }
    finally { setInboxLoading(false); }
  }

  const serviceActions = { taxi: onTaxi, delivery: onDelivery, truck: onTruck, food: onFood };
  const placeItems: { kind: SavedPlaceKind; icon: React.ComponentProps<typeof Icon>['name']; title: string }[] = [
    { kind: 'home', icon: 'home', title: t('Дом') },
    { kind: 'work', icon: 'briefcase', title: t('Работа') },
    { kind: 'favorite', icon: 'star', title: t('Избранное') },
  ];

  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: isDark ? palette.background : BG }}>
    <View testID="service-home-content" style={[styles.content, { paddingBottom: Math.max(insets.bottom, 10) + 5 }]}>
      <View style={styles.heading}>
        <View style={[styles.header, compact && styles.headerCompact]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Меню')} onPress={onMenu} style={styles.headerButton}>
            <Icon name="menu-outline" size={31} color={ink}/>
          </Pressable>
          <Image source={isDark ? require('../../assets/logo dark.png') : require('../../assets/logo light.png')}
            resizeMode="contain" style={styles.logo} accessibilityLabel="Atlas"/>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Уведомления')} onPress={() => void openInbox()} style={styles.headerButton}>
            <Icon name="notifications-outline" size={27} color={ink}/>
            {feed?.hasUnread && <View testID="notification-dot" style={styles.notificationDot}/>}
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить свой адрес')} onPress={onChangeAddress}
          style={styles.addressButton}>
          <Icon name="location" size={16} color={isDark ? ink : '#1267B5'}/>
          <Text numberOfLines={1} style={[styles.addressText, { color: muted }]}>{currentAddress.startsWith('GPS:') ? t('Определяем адрес…') : shortAddress(currentAddress) || t('Укажите свой адрес')}</Text>
          <Icon name="chevron-forward" size={14} color={muted}/>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {CARDS.map(card => <SpringPressable key={card.key} accessibilityRole="button" accessibilityLabel={t(card.title)}
          onPress={serviceActions[card.key]} pressScale={.97} containerStyle={{ width: '48%', height: cardHeight }}
          style={[styles.serviceCard, { backgroundColor: isDark ? palette.elevated : card.tint,
            borderColor: isDark ? palette.line : 'transparent' }]}>
          <Image source={card.image} resizeMode="contain" style={[styles.serviceImage, card.key === 'food' && styles.serviceImageFood,
            { height: Math.max(80, cardHeight + 4) }]}/>
          <Text style={[styles.serviceTitle, { color: ink }]}>{t(card.title)}</Text>
        </SpringPressable>)}
      </View>

      <SpringPressable accessibilityRole="button" accessibilityLabel={t('Куда едем?')} onPress={onSearch} pressScale={.985}
        style={[styles.search, compact && styles.searchCompact, { backgroundColor: palette.surface, borderColor: isDark ? palette.line : '#B9DAF6' }]}>
        <Icon name="location" size={25} color={isDark ? ink : '#1267B5'}/>
        <AnimatedSearchPrompt active={active} prompt={t('Куда едем?')} color={ink}/>
        <View style={{ marginLeft: 'auto' }}><Icon name="chevron-forward" size={19} color={muted}/></View>
      </SpringPressable>

      <View style={[styles.places, tight && styles.placesTight]}>
        {placeItems.map(place => <SpringPressable key={place.kind} accessibilityRole="button"
          accessibilityLabel={`${place.title}: ${savedPlaces[place.kind]?.address || t('добавить адрес')}`}
          onPress={() => onSavedPlace(place.kind)} onLongPress={() => onEditSavedPlace(place.kind)} pressScale={.95}
          containerStyle={styles.placeTouch} style={styles.place}>
          <View style={[styles.placeIcon, tight && styles.placeIconTight, { backgroundColor: isDark ? palette.elevated : '#D9EBFB' }]}>
            <Icon name={place.icon} size={27} color={isDark ? ink : '#1267B5'}/>
          </View>
          <Text style={[styles.placeTitle, { color: ink }]}>{place.title}</Text>
          {!!savedPlaces[place.kind] && <Text numberOfLines={1} style={[styles.placeAddress, { color: muted }]}>
            {shortAddress(savedPlaces[place.kind]!.address)}
          </Text>}
        </SpringPressable>)}
      </View>

      {hasOrder && <SpringPressable accessibilityRole="button" accessibilityLabel={t('Открыть активный заказ еды')}
        onPress={onOrders} style={[styles.activeOrder, { backgroundColor: palette.surface }]}>
        <Icon name="bag-handle" color={isDark ? ink : '#1267B5'} size={22}/>
        <Text style={[styles.activeOrderText, { color: ink }]}>{t('Заказ уже в работе')}</Text>
        <Icon name="chevron-forward" color={muted} size={19}/>
      </SpringPressable>}

      <SpringPressable accessibilityRole={promoBanner?.actionType === 'NONE' ? 'image' : 'button'}
        accessibilityLabel={promoBanner?.title || t('Быстрые заказы рядом')}
        onPress={promoBanner ? (promoBanner.actionType === 'NONE' ? undefined : () => onBanner(promoBanner)) : onTaxi} pressScale={.99}>
        <LinearGradient colors={isDark ? ['#957719', '#5A491B'] : ['#FFE45C', '#FFDE47']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.promo, { height: promoHeight }]}>
          <Image source={promoBanner ? foodImage(promoBanner.imageKey, promoBanner.imageUrl, 'nearby-promo')
            : require('../../assets/home/promo-nearby-map.png')} resizeMode="contain" style={styles.promoImage}/>
          <View style={styles.promoCopy}>
            <Text numberOfLines={2} adjustsFontSizeToFit style={[styles.promoTitle, tight && styles.promoTitleTight]}>
              {promoBanner?.title || t('Быстрые\nзаказы рядом!')}</Text>
            <Text numberOfLines={2} adjustsFontSizeToFit style={[styles.promoSubtitle, tight && styles.promoSubtitleTight]}>
              {promoBanner?.subtitle || t('Всё, что нужно —\nуже рядом')}</Text>
          </View>
        </LinearGradient>
      </SpringPressable>
    </View>

    {inboxOpen && <BottomPanel onClose={() => setInboxOpen(false)} label={t('Закрыть уведомления')}>
      <View style={{ height: Math.min(510, height * .64), paddingHorizontal: 19, paddingTop: 8 }}>
        <Text style={[styles.inboxTitle, { color: ink }]}>{t('Уведомления')}</Text>
        {inboxLoading && <ActivityIndicator style={{ marginTop: 30 }} color={palette.accent}/>}
        {!!inboxError && <Pressable accessibilityRole="button" accessibilityLabel={t('Повторить загрузку уведомлений')}
          onPress={() => void openInbox()} style={{ paddingVertical: 18 }}><Text style={{ color: palette.accent }}>{inboxError} · {t('Повторить')}</Text></Pressable>}
        {!inboxLoading && !inboxError && !feed?.items.length && <View style={styles.emptyInbox}>
          <Icon name="notifications-outline" size={34} color={muted}/>
          <Text style={{ color: muted, fontSize: 15 }}>{t('Пока нет уведомлений')}</Text>
        </View>}
        {!inboxLoading && !inboxError && !!feed?.items.length && <ScrollView showsVerticalScrollIndicator={false}>
          {feed.items.map(item => <View key={item.id} style={[styles.notificationRow, { borderBottomColor: palette.line }]}>
            <View style={{ flex: 1, gap: 4 }}><Text style={[styles.notificationTitle, { color: ink }]}>{item.title}</Text>
              <Text style={{ color: muted, fontSize: 13, lineHeight: 19 }}>{item.body}</Text>
              <Text style={{ color: muted, fontSize: 11 }}>{new Date(item.createdAt).toLocaleString(language === 'ky' ? 'ky-KG' : language === 'en' ? 'en-US' : 'ru-RU')}</Text></View>
          </View>)}
        </ScrollView>}
      </View>
    </BottomPanel>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 18, paddingTop: 6, justifyContent: 'space-between' },
  heading: { alignItems: 'center' },
  header: { width: '100%', height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerCompact: { height: 44 },
  headerButton: { width: 43, height: 44, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 5, right: 1, width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#F43F39', borderWidth: 1, borderColor: '#FFFFFF' },
  logo: { width: 167, height: 50 },
  addressButton: { maxWidth: '75%', minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: -9, paddingHorizontal: 4 },
  addressText: { maxWidth: '85%', fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  serviceCard: { flex: 1, overflow: 'hidden', borderRadius: 17, borderWidth: 1, paddingHorizontal: 11, paddingBottom: 8,
    justifyContent: 'flex-end' },
  serviceImage: { position: 'absolute', left: '-4%', top: -12, width: '108%' },
  serviceImageFood: { transform: [{ scale: .9 }] },
  serviceTitle: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 22, letterSpacing: -.35 },
  search: { minHeight: 62, borderRadius: 21, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 15,
    paddingHorizontal: 19, shadowColor: '#41618C', shadowOpacity: .06, shadowOffset: { width: 0, height: 5 }, shadowRadius: 12, elevation: 2 },
  searchCompact: { minHeight: 52 },
  searchTitle: { fontFamily: fonts.bold, fontSize: 20 },
  places: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 },
  placesTight: { marginTop: 0 },
  placeTouch: { width: '33.333%' },
  place: { alignItems: 'center', paddingHorizontal: 3, paddingVertical: 1 },
  placeIcon: { width: 57, height: 57, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  placeIconTight: { width: 48, height: 48, borderRadius: 24 },
  placeTitle: { fontFamily: fonts.medium, fontSize: 15, marginTop: 7, textAlign: 'center' },
  placeAddress: { fontSize: 10, marginTop: 2, textAlign: 'center', maxWidth: '100%' },
  activeOrder: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15 },
  activeOrderText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14 },
  promo: { borderRadius: 20, overflow: 'hidden', justifyContent: 'center' },
  promoImage: { position: 'absolute', width: '64%', height: '125%', right: -16, bottom: -18 },
  promoCopy: { width: '59%', paddingLeft: 20, gap: 7 },
  promoTitle: { fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 26, letterSpacing: -.6, color: INK },
  promoSubtitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 17, color: '#3C3830' },
  promoTitleTight: { fontSize: 21, lineHeight: 22 },
  promoSubtitleTight: { fontSize: 12, lineHeight: 15 },
  inboxTitle: { fontFamily: fonts.bold, fontSize: 22, marginBottom: 8 },
  emptyInbox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  notificationRow: { minHeight: 78, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  notificationTitle: { fontFamily: fonts.semibold, fontSize: 15 },
});
