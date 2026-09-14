import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Language, User } from './types';
import { Button, Logo, colors, tr } from './ui';
import { useTheme } from './design/theme';

export type PermissionStep = 'location' | 'notifications';

const artwork = {
  location: require('../assets/onboarding-location.png'),
  notifications: require('../assets/onboarding-notifications.png'),
};

export function PermissionOnboarding({ step, language, role, busy, error, openSettings, onAllow, onSkip }: {
  step: PermissionStep;
  language: Language;
  role: User['role'];
  busy: boolean;
  error?: string;
  openSettings?: boolean;
  onAllow: () => void;
  onSkip: () => void;
}) {
  const { isDark } = useTheme();
  const t = tr(language);
  const { width, height } = useWindowDimensions();
  const imageSize = Math.min(width - 40, Math.max(205, Math.min(300, height * .36)));
  const location = step === 'location';
  const description = location
    ? role === 'DRIVER'
      ? 'Так вы сможете быстро увидеть своё положение на карте. Геолокация используется только во время работы приложения.'
      : 'Так мы быстрее найдём место подачи и покажем вашу точку на карте. Геолокация используется только во время работы приложения.'
    : role === 'DRIVER'
      ? 'Сообщим о новом заказе, сообщении пассажира, когда пассажир выходит, и о завершении поездки.'
      : 'Сообщим, когда водитель назначен, приехал, написал вам и завершил поездку.';

  return <SafeAreaView style={[styles.safe, isDark && styles.darkSafe]}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Logo />
        <View style={styles.progress} accessibilityLabel={t(location ? 'Шаг 1 из 2' : 'Шаг 2 из 2')}>
          <View style={[styles.progressDot, isDark && styles.darkProgressDot, location && styles.progressDotActive, isDark && location && styles.darkProgressDotActive]}/>
          <View style={[styles.progressDot, isDark && styles.darkProgressDot, !location && styles.progressDotActive, isDark && !location && styles.darkProgressDotActive]}/>
        </View>
      </View>

      <View style={styles.main}>
        <View style={[styles.artHalo, isDark && styles.darkArtHalo, { width: imageSize, height: imageSize }]}>
          <Image source={artwork[step]} resizeMode="contain" style={styles.art} accessibilityIgnoresInvertColors />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, isDark && styles.darkTitle]}>{t(location ? 'Разрешите доступ к геолокации' : 'Не пропустите важное')}</Text>
          <Text style={[styles.description, isDark && styles.darkDescription]}>{t(description)}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        {!!error && <View accessibilityRole="alert" style={[styles.error, isDark && styles.darkError]}><Text style={[styles.errorText, isDark && styles.darkErrorText]}>{t(error)}</Text></View>}
        <Button
          label={t(openSettings ? 'Открыть настройки' : location ? 'Разрешить доступ' : 'Включить уведомления')}
          onPress={onAllow}
          busy={busy}
        />
        <Pressable accessibilityRole="button" disabled={busy} onPress={onSkip} style={({ pressed }) => [styles.skip, pressed && { opacity: .55 }, busy && { opacity: .45 }]}>
          <Text style={[styles.skipText, isDark && styles.darkSkipText]}>{t(location ? 'Указать адрес вручную' : 'Не сейчас')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  darkSafe: { backgroundColor: '#050505' },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 8 },
  progressDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#DCE8F4' },
  progressDotActive: { width: 26, backgroundColor: colors.blue },
  darkProgressDot: { backgroundColor: '#494949' }, darkProgressDotActive: { backgroundColor: '#FFFFFF' },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 10 },
  artHalo: { maxWidth: 300, maxHeight: 300, minWidth: 205, minHeight: 205, borderRadius: 999, backgroundColor: '#F4F9FF', alignItems: 'center', justifyContent: 'center' },
  darkArtHalo: { backgroundColor: '#1D1D1D' },
  art: { width: '108%', height: '108%' },
  copy: { alignItems: 'center', gap: 13, maxWidth: 340 },
  title: { color: colors.ink, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -.7, textAlign: 'center' },
  darkTitle: { color: '#FFFFFF' },
  description: { color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  darkDescription: { color: '#B8B8B8' },
  actions: { gap: 8, paddingTop: 8 },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  skipText: { color: colors.blue, fontSize: 16, fontWeight: '600' },
  darkSkipText: { color: '#FFFFFF' },
  error: { backgroundColor: '#FFF1F1', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 13 },
  darkError: { backgroundColor: '#303030' },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  darkErrorText: { color: '#FFFFFF' },
});
