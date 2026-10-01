import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api, messageOf } from './api';
import { Icon, s, tr } from './ui';
import type { Language, Session } from './types';
import { CodeCells, useReducedMotion } from './auth/AuthMotion';
import { readSelectedLanguage, writeSelectedLanguage } from './auth/languageStore';

type CodeResponse = { retryAfterSeconds?: number; development?: boolean; developmentCode?: string };

export function AuthScreen({ onLogin }: { onLogin: (session: Session, language: Language) => Promise<void> }) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<Language>('ru');
  const [languageMenu, setLanguageMenu] = useState(false);
  const [languageAnchor, setLanguageAnchor] = useState({ x: 24, y: 0, width: 280, height: 60 });
  const languageSelector = useRef<View>(null);
  const languageChanged = useRef(false);
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
  const text = (ru: string, ky: string, en: string) => language === 'ky' ? ky : language === 'en' ? en : ru;
  const normalizedPhone = `+996${phone}`;
  const displayPhone = (digits: string) => digits.replace(/(\d{3})(?=\d)/g, '$1 ');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelHandoff.current?.(); };
  }, []);
  useEffect(() => {
    void readSelectedLanguage().then(value => { if (mounted.current && !languageChanged.current) setLanguage(value); });
  }, []);
  function selectLanguage(next: Language) {
    languageChanged.current = true;
    setLanguage(next);
    setLanguageMenu(false);
    void writeSelectedLanguage(next).catch(() => undefined);
  }
  function openLanguageMenu() {
    languageSelector.current?.measureInWindow?.((x, y, width, height) => {
      setLanguageAnchor({ x, y, width, height });
      setLanguageMenu(true);
    });
  }
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
    <SafeAreaView style={a.screen}>
      <StatusBar style="light" backgroundColor="#050505" />
      <KeyboardAvoidingView style={a.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={a.fill} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false} contentContainerStyle={[a.content, { minHeight: screenHeight - insets.top - insets.bottom }]}>
          {step === 'phone' ? (
            <>
              <View style={[a.hero, { minHeight: Math.min(330, Math.max(240, screenHeight * .325)) }]}>
                <Image source={require('../assets/logo dark.png')} resizeMode="contain" accessibilityLabel="ATLAS" style={a.logo} />
                <Text style={a.title}>{t('Вход в приложение')}</Text>
                <Text style={a.subtitle}>{t('Быстрые и безопасные поездки\nвсегда рядом')}</Text>
              </View>
              <View style={a.form}>
                <View style={a.field}>
                  <Icon name="call-outline" size={25} color="#FFFFFF" />
                  <View style={a.fill}>
                    <Text style={a.fieldLabel}>{t('Номер телефона')}</Text>
                    <View style={[s.row, { gap: 7 }]}>
                      <Text style={a.phonePrefix}>+996</Text>
                      <TextInput testID="auth-phone" accessibilityLabel={t('Номер телефона')} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel-national" editable={!busy} value={displayPhone(phone)} onChangeText={value => {
                        let digits = value.replace(/\D/g, '');
                        if (digits.startsWith('996') && digits.length > 9) digits = digits.slice(3);
                        setPhone(digits.slice(0, 9)); setError('');
                      }} placeholder="700 123 456" placeholderTextColor="#858585" selectionColor="#FFFFFF" style={a.phoneInput} maxLength={17} onSubmitEditing={() => void send()} />
                    </View>
                  </View>
                </View>
                {error ? <Text accessibilityRole="alert" style={a.error}>{t(error)}</Text> : null}
                <Pressable testID="auth-continue" accessibilityRole="button" accessibilityState={{ disabled: phone.length !== 9 || busy, busy }} disabled={phone.length !== 9 || busy} onPress={() => void send()} style={[a.continueButton, phone.length === 9 && !busy && a.continueActive]}>
                  {busy ? <ActivityIndicator color="#111111" /> : <Text style={a.continueText}>{t('Продолжить')}</Text>}
                </Pressable>
                <Text style={a.footnote}>{text('Отправим код подтверждения\nна ваш номер телефона', 'Телефон номериңизге\nырастоо кодун жөнөтөбүз', 'We will send a confirmation code\nto your phone number')}</Text>
                <View style={a.formSpacer} />
                <LegalLinks language={language} />
                <View ref={languageSelector} collapsable={false} style={a.selectorAnchor}>
                  <LanguageSelector language={language} expanded={languageMenu} onPress={openLanguageMenu} />
                </View>
              </View>
            </>
          ) : (
            <View style={a.codeScreen}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Назад')} onPress={back} style={a.back}><Icon name="arrow-back" color="#FFFFFF" /></Pressable>
              <Text style={a.title}>{text('Введите код', 'Кодду киргизиңиз', 'Enter the code')}</Text>
              <Text style={a.subtitle}>{developmentCode ? text('Тестовый вход для номера', 'Номер үчүн сыноо кирүүсү', 'Test sign in for') : text('Отправили SMS на номер', 'Бул номерге SMS жөнөтүлдү', 'We sent an SMS to')}</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={back} style={a.editPhone}>
                <Text style={a.sentPhone}>{`+996 ${displayPhone(sentPhone.slice(4))}`}</Text>
                <Icon name="pencil-outline" color="#FFFFFF" size={17} />
              </Pressable>
              <Pressable onPress={() => input.current?.focus()} style={a.codeEntry}>
                <CodeCells code={code} focused={codeFocused} error={error} verified={verified} reducedMotion={reducedMotion} />
                <TextInput ref={input} testID="auth-code" accessibilityLabel={t('Код из SMS')} accessibilityHint={text('Шесть цифр. Код проверится автоматически.', 'Алты сан. Код автоматтык түрдө текшерилет.', 'Six digits. The code will be checked automatically.')} value={code} editable={!busy} onChangeText={changeCode} onFocus={() => setCodeFocused(true)} onBlur={() => setCodeFocused(false)} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} caretHidden autoFocus underlineColorAndroid="transparent" selectionColor="transparent" selection={error ? { start: 0, end: code.length } : undefined} style={a.hiddenInput} onSubmitEditing={() => void login()} />
              </Pressable>
              {error ? <Text accessibilityRole="alert" style={a.error}>{t(error)}</Text> : null}
              {developmentCode ? <Text style={a.demoCode}>{text('Тестовый код', 'Сыноо коду', 'Test code')}: {developmentCode}</Text> : null}
              <Pressable accessibilityRole="button" disabled={busy || secondsLeft > 0} onPress={() => void send()} style={a.resend}>
                <Text style={[a.resendText, secondsLeft > 0 && { color: '#888888' }]}>{secondsLeft > 0 ? text(`Отправить код ещё раз через ${secondsLeft} с`, `Кодду ${secondsLeft} сек кийин кайра жөнөтүү`, `Resend code in ${secondsLeft}s`) : t('Отправить ещё раз')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={back} disabled={busy} style={a.resend}><Text style={a.resendText}>{text('Изменить номер телефона', 'Телефон номерин өзгөртүү', 'Change phone number')}</Text></Pressable>
              <View style={a.formSpacer} />
              <LegalLinks language={language} />
              <View ref={languageSelector} collapsable={false} style={a.selectorAnchor}><LanguageSelector language={language} expanded={languageMenu} onPress={openLanguageMenu} /></View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={languageMenu} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setLanguageMenu(false)}>
        <View style={a.menuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLanguageMenu(false)} accessibilityLabel={text('Закрыть выбор языка', 'Тил тандоону жабуу', 'Close language menu')} />
          <View style={[a.menu, { left: languageAnchor.x, width: languageAnchor.width, top: Math.max(insets.top + 8, languageAnchor.y + insets.top - 172) }]}>
            {(['ru', 'ky', 'en'] as Language[]).map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: language === item }} onPress={() => selectLanguage(item)} style={a.menuItem}>
              <Text style={[a.menuText, language === item && a.menuTextActive]}>{languageName(item)}</Text>
              {language === item ? <Icon name="checkmark" size={21} color="#FFFFFF" /> : null}
            </Pressable>)}
          </View>
          <View style={{ position: 'absolute', left: languageAnchor.x, top: languageAnchor.y + insets.top, width: languageAnchor.width }}><LanguageSelector language={language} expanded onPress={() => setLanguageMenu(false)} /></View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LegalLinks({ language }: { language: Language }) {
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;
  const en = language === 'en';
  const ky = language === 'ky';
  const unavailable = () => Alert.alert(en ? 'Document unavailable' : ky ? 'Документ азырынча жеткиликсиз' : 'Документ пока недоступен');
  return <View style={a.legal}>
    <Text style={a.legalIntro}>{en ? 'By tapping “Continue”, you agree\nwith our' : ky ? '«Улантуу» баскычын басуу менен\nсиз биздин шарттарга макул болосуз' : 'Нажимая «Продолжить», вы соглашаетесь\nс нашими'}</Text>
    <View style={[a.legalLinks, (en || ky) && a.legalLinksInline]}>
      <Pressable accessibilityRole="link" style={ky && a.legalLinkCompact} onPress={() => privacyUrl ? void Linking.openURL(privacyUrl) : unavailable()}><Text style={a.privacy} numberOfLines={ky ? 1 : undefined} adjustsFontSizeToFit={ky}>{en ? 'Privacy Policy' : ky ? 'Купуялык саясаты' : 'Политикой конфиденциальности'}</Text></Pressable>
      <Pressable accessibilityRole="link" style={ky && a.legalLinkCompact} onPress={() => termsUrl ? void Linking.openURL(termsUrl) : unavailable()}><Text style={a.privacy} numberOfLines={ky ? 1 : undefined} adjustsFontSizeToFit={ky}>{en ? 'Terms of Use' : ky ? 'Колдонуу шарттары' : 'Условиями использования'}</Text></Pressable>
    </View>
  </View>;
}

function languageName(language: Language) { return language === 'ky' ? 'Кыргызский' : language === 'en' ? 'English' : 'Русский'; }
function LanguageSelector({ language, expanded, onPress }: { language: Language; expanded: boolean; onPress: () => void }) {
  return <Pressable testID="auth-language-selector" accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={a.languageSelector}>
    <View style={a.globeCircle}><Icon name="globe-outline" size={22} color="#FFFFFF" /></View>
    <Text style={a.selectedLanguage}>{languageName(language)}</Text>
    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={21} color="#E8E8E8" />
  </Pressable>;
}

const a = StyleSheet.create({
  fill: { flex: 1 }, screen: { flex: 1, backgroundColor: '#050505' }, content: { flexGrow: 1, backgroundColor: '#050505' },
  hero: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 18 },
  logo: { width: 245, height: 84 },
  title: { color: '#FFFFFF', fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -.7, textAlign: 'center', marginTop: 18 },
  subtitle: { color: '#ACACAC', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12 },
  form: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 23, paddingBottom: 14, borderTopLeftRadius: 34, borderTopRightRadius: 34, backgroundColor: '#111111', gap: 14 },
  field: { borderWidth: 1, borderColor: '#555555', backgroundColor: '#181818', borderRadius: 18, minHeight: 76, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', gap: 17, alignItems: 'center' },
  fieldLabel: { fontSize: 13, color: '#AAAAAA', marginBottom: 3 }, phonePrefix: { fontSize: 20, color: '#FFFFFF' }, phoneInput: { flex: 1, color: '#FFFFFF', fontSize: 20, paddingVertical: 2 },
  error: { color: '#FF8888', fontSize: 14, lineHeight: 21 },
  continueButton: { height: 58, borderRadius: 17, backgroundColor: '#C8C8C8', alignItems: 'center', justifyContent: 'center' },
  continueActive: { backgroundColor: '#FFFFFF' }, continueText: { fontSize: 17, fontWeight: '700', color: '#111111' },
  footnote: { fontSize: 13, color: '#A0A0A0', textAlign: 'center', lineHeight: 20 },
  formSpacer: { flexGrow: 1, minHeight: 24 },
  legal: { alignItems: 'center', gap: 5 }, legalIntro: { color: '#929292', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 3 },
  legalLinks: { alignItems: 'center', gap: 5 }, legalLinksInline: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', gap: 16 }, legalLinkCompact: { flexShrink: 1 },
  privacy: { color: '#E6E6E6', textDecorationLine: 'underline', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  selectorAnchor: { alignSelf: 'center', width: '68%', maxWidth: 260, marginTop: 14 }, languageSelector: { minHeight: 62, borderWidth: 1, borderColor: '#515151', borderRadius: 32, backgroundColor: '#151515', flexDirection: 'row', alignItems: 'center', paddingLeft: 5, paddingRight: 12, gap: 8 },
  globeCircle: { width: 49, height: 49, borderRadius: 25, backgroundColor: '#292929', alignItems: 'center', justifyContent: 'center' }, selectedLanguage: { flex: 1, color: '#F5F5F5', fontSize: 15, fontWeight: '500' },
  menuOverlay: { flex: 1 }, menu: { position: 'absolute', backgroundColor: '#202020', borderColor: '#515151', borderWidth: 1, borderRadius: 18, paddingVertical: 4, overflow: 'hidden' }, menuItem: { minHeight: 52, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, menuText: { color: '#D1D1D1', fontSize: 16 }, menuTextActive: { color: '#FFFFFF', fontWeight: '700' },
  codeScreen: { flexGrow: 1, padding: 24, paddingTop: 18, backgroundColor: '#111111', borderTopLeftRadius: 34, borderTopRightRadius: 34 }, back: { width: 44, height: 44, justifyContent: 'center' },
  editPhone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 }, sentPhone: { color: '#FFFFFF', fontSize: 19, fontWeight: '600' },
  codeEntry: { marginVertical: 24, height: 62 }, hiddenInput: { ...StyleSheet.absoluteFillObject, color: 'transparent', backgroundColor: 'transparent', fontSize: 20, borderWidth: 0, padding: 0 },
  demoCode: { color: '#AAAAAA', textAlign: 'center', fontSize: 13, marginBottom: 17 }, resend: { alignItems: 'center', paddingVertical: 12, marginTop: 6 }, resendText: { fontSize: 14, color: '#FFFFFF', textAlign: 'center' },
});
