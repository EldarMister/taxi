import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api, messageOf } from './api';
import { Icon, s, tr } from './ui';
import type { Language, Session } from './types';
import { CodeCells, useReducedMotion } from './auth/AuthMotion';
import { readSelectedLanguage, writeSelectedLanguage } from './auth/languageStore';
import { useAuthDesign } from './auth/design';
import { fonts } from './design/typography';

type CodeResponse = { retryAfterSeconds?: number; channel?: 'whatsapp' | 'sms' | 'development'; development?: boolean; developmentCode?: string };

export function AuthScreen({ onLogin }: { onLogin: (session: Session, language: Language) => Promise<void> }) {
  const { isDark, palette } = useAuthDesign();
  const a = useAuthStyles();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = Math.max(.78, Math.min(1.15, screenWidth / 426));
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
  const [deliveryChannel, setDeliveryChannel] = useState<CodeResponse['channel']>('sms');
  const [retryAt, setRetryAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [codeFocused, setCodeFocused] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const cancelHandoff = useRef<(() => void) | null>(null);
  const codeRevision = useRef(0);
  const attemptedCodeRevision = useRef(-1);
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const continueButton = useRef<View>(null);
  const scrollOffset = useRef(0);
  const keyboardHost = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const keyboardMeasurement = useRef(0);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
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
  const measureKeyboardOverlap = useCallback(() => {
    if (Platform.OS !== 'android' || keyboardTop.current === null) return;
    const top = keyboardTop.current;
    const measurement = ++keyboardMeasurement.current;
    keyboardHost.current?.measure((_, __, ___, height, ____, pageY) => {
      if (keyboardTop.current !== top || keyboardMeasurement.current !== measurement) return;
      const overlap = Math.min(Math.max(0, height - 100), Math.max(0, pageY + height - top));
      setKeyboardOverlap(current => Math.abs(current - overlap) > 1 ? overlap : current);
    });
  }, []);
  function keepContinueVisible() {
    if (step !== 'phone' || keyboardTop.current === null) return;
    const top = keyboardTop.current;
    continueButton.current?.measure((_, __, ___, height, ____, pageY) => {
      if (keyboardTop.current !== top) return;
      const overlap = pageY + height + 16 - top;
      if (overlap > 0) scroll.current?.scrollTo({ y: scrollOffset.current + overlap, animated: true });
    });
  }
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event => {
      keyboardTop.current = event.endCoordinates.screenY;
      measureKeyboardOverlap();
      keepContinueVisible();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      ++keyboardMeasurement.current;
      setKeyboardOverlap(0);
    });
    return () => { shown.remove(); hidden.remove(); keyboardTop.current = null; ++keyboardMeasurement.current; };
  }, [step, measureKeyboardOverlap]);
  useEffect(() => {
    scrollOffset.current = 0;
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

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
      setDeliveryChannel(result.channel ?? 'sms');
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
    const digits = value.replace(/\D/g, '');
    // A full clipboard code replaces an already entered prefix.
    const pastedCode = code.length > 0 && digits.length === code.length + 6 && digits.startsWith(code);
    const next = pastedCode ? digits.slice(-6) : digits.slice(0, 6);
    if (next === code) return;
    setError(''); setVerified(false); ++codeRevision.current; setCode(next);
  }
  useEffect(() => {
    if (step === 'code' && code.length === 6 && !busy && !verified) void login(code, codeRevision.current);
  }, [step, code, busy, verified]);

  return (
    <SafeAreaView style={a.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={palette.background} />
      <View ref={keyboardHost} testID="auth-keyboard-host" onLayout={measureKeyboardOverlap} style={a.fill}>
      <KeyboardAvoidingView style={[a.fill, { paddingBottom: keyboardOverlap }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} onLayout={keepContinueVisible} onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} style={a.fill} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false} contentContainerStyle={[a.content, { minHeight: screenHeight - insets.top - insets.bottom }]}>
          {step === 'phone' ? (
            <>
              <View style={[a.hero, { paddingTop: Math.max(24, screenHeight * .153 - insets.top), paddingBottom: Math.max(24, Math.min(64, (screenHeight - 640) * .14 + 24)) * scale }]}>
                <Image source={isDark ? require('../assets/logo dark.png') : require('../assets/logo light.png')} resizeMode="contain" accessibilityLabel="ATLAS" style={a.logo} />
                <Text style={a.title}>{t('Вход в приложение')}</Text>
                <Text style={a.subtitle}>{t('Быстрые и безопасные поездки\nвсегда рядом')}</Text>
              </View>
              <View style={a.form}>
                <View style={a.field}>
                  <Icon name="call-outline" size={26 * scale} color={palette.ink} />
                  <View style={a.fill}>
                    <Text style={a.fieldLabel}>{t('Номер телефона')}</Text>
                    <View style={[s.row, { gap: 7 }]}>
                      <Text style={a.phonePrefix}>+996</Text>
                      <TextInput testID="auth-phone" accessibilityLabel={t('Номер телефона')} keyboardType="phone-pad" keyboardAppearance={isDark ? 'dark' : 'light'} textContentType="telephoneNumber" autoComplete="tel-national" editable={!busy} value={displayPhone(phone)} onChangeText={value => {
                        let digits = value.replace(/\D/g, '');
                        if (digits.startsWith('996') && digits.length > 9) digits = digits.slice(3);
                        setPhone(digits.slice(0, 9)); setError('');
                      }} placeholder="700 123 456" placeholderTextColor={palette.muted} selectionColor={palette.accent} style={a.phoneInput} maxLength={32} onSubmitEditing={() => void send()} />
                    </View>
                  </View>
                </View>
                {error ? <Text accessibilityRole="alert" style={a.error}>{t(error)}</Text> : null}
                <Pressable ref={continueButton} testID="auth-continue" accessibilityRole="button" accessibilityState={{ disabled: phone.length !== 9 || busy, busy }} disabled={phone.length !== 9 || busy} onPress={() => void send()} style={[a.continueButton, phone.length === 9 && a.continueActive]}>
                  {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={[a.continueText, phone.length === 9 && a.continueTextActive]}>{t('Продолжить')}</Text>}
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
              <Pressable accessibilityRole="button" accessibilityLabel={t('Назад')} onPress={back} style={a.back}><Icon name="arrow-back" size={26 * scale} color={palette.ink} /></Pressable>
              <Text style={[a.title, a.codeTitle]}>{text('Введите код', 'Кодду киргизиңиз', 'Enter the code')}</Text>
              <Text style={a.subtitle}>{developmentCode ? text('Тестовый вход для номера', 'Номер үчүн сыноо кирүүсү', 'Test sign in for') : deliveryChannel === 'whatsapp' ? text('Код отправлен в WhatsApp на номер', 'Бул номерге WhatsApp аркылуу код жөнөтүлдү', 'Code sent via WhatsApp to') : text('Отправили SMS на номер', 'Бул номерге SMS жөнөтүлдү', 'We sent an SMS to')}</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={back} style={a.editPhone}>
                <Text style={a.sentPhone}>{`+996 ${displayPhone(sentPhone.slice(4))}`}</Text>
              </Pressable>
              <Pressable onPress={() => input.current?.focus()} style={a.codeEntry}>
                <CodeCells code={code} focused={codeFocused} error={error} verified={verified} reducedMotion={reducedMotion} />
                <TextInput ref={input} testID="auth-code" accessibilityLabel={text('Код подтверждения', 'Ырастоо коду', 'Verification code')} accessibilityHint={text('Шесть цифр. Код проверится автоматически.', 'Алты сан. Код автоматтык түрдө текшерилет.', 'Six digits. The code will be checked automatically.')} value={code} editable={!busy} onChangeText={changeCode} onFocus={() => setCodeFocused(true)} onBlur={() => setCodeFocused(false)} keyboardType="number-pad" keyboardAppearance={isDark ? 'dark' : 'light'} textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={32} caretHidden autoFocus underlineColorAndroid="transparent" selectionColor="transparent" selection={error ? { start: 0, end: code.length } : { start: code.length, end: code.length }} style={a.hiddenInput} onSubmitEditing={() => void login()} />
              </Pressable>
              {error ? <Text accessibilityRole="alert" style={a.error}>{t(error)}</Text> : null}
              {developmentCode ? <Text style={a.demoCode}>{text('Тестовый код', 'Сыноо коду', 'Test code')}: {developmentCode}</Text> : null}
              <Pressable accessibilityRole="button" disabled={busy || secondsLeft > 0} onPress={() => void send()} style={[a.resend, a.resendFirst]}>
                <Text style={[a.resendText, secondsLeft > 0 && { color: palette.muted }]}>{secondsLeft > 0 ? text(`Отправить код ещё раз через ${secondsLeft} с`, `Кодду ${secondsLeft} сек кийин кайра жөнөтүү`, `Resend code in ${secondsLeft}s`) : t('Отправить ещё раз')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={back} disabled={busy} style={a.resend}><Text style={a.resendText}>{text('Изменить номер телефона', 'Телефон номерин өзгөртүү', 'Change phone number')}</Text></Pressable>
              <View style={a.formSpacer} />
              <View ref={languageSelector} collapsable={false} style={a.selectorAnchor}><LanguageSelector language={language} expanded={languageMenu} onPress={openLanguageMenu} /></View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      </View>
      <Modal visible={languageMenu} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setLanguageMenu(false)}>
        <View style={a.menuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLanguageMenu(false)} accessibilityLabel={text('Закрыть выбор языка', 'Тил тандоону жабуу', 'Close language menu')} />
          <View style={[a.menu, { left: languageAnchor.x, width: languageAnchor.width, top: Math.max(insets.top + 8, languageAnchor.y + (Platform.OS === 'android' ? insets.top : 0) - 172) }]}>
            {(['ru', 'ky', 'en'] as Language[]).map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: language === item }} onPress={() => selectLanguage(item)} style={a.menuItem}>
              <Text style={[a.menuText, language === item && a.menuTextActive]}>{languageName(item)}</Text>
              {language === item ? <Icon name="checkmark" size={21} color={palette.accent} /> : null}
            </Pressable>)}
          </View>
          <View style={{ position: 'absolute', left: languageAnchor.x, top: languageAnchor.y + (Platform.OS === 'android' ? insets.top : 0), width: languageAnchor.width }}><LanguageSelector language={language} expanded onPress={() => setLanguageMenu(false)} /></View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LegalLinks({ language }: { language: Language }) {
  const a = useAuthStyles();
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;
  const en = language === 'en';
  const ky = language === 'ky';
  const unavailable = () => Alert.alert(en ? 'Document unavailable' : ky ? 'Документ азырынча жеткиликсиз' : 'Документ пока недоступен');
  return <View style={a.legal}>
    <Text style={a.legalIntro}>{en ? 'By tapping “Continue”, you agree\nwith our' : ky ? '«Улантуу» баскычын басуу менен\nсиз биздин шарттарга макул болосуз' : 'Нажимая «Продолжить», вы соглашаетесь\nс нашими'}</Text>
    <View style={[a.legalLinks, a.legalLinksInline, !en && !ky && a.legalLinksRussian]}>
      <Pressable accessibilityRole="link" style={a.legalLinkCompact} onPress={() => privacyUrl ? void Linking.openURL(privacyUrl) : unavailable()}><Text style={[a.privacy, !en && !ky && a.privacyRussian]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.85}>{en ? 'Privacy Policy' : ky ? 'Купуялык саясаты' : 'Политикой конфиденциальности'}</Text></Pressable>
      <Pressable accessibilityRole="link" style={a.legalLinkCompact} onPress={() => termsUrl ? void Linking.openURL(termsUrl) : unavailable()}><Text style={[a.privacy, !en && !ky && a.privacyRussian]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.85}>{en ? 'Terms of Use' : ky ? 'Колдонуу шарттары' : 'Условиями использования'}</Text></Pressable>
    </View>
  </View>;
}

function languageName(language: Language) { return language === 'ky' ? 'Кыргызский' : language === 'en' ? 'English' : 'Русский'; }
function LanguageSelector({ language, expanded, onPress }: { language: Language; expanded: boolean; onPress: () => void }) {
  const { palette } = useAuthDesign();
  const a = useAuthStyles();
  return <Pressable testID="auth-language-selector" accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={a.languageSelector}>
    <Icon name="globe-outline" size={23} color={palette.ink} />
    <Text style={a.selectedLanguage}>{languageName(language)}</Text>
    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={palette.ink} />
  </Pressable>;
}

function useAuthStyles() {
  const { isDark, palette } = useAuthDesign();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = Math.max(.78, Math.min(1.15, width / 426));
  return useMemo(() => StyleSheet.create({
    fill: { flex: 1 }, screen: { flex: 1, backgroundColor: palette.background },
    content: { flexGrow: 1, backgroundColor: palette.background },
    hero: { alignItems: 'center', paddingHorizontal: 20 * scale, paddingBottom: 64 * scale },
    logo: { width: 214 * scale, height: (214 / 3) * scale },
    title: { color: palette.ink, fontFamily: fonts.bold, fontSize: 26 * scale, lineHeight: 34 * scale, letterSpacing: -.7, textAlign: 'center', marginTop: 22 * scale },
    subtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 16 * scale, lineHeight: 22 * scale, textAlign: 'center', marginTop: 12 * scale },
    form: { flexGrow: 1, paddingLeft: Math.max(insets.left, 20 * scale), paddingRight: Math.max(insets.right, 20 * scale), paddingBottom: 18 * scale },
    field: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, borderRadius: 12 * scale, minHeight: 70 * scale, paddingHorizontal: 18 * scale, paddingVertical: 10 * scale, flexDirection: 'row', gap: 18 * scale, alignItems: 'center' },
    fieldLabel: { fontFamily: fonts.regular, fontSize: 12.5 * scale, lineHeight: 18 * scale, color: palette.muted, marginBottom: 4 * scale },
    phonePrefix: { fontFamily: fonts.medium, fontSize: 19 * scale, color: palette.ink },
    phoneInput: { flex: 1, fontFamily: fonts.regular, color: palette.ink, fontSize: 19 * scale, paddingVertical: 0 },
    error: { color: isDark ? '#FF8888' : '#CA4149', fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 10 },
    continueButton: { minHeight: 52 * scale, marginTop: 18 * scale, borderRadius: 11 * scale, backgroundColor: isDark ? '#353535' : '#E4E7ED', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    continueActive: { backgroundColor: palette.accent },
    continueText: { fontFamily: fonts.semibold, fontSize: 16 * scale, color: palette.muted },
    continueTextActive: { color: palette.accentText },
    footnote: { fontFamily: fonts.regular, fontSize: 13 * scale, color: palette.muted, textAlign: 'center', lineHeight: 19 * scale, marginTop: 14 * scale },
    formSpacer: { flexGrow: 1, minHeight: 24 * scale },
    legal: { alignItems: 'center', gap: 10 * scale },
    legalIntro: { fontFamily: fonts.regular, color: palette.muted, fontSize: 13 * scale, textAlign: 'center', lineHeight: 19 * scale },
    legalLinks: { alignItems: 'center' }, legalLinksInline: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', gap: 16 * scale }, legalLinkCompact: { flexShrink: 1, minHeight: 32, justifyContent: 'center' },
    legalLinksRussian: { gap: 14 * scale }, privacyRussian: { fontSize: 12 * scale, lineHeight: 18 * scale },
    privacy: { fontFamily: fonts.regular, color: palette.ink, textDecorationLine: 'underline', fontSize: 14 * scale, textAlign: 'center', lineHeight: 21 * scale },
    selectorAnchor: { alignSelf: 'center', marginTop: 24 * scale, minWidth: 146 * scale },
    languageSelector: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 * scale },
    selectedLanguage: { fontFamily: fonts.medium, color: palette.ink, fontSize: 15 * scale },
    menuOverlay: { flex: 1 }, menu: { position: 'absolute', backgroundColor: palette.elevated, borderColor: palette.line, borderWidth: 1, borderRadius: 12, paddingVertical: 4, overflow: 'hidden' },
    menuItem: { minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, menuText: { fontFamily: fonts.regular, color: palette.muted, fontSize: 14 }, menuTextActive: { fontFamily: fonts.semibold, color: palette.ink },
    codeScreen: { flexGrow: 1, paddingLeft: Math.max(insets.left, 20 * scale), paddingRight: Math.max(insets.right, 20 * scale), paddingTop: 12 * scale, paddingBottom: 34 * scale, backgroundColor: palette.surface },
    back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 30 * scale },
    codeTitle: { marginTop: 0 },
    editPhone: { alignItems: 'center', paddingTop: 14 * scale },
    sentPhone: { color: palette.ink, fontFamily: fonts.bold, fontSize: 19 * scale, lineHeight: 26 * scale },
    codeEntry: { marginTop: 36 * scale, height: 64 * scale },
    hiddenInput: { ...StyleSheet.absoluteFillObject, color: 'transparent', backgroundColor: 'transparent', fontSize: 20, borderWidth: 0, padding: 0 },
    demoCode: { fontFamily: fonts.regular, color: palette.muted, textAlign: 'center', fontSize: 13 * scale, lineHeight: 20 * scale, marginTop: 22 * scale },
    resend: { alignItems: 'center', minHeight: 44, justifyContent: 'center', paddingVertical: 10 * scale, marginTop: 6 * scale },
    resendFirst: { marginTop: 18 * scale },
    resendText: { fontFamily: fonts.regular, fontSize: 14 * scale, lineHeight: 22 * scale, color: palette.ink, textAlign: 'center' },
  }), [isDark, palette, scale, insets.left, insets.right]);
}
