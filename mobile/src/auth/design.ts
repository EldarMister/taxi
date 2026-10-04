import { useMemo } from 'react';
import { useTheme } from '../design/theme';

// Screen-local colors keep the rest of the application on its existing theme.
export function useAuthDesign() {
  const { isDark, palette } = useTheme();
  return useMemo(() => ({ isDark, palette: isDark ? palette : { ...palette,
    background: '#FBFBFD', surface: '#FBFBFD', elevated: '#F4F5F8',
    ink: '#1E2028', muted: '#737B8C', line: '#E2E4EC', accent: '#3478F6', accentText: '#FFFFFF',
  } }), [isDark, palette]);
}
