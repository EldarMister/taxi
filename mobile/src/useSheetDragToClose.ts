import { useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, useWindowDimensions } from 'react-native';
import { useMotionPreference } from './design/motion';
import { motion } from './design/tokens';

export function useSheetDragToClose(onClose: () => void, enabled: boolean) {
  const translateY = useRef(new Animated.Value(0)).current;
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useMotionPreference();
  const onCloseRef = useRef(onClose);
  const enabledRef = useRef(enabled);
  const closing = useRef(false);
  onCloseRef.current = onClose;
  enabledRef.current = enabled;

  const panHandlers = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => enabledRef.current && !closing.current && gesture.dy > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => { if (!closing.current) translateY.setValue(Math.max(0, gesture.dy)); },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 64 || (gesture.dy > 18 && gesture.vy > .8)) {
        if (closing.current) return;
        closing.current = true;
        if (reducedMotion === true) { onCloseRef.current(); return; }
        Animated.timing(translateY, { toValue: windowHeight + 24, duration: Math.round(motion.sheet * .72), easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
          if (finished) onCloseRef.current();
          else closing.current = false;
        });
      } else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
    },
    onPanResponderTerminate: () => { if (!closing.current) Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start(); },
  }).panHandlers, [reducedMotion, translateY, windowHeight]);

  return { panHandlers, translateY, reset: () => { closing.current = false; translateY.setValue(0); } };
}
