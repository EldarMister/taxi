import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessCelebration } from './SuccessCelebration';
import { useMotionPreference } from './design/motion';
import { useTheme } from './design/theme';
import { Icon, colors, money, shortAddress } from './ui';
import { useSheetDragToClose } from './useSheetDragToClose';
import { useSheetStageTransition } from './useSheetStageTransition';
import type { Order, User } from './types';

type Stage = 'success' | 'rating' | 'thankYou';
type Props = {
  order: Order;
  user: User;
  busy: boolean;
  onDone: () => void;
  onRating: (score: number, comment?: string) => Promise<boolean>;
  onHeight: (height: number) => void;
};

const compliments = [
  { ru: 'Отличный водитель', ky: 'Мыкты айдоочу', icon: 'happy' as const, color: '#15B565' },
  { ru: 'Чистый автомобиль', ky: 'Таза унаа', icon: 'car-sport' as const, color: '#087FFF' },
  { ru: 'Безопасная поездка', ky: 'Коопсуз сапар', icon: 'shield-checkmark' as const, color: '#1FA979' },
];

function PrimaryButton({ label, icon, onPress, disabled, busy }: { label: string; icon?: React.ComponentProps<typeof Icon>['name']; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const { isDark } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [s.primary, isDark && s.darkPrimary, pressed && s.pressed, (disabled || busy) && s.disabled]}>
    {busy ? <ActivityIndicator color={isDark ? '#050505' : '#FFFFFF'}/> : icon ? <Icon name={icon} size={22} color={isDark ? '#050505' : '#FFFFFF'}/> : null}
    <Text style={[s.primaryText, isDark && s.darkPrimaryText]}>{label}</Text>
  </Pressable>;
}

export function ClientCompletionPanel({ order, user, busy, onDone, onRating, onHeight }: Props) {
  const { isDark } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const reducedMotion = useMotionPreference();
  const insets = useSafeAreaInsets();
  const ky = user.language === 'ky';
  const delivery = order.kind !== undefined && order.kind !== 'RIDE';
  const say = (ru: string, kyrgyz: string) => ky ? kyrgyz : ru;
  const { stage, navigate: navigateStage, reset: resetStage, exit: exitStage, translateY: stageTranslateY } = useSheetStageTransition<Stage>(order.rating ? 'thankYou' : 'success');
  const [score, setScore] = useState(5);
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const closeCompletion = () => exitStage(onDone);
  const drag = useSheetDragToClose(stage === 'rating' ? () => navigateStage('success') : closeCompletion, stage === 'rating' && !busy && !submitting);
  useEffect(() => { drag.reset(); }, [stage]);
  const carEntry = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    resetStage(order.rating ? 'thankYou' : 'success');
    setScore(order.rating || 5);
    setSelected([]);
    setComment('');
  }, [order.id]);

  useEffect(() => {
    if (stage !== 'thankYou') return;
    onHeight(0);
    if (reducedMotion !== false) { carEntry.setValue(1); return; }
    carEntry.setValue(0);
    const animation = Animated.timing(carEntry, { toValue: 1, duration: 560, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [stage, carEntry, onHeight, reducedMotion]);

  const submit = async () => {
    if (submitting || busy || score < 1) return;
    setSubmitting(true);
    const note = [
      ...selected.map(key => compliments.find(item => item.ru === key)).filter((value): value is typeof compliments[number] => !!value).map(item => ky ? item.ky : item.ru),
      comment.trim(),
    ].filter(Boolean).join(' · ');
    try {
      const saved = await onRating(score, note || undefined);
      if (saved) navigateStage('thankYou');
    } finally {
      setSubmitting(false);
    }
  };

  const measure = (height: number) => { if (stage !== 'thankYou') onHeight(height); };
  const swipeHandle = stage === 'rating' ? () => navigateStage('success') : closeCompletion;

  if (stage === 'thankYou') return <View style={s.thankYouHost}>
    <View style={[s.backdrop, isDark && s.darkBackdrop]}/>
    <Animated.View style={[s.thankYouCard, isDark && s.darkThankYouCard, { maxHeight: screenHeight - insets.top - insets.bottom - 24, transform: [{ translateY: stageTranslateY }] }]}>
      <ScrollView contentContainerStyle={s.thankYouContent} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={s.thankYouArt}>
          <SuccessCelebration key={`thanks-${order.id}`} variant="thankYou" size={210} testID="thank-you-celebration"/>
          <Animated.Image source={require('../assets/success-blue-car.png')} resizeMode="cover" accessibilityLabel={say('Синий автомобиль', 'Көк унаа')} style={[s.thankYouCar, { opacity: carEntry, transform: [{ translateY: carEntry.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }, { scale: carEntry.interpolate({ inputRange: [0, 1], outputRange: [.9, 1] }) }] }]}/>
        </View>
        <Text style={[s.thankYouTitle, isDark && s.darkInk]}>{say('Спасибо\nза ваш отзыв!', 'Пикириңиз үчүн\nрахмат!')}</Text>
        <Text style={[s.thankYouSubtitle, isDark && s.darkMuted]}>{say('Ваше мнение помогает нам\nделать Atlas лучше', 'Сиздин пикириңиз Atlasты\nжакшыртууга жардам берет')} <Icon name="heart" size={19} color={isDark ? '#FFFFFF' : '#087FFF'}/></Text>
        <View style={s.thankYouSpacer}/>
        <View style={s.thankYouButton}><PrimaryButton label={say('Отлично', 'Азамат')} onPress={closeCompletion}/></View>
      </ScrollView>
    </Animated.View>
  </View>;

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.host} pointerEvents="box-none">
    <Animated.View onLayout={event => measure(event.nativeEvent.layout.height)} style={[s.sheet, isDark && s.darkSheet, { paddingBottom: Math.max(insets.bottom, 14), transform: [{ translateY: stageTranslateY }, { translateY: drag.translateY }] }]}>
      {stage === 'rating' && <View {...drag.panHandlers} style={s.handleTouch}><Pressable accessibilityRole="button" accessibilityLabel={say(delivery ? 'Вернуться к доставке' : 'Вернуться к поездке', 'Сапарга кайтуу')} accessibilityState={{ disabled: submitting || busy }} disabled={submitting || busy} onPress={swipeHandle} hitSlop={10}><View style={[s.handle, isDark && s.darkHandle]}/></Pressable></View>}
      <ScrollView contentContainerStyle={stage === 'success' ? s.successContent : s.ratingContent} showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, maxHeight: screenHeight - insets.top - 36 }}>
        {stage === 'success' ? <>
          <SuccessCelebration key={`success-${order.id}`} size={132} testID="order-success-celebration"/>
          <Text style={[s.successTitle, isDark && s.darkInk]}>{say('Заказ успешно\nвыполнен!', 'Буюртма ийгиликтүү\nаткарылды!')}</Text>
          <Text style={[s.successSubtitle, isDark && s.darkMuted]}>{say('Спасибо, что выбрали Atlas', 'Atlasты тандаганыңыз үчүн рахмат')}</Text>
          <View style={[s.routeCard, isDark && s.darkInset]}>
            <View style={s.routeRow}><Icon name="person" size={22} color={isDark ? '#FFFFFF' : colors.ink}/><Text style={[s.routeText, isDark && s.darkInk]} numberOfLines={2}>{shortAddress(order.pickup.address)}</Text></View>
            <View style={s.routeRow}><Icon name="flag" size={22} color={isDark ? '#FFFFFF' : colors.ink}/><Text style={[s.routeText, isDark && s.darkInk]} numberOfLines={2}>{shortAddress(order.dropoff.address)}</Text></View>
          </View>
          <View style={[s.fareCard, isDark && s.darkInset]}><Icon name="cash" size={25} color={isDark ? '#FFFFFF' : colors.blue}/><Text style={[s.fareLabel, isDark && s.darkInk]} numberOfLines={1}>{say('Наличные', 'Накталай')} · {order.tariff?.name || say('Стандарт', 'Стандарт')}</Text><Text style={[s.price, isDark && s.darkInk]}>{money(order.price)}</Text></View>
          <PrimaryButton label={say(delivery ? 'Оценить доставку' : 'Оценить поездку', 'Сапарды баалоо')} icon="star" onPress={() => navigateStage('rating')}/>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Закрыть', 'Жабуу')} onPress={closeCompletion} style={s.close}><Text style={[s.closeText, isDark && s.darkInk]}>{say('Закрыть', 'Жабуу')}</Text></Pressable>
        </> : <>
          <Text style={[s.ratingTitle, isDark && s.darkInk]}>{say(delivery ? 'Оцените доставку' : 'Оцените поездку', 'Сапарды баалаңыз')}</Text>
          <Text style={[s.ratingSubtitle, isDark && s.darkMuted]}>{say(delivery ? 'Как прошла доставка\nс водителем?' : 'Как прошла ваша поездка\nс водителем?', 'Айдоочу менен сапарыңыз\nкандай өттү?')}</Text>
          <View style={s.stars}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${say('Оценка', 'Баа')} ${value}`} accessibilityState={{ selected: score === value }} onPress={() => setScore(value)} hitSlop={5} style={s.star}><Icon name={value <= score ? 'star' : 'star-outline'} size={39} color={isDark ? '#FFFFFF' : '#FFBE12'}/></Pressable>)}</View>
          <View style={s.compliments}>{compliments.map(item => <Pressable key={item.ru} accessibilityRole="checkbox" accessibilityLabel={say(item.ru, item.ky)} accessibilityState={{ checked: selected.includes(item.ru) }} onPress={() => setSelected(current => current.includes(item.ru) ? current.filter(value => value !== item.ru) : [...current, item.ru])} style={[s.compliment, isDark && s.darkCompliment, selected.includes(item.ru) && s.complimentSelected, isDark && selected.includes(item.ru) && s.darkComplimentSelected]}><View style={[s.complimentIcon, { backgroundColor: isDark ? '#FFFFFF' : item.color }]}><Icon name={item.icon} size={16} color={isDark ? '#050505' : '#FFFFFF'}/></View><Text style={[s.complimentText, isDark && s.darkInk]}>{say(item.ru, item.ky)}</Text></Pressable>)}</View>
          <TextInput accessibilityLabel={say(delivery ? 'Комментарий к доставке' : 'Комментарий к поездке', 'Сапар тууралуу пикир')} placeholder={say('Оставьте комментарий (необязательно)', 'Пикириңизди калтырыңыз (милдеттүү эмес)')} placeholderTextColor={isDark ? '#A0A0A0' : '#8391A7'} selectionColor={isDark ? '#FFFFFF' : undefined} multiline maxLength={400} value={comment} onChangeText={setComment} textAlignVertical="top" style={[s.comment, isDark && s.darkComment]}/>
          <PrimaryButton label={say('Отправить', 'Жөнөтүү')} onPress={() => void submit()} disabled={submitting || busy} busy={submitting || busy}/>
        </>}
      </ScrollView>
    </Animated.View>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 30, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 16, paddingTop: 9, shadowColor: '#12365F', shadowOpacity: .12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 9 },
  darkSheet: { backgroundColor: '#111111', shadowColor: '#000000' },
  darkInk: { color: '#FFFFFF' }, darkMuted: { color: '#B8B8B8' }, darkInset: { backgroundColor: '#202020', borderWidth: 1, borderColor: '#3A3A3A' },
  successContent: { gap: 6, paddingBottom: 2 },
  successTitle: { fontSize: 23, lineHeight: 27, fontWeight: '800', color: '#101D38', textAlign: 'center', letterSpacing: -.5, marginTop: -10 },
  successSubtitle: { fontSize: 14, lineHeight: 19, color: '#63718D', textAlign: 'center', marginBottom: 3 },
  routeCard: { backgroundColor: '#F3F7FF', borderRadius: 15, paddingHorizontal: 15, paddingVertical: 8, gap: 8 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  routeText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '500', color: '#101D38' },
  fareCard: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#F3F7FF', borderRadius: 15, paddingHorizontal: 15, minHeight: 46 },
  fareLabel: { color: '#101D38', fontSize: 14, flex: 1 },
  price: { fontSize: 17, fontWeight: '700', color: '#101D38' },
  primary: { backgroundColor: '#087FFF', borderRadius: 16, minHeight: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 4 },
  darkPrimary: { backgroundColor: '#FFFFFF' },
  primaryText: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  darkPrimaryText: { color: '#050505' },
  pressed: { opacity: .82 }, disabled: { opacity: .55 },
  close: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '700', color: '#087FFF' },
  handleTouch: { height: 25, alignItems: 'center', justifyContent: 'flex-start' },
  handle: { width: 43, height: 5, borderRadius: 4, backgroundColor: '#B9C3D5' },
  darkHandle: { backgroundColor: '#666666' },
  ratingContent: { gap: 15, paddingHorizontal: 1, paddingBottom: 5 },
  ratingTitle: { fontSize: 25, lineHeight: 31, fontWeight: '800', color: '#101D38', textAlign: 'center', letterSpacing: -.5, marginTop: 2 },
  ratingSubtitle: { fontSize: 16, lineHeight: 22, color: '#78859C', textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, marginVertical: 3 },
  star: { padding: 2 },
  compliments: { flexDirection: 'row', gap: 5 },
  compliment: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 48, paddingHorizontal: 5, borderRadius: 18, backgroundColor: '#F1F6FD', borderWidth: 1, borderColor: 'transparent' },
  complimentSelected: { backgroundColor: '#E8F3FF', borderColor: '#87BFFF' },
  darkCompliment: { backgroundColor: '#202020', borderColor: '#3A3A3A' }, darkComplimentSelected: { backgroundColor: '#303030', borderColor: '#FFFFFF' },
  complimentIcon: { width: 23, height: 23, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  complimentText: { flex: 1, color: '#142440', fontSize: 10.5, lineHeight: 14 },
  comment: { minHeight: 94, maxHeight: 130, borderRadius: 17, backgroundColor: '#F8FBFF', borderWidth: 1, borderColor: '#DCE8F8', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, color: '#101D38', fontSize: 14, lineHeight: 20 },
  darkComment: { backgroundColor: '#202020', borderColor: '#4A4A4A', color: '#FFFFFF' },
  thankYouHost: { ...StyleSheet.absoluteFillObject, zIndex: 35, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(210,226,247,.4)' },
  darkBackdrop: { backgroundColor: 'rgba(0,0,0,.72)' },
  thankYouCard: { width: '100%', maxWidth: 440, minHeight: 540, borderRadius: 31, backgroundColor: '#FFFFFF', overflow: 'hidden', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, shadowColor: '#294A70', shadowOpacity: .15, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 11 },
  darkThankYouCard: { backgroundColor: '#111111', shadowColor: '#000000' },
  thankYouContent: { flexGrow: 1, alignItems: 'center' },
  thankYouArt: { width: '100%', height: 290, alignItems: 'center', justifyContent: 'flex-start' },
  thankYouCar: { position: 'absolute', top: 132, width: '95%', height: 160 },
  thankYouTitle: { fontSize: 32, lineHeight: 36, fontWeight: '800', color: '#101D38', textAlign: 'center', letterSpacing: -.6, marginTop: 2 },
  thankYouSubtitle: { color: '#78859C', textAlign: 'center', fontSize: 16, lineHeight: 23, marginTop: 13 },
  thankYouSpacer: { flexGrow: 1, minHeight: 25 },
  thankYouButton: { width: '100%' },
});
