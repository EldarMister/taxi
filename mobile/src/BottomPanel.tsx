import React, { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { measure, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMotionPreference } from './design/motion';
import { useTheme } from './design/theme';
import { useSheetDragToClose } from './useSheetDragToClose';

/** A panel in the map screen's own view tree; the map and draft stay mounted. */
export function BottomPanel({ children, onClose, expanded = false, topGap, bottomPadding, edgeToEdge = false, label = 'Закрыть панель', closeRequested = false }: PropsWithChildren<{ onClose: () => void; expanded?: boolean; topGap?: number; bottomPadding?: number; edgeToEdge?: boolean; label?: string; closeRequested?: boolean }>) {
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
  const opened = useRef(false);
  const { close, open, gesture, animatedStyle, position, travel, dragging, startDrag, updateDrag, settle } = useSheetDragToClose(onClose, layoutReady, panelTravel);
  const closePanel = useCallback(() => { Keyboard.dismiss(); close(); }, [close]);
  const measureHost = useCallback(() => {
    host.current?.measureInWindow((_x, y, _width, height) => {
      setScreenTop(current => Math.abs(current - y) > 1 ? y : current);
      if (Platform.OS !== 'android' || keyboardScreenY.current === null) return;
      // Only compensate the keyboard overlap left after Android adjustResize.
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
  useEffect(() => {
    if (!layoutReady || reducedMotion === null || opened.current || closeRequested) return;
    opened.current = true;
    open(panelTravel + 24);
  }, [layoutReady, reducedMotion, panelTravel, closeRequested, open]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { closePanel(); return true; });
    return () => back.remove();
  }, [closePanel]);
  useEffect(() => { if (closeRequested) closePanel(); }, [closeRequested, closePanel]);
  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const distance = Math.max(1, event.nativeEvent.layout.height);
    setPanelTravel(current => Math.abs(current - distance) > 1 ? distance : current);
    setLayoutReady(true);
  }, []);
  const scrollY = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const beganAtTop = useSharedValue(false);
  const nativeScroll = useMemo(() => Gesture.Native(), []);
  const scrollRef = useAnimatedRef<ScrollView>();
  const scrollChild = findScrollChild(children);
  const hasScrollChild = !!scrollChild;
  const originalRef = (scrollChild?.props as (React.ComponentProps<typeof ScrollView> & { ref?: React.Ref<ScrollView> }) | undefined)?.ref;
  const setScrollRef = useCallback((node: ScrollView | null) => {
    scrollRef(node ?? undefined);
    if (typeof originalRef === 'function') originalRef(node);
    else if (originalRef) originalRef.current = node;
  }, [scrollRef, originalRef]);
  const existingScroll = scrollChild?.props.onScroll;
  const scroll = useAnimatedScrollHandler(event => {
    scrollY.set(Math.max(0, event.contentOffset.y));
    if (existingScroll) runOnJS(existingScroll)({ nativeEvent: event } as unknown as Parameters<NonNullable<typeof existingScroll>>[0]);
  }, [existingScroll]);
  const contentPan = useMemo(() => Gesture.Pan().enabled(layoutReady).manualActivation(true).blocksExternalGesture(nativeScroll)
    .onTouchesDown((event, manager) => {
      beganAtTop.set(false);
      const touch = event.allTouches[0];
      const frame = hasScrollChild ? measure(scrollRef) : null;
      const inScroll = !!(touch && frame && touch.absoluteY >= frame.pageY && touch.absoluteY <= frame.pageY + frame.height);
      const inHeader = !!(touch && frame && touch.absoluteY < frame.pageY);
      if (!touch || (!inHeader && touch.y > 128) || (inScroll && scrollY.get() > 1)) { manager.fail(); return; }
      touchX.set(touch.absoluteX); touchY.set(touch.absoluteY); beganAtTop.set(true);
    })
    .onTouchesMove((event, manager) => {
      if (dragging.get()) return;
      if (!beganAtTop.get() || event.allTouches.length !== 1) { manager.fail(); return; }
      const dx = event.allTouches[0].absoluteX - touchX.get();
      const dy = event.allTouches[0].absoluteY - touchY.get();
      if (Math.abs(dx) > 10 || dy < -8) { manager.fail(); return; }
      if (dy > 10 && dy > Math.abs(dx) * 1.3) manager.activate();
    })
    .onTouchesUp((_event, manager) => { if (!dragging.get()) manager.fail(); })
    .onStart(startDrag).onUpdate(event => updateDrag(event.translationY))
    .onEnd((event, success) => settle(event.velocityY, success)).onFinalize(() => settle(0, false)),
  [layoutReady, nativeScroll, scrollRef, hasScrollChild, scrollY, touchX, touchY, beganAtTop, dragging, startDrag, updateDrag, settle]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: .28 * (1 - Math.min(1, Math.max(0, position.get()) / travel.get())) }));
  // The handle lives outside the clipped content, reserving no space above the header.
  const content = wrapScrollChild(children, scrollChild, nativeScroll, scroll, setScrollRef);
  const keyboardOffset = screenTop + (Platform.OS === 'android' ? insets.top : 0);
  return <View ref={host} onLayout={measureHost} style={p.host}><KeyboardAvoidingView behavior="padding" enabled={Platform.OS === 'ios'} keyboardVerticalOffset={keyboardOffset} style={p.keyboard}>
    <Animated.View style={[StyleSheet.absoluteFill, p.backdrop, isDark && { backgroundColor: palette.background }, backdropStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={closePanel} style={StyleSheet.absoluteFill}/>
    </Animated.View>
    <View testID="bottom-panel-dock" pointerEvents="box-none" style={[p.panelDock, { paddingTop: topGap ?? insets.top + 24, paddingBottom: keyboardLift }]}>
      <Animated.View testID="bottom-panel" onLayout={handlePanelLayout} accessibilityViewIsModal style={[p.panel, expanded && p.expanded, { opacity: layoutReady && reducedMotion !== null ? 1 : 0 }, animatedStyle]}>
        {!edgeToEdge && <GestureDetector gesture={gesture}><View collapsable={false} style={p.handleTouch}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={closePanel} style={p.handleButton}><View style={[p.handle, isDark && { backgroundColor: palette.line }]}/></Pressable>
        </View></GestureDetector>}
        <GestureDetector gesture={contentPan}><View collapsable={false} testID="bottom-panel-drag-area" style={[p.content, expanded && p.expanded, edgeToEdge && p.edgeToEdge, { backgroundColor: palette.surface, paddingBottom: bottomPadding ?? Math.max(insets.bottom, 10) }]}>{content}</View></GestureDetector>
      </Animated.View>
    </View>
  </KeyboardAvoidingView></View>;
}

type ScrollElement = React.ReactElement<React.ComponentProps<typeof ScrollView>>;
function findScrollChild(children: React.ReactNode): ScrollElement | undefined {
  let found: ScrollElement | undefined;
  React.Children.forEach(children, child => {
    if (found || !React.isValidElement<{ children?: React.ReactNode }>(child)) return;
    if (child.type === ScrollView) { found = child as ScrollElement; return; }
    if (child.type === View || child.type === React.Fragment) {
      found = findScrollChild(child.props.children);
    }
  });
  return found;
}
function wrapScrollChild(children: React.ReactNode, target: ScrollElement | undefined, gesture: ReturnType<typeof Gesture.Native>, onScroll: ReturnType<typeof useAnimatedScrollHandler>, ref: (node: ScrollView | null) => void): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return child;
    if (child === target) return <GestureDetector gesture={gesture}><Animated.ScrollView {...target.props} ref={ref} onScroll={onScroll} scrollEventThrottle={16}/></GestureDetector>;
    if (child.type === View || child.type === React.Fragment) return React.cloneElement(child, {}, wrapScrollChild(child.props.children, target, gesture, onScroll, ref));
    return child;
  });
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
  panel: { maxHeight: '100%', overflow: 'visible', paddingTop: 24 },
  expanded: { flex: 1 },
  content: { flexShrink: 1, minHeight: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  edgeToEdge: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  handleTouch: { position: 'absolute', top: 0, left: 0, right: 0, height: 24, alignItems: 'center', zIndex: 3 },
  handleButton: { width: 88, height: 24, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 34, height: 4, borderRadius: 3, backgroundColor: '#D4D6DA' },
});
