import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View, type ScrollViewProps } from 'react-native';
import { measureInScreen } from '../measureInScreen';

const FieldFocus = createContext<() => void>(() => {});
export const useRegistrationFieldFocus = () => useContext(FieldFocus);

export function RegistrationKeyboardLayout({ header, footer, children, contentContainerStyle }: React.PropsWithChildren<{
  header: React.ReactNode; footer: React.ReactNode; contentContainerStyle: ScrollViewProps['contentContainerStyle'];
}>) {
  const host = useRef<View>(null), scroll = useRef<ScrollView>(null), scrollOffset = useRef(0);
  const keyboardY = useRef<number | null>(null), scheduled = useRef<number | null>(null);
  const measurement = useRef(0);
  const [lift, setLift] = useState(0);
  const reveal = useCallback(() => {
    if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = null;
      const input = TextInput.State.currentlyFocusedInput();
      if (!input || keyboardY.current === null) return;
      // RN's generic scrollResponder helper assumes a full-screen scroll view.
      // This form starts below a header: compare actual window frames instead.
      measureInScreen(input, (_x, inputY, _width, inputHeight) => {
        measureInScreen(scroll.current?.getNativeScrollRef() ?? null, (_scrollX: number, scrollY: number, _scrollWidth: number, scrollHeight: number) => {
          if (keyboardY.current === null) return;
          const bottom = Math.min(scrollY + scrollHeight, keyboardY.current) - 18;
          const delta = inputY + inputHeight > bottom ? inputY + inputHeight - bottom : inputY < scrollY + 12 ? inputY - scrollY - 12 : 0;
          if (Math.abs(delta) > 1) scroll.current?.scrollTo({ y: Math.max(0, scrollOffset.current + delta), animated: true });
        });
      });
    });
  }, []);
  const measure = useCallback(() => {
    const keyboardTop = keyboardY.current, revision = ++measurement.current;
    measureInScreen(host.current, (_x, y, _width, height) => {
      if (revision !== measurement.current || keyboardTop !== keyboardY.current) return;
      // adjustResize may already have moved the entire layout. Add only its
      // remaining overlap, avoiding a second full keyboard-height offset.
      const overlap = Platform.OS === 'android' && keyboardY.current !== null ? Math.min(Math.max(0, height - 160), Math.max(0, y + height - keyboardY.current)) : 0;
      setLift(previous => Math.abs(previous - overlap) > 1 ? overlap : previous);
      reveal();
    });
  }, [reveal]);
  useEffect(() => {
    const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => { keyboardY.current = event.endCoordinates.screenY; measure(); });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { keyboardY.current = null; measurement.current++; setLift(0); });
    return () => { shown.remove(); hidden.remove(); keyboardY.current = null; measurement.current++; if (scheduled.current !== null) cancelAnimationFrame(scheduled.current); };
  }, [measure]);
  return <FieldFocus.Provider value={reveal}><View ref={host} collapsable={false} onLayout={measure} style={{ flex: 1 }}>
    <KeyboardAvoidingView style={{ flex: 1, paddingBottom: lift }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={contentContainerStyle} onLayout={reveal} onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
        {children}
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
  </View></FieldFocus.Provider>;
}
