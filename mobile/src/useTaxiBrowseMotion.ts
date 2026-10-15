import { useEffect } from 'react';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { useMotionPreference } from './design/motion';

export const taxiBrowsePeek = 32;

/** One UI-thread offset keeps the home sheet and its two map buttons together. */
export function useTaxiBrowseMotion(moving: boolean, panelHeight: number) {
  const reducedMotion = useMotionPreference();
  const offset = useSharedValue(0);
  useEffect(() => {
    const target = moving ? Math.max(0, panelHeight - taxiBrowsePeek) : 0;
    offset.set(reducedMotion ? target : withSpring(target, { duration: 300, dampingRatio: 1, overshootClamping: true }));
  }, [moving, panelHeight, reducedMotion, offset]);
  return offset;
}
