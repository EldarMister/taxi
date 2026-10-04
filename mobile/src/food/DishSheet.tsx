import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMotionPreference } from '../design/motion';
import { useTheme } from '../design/theme';

const SHEET_CURVE = Easing.bezier(.32, .72, 0, 1);
export function shouldDismissDishSheet(distance: number, velocity: number, height: number) {
  'worklet';
  return distance > Math.min(160, height * .24) || (distance > 12 && velocity > 850);
}

/** Fixed frame. Only its contents scroll; the footer never enters the gesture. */
export function DishSheet({ children, footer, onClose, closeRequested, label, contentKey }: {
  children: React.ReactNode; footer: React.ReactNode; onClose: () => void; closeRequested: boolean; label: string; contentKey?: string;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const reducedMotion = useMotionPreference();
  const [hostHeight, setHostHeight] = useState(windowHeight);
  const sheetHeight = Math.min(hostHeight * .92, hostHeight - insets.top - 12);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const travel = useSharedValue(sheetHeight + 8);
  const y = useSharedValue(sheetHeight + 8);
  const start = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  useEffect(() => {
    scrollY.value = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [contentKey, scrollY]);
  const beganAtTop = useSharedValue(false);
  const dragging = useSharedValue(false);
  const closing = useSharedValue(false);
  const opened = useRef(false);
  const mounted = useRef(true);
  const delivered = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const finish = useCallback(() => {
    if (!mounted.current || delivered.current) return;
    delivered.current = true;
    closeRef.current();
  }, []);
  const close = useCallback(() => {
    if (closing.value || delivered.current) return;
    closing.value = true;
    cancelAnimation(y);
    y.value = withTiming(travel.value, { duration: reducedMotion ? 120 : 360, easing: SHEET_CURVE },
      done => { if (done) runOnJS(finish)(); });
  }, [closing, finish, reducedMotion, travel, y]);
  useEffect(() => {
    travel.value = sheetHeight + 8;
    if (opened.current || reducedMotion === null) return;
    opened.current = true;
    y.value = sheetHeight + 8;
    y.value = withTiming(0, { duration: reducedMotion ? 120 : 420, easing: SHEET_CURVE });
  }, [reducedMotion, sheetHeight, travel, y]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelAnimation(y); };
  }, [y]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => listener.remove();
  }, [close]);
  useEffect(() => { if (closeRequested) close(); }, [closeRequested, close]);
  const scroll = useAnimatedScrollHandler(event => { scrollY.value = Math.max(0, event.contentOffset.y); });
  const nativeScroll = useMemo(() => Gesture.Native(), []);
  const startDrag = useCallback(() => {
    'worklet';
    cancelAnimation(y);
    closing.value = false;
    start.value = y.value;
    dragging.value = true;
  }, [closing, dragging, start, y]);
  const updateDrag = useCallback((translationY: number) => {
    'worklet';
    y.value = Math.min(travel.value, Math.max(0, start.value + translationY));
  }, [start, travel, y]);
  const settle = useCallback((velocity: number, completed: boolean) => {
    'worklet';
    if (!dragging.value) return;
    dragging.value = false;
    if (completed && shouldDismissDishSheet(y.value, velocity, travel.value)) {
      closing.value = true;
      const complete = (done?: boolean) => { 'worklet'; if (done) runOnJS(finish)(); };
      y.value = reducedMotion ? withTiming(travel.value, { duration: 120 }, complete) : withSpring(travel.value, {
        duration: 360, dampingRatio: 1, velocity, overshootClamping: true,
      }, complete);
    } else {
      y.value = reducedMotion ? withTiming(0, { duration: 120 }) : withSpring(0, {
        duration: 300, dampingRatio: 1, velocity, overshootClamping: true,
      });
    }
  }, [closing, dragging, finish, reducedMotion, travel, y]);
  const handlePan = useMemo(() => Gesture.Pan().activeOffsetY([-10, 10]).failOffsetX([-10, 10])
    .onStart(startDrag).onUpdate(event => updateDrag(event.translationY))
    .onEnd(event => settle(event.velocityY, true)).onFinalize(() => settle(0, false)), [settle, startDrag, updateDrag]);
  const contentPan = useMemo(() => Gesture.Pan().manualActivation(true).blocksExternalGesture(nativeScroll)
    .onTouchesDown(event => {
      touchX.value = event.allTouches[0]?.absoluteX ?? 0;
      touchY.value = event.allTouches[0]?.absoluteY ?? 0;
      beganAtTop.value = scrollY.value <= 1;
    })
    .onTouchesMove((event, manager) => {
      if (dragging.value) return;
      if (!beganAtTop.value || event.allTouches.length !== 1) { manager.fail(); return; }
      const dx = (event.allTouches[0]?.absoluteX ?? touchX.value) - touchX.value;
      const dy = (event.allTouches[0]?.absoluteY ?? touchY.value) - touchY.value;
      if (Math.abs(dx) > 10 || dy < -8) { manager.fail(); return; }
      if (dy > 10 && dy > Math.abs(dx) * 1.3 && scrollY.value <= 1) manager.activate();
    })
    .onTouchesUp((_event, manager) => { if (!dragging.value) manager.fail(); })
    .onStart(startDrag).onUpdate(event => updateDrag(event.translationY))
    .onEnd(event => settle(event.velocityY, true)).onFinalize(() => settle(0, false)),
  [beganAtTop, dragging, nativeScroll, scrollY, settle, startDrag, touchX, touchY, updateDrag]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: .45 * (1 - Math.min(1, y.value / travel.value)) }));
  const sheetStyle = useAnimatedStyle(() => reducedMotion ? { opacity: 1 - Math.min(1, y.value / travel.value) }
    : { transform: [{ translateY: y.value }] });
  return <View style={styles.host} onLayout={event => setHostHeight(event.nativeEvent.layout.height)}>
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={close} style={StyleSheet.absoluteFill}/>
    </Animated.View>
    <Animated.View testID="dish-sheet" accessibilityViewIsModal style={[styles.sheet, { height: sheetHeight, backgroundColor: theme.isDark ? theme.palette.background : '#F5F4F2' }, sheetStyle]}>
      <GestureDetector gesture={handlePan}><Animated.View style={styles.handleTouch}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={close} style={styles.handleButton}>
          <View style={styles.handle}/>
        </Pressable>
      </Animated.View></GestureDetector>
      <GestureDetector gesture={contentPan}><Animated.View style={styles.content}>
        <GestureDetector gesture={nativeScroll}>
          <Animated.ScrollView ref={scrollRef} testID="dish-sheet-scroll" onScroll={scroll} scrollEventThrottle={16} bounces={false}
            showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.content} contentContainerStyle={styles.scrollContent}>
            {children}
          </Animated.ScrollView>
        </GestureDetector>
      </Animated.View></GestureDetector>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={close} style={[styles.close, { backgroundColor: theme.isDark ? theme.palette.elevated : '#FFFFFF' }]}>
        <Ionicons name="close" size={28} color={theme.palette.ink}/>
      </Pressable>
      {footer}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 40 },
  backdrop: { backgroundColor: '#000000' },
  sheet: { overflow: 'hidden', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  content: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  handleTouch: { position: 'absolute', top: 0, alignSelf: 'center', width: 88, height: 24, zIndex: 3 },
  handleButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 34, height: 4, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.7)' },
  close: { position: 'absolute', top: 12, right: 12, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
});
