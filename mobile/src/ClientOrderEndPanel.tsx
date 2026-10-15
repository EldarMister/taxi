import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './design/theme';
import { useMotionPreference } from './design/motion';
import { useSheetDragToClose } from './useSheetDragToClose';
import { Icon, localize, shortAddress } from './ui';
import type { Order, User } from './types';

type Props = {
  order: Order;
  user: User;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
  onHeight: (height: number) => void;
};

/** Cancellation and an exhausted search are different outcomes, never a success. */
export function ClientOrderEndPanel({ order, user, busy, onRetry, onClose, onHeight }: Props) {
  const { isDark, palette } = useTheme();
  const reducedMotion = useMotionPreference();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const [closing, setClosing] = useState(false);
  const choice = useRef<'retry' | 'close'>('close');
  const requested = useRef(false);
  const opened = useRef(false);
  const cancelled = order.status === 'CANCELLED';
  const delivery = order.kind !== undefined && order.kind !== 'RIDE';
  const say = (ru: string, ky: string) => localize(user.language, ru, ky);
  const title = cancelled ? say('Заказ отменён', 'Буюртма жокко чыгарылды') : say('Водитель не найден', 'Айдоочу табылган жок');
  const subtitle = cancelled
    ? say(delivery ? 'Можно оформить доставку снова, когда вам будет удобно.' : 'Можно заказать поездку снова, когда вам будет удобно.', delivery ? 'Ыңгайлуу убакта жеткирүүгө кайра буюртма берсеңиз болот.' : 'Ыңгайлуу убакта сапарга кайра буюртма берсеңиз болот.')
    : say('Сейчас нет свободных водителей. Попробуйте заказать снова.', 'Азыр бош айдоочулар жок. Кайра буюртма берип көрүңүз.');
  const drag = useSheetDragToClose(() => {
    if (choice.current === 'retry') onRetry();
    else onClose();
  }, height > 0 && !busy && !closing, height || undefined);

  useEffect(() => {
    if (!height || reducedMotion === null || opened.current) return;
    opened.current = true;
    drag.open(height + 24);
  }, [height, reducedMotion, drag.open]);

  const requestClose = useCallback((action: 'retry' | 'close') => {
    if (busy || requested.current) return;
    requested.current = true;
    choice.current = action;
    setClosing(true);
    drag.close();
  }, [busy, drag.close]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { requestClose('close'); return true; });
    return () => back.remove();
  }, [requestClose]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, drag.position.get()) / drag.travel.get()) }));
  const disabled = busy || closing;
  return <View testID="client-order-end-modal" style={s.host}>
    <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.backdrop }, backdropStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={say('Закрыть', 'Жабуу')} disabled={disabled} onPress={() => requestClose('close')} style={StyleSheet.absoluteFillObject}/>
    </Animated.View>
    <Animated.View testID="client-order-end-sheet" accessibilityViewIsModal onLayout={event => {
      const measured = event.nativeEvent.layout.height;
      setHeight(current => current === measured ? current : measured);
      onHeight(measured);
    }} style={[s.sheet, { backgroundColor: palette.surface, maxHeight: windowHeight - insets.top - 16, opacity: height > 0 && reducedMotion !== null ? 1 : 0 }, drag.animatedStyle]}>
      <GestureDetector gesture={drag.gesture}>
        <View testID="client-order-end-heading" collapsable={false}>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Закрыть', 'Жабуу')} disabled={disabled} onPress={() => requestClose('close')} style={s.handleTouch}>
            <View style={[s.handle, { backgroundColor: isDark ? '#666666' : '#B9C3D5' }]}/>
          </Pressable>
        </View>
      </GestureDetector>
      <ScrollView testID="client-order-end-content" style={s.scroll} contentContainerStyle={s.content} bounces={false} showsVerticalScrollIndicator={false}>
        <View style={s.heading}>
          <Image testID="order-cancelled-illustration" source={require('../assets/order-cancelled-red-3d.webp')} resizeMode="contain" style={s.art} accessible={false}/>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[s.title, { color: palette.ink }]}>{title}</Text>
          <Text style={[s.subtitle, { color: palette.muted }]}>{subtitle}</Text>
        </View>
        <View style={[s.route, { backgroundColor: palette.elevated, borderColor: palette.line }]}>
          {([['person', order.pickup.address], ['flag', order.dropoff.address]] as const).map(([icon, address]) => <View key={icon} style={s.routeRow}>
            <Icon name={icon} size={20} color={palette.ink}/><Text style={[s.routeText, { color: palette.ink }]}>{shortAddress(address)}</Text>
          </View>)}
        </View>
      </ScrollView>
      <View style={[s.actions, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={say('Заказать снова', 'Кайра буюртма берүү')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => requestClose('retry')}
          style={({ pressed }) => [s.primary, { backgroundColor: palette.accent }, pressed && s.pressed, disabled && s.disabled]}>
          <Text style={[s.primaryText, { color: palette.accentText }]}>{say('Заказать снова', 'Кайра буюртма берүү')}</Text>
        </Pressable>
        <Pressable testID="client-order-end-close" accessibilityRole="button" accessibilityLabel={say('Закрыть', 'Жабуу')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => requestClose('close')} style={({ pressed }) => [s.close, pressed && s.pressed, disabled && s.disabled]}>
          <Text style={[s.closeText, { color: isDark ? palette.ink : palette.accent }]}>{say('Закрыть', 'Жабуу')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  </View>;
}

const s = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 30, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', shadowColor: '#12365F', shadowOpacity: .12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 10 },
  handleTouch: { height: 24, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 34, height: 4, borderRadius: 4 },
  heading: { alignItems: 'center', paddingHorizontal: 4, paddingBottom: 14, gap: 7 },
  art: { width: 148, height: 148 },
  title: { fontSize: 23, lineHeight: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -.5 },
  subtitle: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  content: { paddingHorizontal: 16, paddingBottom: 6 },
  route: { borderRadius: 15, paddingHorizontal: 15, paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  routeText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '500' },
  actions: { paddingHorizontal: 16, paddingTop: 4, gap: 4 },
  primary: { borderRadius: 16, minHeight: 52, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  close: { minHeight: 44, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  pressed: { opacity: .82 }, disabled: { opacity: .55 },
});
