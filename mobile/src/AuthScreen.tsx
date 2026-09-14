import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, messageOf } from './api';
import { Button, colors, Icon, IconButton, Logo, s, tr } from './ui';
import type { Language, Session } from './types';
import { CodeCells, useReducedMotion } from './auth/AuthMotion';
import { useTheme } from './design/theme';

type CodeResponse = { retryAfterSeconds?: number; development?: boolean; developmentCode?: string };

export function AuthScreen({ onLogin }: { onLogin: (session: Session, language: Language) => Promise<void> }) {
  const { isDark } = useTheme();
  const [language, setLanguage] = useState<Language>('ru');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [codeFocused, setCodeFocused] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const cancelHandoff = useRef<(() => void) | null>(null);
  const codeRevision = useRef(0);
  const attemptedCodeRevision = useRef(-1);
  const input = useRef<TextInput>(null);
  const reducedMotion = useReducedMotion();
  const t = tr(language);
  const text = (ru: string, ky: string) => language === 'ky' ? ky : ru;
  const normalizedPhone = `+996${phone}`;
  const displayPhone = (digits: string) => digits.replace(/(\d{3})(?=\d)/g, '$1 ');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelHandoff.current?.(); };
  }, []);
  function back() {
    if (submitting.current) return;
    Keyboard.dismiss(); setStep('phone'); setCode(''); setError(''); setVerified(false);
  }
  useEffect(() => {
    if (step !== 'code') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [step]);
  useEffect(() => {
    if (step !== 'code' || busy || verified) return;
    // Android can hide the keyboard while leaving a disabled input marked focused.
    if (error && Platform.OS === 'android') {
      input.current?.blur();
      const timer = setTimeout(() => input.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
    input.current?.focus();
  }, [step, busy, verified, error]);
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function send() {
    if (submitting.current || phone.length !== 9) return;
    if (normalizedPhone === sentPhone && secondsLeft > 0 && step === 'phone') {
      Keyboard.dismiss(); setError(''); setStep('code'); return;
    }
    if (step === 'code' && secondsLeft > 0) return;
    submitting.current = true; setBusy(true); setError(''); setVerified(false);
    try {
      const result = await api.post<CodeResponse>('/auth/request-code', { phone: normalizedPhone });
      if (!mounted.current) return;
      Keyboard.dismiss(); setSentPhone(normalizedPhone); setCode('');
      setDevelopmentCode(result.development ? result.developmentCode || '' : '');
      setRetryAt(Date.now() + (result.retryAfterSeconds ?? 60) * 1000);
      setStep('code');
    } catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  async function login(candidate = code, revision = codeRevision.current) {
    if (submitting.current || candidate.length !== 6 || !sentPhone || attemptedCodeRevision.current === revision) return;
    attemptedCodeRevision.current = revision;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await api.post<Session>('/auth/verify-code', { phone: sentPhone, code: candidate });
      if (!mounted.current) return;
      setVerified(true); Keyboard.dismiss();
      if (!reducedMotion) {
        // Complete the confirmed state before the parent replaces the screen.
        const finished = await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => { cancelHandoff.current = null; resolve(true); }, 360);
          cancelHandoff.current = () => { clearTimeout(timer); resolve(false); };
        });
        if (!finished || !mounted.current) return;
      }
      await onLogin(result, language);
    } catch (e) { if (mounted.current) { setVerified(false); setError(messageOf(e)); } }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  function changeCode(value: string) {
    if (submitting.current) return;
    const next = value.replace(/\D/g, '').slice(0, 6);
    if (next === code) return;
    setError(''); setVerified(false); ++codeRevision.current; setCode(next);
  }
  useEffect(() => {
    if (step === 'code' && code.length === 6 && !busy && !verified) void login(code, codeRevision.current);
  }, [step, code, busy, verified]);

  return (
    <SafeAreaView style={[a.screen, isDark && a.darkScreen]}>
      <KeyboardAvoidingView style={a.fill} behavior="padding">
        <ScrollView style={a.fill} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false} contentContainerStyle={a.content}>
          <View style={a.topbar}>
            {step === 'code' ? <IconButton name="arrow-back" label={t('Назад')} onPress={back} /> : <View style={{ width: 44 }} />}
            <View style={[a.languages, isDark && a.darkLanguages]}>
              {(['ru', 'ky'] as Language[]).map(lang => (
                <Pressable key={lang} accessibilityRole="button" accessibilityState={{ selected: lang === language }} onPress={() => setLanguage(lang)} style={[a.language, language === lang && a.languageActive, isDark && language === lang && a.darkLanguageActive]}>
                  <Text style={[a.languageText, isDark && a.darkSecondaryText, language === lang && { color: isDark ? '#050505' : 'white' }]}>{lang === 'ru' ? 'RU' : 'KG'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {step === 'phone' ? (
            <>
              <View style={[a.hero, isDark && a.darkHero]}>
                <Logo large />
                <Text style={[a.title, isDark && a.darkTitle]}>{t('Вход в приложение')}</Text>
                <Text style={[a.subtitle, isDark && a.darkSecondaryText]}>{t('Быстрые и безопасные поездки\nвсегда рядом')}</Text>
              </View>
              <View style={[a.form, isDark && a.darkForm]}>
                <View style={[a.field, isDark && a.darkField]}>
                  <Icon name="call-outline" size={27} color={isDark ? '#FFFFFF' : undefined} />
                  <View style={a.fill}>
                    <Text style={[a.fieldLabel, isDark && a.darkSecondaryText]}>{t('Номер телефона')}</Text>
                    <View style={[s.row, { gap: 7 }]}>
                      <Text style={[a.phonePrefix, isDark && a.darkTitle]}>+996</Text>
                      <TextInput testID="auth-phone" accessibilityLabel={t('Номер телефона')} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel-national" editable={!busy} value={displayPhone(phone)} onChangeText={value => {
                        let digits = value.replace(/\D/g, '');
                        if (digits.startsWith('996') && digits.length > 9) digits = digits.slice(3);
                        setPhone(digits.slice(0, 9)); setError('');
                      }} placeholder="700 123 456" placeholderTextColor={isDark ? '#888888' : colors.muted} selectionColor={isDark ? '#FFFFFF' : undefined} style={[a.phoneInput, isDark && a.darkInput]} maxLength={17} onSubmitEditing={() => void send()} />
                    </View>
                  </View>
                </View>
                {error ? <Text accessibilityRole="alert" style={[a.error, isDark && a.darkError]}>{t(error)}</Text> : null}
                <Button label={t('Продолжить')} icon="arrow-forward" onPress={() => void send()} busy={busy} disabled={phone.length !== 9} />
                <Text style={[a.footnote, isDark && a.darkSecondaryText]}>{text('Отправим код подтверждения\nна ваш номер телефона', 'Телефон номериңизге\nырастоо кодун жөнөтөбүз')}</Text>
                <Privacy language={language} />
              </View>
            </>
          ) : (
            <View style={a.codeScreen}>
              <Text style={[a.title, isDark && a.darkTitle]}>{text('Введите код', 'Кодду киргизиңиз')}</Text>
              <Text style={[a.subtitle, isDark && a.darkSecondaryText]}>{developmentCode ? text('Тестовый вход для номера', 'Номер үчүн сыноо кирүүсү') : text('Отправили SMS на номер', 'Бул номерге SMS жөнөтүлдү')}</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={back} style={a.editPhone}>
                <Text style={[a.sentPhone, isDark && a.darkTitle]}>{`+996 ${displayPhone(sentPhone.slice(4))}`}</Text>
                <Icon name="pencil-outline" color={isDark ? '#FFFFFF' : colors.blue} size={17} />
              </Pressable>
              <Pressable onPress={() => input.current?.focus()} style={a.codeEntry}>
                <CodeCells code={code} focused={codeFocused} error={error} verified={verified} reducedMotion={reducedMotion} />
                <TextInput ref={input} testID="auth-code" accessibilityLabel={t('Код из SMS')} accessibilityHint={text('Шесть цифр. Код проверится автоматически.', 'Алты сан. Код автоматтык түрдө текшерилет.')} value={code} editable={!busy} onChangeText={changeCode} onFocus={() => setCodeFocused(true)} onBlur={() => setCodeFocused(false)} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} caretHidden autoFocus underlineColorAndroid="transparent" selectionColor="transparent" selection={error ? { start: 0, end: code.length } : undefined} style={a.hiddenInput} onSubmitEditing={() => void login()} />
              </Pressable>
              {error ? <Text accessibilityRole="alert" style={[a.error, isDark && a.darkError]}>{t(error)}</Text> : null}
              {developmentCode ? <Text style={[a.demoCode, isDark && a.darkSecondaryText]}>{text('Тестовый код', 'Сыноо коду')}: {developmentCode}</Text> : null}
              <Pressable accessibilityRole="button" disabled={busy || secondsLeft > 0} onPress={() => void send()} style={a.resend}>
                <Text style={[a.resendText, isDark && a.darkLink, secondsLeft > 0 && { color: isDark ? '#888888' : colors.muted }]}>{secondsLeft > 0 ? text(`Отправить код ещё раз через ${secondsLeft} с`, `Кодду ${secondsLeft} сек кийин кайра жөнөтүү`) : t('Отправить ещё раз')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={back} disabled={busy} style={a.resend}><Text style={[a.resendText, isDark && a.darkLink]}>{text('Изменить номер телефона', 'Телефон номерин өзгөртүү')}</Text></Pressable>
              <View style={a.fill} />
              <Privacy language={language} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Privacy({ language }: { language: Language }) {
  const { isDark } = useTheme();
  const url = process.env.EXPO_PUBLIC_PRIVACY_URL;
  return url ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)}><Text style={[a.privacy, isDark && a.darkLink]}>{tr(language)('Политика конфиденциальности')}</Text></Pressable> : null;
}

const a = StyleSheet.create({
  fill: { flex: 1 }, screen: { flex: 1, backgroundColor: '#FFFFFF' }, content: { flexGrow: 1 },
  darkScreen: { backgroundColor: '#050505' },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 14, paddingBottom: 8 },
  languages: { flexDirection: 'row', borderRadius: 25, backgroundColor: '#EFF3F8' }, language: { minWidth: 48, paddingVertical: 10, paddingHorizontal: 15, borderRadius: 24 }, languageActive: { backgroundColor: colors.blue }, languageText: { textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.muted },
  darkLanguages: { backgroundColor: '#242424' }, darkLanguageActive: { backgroundColor: '#FFFFFF' },
  hero: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 2, backgroundColor: '#FFFFFF' },
  darkHero: { backgroundColor: '#050505' },
  title: { color: '#0B142B', fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -.7, textAlign: 'center', marginTop: 22 },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 23, textAlign: 'center', marginTop: 10 },
  darkTitle: { color: '#FFFFFF' }, darkSecondaryText: { color: '#B8B8B8' }, darkLink: { color: '#FFFFFF' }, darkError: { color: '#FFFFFF' },
  form: { flex: 1, padding: 22, paddingTop: 28, marginTop: 24, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: 'white', gap: 19 },
  darkForm: { backgroundColor: '#111111' },
  field: { borderWidth: 1, borderColor: '#DEE7F2', borderRadius: 18, minHeight: 76, paddingHorizontal: 17, paddingVertical: 10, flexDirection: 'row', gap: 18, alignItems: 'center' },
  darkField: { borderColor: '#444444', backgroundColor: '#1B1B1B' }, darkInput: { color: '#FFFFFF' },
  fieldLabel: { fontSize: 13, color: colors.muted, marginBottom: 3 }, phonePrefix: { fontSize: 20, color: colors.ink }, phoneInput: { flex: 1, color: colors.ink, fontSize: 20, paddingVertical: 2 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 }, footnote: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginTop: 1 }, privacy: { color: colors.blue, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  codeScreen: { flex: 1, padding: 24, paddingTop: 18 },
  editPhone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 }, sentPhone: { color: colors.ink, fontSize: 19, fontWeight: '600' },
  codeEntry: { marginVertical: 24, height: 62 }, hiddenInput: { ...StyleSheet.absoluteFillObject, color: 'transparent', backgroundColor: 'transparent', fontSize: 20, borderWidth: 0, padding: 0 },
  demoCode: { color: colors.muted, textAlign: 'center', fontSize: 13, marginBottom: 17 }, resend: { alignItems: 'center', paddingVertical: 12, marginTop: 6 }, resendText: { fontSize: 14, color: colors.blue, textAlign: 'center' },
});
