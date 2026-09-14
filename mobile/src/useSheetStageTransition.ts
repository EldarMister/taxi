import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, useWindowDimensions } from 'react-native';
import { useMotionPreference } from './design/motion';
import { motion } from './design/tokens';

/** Sequential transition for two layouts that occupy the same bottom sheet. */
export function useSheetStageTransition<Stage extends string>(initial: Stage) {
  const reducedMotion = useMotionPreference();
  const { height: windowHeight } = useWindowDimensions();
  const [stage, setStage] = useState(initial);
  const [entry, setEntry] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const pending = useRef<Stage | null>(null);
  const exiting = useRef(false);
  const opened = useRef(false);

  useEffect(() => () => running.current?.stop(), []);

  const animateIn = () => {
    if (reducedMotion === true) {
      progress.setValue(1);
      pending.current = null;
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.sheet,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (running.current === animation) running.current = null;
      if (finished) pending.current = null;
    });
  };

  useEffect(() => {
    if (reducedMotion === null || opened.current) return;
    opened.current = true;
    animateIn();
  }, [reducedMotion]);

  useEffect(() => {
    if (!entry) return;
    animateIn();
  }, [entry]);

  const navigate = (next: Stage) => {
    if (next === stage || pending.current || exiting.current) return;
    pending.current = next;
    running.current?.stop();
    if (reducedMotion === true) {
      setStage(next);
      progress.setValue(1);
      pending.current = null;
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: Math.round(motion.sheet * .78),
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (running.current === animation) running.current = null;
      if (!finished) return;
      setStage(next);
      setEntry(value => value + 1);
    });
  };

  const reset = (next: Stage) => {
    running.current?.stop();
    running.current = null;
    pending.current = null;
    exiting.current = false;
    progress.setValue(0);
    setStage(next);
    setEntry(value => value + 1);
  };

  const exit = (onClosed: () => void) => {
    if (pending.current || exiting.current) return;
    exiting.current = true;
    running.current?.stop();
    if (reducedMotion === true) {
      onClosed();
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: Math.round(motion.sheet * .78),
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (running.current === animation) running.current = null;
      if (finished) onClosed();
      else exiting.current = false;
    });
  };

  return {
    stage,
    navigate,
    reset,
    exit,
    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight + 24, 0] }),
  };
}
