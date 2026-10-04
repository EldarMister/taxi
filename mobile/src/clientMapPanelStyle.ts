import { StyleSheet } from 'react-native';

// Percentages use the actual map container, including display scaling and split screen.
// Keep the action footer outside the shrinking scroll area.
export const clientMapPanelStyle = StyleSheet.create({
  surface: { maxHeight: '52%' },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
});
