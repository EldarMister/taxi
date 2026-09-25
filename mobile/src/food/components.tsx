import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SpringPressable } from '../design/motion';
import { palette, radii } from '../design/tokens';
import { fonts } from '../design/typography';
import { useTheme } from '../design/theme';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { useFoodT } from './i18n';

export const foodColors = {
  ink: palette.ink,
  muted: palette.muted,
  blue: palette.blue,
  green: palette.green,
  line: palette.line,
  surface: palette.surface,
  white: palette.white,
};

export const money = (amount: number) => `${amount.toLocaleString('ru-RU')} сом`;

export function FoodButton({ label, onPress, disabled, busy, secondary, style }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useFoodStyles(baseStyles);
  const foodColors = useFoodColors();
  return <SpringPressable
    accessibilityRole="button"
    accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
    onPress={onPress}
    disabled={disabled || busy}
    pressScale={.985}
    containerStyle={{ alignSelf: 'stretch' }}
    style={[s.button, secondary && s.secondaryButton, style]}
  >
    {busy && <ActivityIndicator color={secondary ? foodColors.blue : foodColors.white} />}
    <Text style={[s.buttonText, secondary && { color: foodColors.blue }]}>{label}</Text>
  </SpringPressable>;
}

export function FoodIconButton({ name, onPress, label, color, backgroundColor = 'transparent', size = 27, style, containerStyle, disabled, busy }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label: string;
  color?: string;
  backgroundColor?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  const foodColors = useFoodColors();
  const theme = useTheme();
  const unavailable = !!disabled || !!busy;
  const iconBackground = theme.isDark && backgroundColor === 'white' ? theme.palette.surface : backgroundColor;
  return <SpringPressable accessibilityRole="button" accessibilityLabel={t(label)} accessibilityHint={busy ? t('Дождитесь завершения оформления заказа') : undefined} accessibilityState={{ disabled: unavailable, busy: !!busy }} disabled={unavailable} onPress={onPress} hitSlop={6} pressScale={.9} containerStyle={containerStyle}
    style={[s.iconButton, { backgroundColor: iconBackground }, style]}>
    <Ionicons name={name} color={color === palette.ink ? foodColors.ink : color || foodColors.ink} size={size} />
  </SpringPressable>;
}

export function FoodFavoriteButton({ favorite, onPress, item }: { favorite: boolean; onPress: () => void; item: 'ресторан' | 'блюдо' }) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  return <SpringPressable accessibilityRole="button" accessibilityLabel={favorite ? `${t('Убрать из избранного')}: ${t(item)}` : `${t('Добавить в избранное')}: ${t(item)}`}
    accessibilityState={{ selected: favorite }} onPress={onPress} hitSlop={8} pressScale={.9} style={s.favoriteButton}>
    <Ionicons name={favorite ? 'heart' : 'heart-outline'} color="#FFFFFF" size={28} />
  </SpringPressable>;
}

export function FoodHeader({ title, onBack, right, backDisabled, backBusy }: { title: string; onBack: () => void; right?: React.ReactNode; backDisabled?: boolean; backBusy?: boolean }) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  return <View style={s.header}>
    <FoodIconButton name="chevron-back" label={backBusy ? t('Назад недоступно: заказ оформляется') : t('Назад')} onPress={onBack} disabled={backDisabled} busy={backBusy} size={30} />
    <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
    <View style={s.headerRight}>{right}</View>
  </View>;
}

const baseStyles = StyleSheet.create({
  button: { minHeight: 58, backgroundColor: foodColors.blue, borderRadius: radii.medium, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', gap: 8, shadowColor: palette.blueDark, shadowOpacity: .12, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 2 },
  secondaryButton: { backgroundColor: palette.blueSoft, shadowOpacity: 0, elevation: 0 },
  buttonText: { color: foodColors.white, fontFamily: fonts.bold, fontSize: 17, lineHeight: 23, textAlign: 'center' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  favoriteButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(35,39,45,.52)', borderWidth: 1, borderColor: 'rgba(255,255,255,.35)' },
  header: { height: 64, marginHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { flex: 1, textAlign: 'center', color: foodColors.ink, fontFamily: fonts.bold, fontSize: 21, letterSpacing: -.55, paddingHorizontal: 3 },
  headerRight: { width: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
});
