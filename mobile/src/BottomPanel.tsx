import React, { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMotionPreference } from './design/motion';
import { motion } from './design/tokens';
import { useTheme } from './design/theme';

/** A panel in the map screen's own view tree; the map and draft stay mounted. */
export function BottomPanel({ children, onClose, expanded = false, label = 'Закрыть панель', closeRequested = false }: PropsWithChildren<{ onClose: () => void; expanded?: boolean; label?: string; closeRequested?: boolean }>) {
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useMotionPreference();
  const { height: windowHeight } = useWindowDimensions();
  const host = useRef<View>(null);
  const [screenTop, setScreenTop] = useState(0);
  const [keyboardLift, setKeyboardLift] = useState(0);
  const keyboardScreenY = useRef<number | null>(null);
  const [panelTravel, setPanelTravel] = useState(windowHeight);
  const [layoutReady, setLayoutReady] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const panelTravelRef = useRef(windowHeight);
  const dragStart = useRef(1);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const opened = useRef(false);
  const closing = useRef(false);
  const closeDelivered = useRef(false);
  const mounted = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const measureHost = useCallback(() => {
    host.current?.measureInWindow((_x, y, _width, height) => {
      setScreenTop(current => Math.abs(current - y) > 1 ? y : current);
      if (Platform.OS !== 'android' || keyboardScreenY.current === null) return;
      // adjustResize already moves the dock on some devices; only lift the part
      // that still overlaps the keyboard on edge-to-edge Android windows.
      const overlap = Math.min(Math.max(0, height - 120), Math.max(0, y + height - keyboardScreenY.current + 8));
      setKeyboardLift(current => Math.abs(current - overlap) > 1 ? overlap : current);
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const shown = Keyboard.addListener('keyboardDidShow', event => {
      keyboardScreenY.current = event.endCoordinates.screenY;
      measureHost();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardScreenY.current = null;
      setKeyboardLift(0);
    });
    return () => { shown.remove(); hidden.remove(); };
  }, [measureHost]);

  const finishClose = useCallback(() => {
    if (!mounted.current || closeDelivered.current) return;
    closeDelivered.current = true;
    onCloseRef.current();
  }, []);

  const closePanel = useCallback(() => {
    if (closing.current || closeDelivered.current) return;
    closing.current = true;
    running.current?.stop();
    running.current = null;

    if (reducedMotion === true) {
      progress.setValue(0);
      finishClose();
      return;
    }

    progress.stopAnimation(currentValue => {
      if (!mounted.current) return;
      const remaining = Math.max(0, Math.min(1, currentValue));
      const animation = Animated.timing(progress, {
        toValue: 0,
        duration: Math.max(motion.quick, Math.round(motion.sheet * remaining * .78)),
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      });
      running.current = animation;
      animation.start(({ finished }) => {
        if (running.current === animation) running.current = null;
        if (finished) finishClose();
      });
    });
  }, [finishClose, progress, reducedMotion]);

  useEffect(() => {
    if (!layoutReady || reducedMotion === null) return;
    if (closing.current) {
      if (reducedMotion) {
        running.current?.stop();
        running.current = null;
        progress.setValue(0);
        finishClose();
      }
      return;
    }
    if (opened.current) {
      if (reducedMotion) {
        running.current?.stop();
        running.current = null;
        progress.setValue(1);
      }
      return;
    }
    opened.current = true;
    running.current?.stop();
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.sheet,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (finished && running.current === animation) running.current = null;
    });
    return () => {
      if (running.current === animation) {
        animation.stop();
        running.current = null;
      }
    };
  }, [finishClose, layoutReady, progress, reducedMotion]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.stop();
      running.current = null;
    };
  }, []);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { closePanel(); return true; });
    return () => back.remove();
  }, [closePanel]);

  useEffect(() => { if (closeRequested) closePanel(); }, [closeRequested, closePanel]);

  const restorePanel = useCallback(() => {
    if (closing.current) return;
    running.current?.stop();
    running.current = null;
    if (reducedMotion !== false) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.spring(progress, {
      toValue: 1,
      speed: 24,
      bounciness: 0,
      useNativeDriver: true,
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (finished && running.current === animation) running.current = null;
    });
  }, [progress, reducedMotion]);

  const drag = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      running.current?.stop();
      running.current = null;
      progress.stopAnimation(value => { dragStart.current = value; });
    },
    onPanResponderMove: (_, gesture) => {
      const distance = Math.max(1, panelTravelRef.current);
      const next = dragStart.current - Math.max(0, gesture.dy) / distance;
      progress.setValue(Math.max(0, Math.min(1, next)));
    },
    onPanResponderRelease: (_, gesture) => {
      const distance = Math.max(1, panelTravelRef.current);
      const threshold = Math.min(120, Math.max(64, distance * .24));
      const fastSwipe = gesture.vy >= .85 && gesture.dy > 10;
      if (gesture.dy >= threshold || fastSwipe) closePanel();
      else restorePanel();
    },
    onPanResponderTerminate: restorePanel,
  }), [closePanel, progress, restorePanel]);

  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const distance = Math.max(1, event.nativeEvent.layout.height + 8);
    panelTravelRef.current = distance;
    setPanelTravel(current => Math.abs(current - distance) > 1 ? distance : current);
    setLayoutReady(true);
  }, []);

  // Android's translucent status bar is included in the keyboard's screen coordinates.
  const keyboardOffset = screenTop + (Platform.OS === 'android' ? insets.top : 0);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [panelTravel, 0], extrapolate: 'clamp' });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, .28], extrapolate: 'clamp' });
  return <View ref={host} onLayout={measureHost} style={p.host}><KeyboardAvoidingView behavior="padding" enabled={Platform.OS === 'ios'} keyboardVerticalOffset={keyboardOffset} style={p.keyboard}>
    <Animated.View style={[StyleSheet.absoluteFill, p.backdrop, isDark && { backgroundColor: palette.background }, { opacity: backdropOpacity }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={closePanel} style={StyleSheet.absoluteFill}/>
    </Animated.View>
    <View pointerEvents="box-none" style={[p.panelDock, { paddingTop: insets.top + (expanded ? 24 : 20), paddingBottom: keyboardLift }]}>
      <Animated.View onLayout={handlePanelLayout} accessibilityViewIsModal style={[p.panel, expanded && p.expanded, isDark && { backgroundColor: palette.surface }, { paddingBottom: Math.max(insets.bottom, 10), transform: [{ translateY }] }]}>
        <View {...drag.panHandlers} style={p.handleTouch}><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={closePanel} hitSlop={8}><View style={[p.handle, isDark && { backgroundColor: palette.line }]}/></Pressable></View>
        {children}
      </Animated.View>
    </View>
  </KeyboardAvoidingView></View>;
}
export const panelStyle = StyleSheet.create({
  surface: { backgroundColor: 'white', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 5, shadowColor: '#152E50', shadowOpacity: .1, shadowOffset: { width: 0, height: -3 }, shadowRadius: 16, elevation: 8 },
  handle: { width: 34, height: 4, borderRadius: 3, backgroundColor: '#D4D6DA', alignSelf: 'center', marginVertical: 7 },
});
const p = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 40 },
  keyboard: { flex: 1 },
  backdrop: { backgroundColor: '#14243A' },
  panelDock: { flex: 1, justifyContent: 'flex-end' },
  panel: { backgroundColor: 'white', borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '100%', overflow: 'hidden' },
  expanded: { flex: 1 },
  handleTouch: { height: 20, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 34, height: 4, borderRadius: 3, backgroundColor: '#D4D6DA' },
});
