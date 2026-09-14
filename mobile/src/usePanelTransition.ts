import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useMotionPreference } from './design/motion';
import { motion } from './design/tokens';

/** Replaces one bottom surface at a time: the current one leaves before its successor enters. */
export function usePanelTransition<Surface extends string>(root: Surface) {
  const reducedMotion = useMotionPreference();
  const [surface, setSurface] = useState(root);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [rootHeight, setRootHeight] = useState(320);
  const [rootMeasured, setRootMeasured] = useState(false);
  const rootProgress = useRef(new Animated.Value(0)).current;
  const history = useRef<Surface[]>([]);
  const entered = useRef(false);
  const requested = useRef<Surface | null>(null);
  const suspended = useRef<(() => void) | null>(null);
  const transitioning = useRef(false);
  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => running.current?.stop(), []);

  const animateRoot = (toValue: 0 | 1, finished: () => void) => {
    running.current?.stop();
    if (reducedMotion === true) {
      rootProgress.setValue(toValue);
      finished();
      return;
    }
    const animation = Animated.timing(rootProgress, {
      toValue,
      duration: Math.round(motion.sheet * .76),
      easing: toValue ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    running.current = animation;
    animation.start(({ finished: didFinish }) => {
      if (running.current === animation) running.current = null;
      if (didFinish) finished();
    });
  };

  useEffect(() => {
    if (!rootMeasured || reducedMotion === null || entered.current) return;
    entered.current = true;
    animateRoot(1, () => undefined);
  }, [rootMeasured, reducedMotion]);

  const navigate = (next: Surface) => {
    if (next === surface || transitioning.current) return;
    transitioning.current = true;
    if (next === root) history.current = [];
    else if (history.current[history.current.length - 1] === next) history.current.pop();
    else history.current.push(surface);
    if (surface === root) {
      animateRoot(0, () => {
        setSurface(next);
        transitioning.current = false;
      });
    } else {
      requested.current = next;
      setSheetClosing(true);
    }
  };

  const onSheetClosed = () => {
    const next = requested.current ?? history.current.pop() ?? root;
    requested.current = null;
    setSheetClosing(false);
    setSurface(next);
    if (next === root && suspended.current) {
      const done = suspended.current;
      suspended.current = null;
      transitioning.current = false;
      done();
    } else if (next === root) animateRoot(1, () => { transitioning.current = false; });
    else transitioning.current = false;
  };

  const suspend = (done: () => void) => {
    if (transitioning.current) return;
    transitioning.current = true;
    history.current = [];
    if (surface !== root) {
      suspended.current = done;
      requested.current = root;
      setSheetClosing(true);
    } else animateRoot(0, () => { transitioning.current = false; done(); });
  };

  const resume = () => {
    if (surface !== root || transitioning.current) return;
    transitioning.current = true;
    rootProgress.setValue(0);
    animateRoot(1, () => { transitioning.current = false; });
  };

  const reset = () => {
    running.current?.stop();
    running.current = null;
    requested.current = null;
    suspended.current = null;
    history.current = [];
    transitioning.current = false;
    rootProgress.setValue(0);
    entered.current = false;
    setSheetClosing(false);
    setSurface(root);
    if (reducedMotion !== null) {
      entered.current = true;
      animateRoot(1, () => undefined);
    }
  };

  return {
    surface,
    navigate,
    suspend,
    resume,
    onSheetClosed,
    reset,
    sheetClosing,
    rootVisible: surface === root,
    rootTranslateY: rootProgress.interpolate({ inputRange: [0, 1], outputRange: [rootHeight + 24, 0] }),
    onRootHeight: (height: number) => {
      setRootHeight(current => Math.abs(current - height) > 1 ? height : current);
      if (height > 0) setRootMeasured(true);
    },
  };
}
