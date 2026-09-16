import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Order, User } from '../types';
import { useTheme } from '../design/theme';
import { Icon } from '../ui';

export function HistoryRouteMap({}: { order: Order; language: User['language']; onError: (message: string) => void }) {
  const { palette } = useTheme();
  return <View style={[styles.container, { backgroundColor: palette.elevated }]}><View style={{ alignItems: 'center', gap: 40 }}><Icon name="radio-button-on" color="#1686EF" size={24}/><View style={{ height: 70, width: 4, backgroundColor: '#1686EF', borderRadius: 3 }}/><Icon name="location" color={palette.ink} size={29}/></View></View>;
}
const styles = StyleSheet.create({ container: { height: 232, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } });
