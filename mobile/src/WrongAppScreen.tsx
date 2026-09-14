import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appVariant, roleMismatchCopy } from './appVariant';
import { fonts } from './design/typography';
import type { Language } from './types';
import { Button, colors, Icon, Logo } from './ui';
import { useTheme } from './design/theme';

export function WrongAppScreen({ language, onContinue }: { language: Language; onContinue: () => void }) {
  const { isDark } = useTheme();
  const copy = roleMismatchCopy(language);
  return <SafeAreaView style={[s.screen, isDark && s.darkScreen]}>
    <View style={s.brand}><Logo large /><Text style={[s.variant, isDark && s.darkMuted]}>{appVariant === 'driver' ? (language === 'ky' ? 'АЙДООЧУЛАР ҮЧҮН' : 'ДЛЯ ВОДИТЕЛЕЙ') : (language === 'ky' ? 'ЖҮРГҮНЧҮЛӨР ҮЧҮН' : 'ДЛЯ ПАССАЖИРОВ')}</Text></View>
    <View style={s.body}>
      <View style={[s.icon, isDark && s.darkIcon]}><Icon name="swap-horizontal-outline" size={34} color={isDark ? '#FFFFFF' : colors.blue} /></View>
      <Text accessibilityRole="header" style={[s.title, isDark && s.darkTitle]}>{copy.title}</Text>
      <Text accessibilityRole="alert" style={[s.message, isDark && s.darkMuted]}>{copy.message}</Text>
    </View>
    <Button label={copy.action} onPress={onContinue} />
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white', paddingHorizontal: 24, paddingVertical: 22 },
  darkScreen: { backgroundColor: '#050505' },
  brand: { alignItems: 'center', gap: 10 },
  variant: { color: colors.muted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 2 },
  darkMuted: { color: '#B8B8B8' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, gap: 15 },
  icon: { width: 72, height: 72, borderRadius: 25, backgroundColor: '#EAF3FF', alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  darkIcon: { backgroundColor: '#202020', borderWidth: 1, borderColor: '#494949' },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 32, textAlign: 'center' },
  darkTitle: { color: '#FFFFFF' },
  message: { color: colors.muted, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
