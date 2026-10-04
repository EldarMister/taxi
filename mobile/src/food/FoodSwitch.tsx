import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotionPreference } from '../design/motion';
import { useTheme } from '../design/theme';

/** The reference switch keeps its full-size thumb on both mobile platforms. */
export function FoodSwitch({ value, onValueChange, accessibilityLabel, disabled = false }: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const { isDark } = useTheme();
  const reduced = useMotionPreference();
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    const next = value ? 1 : 0;
    progress.set(reduced !== false ? next : withTiming(next, {
      duration: 150,
      easing: Easing.bezier(.23, 1, .32, 1),
    }));
    return () => cancelAnimation(progress);
  }, [value, reduced, progress]);
  const inactiveColor = isDark ? '#3D3D3D' : '#EEEEEE';
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [inactiveColor, '#FFE500']),
  }), [inactiveColor]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: progress.get() * 18 }] }));
  return <Pressable accessibilityRole="switch" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled }} disabled={disabled} hitSlop={8}
    onPress={() => { if (!disabled) onValueChange(!value); }} style={[s.control, disabled && s.disabled]}>
    <Animated.View testID="food-switch-track" pointerEvents="none" style={[s.track, track]}>
      <Animated.View testID="food-switch-thumb" style={[s.thumb, thumb]}><View style={s.thumbSurface}/></Animated.View>
    </Animated.View>
  </Pressable>;
}

const s = StyleSheet.create({
  control: { width: 50, height: 32, flexShrink: 0 },
  disabled: { opacity: .45 },
  track: { width: 50, height: 32, borderRadius: 16, padding: 2 },
  thumb: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: .1, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1 },
  thumbSurface: { flex: 1, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E7E7E7' },
});
