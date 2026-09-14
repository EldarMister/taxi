import React, { useEffect, useRef, useSyncExternalStore, type ComponentProps, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { motion } from './tokens';

let reducedMotion: boolean | null = null;
let motionListenerStarted = false;
const motionListeners = new Set<() => void>();
const publishMotionPreference = (value: boolean) => {
  reducedMotion = value;
  motionListeners.forEach(listener => listener());
};
const ensureMotionListener = () => {
  if (motionListenerStarted) return;
  motionListenerStarted = true;
  AccessibilityInfo.addEventListener('reduceMotionChanged', publishMotionPreference);
  void AccessibilityInfo.isReduceMotionEnabled().then(publishMotionPreference).catch(() => publishMotionPreference(false));
};
const subscribeMotion = (listener: () => void) => {
  motionListeners.add(listener);
  ensureMotionListener();
  return () => { motionListeners.delete(listener); };
};
const motionSnapshot = () => reducedMotion;

export function useMotionPreference() {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => true);
}

export function Reveal({ children, delay = 0, distance = 14, style }: PropsWithChildren<{
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  const reduced = useMotionPreference();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.enter,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);
  return <Animated.View style={[style, {
    opacity: reduced === true ? 1 : progress,
    transform: [{ translateY: reduced === true ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  }]}>{children}</Animated.View>;
}

type SpringPressableProps = Omit<ComponentProps<typeof Pressable>, 'children' | 'style' | 'onPressIn' | 'onPressOut'> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  pressScale?: number;
};

export function SpringPressable({ children, style, containerStyle, pressScale = .975, disabled, ...props }: SpringPressableProps) {
  const reduced = useMotionPreference();
  const scale = useRef(new Animated.Value(1)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => () => running.current?.stop(), []);
  const animate = (toValue: number) => {
    if (reduced !== false) { scale.setValue(1); return; }
    running.current?.stop();
    running.current = Animated.spring(scale, { toValue, speed: 32, bounciness: 1, useNativeDriver: true });
    running.current.start();
  };
  return <Pressable {...props} disabled={disabled} style={containerStyle} onPressIn={() => animate(pressScale)} onPressOut={() => animate(1)}>
    <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: .5 }]}>{children}</Animated.View>
  </Pressable>;
}
