import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../design/theme';
import { palette } from '../design/tokens';

// Keep the original styles as the light theme. Map their semantic colours when
// a food screen renders so cached catalog pages update without losing state.
const asHex = (value: string) => value.toUpperCase();
const pale = new Set([
  '#FFFFFF', '#F7F7F5', '#F2F9FF', '#F1F1EF', '#F1F7FD', '#F3F7FF',
  '#F2F7FD', '#F5F8FD', '#F2F9FF', '#F8FBFF', '#E9F2FF', '#EAF4FF',
  '#F1F6FD', '#EAF1FB', '#E7F3FF', '#E1F0FF', '#E8F2FF', '#EEF6FF',
  '#EAF4FF', '#DDEEFF', '#F2F3F8', '#ECECE8', '#EEF4E8',
]);
const textDark = new Set([
  '#111318', '#3F4652', '#101D38', '#111B38', '#0B1832', '#070D16',
  '#142440', '#0A1730', '#192A48', '#152C23', '#202330',
]);
const textMuted = new Set([
  '#8A9099', '#7A8CA8', '#63718D', '#50678A', '#556179', '#6B737D',
  '#7183A4', '#94A0B7', '#3A5A7E', '#4D6380', '#356496', '#416A95',
]);
const accent = new Set(['#087FFF', '#0567D6', '#0067D9', '#1B75E6']);

function replaceColor(value: string, property: string, name: string, theme: ReturnType<typeof useTheme>['palette']): string {
  const color = asHex(value);
  if (color === 'TRANSPARENT' || color.startsWith('RGBA(')) return value;
  if (property === 'shadowColor') return '#000000';
  if (property.toLowerCase().includes('border')) return theme.line;
  if (property === 'backgroundColor') {
    if (accent.has(color) || color === '#111318' || color === '#101D38') return theme.accent;
    if (color === '#FF5B4D' || color === '#FF5B56' || color === '#E95757') return value;
    if (pale.has(color) || color === 'WHITE' || color === '#FFFFFFDC') {
      return /^(screen|content|restaurantSheet|dishSheet)$/.test(name) ? theme.background :
        /^(sectionCard|historyRow|cartRow|restaurantCardSurface|dishCard|footer|cartDock|activeOrder|search|banner|addressSheet)$/.test(name) ? theme.surface : theme.elevated;
    }
    if (color === '#C5D1DE' || color === '#BBBDBE') return theme.line;
    if (color.startsWith('#FFF') || color.startsWith('#EEF') || color.startsWith('#EAF') || color.startsWith('#DDE') || color.startsWith('#E1F')) return theme.elevated;
    return value;
  }
  if (property === 'color' || property === 'placeholderTextColor' || property === 'textShadowColor') {
    if (name === 'promoButtonText') return theme.accentText;
    if (color === '#B74747' || color === '#C74747') return '#FF8A8A';
    if (name === 'citySlogan') return theme.ink;
    if (accent.has(color)) return theme.accent;
    if (textDark.has(color)) return theme.ink;
    if (textMuted.has(color)) return theme.muted;
    if (color === '#FFFFFF' || color === 'WHITE') {
      return /^(buttonText|filterTextActive|menuTabActive|dishStepperCount|cartDockCountText)$/.test(name) ? theme.accentText : '#FFFFFF';
    }
    if (color === '#C8CBCF' || color === '#BBBDBE') return theme.muted;
  }
  return value;
}

export function useFoodStyles<T extends Record<string, any>>(base: T): T {
  const theme = useTheme();
  return useMemo(() => {
    if (!theme.isDark) return base;
    return Object.fromEntries(Object.entries(base).map(([name, entry]) => {
      const flattened = StyleSheet.flatten(entry) || {};
      return [name, Object.fromEntries(Object.entries(flattened).map(([property, value]) => [
        property, typeof value === 'string' && (property.toLowerCase().includes('color') || property === 'color')
          ? replaceColor(value, property, name, theme.palette) : value,
      ]))];
    })) as T;
  }, [base, theme.isDark, theme.palette]);
}

export function useFoodColors() {
  const theme = useTheme();
  return useMemo(() => theme.isDark ? {
    ink: theme.palette.ink,
    muted: theme.palette.muted,
    blue: theme.palette.accent,
    green: theme.palette.accent,
    line: theme.palette.line,
    surface: theme.palette.elevated,
    white: theme.palette.accentText,
  } : {
    ink: palette.ink,
    muted: palette.muted,
    blue: palette.blue,
    green: palette.green,
    line: palette.line,
    surface: palette.surface,
    white: palette.white,
  }, [theme.isDark, theme.palette]);
}
