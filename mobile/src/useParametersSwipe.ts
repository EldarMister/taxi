import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

/** Pull from the fixed action area; scrolling and taps keep their native owners. */
export function useParametersSwipe(onOpen: () => void, enabled: boolean) {
  const latestOpen = useRef(onOpen);
  useLayoutEffect(() => { latestOpen.current = onOpen; }, [onOpen]);
  const open = useCallback(() => latestOpen.current(), []);
  return useMemo(() => Gesture.Pan().enabled(enabled)
    .activeOffsetY(-8).failOffsetX([-12, 12]).failOffsetY(10)
    .onEnd((event, success) => {
      if (success && (event.translationY < -24 || (event.translationY < -8 && event.velocityY < -300))) {
        runOnJS(open)();
      }
    }), [open, enabled]);
}
