import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessCelebration } from './SuccessCelebration';
import { Icon, km, money, shortAddress, tripTime } from './ui';
import type { Order, User } from './types';
import { useTheme } from './design/theme';
import { useSheetDragToClose } from './useSheetDragToClose';
import { useSheetStageTransition } from './useSheetStageTransition';

type Props = {
  order: Order;
  user: User;
  busy: boolean;
  onDone: (orderId: string) => void;
  onRateClient: (score: number) => Promise<boolean>;
  onHeight?: (height: number) => void;
};

function MainButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  const s = useCompletionStyles();
  const { palette } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!busy, busy: !!busy }} disabled={busy} onPress={onPress} style={({ pressed }) => [s.button, (pressed || busy) && s.buttonDimmed]}>
    {busy && <ActivityIndicator size="small" color={palette.accentText}/>}
    <Text style={s.buttonText}>{label}</Text>
  </Pressable>;
}

export function DriverCompletionPanel({ order, user, busy, onDone, onRateClient, onHeight }: Props) {
  const s = useCompletionStyles();
  const { isDark, palette } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ky = user.language === 'ky';
  const delivery = order.kind !== undefined && order.kind !== 'RIDE';
  const say = (ru: string, kyrgyz: string) => ky ? kyrgyz : ru;
  const { stage, navigate: navigateStage, reset: resetStage, exit: exitStage, translateY: stageTranslateY } = useSheetStageTransition<'success' | 'rating'>('success');
  const [score, setScore] = useState(0);
  const [rated, setRated] = useState(order.driverRating != null);
  const [submitting, setSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  const closeCompletion = () => exitStage(() => onDone(order.id));
  const drag = useSheetDragToClose(stage === 'rating' ? () => navigateStage('success') : closeCompletion, !busy && !submitting);
  useEffect(() => { drag.reset(); }, [stage]);

  useEffect(() => {
    resetStage('success');
    setScore(0);
    setRated(order.driverRating != null);
    setRatingError(false);
  }, [order.id]);
  useEffect(() => { if (order.driverRating != null) setRated(true); }, [order.driverRating]);

  const submit = async () => {
    if (busy || submitting || score < 1) return;
    setSubmitting(true);
    try {
      if (await onRateClient(score)) {
        setRated(true);
        setRatingError(false);
        closeCompletion();
      } else setRatingError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return <View testID="driver-completion" style={s.host}>
    <View style={[s.backdrop, { backgroundColor: palette.backdrop }]}/>
    <Animated.View onLayout={event => onHeight?.(event.nativeEvent.layout.height)} style={[s.sheet, { maxHeight: screenHeight - insets.top - 16, paddingBottom: Math.max(insets.bottom, 14), transform: [{ translateY: stageTranslateY }, { translateY: drag.translateY }] }]}>
      <View {...drag.panHandlers} style={s.handleTouch}><Pressable accessibilityRole="button" accessibilityLabel={stage === 'rating' ? say('Назад к заказу', 'Буюртмага кайтуу') : say('Закрыть', 'Жабуу')} accessibilityState={{ disabled: busy || submitting }} disabled={busy || submitting} onPress={stage === 'rating' ? () => navigateStage('success') : closeCompletion} hitSlop={8}><View style={s.handle}/></Pressable></View>
      <ScrollView contentContainerStyle={stage === 'success' ? s.successContent : s.ratingContent} showsVerticalScrollIndicator={false} bounces={false} style={{ flexGrow: 0 }}>
        {stage === 'success' ? <>
          <SuccessCelebration key={`driver-success-${order.id}`} size={132} testID="driver-success-celebration"/>
          <Text style={s.successTitle}>{say('Заказ успешно\nвыполнен!', 'Буюртма ийгиликтүү\nаткарылды!')}</Text>
          <Text style={s.successSubtitle}>{say('Спасибо, что выбрали Atlas', 'Atlasты тандаганыңыз үчүн рахмат')}</Text>
          <View style={s.routeCard}>
            <View style={s.routeRow}><Icon name="person" size={22} color={palette.ink}/><View style={s.routeCopy}><Text style={s.routeLabel}>{say('Откуда', 'Кайдан')}</Text><Text style={s.routeText} numberOfLines={2}>{shortAddress(order.pickup.address)}</Text></View></View>
            <View style={s.routeDivider}/>
            <View style={s.routeRow}><Icon name="flag" size={22} color={palette.ink}/><View style={s.routeCopy}><Text style={s.routeLabel}>{say('Куда', 'Кайда')}</Text><Text style={s.routeText} numberOfLines={2}>{shortAddress(order.dropoff.address)}</Text></View></View>
          </View>
          <View style={s.metricsCard}>
            <View style={s.metric}><Text style={s.metricLabel}>{say('Общий путь', 'Жалпы жол')}</Text><Text style={s.metricValue}>{km(order.distanceMeters)}</Text></View>
            <View style={s.metricsDivider}/>
            <View style={s.metric}><Text style={s.metricLabel}>{say('Время в пути', 'Жолдогу убакыт')}</Text><Text style={s.metricValue}>{tripTime(order.durationSeconds, user.language)}</Text></View>
          </View>
          <View style={s.fareCard}><Icon name="cash" size={25} color={isDark ? '#FFFFFF' : palette.accent}/><Text style={s.fareLabel} numberOfLines={1}>{say('Наличные', 'Накталай')} · {order.tariff?.name || say('Стандарт', 'Стандарт')}</Text><Text style={s.price}>{money(order.price)}</Text></View>
          {!rated && <MainButton label={say(delivery ? 'Оценить заказчика' : 'Оценить пассажира', 'Жүргүнчүнү баалоо')} onPress={() => { setScore(0); setRatingError(false); navigateStage('rating'); }} busy={busy}/>}
          <Pressable accessibilityRole="button" accessibilityLabel={say('Закрыть', 'Жабуу')} accessibilityState={{ disabled: busy }} disabled={busy} onPress={closeCompletion} style={s.close}><Text style={s.closeText}>{say('Закрыть', 'Жабуу')}</Text></Pressable>
        </> : <>
          <Text style={s.ratingTitle}>{say('Как всё прошло?', 'Баары кандай өттү?')}</Text>
          <Text style={s.ratingSubtitle}>{say(delivery ? 'Оцените заказчика' : 'Оцените пассажира', 'Жүргүнчүнү баалаңыз')}</Text>
          <View style={s.stars}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${say('Оценка', 'Баа')} ${value}`} accessibilityState={{ selected: score === value }} disabled={busy || submitting} onPress={() => { setScore(value); setRatingError(false); }} hitSlop={6} style={s.star}><Icon name={value <= score ? 'star' : 'star-outline'} size={40} color={value <= score ? isDark ? '#FFFFFF' : '#FFBE12' : isDark ? '#777777' : '#AEBED2'}/></Pressable>)}</View>
          {ratingError && <Text accessibilityRole="alert" style={s.ratingError}>{say('Не удалось сохранить отзыв. Попробуйте ещё раз.', 'Пикир сакталган жок. Кайра аракет кылыңыз.')}</Text>}
          <MainButton label={score ? say('Отправить', 'Жөнөтүү') : say('Пропустить', 'Өткөрүп жиберүү')} onPress={score ? () => void submit() : closeCompletion} busy={busy || submitting}/>
        </>}
      </ScrollView>
    </Animated.View>
  </View>;
}

const lightS = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 30, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(16,29,56,.42)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 16, paddingTop: 9, shadowColor: '#12365F', shadowOpacity: .12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 9 },
  handleTouch: { height: 25, alignItems: 'center', justifyContent: 'flex-start' },
  handle: { width: 43, height: 5, borderRadius: 4, backgroundColor: '#B9C3D5' },
  successContent: { gap: 7, paddingBottom: 2 },
  successTitle: { fontSize: 23, lineHeight: 27, fontWeight: '800', color: '#101D38', textAlign: 'center', letterSpacing: -.5, marginTop: -10 },
  successSubtitle: { fontSize: 14, lineHeight: 19, color: '#63718D', textAlign: 'center', marginBottom: 3 },
  routeCard: { backgroundColor: '#F3F7FF', borderRadius: 15, paddingHorizontal: 15, paddingVertical: 9, gap: 7 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  routeCopy: { flex: 1, gap: 2 },
  routeLabel: { fontSize: 11, lineHeight: 15, color: '#72819B' },
  routeText: { fontSize: 14, lineHeight: 19, fontWeight: '500', color: '#101D38' },
  routeDivider: { marginLeft: 34, height: 1, backgroundColor: '#DFE8F5' },
  metricsCard: { backgroundColor: '#F3F7FF', borderRadius: 15, minHeight: 63, flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  metric: { flex: 1, alignItems: 'center', gap: 3 },
  metricLabel: { fontSize: 12, lineHeight: 17, color: '#72819B' },
  metricValue: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: '#101D38' },
  metricsDivider: { width: 1, height: 34, backgroundColor: '#DFE8F5' },
  fareCard: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#F3F7FF', borderRadius: 15, paddingHorizontal: 15, minHeight: 46 },
  fareLabel: { color: '#101D38', fontSize: 14, flex: 1 },
  price: { fontSize: 17, fontWeight: '700', color: '#101D38' },
  button: { backgroundColor: '#087FFF', borderRadius: 16, minHeight: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 4 },
  buttonText: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  buttonDimmed: { opacity: .6 },
  close: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '700', color: '#087FFF' },
  ratingContent: { gap: 15, paddingHorizontal: 1, paddingTop: 17, paddingBottom: 5, minHeight: 225 },
  ratingTitle: { fontSize: 25, lineHeight: 31, fontWeight: '800', color: '#101D38', textAlign: 'center', letterSpacing: -.5 },
  ratingSubtitle: { fontSize: 16, lineHeight: 22, color: '#78859C', textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, marginVertical: 8 },
  star: { padding: 2 },
  ratingError: { color: '#C74747', fontSize: 13, textAlign: 'center' },
});

const darkS = StyleSheet.create({
  sheet: { ...lightS.sheet, backgroundColor: '#111111', shadowColor: '#000000' },
  handle: { ...lightS.handle, backgroundColor: '#777777' },
  successTitle: { ...lightS.successTitle, color: '#FFFFFF' },
  successSubtitle: { ...lightS.successSubtitle, color: '#B0B0B0' },
  routeCard: { ...lightS.routeCard, backgroundColor: '#1D1D1D' },
  routeLabel: { ...lightS.routeLabel, color: '#B0B0B0' },
  routeText: { ...lightS.routeText, color: '#FFFFFF' },
  routeDivider: { ...lightS.routeDivider, backgroundColor: '#353535' },
  metricsCard: { ...lightS.metricsCard, backgroundColor: '#1D1D1D' },
  metricLabel: { ...lightS.metricLabel, color: '#B0B0B0' },
  metricValue: { ...lightS.metricValue, color: '#FFFFFF' },
  metricsDivider: { ...lightS.metricsDivider, backgroundColor: '#353535' },
  fareCard: { ...lightS.fareCard, backgroundColor: '#1D1D1D' },
  fareLabel: { ...lightS.fareLabel, color: '#FFFFFF' },
  price: { ...lightS.price, color: '#FFFFFF' },
  button: { ...lightS.button, backgroundColor: '#FFFFFF' },
  buttonText: { ...lightS.buttonText, color: '#050505' },
  closeText: { ...lightS.closeText, color: '#FFFFFF' },
  ratingTitle: { ...lightS.ratingTitle, color: '#FFFFFF' },
  ratingSubtitle: { ...lightS.ratingSubtitle, color: '#B0B0B0' },
  ratingError: { ...lightS.ratingError, color: '#FF8A8A' },
});

function useCompletionStyles() {
  const { isDark } = useTheme();
  return isDark ? { ...lightS, ...darkS } : lightS;
}
