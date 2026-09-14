import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { readThemePreference, writeThemePreference } from './themeStore';
import type { ThemePreference } from './themeStore';

export type { ThemePreference } from './themeStore';
export type ResolvedTheme = 'light' | 'dark';

export const themePalettes = {
  light: {
    background: '#F4F8FD',
    surface: '#FFFFFF',
    elevated: '#F3F7FF',
    ink: '#101D38',
    muted: '#63718D',
    line: '#E5EDF6',
    accent: '#087FFF',
    accentText: '#FFFFFF',
    backdrop: 'rgba(16,29,56,.42)',
  },
  dark: {
    background: '#050505',
    surface: '#111111',
    elevated: '#1D1D1D',
    ink: '#FFFFFF',
    muted: '#B0B0B0',
    line: '#353535',
    accent: '#FFFFFF',
    accentText: '#050505',
    backdrop: 'rgba(0,0,0,.68)',
  },
} as const;

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
  resolved: ResolvedTheme;
  isDark: boolean;
  palette: typeof themePalettes[ResolvedTheme];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const lightFallback: ThemeContextValue = {
  preference: 'system',
  setPreference: () => undefined,
  resolved: 'light',
  isDark: false,
  palette: themePalettes.light,
};

export function resolveTheme(preference: ThemePreference, systemScheme: string | null | undefined): ResolvedTheme {
  return preference === 'system' ? systemScheme === 'dark' ? 'dark' : 'light' : preference;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [hydrated, setHydrated] = useState(false);
  const changedManually = useRef(false);

  useEffect(() => {
    let mounted = true;
    void readThemePreference()
      .then(value => { if (mounted && !changedManually.current) setPreferenceState(value); })
      .finally(() => { if (mounted) setHydrated(true); });
    return () => { mounted = false; };
  }, []);

  const setPreference = useCallback((value: ThemePreference) => {
    changedManually.current = true;
    setPreferenceState(value);
    void writeThemePreference(value).catch(() => undefined);
  }, []);
  const resolved = resolveTheme(preference, systemScheme);
  const context = useMemo<ThemeContextValue>(() => ({
    preference,
    setPreference,
    resolved,
    isDark: resolved === 'dark',
    palette: themePalettes[resolved],
  }), [preference, setPreference, resolved]);
  return <ThemeContext.Provider value={context}>
    {hydrated ? children : <View style={{ flex: 1, backgroundColor: context.palette.background }} />}
  </ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) || lightFallback;
}
