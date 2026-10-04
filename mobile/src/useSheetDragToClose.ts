import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { useMotionPreference } from './design/motion';

const SHEET_CURVE = Easing.bezier(.32, .72, 0, 1);
export function shouldDismissSheet(distance: number, velocity: number, height: number) {
  'worklet';
  return distance > Math.min(160, height * .24) || (distance > 12 && velocity > 850);
}

/** One UI-thread drag/settle path for content-sized sheets. JS runs only on close. */
export function useSheetDragToClose(onClose: () => void, enabled: boolean, measuredHeight?: number) {
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useMotionPreference();
  const position = useSharedValue(0);
  const travel = useSharedValue(measuredHeight || windowHeight);
  const origin = useSharedValue(0);
  const dragging = useSharedValue(false);
  const closing = useSharedValue(false);
  const enabledValue = useSharedValue(enabled);
  const delivered = useRef(false);
  const mounted = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { travel.set(Math.max(1, measuredHeight || windowHeight) + 24); }, [measuredHeight, windowHeight, travel]);
  useEffect(() => { enabledValue.set(enabled); }, [enabled, enabledValue]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelAnimation(position); };
  }, [position]);
  const finish = useCallback(() => {
    if (!mounted.current || delivered.current) return;
    delivered.current = true;
    onCloseRef.current();
  }, []);
  const close = useCallback((velocity = 0) => {
    'worklet';
    if (closing.get()) return;
    closing.set(true);
    dragging.set(false);
    cancelAnimation(position);
    const complete = (done?: boolean) => { 'worklet'; if (done) runOnJS(finish)(); };
    position.set(reduced === true
      ? withTiming(travel.get(), { duration: 0 }, complete)
      : withSpring(travel.get(), { duration: 300, dampingRatio: 1, velocity, overshootClamping: true }, complete));
  }, [closing, dragging, finish, position, reduced, travel]);
  const restore = useCallback((velocity = 0) => {
    'worklet';
    position.set(reduced === true ? withTiming(0, { duration: 0 })
      : withSpring(0, { duration: 300, dampingRatio: .8, velocity, overshootClamping: true }));
  }, [position, reduced]);
  const startDrag = useCallback(() => {
    'worklet';
    if (!enabledValue.get() || closing.get()) return;
    cancelAnimation(position);
    origin.set(position.get());
    dragging.set(true);
  }, [closing, dragging, enabledValue, origin, position]);
  const updateDrag = useCallback((dy: number) => {
    'worklet';
    if (!dragging.get()) return;
    const next = origin.get() + dy;
    // Resist a pull beyond the open edge, while a downward drag stays 1:1.
    const resisted = next < 0 ? next * travel.get() * .55 / (travel.get() + .55 * Math.abs(next)) : next;
    position.set(Math.min(travel.get(), resisted));
  }, [dragging, origin, position, travel]);
  const settle = useCallback((velocity: number, success: boolean) => {
    'worklet';
    if (!dragging.get()) return;
    dragging.set(false);
    if (success && enabledValue.get() && shouldDismissSheet(position.get(), velocity, travel.get())) close(velocity);
    else restore(velocity);
  }, [close, dragging, enabledValue, position, restore, travel]);
  const gesture = useMemo(() => Gesture.Pan().enabled(enabled).activeOffsetY([-10, 10]).failOffsetX([-10, 10])
    .onStart(startDrag).onUpdate(event => updateDrag(event.translationY))
    .onEnd((event, success) => settle(event.velocityY, success)).onFinalize(() => settle(0, false)),
  [enabled, startDrag, updateDrag, settle]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: position.get() }] }));
  const reset = useCallback(() => {
    delivered.current = false;
    closing.set(false);
    dragging.set(false);
    cancelAnimation(position);
    position.set(0);
  }, [closing, dragging, position]);
  const open = useCallback((from: number) => {
    reset();
    position.set(from);
    position.set(withTiming(0, { duration: reduced === true ? 0 : 300, easing: SHEET_CURVE }));
  }, [position, reduced, reset]);
  return { gesture, animatedStyle, position, travel, dragging, reset, open, close, startDrag, updateDrag, settle };
}
