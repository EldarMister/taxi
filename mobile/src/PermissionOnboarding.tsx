import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Language, User } from './types';
import { tr } from './ui';
import { useTheme } from './design/theme';
import { permissionPalettes } from './permissionPalette';
import { PermissionIllustration } from './PermissionIllustration';
import { permissionSteps, type PermissionStep } from './permissionFlow';

export type { PermissionStep } from './permissionFlow';

const titles: Record<PermissionStep, string> = {
  notifications: 'Разрешите уведомления',
  overlay: 'Разрешите отображение всплывающих окон',
  location: 'Разрешите доступ к геолокации',
  battery: 'Отключите энергосбережение',
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
  const t = tr(language);
  const { isDark } = useTheme();
  const tone = permissionPalettes[isDark ? 'dark' : 'light'];
  const { width, height } = useWindowDimensions();
  const steps = permissionSteps(role === 'DRIVER' ? 'DRIVER' : 'CLIENT');
  const activeStep = steps.indexOf(step);
  const compact = height < 740;
  const imageSize = Math.min(width - 48, 342, Math.max(compact ? 160 : 216, height * (compact ? .28 : .40)));
  const description = step === 'location'
    ? role === 'DRIVER'
      ? 'Находим заказы рядом. На линии геолокация может работать в фоне с вашего разрешения.'
      : 'Определим место подачи и вашу точку на карте.'
    : step === 'notifications'
      ? role === 'DRIVER'
        ? 'Сообщим о новом заказе, сообщении пассажира, когда пассажир выходит, и о завершении поездки.'
        : 'Сообщим, когда водитель назначен, приехал, написал вам и завершил поездку.'
      : step === 'overlay'
        ? 'Новые заказы и важные уведомления будут видны поверх других приложений.'
        : 'Иначе вы можете пропустить новый заказ, а приложение может работать некорректно.';
  const settingsAction = openSettings || step === 'overlay' || step === 'battery';
  const buttonLabel = t(settingsAction ? 'Открыть настройки' : step === 'location' ? 'Разрешить доступ' : 'Включить уведомления');

  return <SafeAreaView style={[styles.safe, { backgroundColor: tone.background }]}>
    <StatusBar style={isDark ? "light" : "dark"} />
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Image source={isDark ? require('../assets/logo dark.png') : require('../assets/logo light.png')} resizeMode="contain" style={styles.logo} accessibilityLabel="ATLAS" accessibilityIgnoresInvertColors />
        <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel={t(`Шаг ${activeStep + 1} из ${steps.length}`)} accessibilityValue={{ min: 1, max: steps.length, now: activeStep + 1 }}>
          {steps.map((item, index) => <View key={item} style={[styles.progressDot, { backgroundColor: tone.dot }, index === activeStep && styles.progressDotActive]} />)}
        </View>
      </View>

      <View style={[styles.main, compact && styles.compactMain]}>
        <PermissionIllustration step={step} language={language} role={role} size={imageSize} dark={isDark} />
        <View style={[styles.copy, compact && styles.compactCopy]}>
          <View style={styles.titleBox}><Text accessibilityRole="header" style={[styles.title, { color: tone.ink }]}>{t(titles[step])}</Text></View>
          <Text style={[styles.description, { color: tone.muted }]}>{t(description)}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        {!!error && <View accessibilityRole="alert" style={[styles.error, { backgroundColor: tone.error }]}><Text style={[styles.errorText, { color: tone.errorText }]}>{t(error)}</Text></View>}
        <Pressable accessibilityRole="button" accessibilityLabel={buttonLabel} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onAllow} style={({ pressed }) => [styles.allow, { backgroundColor: tone.button }, pressed && styles.pressed, busy && styles.disabled]}>
          {busy && <ActivityIndicator color={tone.ink} size="small" />}
          <Text style={[styles.allowText, { color: tone.ink }]}>{buttonLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onSkip} style={({ pressed }) => [styles.skip, pressed && styles.pressed, busy && styles.disabled]}>
          <Text style={[styles.skipText, { color: tone.muted }]}>{t(step === 'location' && role !== 'DRIVER' ? 'Указать адрес вручную' : 'Не сейчас')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 60 },
  logo: { width: 176, height: 60 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10 },
  progressDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E7E9EE' },
  progressDotActive: { backgroundColor: '#2C6BFF' },
  main: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 36, paddingBottom: 30, gap: 12 },
  compactMain: { paddingTop: 18, paddingBottom: 18, gap: 8 },
  compactCopy: { gap: 12 },
  copy: { width: '100%', alignItems: 'center', gap: 16, maxWidth: 360 },
  titleBox: { minHeight: 62, justifyContent: 'center', width: '100%' },
  title: { color: '#131A2C', fontSize: 24, lineHeight: 31, fontFamily: 'Inter_600SemiBold', letterSpacing: -.5, textAlign: 'center' },
  description: { color: '#8A91A0', fontSize: 16, lineHeight: 23, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  actions: { gap: 4 },
  allow: { width: '100%', minHeight: 58, borderRadius: 18, backgroundColor: '#EFF0F3', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, paddingHorizontal: 18 },
  allowText: { color: '#131A2C', fontSize: 18, lineHeight: 25, fontFamily: 'Inter_400Regular', textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: .65 },
  disabled: { opacity: .5 },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  skipText: { color: '#8A91A0', fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  error: { backgroundColor: '#FFF1F1', borderRadius: 14, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 13 },
  errorText: { color: '#CA4149', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
