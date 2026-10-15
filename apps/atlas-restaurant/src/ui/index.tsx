import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch as NativeSwitch,
  Text as NativeText,
  TextInput,
  View,
  type ImageStyle,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localPhotos } from './photos';
/** React Native Web uses a separate active thumb property. Keep the Atlas knob white. */
export function Switch(props: React.ComponentProps<typeof NativeSwitch>) {
  return (
    <NativeSwitch
      {...props}
      {...(Platform.OS === 'web'
        ? { activeThumbColor: props.thumbColor || '#FFFFFF' }
        : {})}
    />
  );
}
const { resolveApiUrl } = require('../../config/api.cjs');
export const tokens = {
  blue: '#087FFF',
  blueSoft: '#E8F2FF',
  ink: '#111318',
  muted: '#737B87',
  canvas: '#F7F7F5',
  surface: '#F1F1EF',
  white: '#FFFFFF',
  line: '#E7E7E3',
  danger: '#C74747',
  coral: '#FF5B4D',
  green: '#169B62',
  greenSoft: '#E9F7F0',
};
export const styles = StyleSheet.create({
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: tokens.ink,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    color: tokens.ink,
  },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.4,
    color: tokens.ink,
  },
  caption: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: tokens.muted,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
    color: tokens.ink,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: {
    backgroundColor: tokens.white,
    borderRadius: 24,
    padding: 20,
    gap: 14,
  },
  page: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 20,
  },
});
export function Text({
  variant = 'body',
  style,
  ...props
}: TextProps & {
  variant?: 'body' | 'title' | 'heading' | 'caption' | 'label';
}) {
  return <NativeText {...props} style={[styles[variant], style]} />;
}
export function Row({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, style]}>{children}</View>;
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      {children}
    </ScrollView>
  );
}
export function SectionTitle({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant="heading" style={{ flex: 1 }}>
        {title}
      </Text>
      {action && onPress && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text variant="label" style={{ color: tokens.blue }}>
            {action}
          </Text>
        </Pressable>
      )}
    </Row>
  );
}
export function Button({
  title,
  onPress,
  busy,
  disabled,
  secondary,
  danger,
  icon,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: 18,
        paddingVertical: 13,
        paddingHorizontal: 18,
        backgroundColor: danger
          ? '#FFF0EC'
          : secondary
            ? tokens.surface
            : tokens.blue,
        opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1,
        flexDirection: 'row',
        gap: 9,
        justifyContent: 'center',
        alignItems: 'center',
      })}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={19}
          color={secondary ? tokens.ink : 'white'}
        />
      )}
      <Text
        variant="label"
        style={{
          color: danger ? tokens.danger : secondary ? tokens.ink : 'white',
          textAlign: 'center',
        }}
      >
        {busy ? 'Подождите…' : title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  numeric,
  secure,
  multiline,
  editable = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  secure?: boolean;
  multiline?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={tokens.muted}
        secureTextEntry={secure}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        autoCapitalize={secure ? 'none' : 'sentences'}
        autoCorrect={!secure}
        multiline={multiline}
        editable={editable}
        style={[
          styles.body,
          {
            backgroundColor: tokens.surface,
            borderRadius: 16,
            padding: 15,
            minHeight: multiline ? 94 : 52,
            textAlignVertical: multiline ? 'top' : 'center',
            opacity: editable ? 1 : 0.6,
          },
        ]}
      />
    </View>
  );
}
export function Chip({
  title,
  active,
  onPress,
}: {
  title: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 17,
        paddingVertical: 12,
        minHeight: 44,
        borderRadius: 25,
        backgroundColor: active ? tokens.ink : tokens.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant="label" style={{ color: active ? 'white' : tokens.ink }}>
        {title}
      </Text>
    </Pressable>
  );
}
export function SwitchRow({
  title,
  subtitle,
  value,
  onChange,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row style={{ minHeight: 52 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="label">{title}</Text>
        {subtitle && <Text variant="caption">{subtitle}</Text>}
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#D5D8DC', true: tokens.blue }}
        thumbColor="white"
      />
    </Row>
  );
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => sub.remove();
  }, []);
  return reduced;
}
export function Sheet({
  title,
  children,
  onClose,
  visible = true,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  visible?: boolean;
  busy?: boolean;
}) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'fade' : 'slide'}
      onRequestClose={() => !busy && onClose()}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: '#11131866',
        }}
      >
        <Pressable
          accessibilityLabel="Закрыть окно"
          onPress={() => !busy && onClose()}
          style={{ flex: 1 }}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: '92%',
            width: '100%',
            maxWidth: 680,
            alignSelf: 'center',
            backgroundColor: tokens.white,
            borderTopLeftRadius: 30,
            borderTopRightRadius: 30,
            paddingBottom: insets.bottom,
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              backgroundColor: tokens.line,
              borderRadius: 4,
              alignSelf: 'center',
              marginTop: 10,
            }}
          />
          <Row
            style={{ paddingHorizontal: 22, paddingTop: 9, paddingBottom: 10 }}
          >
            <Text variant="heading" style={{ flex: 1 }}>
              {title}
            </Text>
            <Pressable
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              onPress={onClose}
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tokens.surface,
                borderRadius: 22,
              }}
            >
              <Ionicons name="close" size={22} />
            </Pressable>
          </Row>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingBottom: 28,
              gap: 18,
            }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function Empty({
  title,
  body,
  icon = 'restaurant-outline',
}: {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View
      style={{
        paddingVertical: 34,
        paddingHorizontal: 14,
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View
        style={{
          width: 70,
          height: 70,
          backgroundColor: tokens.blueSoft,
          borderRadius: 25,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Ionicons name={icon} size={30} color={tokens.blue} />
      </View>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="caption" style={{ textAlign: 'center', maxWidth: 360 }}>
        {body}
      </Text>
    </View>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error?: string | null;
  retry?: () => void;
}) {
  return error ? (
    <Card style={{ backgroundColor: '#FFF0EC' }}>
      <Text accessibilityRole="alert" style={{ color: tokens.danger }}>
        {error}
      </Text>
      {retry && <Button secondary title="Повторить" onPress={retry} />}
    </Card>
  ) : null;
}
export function Skeleton() {
  const opacity = useRef(new Animated.Value(0.45)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View accessibilityLabel="Загрузка" style={{ opacity, gap: 14 }}>
      {[150, 70, 110].map((height, i) => (
        <View
          key={i}
          style={{ height, borderRadius: 24, backgroundColor: '#E7E7E3' }}
        />
      ))}
    </Animated.View>
  );
}
export function Photo({
  uri,
  imageUrl,
  imageKey,
  style,
  label,
}: {
  uri?: string | null;
  imageUrl?: string | null;
  imageKey?: string | null;
  style?: StyleProp<ImageStyle>;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const value = (uri || imageUrl)?.trim();
  useEffect(() => setFailed(false), [value, imageKey]);
  const remote = value?.startsWith('/api/content/media/')
    ? `${new URL(resolveApiUrl(process.env.EXPO_PUBLIC_API_URL)).origin}${value}`
    : value && /^(https?:|blob:|file:|data:)/.test(value)
      ? value
      : undefined;
  const source = remote || localPhotos[imageKey || ''];
  if (!source || failed)
    return (
      <View
        accessibilityLabel={label || 'Фотография не добавлена'}
        style={[
          {
            backgroundColor: tokens.surface,
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
          },
          style,
        ]}
      >
        <Ionicons name="restaurant-outline" size={28} color={tokens.muted} />
      </View>
    );
  return (
    <Image
      accessibilityLabel={label}
      source={source}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={remote || imageKey || ''}
      transition={reduced ? 0 : 160}
      onError={() => setFailed(true)}
    />
  );
}
