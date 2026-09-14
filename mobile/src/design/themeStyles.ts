import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from './theme';

const accentColors = new Set(['#087FFF', '#0067D9', '#246BFD', '#1B75E6', '#0567D6', '#EAF3FF']);
const inkColors = new Set(['#101D38', '#111318', '#142440', '#122640', '#202A3B', '#293448', '#0B1832', '#070D16']);
const mutedColors = new Set(['#7A8CA8', '#63718D', '#78859C', '#72819B', '#8391A7', '#95A5BD', '#AEBED2']);
const paleColors = new Set(['#F0F2F5', '#F1F2F4', '#F2F7FC', '#F3F7FF', '#F1F7FD', '#F4F5F7', '#F7F8FA', '#F8FBFF', '#EFF6FD', '#EAF3FF', '#EAF0F8', '#E8F3FF', '#E1EFFF', '#F4F8FD']);

function darkColor(value: string, property: string, styleName: string, palette: ReturnType<typeof useTheme>['palette']): string {
  const color = value.toUpperCase();
  if (color === 'TRANSPARENT' || color.startsWith('RGBA(')) return value;
  if (property === 'shadowColor') return '#000000';
  if (property === 'textShadowColor') return palette.background;
  if (property.toLowerCase().includes('border') && property.toLowerCase().includes('color')) return palette.line;
  if (property === 'backgroundColor') {
    if (accentColors.has(color) && !paleColors.has(color)) return palette.accent;
    if (color === 'WHITE' || color === '#FFFFFF') return palette.surface;
    if (paleColors.has(color) || color.startsWith('#F') || color.startsWith('#E')) return palette.elevated;
    if (inkColors.has(color) || color === 'BLACK' || color === '#000000') return palette.elevated;
    return value;
  }
  if (property === 'color' || property === 'placeholderTextColor') {
    if (color === 'WHITE' || color === '#FFFFFF') {
      return /(?:button|primary|action|slider|active|selected|submit)/i.test(styleName) ? palette.accentText : '#FFFFFF';
    }
    if (accentColors.has(color)) return palette.accent;
    if (inkColors.has(color) || color === 'BLACK' || color === '#000000') return palette.ink;
    if (mutedColors.has(color)) return palette.muted;
    if (color.startsWith('#1') || color.startsWith('#2') || color.startsWith('#3')) return palette.ink;
    if (color.startsWith('#6') || color.startsWith('#7') || color.startsWith('#8') || color.startsWith('#9')) return palette.muted;
  }
  return value;
}

/** Preserves the existing light styles and recolors static StyleSheet entries on theme changes. */
export function useThemeStyles<T extends Record<string, any>>(base: T): T {
  const { isDark, palette } = useTheme();
  return useMemo(() => {
    if (!isDark) return base;
    return Object.fromEntries(Object.entries(base).map(([styleName, entry]) => {
      const flat = StyleSheet.flatten(entry) || {};
      return [styleName, Object.fromEntries(Object.entries(flat).map(([property, value]) =>
        [property, typeof value === 'string' && property.toLowerCase().includes('color')
          ? darkColor(value, property, styleName, palette) : value],
      ))];
    })) as T;
  }, [base, isDark, palette]);
}
