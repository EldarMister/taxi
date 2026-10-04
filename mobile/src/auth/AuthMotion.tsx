import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../design/theme';

const authColors = {
  ink: '#1E2028', muted: '#737B8C', green: '#3478F6', greenDark: '#FFFFFF',
  surface: '#F4F5F8', mint: '#3478F6', focus: '#FBFBFD', red: '#BE3D46', redSurface: '#FFF0F1',
};
const darkAuthColors = {
  ink: '#FFFFFF', muted: '#B8B8B8', green: '#FFFFFF', greenDark: '#FFFFFF',
  surface: '#202020', mint: '#303030', focus: '#3D3D3D', red: '#FFFFFF', redSurface: '#474747',
};

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; setReduced(value); });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && !changed) setReduced(value); }).catch(() => {});
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return reduced;
}

function CodeCell({ digit, active, error, verified, reducedMotion, index, isDark, scale }: {
  digit: string; active: boolean; error: boolean; verified: boolean; reducedMotion: boolean; index: number; isDark: boolean; scale: number;
}) {
  const palette = isDark ? darkAuthColors : authColors;
  const fill = useRef(new Animated.Value(digit ? 1 : 0)).current;
  const focus = useRef(new Animated.Value(active ? 1 : 0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const success = useRef(new Animated.Value(0)).current;
  const filled = !!digit;
  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(fill, { toValue: filled ? 1 : 0, duration: reducedMotion ? 0 : 170, useNativeDriver: true }),
      Animated.timing(focus, { toValue: active ? 1 : 0, duration: reducedMotion ? 0 : 170, useNativeDriver: true }),
      Animated.timing(success, { toValue: verified ? 1 : 0, duration: reducedMotion ? 0 : 190, delay: reducedMotion || !verified ? 0 : index * 22, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [filled, active, verified, reducedMotion, fill, focus, success, index]);
  useEffect(() => {
    if (!digit || reducedMotion) { pop.setValue(1); return; }
    pop.setValue(0);
    const animation = Animated.spring(pop, { toValue: 1, speed: 28, bounciness: 5, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [digit, reducedMotion, pop]);
  return <View testID={`auth-digit-${index}`} style={[m.cell, isDark && m.darkCell, { borderRadius: 12 * scale, borderColor: error ? palette.red : active || filled ? '#3478F6' : isDark ? '#555555' : '#E2E4EC' }]}>
    <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.focus, opacity: focus }]} />
    <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.mint, opacity: fill }]} />
    <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.green, opacity: success }]} />
    {error ? <View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.redSurface }]} /> : null}
    <Animated.Text maxFontSizeMultiplier={1.3} style={[m.digit, { fontSize: 28 * scale, lineHeight: 36 * scale, color: error ? palette.red : verified ? isDark ? '#050505' : 'white' : palette.greenDark, opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [.75, 1] }) }, { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }] }]}>{digit}</Animated.Text>
  </View>;
}

export function CodeCells({ code, focused, error, verified, reducedMotion }: { code: string; focused: boolean; error: string; verified: boolean; reducedMotion: boolean }) {
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  const scale = Math.max(.78, Math.min(1.15, width / 426));
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error || reducedMotion) { shake.setValue(0); return; }
    const animation = Animated.sequence([-6, 5, -3, 0].map(toValue => Animated.timing(shake, { toValue, duration: 65, useNativeDriver: true })));
    animation.start();
    return () => animation.stop();
  }, [error, reducedMotion, shake]);
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[m.cells, { gap: 9 * scale, transform: [{ translateX: shake }] }]}>
    {Array.from({ length: 6 }, (_, index) => <CodeCell key={index} index={index} digit={code[index] || ''} active={focused && index === code.length && !error} error={!!error} verified={verified} reducedMotion={reducedMotion} isDark={isDark} scale={scale} />)}
  </Animated.View>;
}

const m = StyleSheet.create({
  cells: { flexDirection: 'row', gap: 8, height: '100%' },
  cell: { flex: 1, minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: '#E2E4EC', backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  darkCell: { backgroundColor: darkAuthColors.surface, borderWidth: 1, borderColor: '#555555' },
  digit: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 36, fontVariant: ['tabular-nums'], textAlign: 'center', includeFontPadding: false },
});
