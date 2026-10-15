import { useTheme } from '../design/theme';
export const onboardingLight = { background: '#FBFBFD', surface: '#FFFFFF', ink: '#1E2028', muted: '#737B8C', line: '#DDE1EA', accent: '#3478F6', accentText: '#FFFFFF', elevated: '#F7F8FA', backdrop: 'rgba(15,18,24,.48)' };
export function useRegistrationDesign() {
  const { isDark, palette } = useTheme();
  return { isDark, palette: isDark ? palette : { ...palette, ...onboardingLight } };
}
