import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../data/api';
import type { Session } from '../domain/types';
import { ErrorNotice, Text } from '../ui';
import { AtlasLogo } from '../ui/AtlasLogo';
import { useCommand } from './hooks';

const palette = {
  background: '#FAFBFE',
  ink: '#10151D',
  muted: '#7C8594',
  border: '#DDE2EB',
  blue: '#2D79F4',
};

export function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [phone, setPhone] = useState('+996');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'phone' | 'password' | null>(null);
  const passwordInput = useRef<TextInput>(null);
  const command = useCommand();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = Math.max(0.9, Math.min(1.08, Math.min(width, 480) / 393));
  const canSubmit = !!phone.trim() && !!password && !command.busy;
  const submit = () => {
    if (!canSubmit) return;
    void command.run(async () => {
      onLogin(await api.login(phone.trim(), password));
    });
  };
  const inputStyle = [styles.input, { fontSize: 19 * scale, lineHeight: 25 * scale }];
  const labelStyle = [styles.label, { fontSize: 12 * scale, lineHeight: 18 * scale }];
  const fieldStyle = [
    styles.field,
    { minHeight: Math.max(64, 65 * scale), paddingHorizontal: 16 * scale, gap: 18 * scale },
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: 20 * scale, paddingBottom: 32 * scale },
          ]}
        >
          <View
            style={[
              styles.hero,
              {
                paddingTop: Math.max(28, Math.min(160, height * 0.153 - insets.top)),
              },
            ]}
          >
            <AtlasLogo width={200 * scale} />
            <Text
              style={[
                styles.title,
                { fontSize: 25 * scale, lineHeight: 32 * scale, marginTop: 18 * scale },
              ]}
            >
              Вход в ресторан
            </Text>
            <Text
              style={[
                styles.subtitle,
                { fontSize: 15 * scale, lineHeight: 21 * scale, marginTop: 12 * scale },
              ]}
            >
              Заказы, меню и команда{'\n'}вашего ресторана
            </Text>
          </View>

          <View style={{ marginTop: 46 * scale, gap: 18 * scale }}>
            <View style={[fieldStyle, focused === 'phone' && styles.focused]}>
              <Ionicons name="call-outline" size={24 * scale} color={palette.ink} />
              <View style={styles.fieldContent}>
                <Text style={labelStyle}>Номер телефона</Text>
                <TextInput
                  accessibilityLabel="Телефон"
                  testID="restaurant-login-phone"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!command.busy}
                  placeholder="+996 000 000 000"
                  placeholderTextColor={palette.muted}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInput.current?.focus()}
                  onFocus={() => setFocused('phone')}
                  onBlur={() => setFocused(null)}
                  style={inputStyle}
                />
              </View>
            </View>

            <View style={[fieldStyle, focused === 'password' && styles.focused]}>
              <Ionicons name="lock-closed-outline" size={24 * scale} color={palette.ink} />
              <View style={styles.fieldContent}>
                <Text style={labelStyle}>Пароль</Text>
                <TextInput
                  ref={passwordInput}
                  accessibilityLabel="Пароль"
                  testID="restaurant-login-password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!command.busy}
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  style={inputStyle}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                disabled={command.busy}
                onPress={() => setShowPassword((value) => !value)}
                style={styles.passwordToggle}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={25 * scale}
                  color={palette.muted}
                />
              </Pressable>
            </View>

            <ErrorNotice error={command.error} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Войти"
              accessibilityState={{ disabled: !canSubmit, busy: command.busy }}
              disabled={!canSubmit}
              onPress={submit}
              style={({ pressed }) => [
                styles.submit,
                {
                  minHeight: Math.max(50, 50 * scale),
                  marginTop: 2 * scale,
                  opacity: canSubmit ? (pressed ? 0.85 : 1) : 0.55,
                },
              ]}
            >
              {command.busy ? (
                <ActivityIndicator color="white" accessibilityLabel="Выполняется вход" />
              ) : (
                <Text style={[styles.submitText, { fontSize: 17 * scale }]}>Войти</Text>
              )}
            </Pressable>
          </View>

          <View style={{ marginTop: 26 * scale, gap: 3 * scale }}>
            {[
              'Владельца регистрирует администратор Atlas.',
              'Доступ менеджеру выдаёт владелец ресторана.',
              'Если забыли пароль, обратитесь к тому, кто выдал доступ.',
            ].map((line) => (
              <Text
                key={line}
                style={[styles.help, { fontSize: 11 * scale, lineHeight: 17 * scale }]}
              >
                {line}
              </Text>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: palette.background },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  hero: { alignItems: 'center' },
  title: {
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.7,
    color: palette.ink,
    textAlign: 'center',
  },
  subtitle: { color: palette.muted, textAlign: 'center' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingVertical: 8,
  },
  focused: { borderColor: palette.blue },
  fieldContent: { flex: 1, minWidth: 0 },
  label: { color: palette.muted, marginBottom: 2 },
  input: {
    fontFamily: 'Inter_400Regular',
    color: palette.ink,
    padding: 0,
    margin: 0,
    minHeight: 25,
    includeFontPadding: false,
  },
  passwordToggle: {
    minWidth: 44,
    minHeight: 44,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit: {
    backgroundColor: palette.blue,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontFamily: 'Inter_600SemiBold', color: 'white', lineHeight: 24 },
  help: { color: palette.muted, textAlign: 'center' },
});
