import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BottomPanel, panelStyle } from './BottomPanel';
import { colors, Icon, km, money, shortAddress, tr, tripTime } from './ui';
import { Order, User } from './types';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import type { useApproachRoute } from './useDriverTracking';
import type { useDriverNavigation } from './useDriverNavigation';
import { displayDistance, distanceBetween } from './navigation';
import { DriverCompletionPanel } from './DriverCompletionPanel';
import { useTheme } from './design/theme';
import { usePanelTransition } from './usePanelTransition';
import { useWaiting, waitingClock } from './waiting';

type Props = {
  approach?: ReturnType<typeof useApproachRoute>; backgroundReady?: boolean; onBackground?: () => void;
  navigation?: Pick<ReturnType<typeof useDriverNavigation>, 'progress' | 'gpsStatus' | 'loading' | 'position'>;
  user: User; order: Order | null; offer?: Order; busy: boolean; coming: boolean;
  onAccept: (offer: Order) => void; onRateClient: (score: number) => Promise<boolean>;
  onCompletionHeight?: (height: number) => void;
  onHeight?: (height: number) => void;
  onOnline: () => void; onAction: (action: string) => void; onChat: () => void; onDone: (orderId?: string) => void;
};
const nextAction = {
  ASSIGNED: { title: 'Следуйте к пассажиру', button: 'Приехал', action: 'arrive' },
  ARRIVED: { title: 'Ожидайте пассажира', button: 'Начать поездку', action: 'start' },
  IN_PROGRESS: { title: 'Поездка началась', button: 'Завершить поездку', action: 'complete' },
} as const;

function Deadline({ order, language }: { order: Order; language: User['language'] }) {
  const d = useDriverStyles();
  const { palette } = useTheme();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!order.searchExpiresAt) return null;
  const end = new Date(order.searchExpiresAt).getTime();
  const remaining = Math.max(0, Math.ceil((end - now) / 1000));
  const total = 30000;
  return <View style={d.deadline}>
    <Text style={d.caption}>{tr(language)('Осталось')} {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</Text>
    <View style={d.progress}><View style={{ height: 4, borderRadius: 4, backgroundColor: palette.accent, width: `${Math.min(100, Math.max(0, (end - now) / total * 100))}%` }}/></View>
  </View>;
}

function Action({ label, onPress, busy = false, disabled = false, secondary = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean }) {
  const d = useDriverStyles();
  const { palette } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [d.action, secondary && d.secondary, (pressed || busy || disabled) && { opacity: .6 }]}>
    {busy && <ActivityIndicator size="small" color={secondary ? palette.ink : palette.accentText}/>}<Text style={[d.actionText, secondary && { color: palette.ink }]}>{label}</Text>
  </Pressable>;
}

export function DriverOfferSkip({ offer, busy, language, onSkip }: { offer: Order; busy: boolean; language: User['language']; onSkip: (offer: Order) => void }) {
  const d = useDriverStyles();
  return <Pressable testID="driver-offer-skip" accessibilityRole="button" accessibilityLabel={tr(language)('Пропустить')} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onSkip(offer)} style={({ pressed }) => [d.mapSkip, (pressed || busy) && { opacity: .6 }]}>
    <Text style={d.mapSkipText}>{tr(language)('Пропустить')}</Text>
  </Pressable>;
}

export function pickupCategory(distanceMeters: number): 'Близкая подача' | 'Средняя подача' | 'Дальняя подача' {
  return distanceMeters < 1000 ? 'Близкая подача' : distanceMeters <= 3000 ? 'Средняя подача' : 'Дальняя подача';
}

const SLIDER_INSET = 4;
const SLIDER_THUMB = 54;

/** Deliberate stage transition: a tap cannot accidentally advance a live trip. */
function SlideToConfirm({ label, hint, onConfirm, busy, resetKey, compact = false }: { label: string; hint: string; onConfirm: () => void; busy: boolean; resetKey: string; compact?: boolean }) {
  const d = useDriverStyles();
  const { palette } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const completed = useRef(false);
  const wasBusy = useRef(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const distance = Math.max(0, trackWidth - (compact ? 48 : SLIDER_THUMB) - SLIDER_INSET * 2);
  const reset = () => {
    completed.current = false;
    animation.current?.stop();
    animation.current = Animated.spring(translateX, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220, mass: .7 });
    animation.current.start();
  };
  const confirm = () => {
    if (busy || completed.current || distance <= 0) return;
    completed.current = true;
    animation.current?.stop();
    animation.current = Animated.timing(translateX, { toValue: distance, duration: 120, useNativeDriver: true });
    animation.current.start();
    onConfirm();
  };
  useEffect(() => {
    completed.current = false;
    animation.current?.stop();
    translateX.setValue(0);
  }, [resetKey, translateX]);
  useEffect(() => () => animation.current?.stop(), []);
  useEffect(() => {
    if (!busy && wasBusy.current) reset();
    wasBusy.current = busy;
  }, [busy]);
  const onGesture = useMemo(() => Animated.event([{ nativeEvent: { translationX: translateX } }], { useNativeDriver: true }), [translateX]);
  const clamped = translateX.interpolate({ inputRange: [0, Math.max(1, distance)], outputRange: [0, distance], extrapolate: 'clamp' });
  const fade = translateX.interpolate({ inputRange: [0, Math.max(1, distance * .65)], outputRange: [1, .08], extrapolate: 'clamp' });
  const onGestureState = (event: { nativeEvent: { state: number; translationX: number } }) => {
    const { state, translationX: travel } = event.nativeEvent;
    if (state === State.BEGAN) { animation.current?.stop(); translateX.setValue(0); }
    if (state === State.END) { if (distance > 0 && travel >= distance * .72) confirm(); else reset(); }
    if (state === State.CANCELLED || state === State.FAILED) reset();
  };

  return <View
    testID="driver-stage-slider"
    accessible
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    accessibilityState={{ disabled: busy }}
    accessibilityActions={[{ name: 'activate', label }]}
    onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') confirm(); }}
    onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
    style={[d.slider, compact && d.compactSlider, busy && { opacity: .7 }]}
  >
    <Animated.Text pointerEvents="none" numberOfLines={1} style={[d.sliderText, { opacity: fade }]}>{label}  ››</Animated.Text>
    <PanGestureHandler enabled={!busy && !completed.current} activeOffsetX={[-2, 2]} failOffsetY={[-18, 18]} onGestureEvent={onGesture} onHandlerStateChange={onGestureState}>
    <Animated.View testID="driver-slider-thumb" style={[d.sliderThumb, compact && d.compactSliderThumb, { transform: [{ translateX: clamped }] }]}>
      {busy ? <ActivityIndicator size="small" color={palette.accentText}/> : <Icon name="chevron-forward" color={palette.accentText} size={25}/>}
    </Animated.View></PanGestureHandler>
  </View>;
}

function RouteDetails({ order, language, offer = false }: { order: Order; language: User['language']; offer?: boolean }) {
  const d = useDriverStyles();
  const { palette } = useTheme();
  const t = tr(language);
  return <View style={d.route}>
    <View style={[d.routePins, offer && { paddingTop: 0 }]}>{offer ? <View style={d.routeLetter}><Text style={d.routeLetterText}>А</Text></View> : <Icon name="radio-button-on" color={palette.accent} size={22}/>}<View style={d.routeLine}/>{offer ? <View style={d.routeLetter}><Text style={d.routeLetterText}>Б</Text></View> : <Icon name="location" color={palette.ink} size={25}/>}</View>
    <View style={{ flex: 1, gap: 13 }}>
      <View style={{ gap: 3 }}>{!offer && <Text style={d.caption}>{t('Откуда')}</Text>}<Text numberOfLines={offer ? 1 : 2} style={[d.address, offer && d.offerAddress]}>{shortAddress(order.pickup.address)}</Text></View>
      <View style={{ gap: 3 }}>{!offer && <Text style={d.caption}>{t('Куда')}</Text>}<Text numberOfLines={offer ? 1 : 2} style={[d.address, offer && d.offerAddress]}>{shortAddress(order.dropoff.address)}</Text></View>
    </View>
  </View>;
}

export function DriverPanel({ user, order, offer, busy, coming, onAccept, onRateClient, onCompletionHeight, onHeight, onOnline, onAction, onChat, onDone, approach, navigation, backgroundReady, onBackground }: Props) {
  const d = useDriverStyles();
  const { isDark, palette } = useTheme();
  const t = tr(user.language);
  const { height: screenHeight } = useWindowDimensions();
  const { surface, navigate, onSheetClosed, reset, sheetClosing, rootVisible, rootTranslateY, onRootHeight } = usePanelTransition<'summary' | 'cancel' | 'comment'>('summary');
  const confirmation = surface === 'cancel';
  const showComment = surface === 'comment';
  const displayed = order || offer;
  const waiting = useWaiting(order);
  const [panelHeight, setPanelHeight] = useState(0);
  useEffect(() => { onHeight?.(rootVisible ? panelHeight : 0); }, [rootVisible, panelHeight, onHeight]);
  const delivery = !!displayed && displayed.kind !== undefined && displayed.kind !== 'RIDE';
  const goods = displayed?.deliveryDetails;
  const goodsDescription = goods?.goodsDescription?.trim();
  const deliverySummary = delivery ? [
    goodsDescription && !['Доставка', 'Доставка груза', 'Грузовой'].includes(goodsDescription) ? goodsDescription : '',
    goods?.doorToDoor ? 'От двери до двери' : '',
    goods?.loaders ? `Грузчики: ${goods.loaders}` : '',
  ].filter(Boolean).join(' · ') : '';
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const terminal = !!order && ['CANCELLED', 'NO_DRIVER'].includes(order.status);
  const onPanelGesture = (event: { nativeEvent: { state: number; translationY: number; velocityY: number } }) => {
    if (event.nativeEvent.state !== State.END || !displayed || !rootVisible) return;
    const { translationY, velocityY } = event.nativeEvent;
    if (terminal && order && (translationY > 48 || velocityY > 650)) { onDone(order.id); return; }
    if (translationY < -48 || velocityY < -650) setDetailsExpanded(true);
    if (translationY > 48 || velocityY > 650) setDetailsExpanded(false);
  };
  useEffect(() => { reset(); }, [order?.id, order?.status]);
  useEffect(() => { setDetailsExpanded(!(order && ['ASSIGNED', 'IN_PROGRESS'].includes(order.status))); }, [displayed?.id, order?.status]);
  const active = order && order.status in nextAction ? delivery ? ({
    ASSIGNED: { title: 'Следуйте к отправителю', button: 'Прибыл за грузом', action: 'arrive' },
    ARRIVED: { title: 'Ожидайте отправителя', button: 'Забрал груз', action: 'start' },
    IN_PROGRESS: { title: 'Доставка началась', button: 'Завершить доставку', action: 'complete' },
  } as const)[order.status as keyof typeof nextAction] : nextAction[order.status as keyof typeof nextAction] : null;
  const complete = order?.status === 'COMPLETED';
  const title = active?.title || 'Заказ отменён';
  const compactPassengerPickup = order?.status === 'ASSIGNED' && !delivery && !detailsExpanded;
  const passengerPickup = order?.status === 'ASSIGNED' && !delivery;
  const showNavigationMetrics = !!order && ['ASSIGNED', 'IN_PROGRESS'].includes(order.status);
  const progress = showNavigationMetrics ? navigation?.progress : null;
  const currentDestination = order?.status === 'ASSIGNED' ? order.pickup : order?.status === 'IN_PROGRESS' ? order.dropoff : null;
  const approximateDistance = showNavigationMetrics && currentDestination && navigation?.position
    ? distanceBetween(navigation.position, currentDestination) : null;
  const arrivalClock = (seconds: number) => new Date(Date.now() + seconds * 1000).toLocaleTimeString(user.language === 'ky' ? 'ky-KG' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
  const arrival = progress ? arrivalClock(progress.remainingSeconds) : '—';

  if (complete && order) return <DriverCompletionPanel order={order} user={user} busy={busy} onRateClient={onRateClient} onDone={onDone} onHeight={onCompletionHeight}/>;

  return <>
    <PanGestureHandler enabled={!!displayed && rootVisible} activeOffsetY={[-16, 16]} failOffsetX={[-24, 24]} onHandlerStateChange={onPanelGesture}>
    <Animated.View pointerEvents={rootVisible ? 'auto' : 'none'} accessibilityElementsHidden={!!(confirmation || showComment)} importantForAccessibility={confirmation || showComment ? 'no-hide-descendants' : 'auto'} onLayout={event => { const height = event.nativeEvent.layout.height; onRootHeight(height); setPanelHeight(height); }} style={[panelStyle.surface, d.panel, !displayed && { paddingTop: 14 }, { transform: [{ translateY: rootTranslateY }] }]}>
      {!!displayed && <View pointerEvents="none" style={d.dragHandle}/>}
      {!displayed ? <View style={d.idle}>
        <View style={d.row}><View style={d.idleIcon}><Icon name={!user.driverProfile?.verified ? 'shield-checkmark-outline' : user.driverProfile.online ? 'radio-outline' : 'car-outline'} size={25} color={palette.accent}/></View><View style={{ flex: 1, gap: 5 }}><Text style={d.title}>{t(!user.driverProfile?.verified ? 'Ожидаем подтверждение' : user.driverProfile.online ? 'Ищем заказы рядом' : 'Вы не на линии')}</Text><Text style={d.caption}>{t(!user.driverProfile?.verified ? 'Диспетчер проверяет профиль и автомобиль' : user.driverProfile.online ? 'Новый заказ появится здесь' : 'Выйдите на линию, чтобы получать заказы')}</Text></View></View>
        {!!user.driverProfile?.verified && !user.driverProfile.online && <Action label={t('Выйти на линию')} onPress={onOnline} busy={busy}/>}
      </View> : <View style={{ gap: compactPassengerPickup ? 9 : 13 }}>
        {offer ? <View style={d.offerLead}>
          <Text style={d.approachLabel}>{t(delivery ? 'До отправителя' : 'До клиента')}</Text>
          <View style={d.offerTools}><Deadline order={offer} language={user.language}/><Pressable accessibilityRole="button" accessibilityLabel={t(detailsExpanded ? delivery ? 'Свернуть детали доставки' : 'Свернуть детали поездки' : delivery ? 'Раскрыть детали доставки' : 'Раскрыть детали поездки')} accessibilityState={{ expanded: detailsExpanded }} onPress={() => setDetailsExpanded(value => !value)} style={d.offerToggle}><Icon name={detailsExpanded ? 'chevron-up' : 'chevron-down'} color={palette.muted} size={19}/></Pressable></View>
        </View> : terminal ? <View style={d.row}><Text style={d.title}>{t(title)}</Text></View> : <View style={d.row}><Pressable accessibilityRole="button" accessibilityLabel={t(detailsExpanded ? delivery ? 'Свернуть детали доставки' : 'Свернуть детали поездки' : delivery ? 'Раскрыть детали доставки' : 'Раскрыть детали поездки')} accessibilityState={{ expanded: detailsExpanded }} onPress={() => setDetailsExpanded(value => !value)} style={d.titleToggle}><Text style={[d.title, { flex: 1 }]}>{t(title)}</Text><Icon name={detailsExpanded ? 'chevron-up' : 'chevron-down'} color={palette.muted} size={18}/></Pressable></View>}
        {offer && <View testID="driver-offer-approach" style={d.approach}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[d.approachTitle, !approach?.route && d.approachPlaceholder]}>{approach?.route ? approach.route.distanceMeters >= 1000 ? km(approach.route.distanceMeters) : `${Math.round(approach.route.distanceMeters)} м` : approach?.loading ? t('Строим маршрут до клиента…') : approach?.error || t('Ожидаем GPS водителя')}</Text>
          <View style={d.approachTags}>
            {!!approach?.route && <Text style={d.approachTag}>{t('прибытие ≈')} {arrivalClock(approach.route.durationSeconds)}</Text>}
            <Text style={d.approachTag}>{approach?.route ? t(pickupCategory(approach.route.distanceMeters)) : t('Подача рассчитывается')}</Text>
            {detailsExpanded && !!offer.tariff?.name && <Text style={d.approachTag}>{t(offer.tariff.name)}</Text>}
          </View>
        </View>}
        {order && !terminal && !compactPassengerPickup && !backgroundReady && onBackground && <Pressable accessibilityRole="button" onPress={onBackground} style={d.background}><Icon name="volume-high-outline" color={palette.accent} size={20}/><Text style={d.backgroundText}>{t('Включить навигацию и положение в фоне')}</Text><Icon name="chevron-forward" color={palette.accent} size={16}/></Pressable>}
        {order && !terminal && <View style={d.row}>
          <View style={d.activePassengerIcon}><Icon name={delivery ? 'cube' : 'person'} size={27} color="white"/></View><View style={{ flex: 1, gap: 3 }}><Text style={d.person} numberOfLines={1}>{delivery ? order.client?.name || t('Отправитель') : order.passenger?.name || t('Пассажир')}</Text><Text style={d.caption}>{coming && order.status === 'ARRIVED' ? `${t(delivery ? 'Отправитель выходит' : 'Пассажир выходит')} · ` : ''}{delivery ? order.client?.phone : order.passenger ? order.passenger.phone : order.clientRating != null ? `★ ${Number(order.clientRating).toFixed(2).replace('.', ',')}` : t('Пока нет оценок')}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t(delivery ? 'Позвонить отправителю' : 'Позвонить пассажиру')} disabled={!(order.passenger?.phone || order.client?.phone)} onPress={() => { const phone = order.passenger?.phone || order.client?.phone; if (phone) void Linking.openURL(`tel:${phone}`); }} style={d.contact}><Icon name="call-outline" color={palette.accent} size={24}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t(delivery || order.passenger ? 'Чат с заказчиком' : 'Чат с пассажиром')} onPress={onChat} style={d.contact}><Icon name="chatbubble-outline" color={palette.accent} size={24}/></Pressable>
        </View>}
        {waiting && <View style={d.waiting}>
          <View style={{ flex: 1, gap: 3 }}><Text style={d.waitingTitle}>{t(waiting.phase === 'BEFORE_FREE' ? 'Ожидание начнётся через' : waiting.phase === 'FREE' ? 'Бесплатное ожидание' : 'Платное ожидание')} {waiting.phase === 'PAID' ? `· ${waiting.billedMinutes} ${t('мин')}` : `· ${waitingClock(waiting.remainingSeconds)}`}</Text>
          <Text style={d.caption}>{waiting.phase === 'BEFORE_FREE' ? `${order?.waiting?.freeMinutes ?? 5} ${t('мин бесплатно после начала')}` : waiting.phase === 'PAID' ? `+${money(waiting.charge)} · ${money(order?.waiting?.pricePerMinute ?? 0)}/${t('мин')}` : `${t('Затем')} ${money(order?.waiting?.pricePerMinute ?? 0)}/${t('мин')}`}</Text></View>
          <Text style={d.waitingPrice}>{money(waiting.totalPrice)}</Text>
        </View>}
        {showNavigationMetrics && currentDestination && !detailsExpanded && !passengerPickup && <View testID="driver-current-destination" style={[d.row, { gap: 8 }]}>
          <Icon name={order?.status === 'ASSIGNED' ? 'location-outline' : 'flag-outline'} color={palette.accent} size={19}/>
          <Text numberOfLines={1} style={[d.address, { flex: 1, fontSize: 14 }]}>{shortAddress(currentDestination.address)}</Text>
        </View>}
        {showNavigationMetrics && <View testID="driver-trip-metrics" style={[d.liveStats, compactPassengerPickup && d.compactLiveStats]}>
          <View style={d.liveStat}><Text numberOfLines={1} adjustsFontSizeToFit style={d.liveValue}>{progress ? displayDistance(progress.remainingMeters) : approximateDistance != null ? `≈${displayDistance(approximateDistance)}` : '—'}</Text><Text style={d.liveLabel}>{t(order?.status === 'ASSIGNED' ? 'до клиента' : progress ? 'до цели' : 'по прямой')}</Text></View>
          <View style={d.liveDivider}/>
          <View style={d.liveStat}><Text numberOfLines={1} adjustsFontSizeToFit style={d.liveValue}>{arrival}</Text><Text style={d.liveLabel}>{t('прибытие ≈')}</Text></View>
        </View>}
        {!terminal && !detailsExpanded && !passengerPickup && <View testID="driver-compact-summary" style={d.compactSummary}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={d.compactService}>{t(delivery ? displayed.kind === 'DELIVERY_TRUCK' ? 'Грузовой' : 'Доставка' : displayed.tariff?.name || 'Такси')}</Text>
            {delivery && !!goods?.doorToDoor && <Text style={d.caption}>{t('От двери до двери')}</Text>}
          </View>
          <Text style={d.compactPrice}>{money(displayed.price)}</Text>
        </View>}
        {terminal && order && <View testID="driver-terminal-summary" style={d.detailsBody}>
          <RouteDetails order={order} language={user.language}/>
          <View style={[d.stats, { justifyContent: 'space-between', alignItems: 'center' }]}><Text style={d.caption}>{t('Наличные')}</Text><Text style={d.compactPrice}>{money(order.price)}</Text></View>
        </View>}
        {!terminal && detailsExpanded && <ScrollView testID="driver-trip-details" style={{ maxHeight: Math.max(96, Math.min(230, screenHeight * .22)) }} contentContainerStyle={d.detailsBody} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          <RouteDetails order={displayed} language={user.language} offer={!!offer}/>
          {passengerPickup ? <View style={d.pickupPrice}><Text style={d.caption}>{t('Наличные')}</Text><Text style={d.compactPrice}>{money(displayed.price)}</Text></View> : <View style={d.stats}>
            <View style={d.stat}><Text numberOfLines={1} adjustsFontSizeToFit style={d.statValue}>{km(displayed.distanceMeters)}</Text><Text style={d.caption}>{t(delivery ? 'Маршрут доставки' : 'Маршрут поездки')}</Text></View><View style={d.divider}/>
            <View style={d.stat}><Text numberOfLines={1} adjustsFontSizeToFit style={d.statValue}>{tripTime(displayed.durationSeconds, user.language)}</Text><Text style={d.caption}>{t(delivery ? 'Время доставки' : 'Время поездки')}</Text></View><View style={d.divider}/>
            <View style={d.stat}><Text numberOfLines={1} adjustsFontSizeToFit style={[d.statValue, { color: palette.accent }]}>{money(displayed.price)}</Text><Text style={d.caption}>{t('Наличные')}</Text></View>
          </View>}
          {!!deliverySummary && <View style={d.comment}><Icon name="cube-outline" color={palette.accent} size={22}/><Text numberOfLines={3} style={d.commentText}>{deliverySummary}</Text></View>}
        </ScrollView>}
        {!!displayed.comment && !compactPassengerPickup && <Pressable testID="driver-client-comment" accessibilityRole="button" accessibilityLabel={t(delivery ? 'Комментарий заказчика' : 'Комментарий пассажира')} onPress={() => navigate('comment')} style={d.comment}><Icon name="chatbox-outline" color={palette.accent} size={22}/><Text numberOfLines={2} style={d.commentText}>{displayed.comment}</Text><Icon name="chevron-forward" color={palette.muted} size={16}/></Pressable>}
        {offer && <View style={d.offerPassenger}><View style={d.offerPassengerIcon}><Icon name={delivery ? 'cube' : 'person'} size={20} color="white"/></View><Text style={[d.person, { flex: 1 }]}>{delivery ? t('Отправитель') : offer.passenger?.name || t('Пассажир')}</Text>{!offer.passenger && <><Icon name="star" size={17} color={isDark ? '#FFFFFF' : '#E7A324'}/><Text style={d.ratingValue}>{offer.clientRating != null ? Number(offer.clientRating).toFixed(2).replace('.', ',') : t('Пока нет оценок')}</Text></>}</View>}
        {offer && <SlideToConfirm label={t('Взять заказ')} hint={t('Проведите вправо')} onConfirm={() => onAccept(offer)} busy={busy} resetKey={`${offer.id}:accept`}/>}
        {active && order && <SlideToConfirm label={t(active.button)} hint={t('Проведите вправо')} onConfirm={() => onAction(active.action)} busy={busy} resetKey={`${order.id}:${order.status}`} compact={compactPassengerPickup}/>}
        {order && !terminal && order.status !== 'IN_PROGRESS' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigate('cancel')} style={d.cancel}><Text style={d.caption}>{t('Отменить заказ')}</Text></Pressable>}
        {terminal && order && <Action label={t('К новым заказам')} onPress={() => onDone(order.id)} busy={busy}/>}
      </View>}
    </Animated.View>
    </PanGestureHandler>
    {(confirmation || showComment) && <BottomPanel key={surface} closeRequested={sheetClosing} onClose={onSheetClosed}>
      <View style={d.confirm}>
        <Text style={d.title}>{t(showComment ? delivery ? 'Комментарий заказчика' : 'Комментарий пассажира' : 'Отменить заказ?')}</Text>
        <Text style={d.confirmText}>{showComment ? displayed?.comment : t('Пассажир увидит, что заказ отменён.')}</Text>
        {showComment ? <Action label={t('Готово')} onPress={() => navigate('summary')}/> : <><Action label={t('Отменить заказ')} onPress={() => onAction('cancel')} busy={busy}/><Action label={t('Назад')} secondary onPress={() => navigate('summary')}/></>}
      </View>
    </BottomPanel>}
  </>;
}

const lightD = StyleSheet.create({
  panel: { marginTop: -30, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 17, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  dragHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: '#AAB6C8', marginTop: -10, marginBottom: 11 },
  compactSummary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E8EFF7' },
  pickupPrice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderColor: '#E8EFF7' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: '#EAF3FF' },
  waitingTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  waitingPrice: { fontSize: 17, fontWeight: '800', color: colors.ink },
  compactService: { fontSize: 15, fontWeight: '700', color: colors.ink },
  compactPrice: { fontSize: 23, fontWeight: '800', color: colors.ink },
  offerLead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  offerTools: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  offerToggle: { width: 28, height: 35, alignItems: 'center', justifyContent: 'center' },
  approachLabel: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  approach: { gap: 5 },
  approachTitle: { color: '#122640', fontSize: 29, fontWeight: '800', fontVariant: ['tabular-nums'] },
  approachPlaceholder: { fontSize: 17, fontWeight: '600', lineHeight: 23 },
  approachTags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  approachTag: { overflow: 'hidden', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#EAF0F8', color: '#3A506C', fontSize: 13, fontWeight: '600' },
  mapSkip: { alignSelf: 'center', minHeight: 45, justifyContent: 'center', paddingHorizontal: 23, borderRadius: 24, backgroundColor: 'rgba(255,255,255,.97)', shadowColor: '#26354F', shadowOpacity: .16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  mapSkipText: { color: '#202A3B', fontSize: 16, fontWeight: '700' },
  background: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  backgroundText: { flex: 1, color: '#246BFD', fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 31 },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, lineHeight: 28 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.muted },
  deadline: { width: 114, gap: 5 }, progress: { height: 4, borderRadius: 4, backgroundColor: '#E1EAF6' },
  route: { flexDirection: 'row', gap: 15, paddingVertical: 1 }, routePins: { alignItems: 'center', paddingTop: 17, paddingBottom: 6 }, routeLine: { flex: 1, borderLeftWidth: 1.5, borderColor: '#ACBDD2', borderStyle: 'dashed', marginVertical: 5 },
  routeLetter: { width: 29, height: 29, borderWidth: 2, borderColor: '#30384A', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, routeLetterText: { color: '#30384A', fontSize: 17, fontWeight: '800' },
  address: { fontSize: 18, lineHeight: 23, fontWeight: '600', color: colors.ink },
  offerAddress: { fontSize: 16, lineHeight: 29 },
  stats: { flexDirection: 'row', paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E8EFF7' },
  stat: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 3 }, statValue: { fontSize: 20, fontWeight: '700', color: colors.ink }, divider: { width: 1, backgroundColor: '#E8EFF7' },
  person: { fontSize: 17, color: colors.ink, fontWeight: '700' }, contact: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#EAF3FF' },
  activePassengerIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: '#293448', alignItems: 'center', justifyContent: 'center' },
  offerPassenger: { flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderColor: '#E8EFF7', paddingTop: 11 },
  offerPassengerIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#293448', alignItems: 'center', justifyContent: 'center', marginRight: 3 },
  ratingValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  liveStats: { minHeight: 70, borderWidth: 1, borderColor: '#C9DFFF', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  compactLiveStats: { minHeight: 52, borderRadius: 12, paddingVertical: 5 },
  liveStat: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 2 },
  liveValue: { fontSize: 20, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  liveLabel: { fontSize: 11, color: colors.muted },
  liveDivider: { width: 1, height: 34, backgroundColor: '#D6E5F9' },
  comment: { flexDirection: 'row', alignItems: 'center', gap: 12 }, commentText: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 19 },
  detailsBody: { gap: 12 },
  action: { height: 52, borderRadius: 17, backgroundColor: colors.blue, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, secondary: { height: 46, backgroundColor: '#EFF3F8' }, actionText: { color: 'white', fontSize: 18, fontWeight: '600' },
  slider: { height: 62, borderRadius: 31, padding: SLIDER_INSET, justifyContent: 'center', overflow: 'hidden', backgroundColor: '#EEF6FF', borderWidth: 1, borderColor: '#C9DFFF' },
  compactSlider: { height: 54, borderRadius: 27 },
  sliderText: { position: 'absolute', left: 68, right: 18, color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  sliderThumb: { width: SLIDER_THUMB, height: SLIDER_THUMB, borderRadius: SLIDER_THUMB / 2, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', shadowColor: colors.blue, shadowOpacity: .24, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  compactSliderThumb: { width: 48, height: 48, borderRadius: 24 },
  cancel: { alignItems: 'center', paddingVertical: 3 }, idle: { paddingTop: 4, paddingBottom: 6, gap: 17 }, idleIcon: { width: 48, height: 48, borderRadius: 18, backgroundColor: '#EDF5FF', alignItems: 'center', justifyContent: 'center' },
  confirm: { paddingHorizontal: 18, paddingBottom: 12, gap: 16 }, confirmText: { fontSize: 16, color: colors.ink, lineHeight: 22 },
});

const darkD = StyleSheet.create({
  panel: { ...lightD.panel, backgroundColor: '#111111', shadowOpacity: 0 },
  dragHandle: { ...lightD.dragHandle, backgroundColor: '#6D6D6D' },
  compactSummary: { ...lightD.compactSummary, borderColor: '#353535' },
  pickupPrice: { ...lightD.pickupPrice, borderColor: '#353535' },
  waiting: { ...lightD.waiting, backgroundColor: '#252525' },
  waitingTitle: { ...lightD.waitingTitle, color: '#FFFFFF' },
  waitingPrice: { ...lightD.waitingPrice, color: '#FFFFFF' },
  compactService: { ...lightD.compactService, color: '#FFFFFF' },
  compactPrice: { ...lightD.compactPrice, color: '#FFFFFF' },
  approachLabel: { ...lightD.approachLabel, color: '#B0B0B0' },
  approachTitle: { ...lightD.approachTitle, color: '#FFFFFF' },
  approachTag: { ...lightD.approachTag, backgroundColor: '#242424', color: '#FFFFFF' },
  mapSkip: { ...lightD.mapSkip, backgroundColor: '#111111', shadowColor: '#000000' },
  mapSkipText: { ...lightD.mapSkipText, color: '#FFFFFF' },
  backgroundText: { ...lightD.backgroundText, color: '#FFFFFF' },
  title: { ...lightD.title, color: '#FFFFFF' },
  caption: { ...lightD.caption, color: '#B0B0B0' },
  progress: { ...lightD.progress, backgroundColor: '#353535' },
  routeLine: { ...lightD.routeLine, borderColor: '#777777' },
  routeLetter: { ...lightD.routeLetter, borderColor: '#FFFFFF' },
  routeLetterText: { ...lightD.routeLetterText, color: '#FFFFFF' },
  address: { ...lightD.address, color: '#FFFFFF' },
  stats: { ...lightD.stats, borderColor: '#353535' },
  statValue: { ...lightD.statValue, color: '#FFFFFF' },
  divider: { ...lightD.divider, backgroundColor: '#353535' },
  person: { ...lightD.person, color: '#FFFFFF' },
  contact: { ...lightD.contact, backgroundColor: '#242424' },
  activePassengerIcon: { ...lightD.activePassengerIcon, backgroundColor: '#353535' },
  offerPassenger: { ...lightD.offerPassenger, borderColor: '#353535' },
  offerPassengerIcon: { ...lightD.offerPassengerIcon, backgroundColor: '#353535' },
  ratingValue: { ...lightD.ratingValue, color: '#FFFFFF' },
  liveStats: { ...lightD.liveStats, borderColor: '#353535', backgroundColor: '#1D1D1D' },
  liveValue: { ...lightD.liveValue, color: '#FFFFFF' },
  liveLabel: { ...lightD.liveLabel, color: '#B0B0B0' },
  liveDivider: { ...lightD.liveDivider, backgroundColor: '#353535' },
  commentText: { ...lightD.commentText, color: '#FFFFFF' },
  action: { ...lightD.action, backgroundColor: '#FFFFFF' },
  secondary: { ...lightD.secondary, backgroundColor: '#242424' },
  actionText: { ...lightD.actionText, color: '#050505' },
  slider: { ...lightD.slider, backgroundColor: '#1D1D1D', borderColor: '#353535' },
  sliderText: { ...lightD.sliderText, color: '#FFFFFF' },
  sliderThumb: { ...lightD.sliderThumb, backgroundColor: '#FFFFFF', shadowColor: '#000000' },
  idleIcon: { ...lightD.idleIcon, backgroundColor: '#242424' },
  confirm: { ...lightD.confirm, backgroundColor: '#111111' },
  confirmText: { ...lightD.confirmText, color: '#FFFFFF' },
});

function useDriverStyles() {
  const { isDark } = useTheme();
  return isDark ? { ...lightD, ...darkD } : lightD;
}
