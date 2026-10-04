import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useMotionPreference } from './design/motion';

export function sheetDestination(reveal: number, height: number, velocityY: number) {
  'worklet';
  // Project momentum so a short flick and a deliberate slow drag both work.
  return reveal - velocityY * .18 > height / 2;
}

/** Fixed measured envelope: translate the surface and countertranslate its footer.
 * A translated clipping window reveals details without a Yoga layout per frame.
 * Reanimated 3 is required by this app's Paper architecture; runOnJS runs only
 * at gesture boundaries / settlement, never for each animation frame.
 */
export function DriverRideSheet({ header, details, compactDetails, footer, style, handleStyle, handleTouchStyle, handleLabel, onExpanded, onHeight, inset, visible = true, testID = 'driver-ride-sheet' }: {
  header: React.ReactNode | ((expanded: boolean, toggle: () => void) => React.ReactNode); details: React.ReactNode; compactDetails?: React.ReactNode; footer: React.ReactNode;
  style: StyleProp<ViewStyle>; handleStyle: StyleProp<ViewStyle>; handleLabel: (expanded: boolean) => string;
  handleTouchStyle?: StyleProp<ViewStyle>; testID?: string;
  onExpanded: (expanded: boolean) => void; onHeight: (height: number) => void;
  inset?: SharedValue<number>; visible?: boolean;
}) {
  const reduced = useMotionPreference();
  const reveal = useSharedValue(0);
  const detailHeight = useSharedValue(0);
  const envelopeHeight = useSharedValue(0);
  const origin = useSharedValue(0);
  const targetExpanded = useSharedValue(false);
  const dragging = useSharedValue(false);
  const shown = useSharedValue(visible);
  const ready = useSharedValue(false);
  const [expanded, setExpanded] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [measuredDetails, setMeasuredDetails] = useState(0);
  const [measuredCompact, setMeasuredCompact] = useState(0);
  const notify = useCallback((value: boolean, height: number) => {
    setExpanded(value); onExpanded(value); onHeight(height);
  }, [onExpanded, onHeight]);

  const settle = useCallback((open: boolean, velocity = 0) => {
    'worklet';
    targetExpanded.set(open);
    const destination = open ? detailHeight.get() : 0;
    const finished = (done?: boolean) => {
      'worklet';
      if (done) runOnJS(notify)(open, shown.get() ? envelopeHeight.get() - detailHeight.get() + destination : 0);
    };
    // Replacing an animation starts at its current position and carries drag velocity.
    reveal.set(reduced !== false
      ? withTiming(destination, { duration: 120, easing: Easing.bezier(.32, .72, 0, 1) }, finished)
      : withSpring(destination, { duration: 300, dampingRatio: .8, overshootClamping: true, velocity: -velocity }, finished));
    runOnJS(setExpanded)(open);
    runOnJS(onExpanded)(open);
  }, [reduced, notify, onExpanded, detailHeight, envelopeHeight, reveal, shown, targetExpanded]);

  useEffect(() => {
    const travel = Math.max(0, measuredDetails - measuredCompact);
    const measured = !!(measuredHeight && measuredDetails && (!compactDetails || measuredCompact));
    detailHeight.set(travel);
    envelopeHeight.set(measuredHeight);
    ready.set(measured);
    if (measured) {
      // Layout changes from text scaling or orientation settle from the current pose.
      onHeight(visible ? measuredHeight - travel + (expanded ? travel : 0) : 0);
      if (targetExpanded.get()) settle(true);
    }
  }, [measuredHeight, measuredDetails, measuredCompact, detailHeight, envelopeHeight]);
  useEffect(() => {
    shown.set(visible);
    if (!visible) onHeight(0);
    else if (measuredHeight) onHeight(measuredHeight - detailHeight.get() + reveal.get());
  }, [visible, shown]);
  useEffect(() => {
    if (reduced === true && measuredHeight && !dragging.get()) settle(targetExpanded.get());
  }, [reduced]);
  useEffect(() => () => cancelAnimation(reveal), [reveal]);

  useAnimatedReaction(() => shown.get() && ready.get() ? Math.max(0, envelopeHeight.get() - detailHeight.get() + reveal.get()) : 0,
    value => { if (inset) inset.set(value); }, [inset]);
  const surfaceStyle = useAnimatedStyle(() => ({ opacity: ready.get() ? 1 : 0, transform: [{ translateY: detailHeight.get() - reveal.get() }] }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ translateY: reveal.get() - detailHeight.get() }] }));
  const detailStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: detailHeight.get() - reveal.get() }],
    opacity: detailHeight.get() ? Math.min(1, reveal.get() / detailHeight.get() * 1.5) : 0,
  }));
  const compactStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: detailHeight.get() - reveal.get() }],
    opacity: detailHeight.get() ? Math.max(0, 1 - reveal.get() / detailHeight.get() * 2) : 1,
  }));
  const gesture = useMemo(() => Gesture.Pan().enabled(visible).activeOffsetY([-8, 8]).failOffsetX([-10, 10])
    .onStart(event => { cancelAnimation(reveal); origin.set(reveal.get() + event.translationY); dragging.set(true); })
    .onUpdate(event => { reveal.set(Math.max(0, Math.min(detailHeight.get(), origin.get() - event.translationY))); })
    .onEnd(event => { dragging.set(false); settle(sheetDestination(reveal.get(), detailHeight.get(), event.velocityY), event.velocityY); })
    .onFinalize(() => { if (dragging.get()) { dragging.set(false); settle(reveal.get() > detailHeight.get() / 2); } }),
  [visible, reveal, origin, dragging, detailHeight, settle]);

  const toggle = () => settle(!targetExpanded.get());
  return <Animated.View testID={testID} onLayout={event => setMeasuredHeight(event.nativeEvent.layout.height)} style={[style, surfaceStyle]}>
    <GestureDetector gesture={gesture}>
      <View testID="driver-sheet-drag-area" pointerEvents="box-none" collapsable={false}>
      <View>
        <Pressable testID="driver-panel-handle" hitSlop={{ top: 14, bottom: 4, left: 16, right: 16 }} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={handleLabel(expanded)}
          onPress={toggle} style={[styles.handleTouch, handleTouchStyle]}><View style={handleStyle}/></Pressable>
        {typeof header === 'function' ? header(expanded, toggle) : header}
      </View>
    <Animated.View pointerEvents="box-none" style={[styles.clip, counterStyle]} onLayout={event => setMeasuredDetails(event.nativeEvent.layout.height)}>
      <Animated.View pointerEvents={expanded ? 'auto' : 'none'} accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'} style={detailStyle}>
        {details}
      </Animated.View>
      {compactDetails && <Animated.View testID="driver-sheet-compact-details" onLayout={event => setMeasuredCompact(event.nativeEvent.layout.height)} pointerEvents={expanded ? 'none' : 'auto'} accessibilityElementsHidden={expanded} importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'} style={[styles.compactDetails, compactStyle]}>{compactDetails}</Animated.View>}
    </Animated.View>
      </View>
    </GestureDetector>
    <Animated.View style={[styles.footer, counterStyle]}>{footer}</Animated.View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  handleTouch: { height: 56, marginTop: -12, marginBottom: 4, paddingTop: 10, alignItems: 'center' },
  clip: { overflow: 'hidden' },
  compactDetails: { position: 'absolute', top: 0, left: 0, right: 0 },
  footer: { paddingTop: 10 },
});
