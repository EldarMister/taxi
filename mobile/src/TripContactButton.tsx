import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from './design/theme';

export type TripContactKind = 'call' | 'chat';

/** Matching handset and speech bubble outlines for both sides of a trip. */
export function TripContactIcon({ kind, size = 22 }: { kind: TripContactKind; size?: number }) {
  const { isDark } = useTheme();
  const ink = isDark ? '#FFFFFF' : '#1E2028';
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Path
      d={kind === 'call'
        ? 'M6.6 3.2c.6-.4 1.4-.2 1.8.4l2 3.2c.4.6.3 1.3-.2 1.8L8.7 10c1.1 2.3 3 4.2 5.3 5.3l1.4-1.5c.5-.5 1.2-.6 1.8-.2l3.2 2c.6.4.8 1.2.4 1.8l-1 1.7c-.6 1-1.8 1.5-3 1.2C10.3 18.7 5.3 13.7 3.7 7.2c-.3-1.2.2-2.4 1.2-3l1.7-1Z'
        : 'M20.8 11.5a8.8 8.8 0 0 1-12.9 7.8L3 21l1.6-4.8a8.8 8.8 0 1 1 16.2-4.7Z'}
      fill="none" stroke={ink} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
    />
  </Svg>;
}

export function TripContactButton({ kind, label, disabled = false, onPress }: { kind: TripContactKind; label: string; disabled?: boolean; onPress: () => void }) {
  const { isDark } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, isDark && styles.dark, (pressed || disabled) && { opacity: disabled ? .4 : .65 }]}>
    <TripContactIcon kind={kind}/>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#D3D8E1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dark: { backgroundColor: '#111111', borderColor: '#454545' },
});
