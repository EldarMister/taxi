import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { messageOf } from './api';
import { useAuthDesign } from './auth/design';
import { fonts } from './design/typography';
import { RegistrationKeyboardLayout, useRegistrationFieldFocus } from './registration/RegistrationKeyboardLayout';
import { ClearableTextInput } from './registration/ClearableTextInput';
import { Icon, tr } from './ui';
import type { User } from './types';

type Props = {
  user: User;
  onSave: (firstName: string, lastName: string) => Promise<void>;
  onBack: () => void;
};

const normalizeName = (value: string) => value.trim().replace(/\s+/gu, ' ');

export function ClientNameScreen({ user, onSave, onBack }: Props) {
  const { isDark, palette } = useAuthDesign();
  const styles = useMemo(() => createStyles(isDark, palette), [isDark, palette]);
  const t = tr(user.language);
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false), completed = useRef(false), mounted = useRef(true);
  const lastNameInput = useRef<TextInput>(null);
  const first = normalizeName(firstName), last = normalizeName(lastName);
  const tooLong = `${first} ${last}`.length > 80;
  const disabled = busy || saved || !first || !last || tooLong;
  const visibleError = error || (tooLong ? t('Имя и фамилия вместе — не более 80 символов') : '');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function back() {
    if (submitting.current || completed.current) return;
    Keyboard.dismiss();
    onBack();
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [onBack]);

  async function save() {
    if (submitting.current || completed.current) return;
    if (!first || !last) { setError(t('Введите имя и фамилию')); return; }
    if (tooLong) { setError(t('Имя и фамилия вместе — не более 80 символов')); return; }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(first, last);
      completed.current = true;
      Keyboard.dismiss();
      if (mounted.current) setSaved(true);
    } catch (failure) {
      if (mounted.current) setError(messageOf(failure));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const header = <View style={styles.header}>
    <Pressable testID="client-name-back" accessibilityRole="button" accessibilityLabel={t('Назад')}
      accessibilityState={{ disabled: busy || saved }} disabled={busy || saved} onPress={back} hitSlop={8} style={styles.back}>
      <Icon name="arrow-back" size={25} color={palette.ink} />
    </Pressable>
  </View>;
  const footer = <View testID="client-name-footer" style={styles.footer}>
    <Pressable testID="client-name-continue" accessibilityRole="button" accessibilityLabel={t('Далее')}
      accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => { void save(); }}
      style={({ pressed }) => [styles.continueButton, pressed && !disabled && styles.pressed, disabled && styles.disabled]}>
      {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.continueText}>{t('Далее')}</Text>}
    </Pressable>
  </View>;

  return <SafeAreaView style={styles.screen}>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <RegistrationKeyboardLayout header={header} footer={footer} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>{t('Введите имя и фамилию')}</Text>
      <NameField testID="client-first-name" value={firstName} label={t('Имя')} inputRef={undefined}
        autoComplete="given-name" returnKeyType="next" isDark={isDark} busy={busy || saved} styles={styles}
        placeholderColor={palette.muted} onChange={value => { setFirstName(value); setError(''); }}
        onSubmit={() => lastNameInput.current?.focus()} />
      <NameField testID="client-last-name" value={lastName} label={t('Фамилия')} inputRef={lastNameInput}
        autoComplete="family-name" returnKeyType="done" isDark={isDark} busy={busy || saved} styles={styles}
        placeholderColor={palette.muted} onChange={value => { setLastName(value); setError(''); }}
        onSubmit={() => { void save(); }} />
      {!!visibleError && <Text testID="client-name-error" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{visibleError}</Text>}
    </RegistrationKeyboardLayout>
  </SafeAreaView>;
}

function NameField({ testID, value, label, inputRef, autoComplete, returnKeyType, isDark, busy, styles, placeholderColor, onChange, onSubmit }: {
  testID: string; value: string; label: string; inputRef?: React.RefObject<TextInput | null>;
  autoComplete: 'given-name' | 'family-name'; returnKeyType: 'next' | 'done'; isDark: boolean; busy: boolean;
  styles: ReturnType<typeof createStyles>; placeholderColor: string; onChange: (value: string) => void; onSubmit: () => void;
}) {
  const reveal = useRegistrationFieldFocus();
  return <View style={styles.field}>
    <ClearableTextInput ref={inputRef} testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange}
      editable={!busy} maxLength={80} placeholder={label} placeholderTextColor={placeholderColor} style={styles.input}
      autoCapitalize="words" autoCorrect={false} autoComplete={autoComplete} returnKeyType={returnKeyType}
      submitBehavior={returnKeyType === 'next' ? 'submit' : 'blurAndSubmit'} keyboardAppearance={isDark ? 'dark' : 'light'}
      onFocus={reveal} onSubmitEditing={onSubmit} />
  </View>;
}

function createStyles(isDark: boolean, palette: ReturnType<typeof useAuthDesign>['palette']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
    back: { width: 44, minHeight: 44, justifyContent: 'center' },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 },
    title: { fontFamily: fonts.semibold, fontSize: 21, lineHeight: 29, color: palette.ink, marginBottom: 30 },
    field: {
      minHeight: 58, justifyContent: 'center', borderRadius: 15, marginBottom: 16,
      backgroundColor: isDark ? palette.elevated : '#FFFFFF', shadowColor: isDark ? '#000000' : '#263B5C',
      shadowOffset: { width: 0, height: 7 }, shadowOpacity: isDark ? .1 : .06, shadowRadius: 12, elevation: isDark ? 0 : 2,
    },
    input: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24, color: palette.ink, minHeight: 58, paddingHorizontal: 18, paddingVertical: 16 },
    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
    continueButton: { minHeight: 60, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 18, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
    continueText: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24, color: palette.accentText },
    pressed: { opacity: .85 }, disabled: { opacity: .65 },
    error: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: isDark ? '#FF8888' : '#CA4149', marginTop: 2 },
  });
}
