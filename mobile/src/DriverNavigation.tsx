import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { displayDistance, navigationConfig, normalizeManeuver, NormalizedManeuver, NavigationFix } from './navigation';
import { useDriverNavigation } from './useDriverNavigation';
import { freezeDriverGps, getDriverTrackingDiagnostics, replayDriverGps, startDriverGpsRecording, stopDriverGpsDiagnostic, stopDriverGpsRecording } from './native/driverTracking';
import { colors, Icon } from './ui';
import { useTheme } from './design/theme';

const trackingDiagnosticsEnabled = typeof __DEV__ !== 'undefined' && __DEV__
  && typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TRACKING_DIAGNOSTICS === '1';

function TurnArrow({ maneuver, arrived, color = 'white' }: { maneuver?: NormalizedManeuver; arrived?: boolean; color?: string }) {
  if (arrived || maneuver?.kind === 'arrive') return <Icon name="flag" size={34} color={color}/>;
  const left = maneuver?.side === 'left';
  const roundabout = maneuver?.kind === 'roundabout' || maneuver?.kind === 'exit-roundabout';
  return <Svg width={42} height={46} viewBox="0 0 48 48" style={left ? { transform: [{ scaleX: -1 }] } : undefined}>
    {roundabout ? <><Circle cx="24" cy="25" r="12" fill="none" stroke={color} strokeWidth={4}/><Path d="M24 45V37M24 13V3M17 10L24 3L31 10" stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round"/></> :
      maneuver?.kind === 'uturn' ? <Path d="M12 43V17C12 3 36 3 36 17V33M29 26L36 33L43 26" stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round"/> :
      maneuver?.side === 'left' || maneuver?.side === 'right' ? <Path d="M12 43V25Q12 15 22 15H41M32 6L41 15L32 24" stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round"/> :
      <Path d="M24 43V5M12 17L24 5L36 17" stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>}
  </Svg>;
}

export function DriverNavigation({ navigation, top, onLocation, onHeight }: {
  navigation: ReturnType<typeof useDriverNavigation>; top: number; onLocation: () => void; onHeight?: (height: number) => void;
}) {
  const theme = useTheme();
  const { progress, loading, error, gpsStatus, voiceEnabled, voiceError } = navigation;
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState(getDriverTrackingDiagnostics);
  const [recordedTrace, setRecordedTrace] = React.useState<NavigationFix[]>([]);
  const [diagnosticMode, setDiagnosticMode] = React.useState<'live' | 'recording' | 'frozen' | 'replaying'>('live');
  React.useEffect(() => () => stopDriverGpsDiagnostic(), []);
  React.useEffect(() => {
    if (!trackingDiagnosticsEnabled || !diagnosticsOpen) return;
    setDiagnostics(getDriverTrackingDiagnostics());
    const timer = setInterval(() => setDiagnostics(getDriverTrackingDiagnostics()), 1000);
    return () => clearInterval(timer);
  }, [diagnosticsOpen]);
  const offRoute = (progress?.offRouteMeters || 0) > navigationConfig.offRouteMeters;
  const ready = !!progress && !gpsStatus && !offRoute && !loading && (!error || !!navigation.route);
  const title = gpsStatus || (loading ? 'Строим маршрут' : offRoute ? 'Вы отклонились от маршрута' : progress?.instruction || (error ? 'Маршрут недоступен' : 'Готовим навигацию'));
  const turn = navigation.route?.steps[progress?.stepIndex || 0];
  const maneuver = turn ? normalizeManeuver(turn) : undefined;
  return <View testID="driver-navigation" pointerEvents="box-none" onLayout={event => onHeight?.(event.nativeEvent.layout.height)} style={[styles.position, { top }]}>
    <View style={styles.guidance}>
      <View style={[styles.turn, theme.isDark && { backgroundColor: theme.palette.accent, shadowColor: '#000000' }]}>{loading ? <ActivityIndicator color={theme.isDark ? theme.palette.accentText : 'white'}/> : <TurnArrow maneuver={maneuver} arrived={progress?.arrived} color={theme.isDark ? theme.palette.accentText : 'white'}/>}</View>
      <View style={[styles.instruction, theme.isDark && { backgroundColor: '#111111E8', borderRadius: 13, paddingHorizontal: 8, paddingVertical: 4 }]}>
        <Text style={[styles.distance, theme.isDark && { color: theme.palette.ink, textShadowColor: '#000000' }]}>{ready ? progress.arrived ? '0 м' : displayDistance(progress.maneuverDistance) : '—'}</Text>
        <Text numberOfLines={2} style={[styles.title, theme.isDark && { color: theme.palette.muted, textShadowColor: '#000000' }]}>{title}</Text>
      </View>
      <Pressable accessibilityRole="switch" accessibilityLabel="Голосовые подсказки" accessibilityState={{ checked: voiceEnabled }} hitSlop={8} onPress={navigation.toggleVoice} style={[styles.voice, theme.isDark && { backgroundColor: theme.palette.elevated }]}>
        <Icon name={voiceEnabled ? 'volume-high' : 'volume-mute'} size={20} color={theme.isDark ? voiceEnabled ? theme.palette.ink : theme.palette.muted : voiceEnabled ? colors.blue : '#8494AD'}/>
      </Pressable>
    </View>
    {!!gpsStatus && <Pressable accessibilityRole="button" accessibilityLabel="Проверить местоположение" onPress={() => { navigation.retry(); onLocation(); }} style={[styles.notice, theme.isDark && { backgroundColor: theme.palette.elevated }]}><Icon name="locate" color={theme.isDark ? theme.palette.ink : '#B57522'} size={16}/><Text numberOfLines={2} style={[styles.noticeText, theme.isDark && { color: theme.palette.ink }]}>{gpsStatus}</Text></Pressable>}
    {!!error && <Pressable accessibilityRole="button" onPress={navigation.retry} style={[styles.notice, theme.isDark && { backgroundColor: theme.palette.elevated }]}><Icon name="refresh" color={theme.isDark ? theme.palette.ink : colors.blue} size={16}/><Text numberOfLines={2} style={[styles.noticeText, theme.isDark && { color: theme.palette.ink }]}>{error} · Повторить</Text></Pressable>}
    {voiceEnabled && !!voiceError && <Text style={[styles.voiceWarning, theme.isDark && { color: theme.palette.muted, textShadowColor: '#000000' }]}>{voiceError}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Проверить голос" onPress={navigation.testVoice} style={[styles.voiceTest, theme.isDark && { backgroundColor: theme.palette.elevated }]}><Text style={[styles.voiceTestText, theme.isDark && { color: theme.palette.ink }]}>Проверить голос</Text></Pressable>
    {!navigation.followDriver && <Pressable accessibilityRole="button" accessibilityLabel="Показать водителя" onPress={() => navigation.setFollowDriver(true)} style={[styles.returnToCar, theme.isDark && { backgroundColor: theme.palette.surface }]}><Icon name="navigate" color={theme.isDark ? theme.palette.ink : colors.blue} size={17}/><Text style={[styles.returnText, theme.isDark && { color: theme.palette.ink }]}>Показать водителя</Text></Pressable>}
    {trackingDiagnosticsEnabled && <>
      <Pressable accessibilityRole="button" accessibilityLabel="Диагностика трекинга" onPress={() => setDiagnosticsOpen(value => !value)} style={[styles.diagnosticsToggle, theme.isDark && { backgroundColor: theme.palette.surface }]}><Text style={[styles.diagnosticsText, theme.isDark && { color: theme.palette.ink }]}>Диагностика {diagnosticsOpen ? '−' : '+'}</Text></Pressable>
      {diagnosticsOpen && <View testID="driver-tracking-diagnostics" style={[styles.diagnosticsPanel, theme.isDark && { backgroundColor: theme.palette.surface }]}>
        <Text selectable style={[styles.diagnosticsText, theme.isDark && { color: theme.palette.ink }]}>{[
          `Исходная: ${diagnostics.raw ? `${diagnostics.raw.latitude.toFixed(6)}, ${diagnostics.raw.longitude.toFixed(6)}` : '—'}`,
          `Обработанная: ${diagnostics.processed ? `${diagnostics.processed.latitude.toFixed(6)}, ${diagnostics.processed.longitude.toFixed(6)}` : '—'}`,
          `Точность: ${diagnostics.processed ? Math.round(diagnostics.processed.accuracy) + ' м' : '—'} · возраст: ${diagnostics.ageMs == null ? '—' : Math.max(0, Math.round(diagnostics.ageMs / 1000)) + ' с'}`,
          `Сессия: ${diagnostics.trackingSessionId || '—'} · № ${diagnostics.sequence}`,
          `Связь: ${diagnostics.transportStatus} · маршрут: ${navigation.routeVersion || 0}`,
          `Манёвр: ${turn ? `${turn.maneuver.type}/${turn.maneuver.modifier || '—'}` : '—'}`,
          `Отброс: ${diagnostics.lastDropReason || '—'} · перестроение: ${navigation.rerouteReason || '—'}`,
        ].join('\n')}</Text>
        <Text style={[styles.diagnosticsText, theme.isDark && { color: theme.palette.ink }]}>GPS: {diagnosticMode} · точек в записи: {recordedTrace.length}</Text>
        <View style={styles.diagnosticsActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={diagnosticMode === 'recording' ? 'Остановить запись GPS' : 'Записать GPS-трассу'} onPress={() => {
            if (diagnosticMode === 'recording') { setRecordedTrace(stopDriverGpsRecording()); setDiagnosticMode('live'); }
            else if (startDriverGpsRecording()) setDiagnosticMode('recording');
          }} style={styles.diagnosticsAction}><Text style={styles.diagnosticsText}>{diagnosticMode === 'recording' ? 'Стоп запись' : 'Запись'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Заморозить GPS-точку" onPress={() => { if (freezeDriverGps()) setDiagnosticMode('frozen'); }} style={styles.diagnosticsAction}><Text style={styles.diagnosticsText}>Заморозить</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Воспроизвести GPS-трассу" disabled={recordedTrace.length < 2} onPress={() => { if (replayDriverGps(recordedTrace)) setDiagnosticMode('replaying'); }} style={[styles.diagnosticsAction, recordedTrace.length < 2 && { opacity: .45 }]}><Text style={styles.diagnosticsText}>Повтор</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к живому GPS" onPress={() => { stopDriverGpsDiagnostic(); setDiagnosticMode('live'); }} style={styles.diagnosticsAction}><Text style={styles.diagnosticsText}>Живой GPS</Text></Pressable>
        </View>
      </View>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  position: { position: 'absolute', left: 14, width: 250, gap: 7 },
  guidance: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  turn: { width: 52, height: 56, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', shadowColor: '#175BA9', shadowOpacity: .2, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  instruction: { flex: 1, gap: 1 },
  distance: { fontSize: 28, lineHeight: 32, fontWeight: '800', color: '#152644', letterSpacing: -.8, fontVariant: ['tabular-nums'], textShadowColor: 'white', textShadowRadius: 6 },
  title: { fontSize: 12, lineHeight: 15, fontWeight: '600', color: '#3E5874', textShadowColor: 'white', textShadowRadius: 5 },
  voice: { width: 31, height: 36, borderRadius: 13, backgroundColor: 'rgba(255,255,255,.88)', justifyContent: 'center', alignItems: 'center' },
  notice: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.94)' },
  noticeText: { flex: 1, color: '#71512A', fontSize: 11, lineHeight: 14 },
  voiceWarning: { color: '#566983', fontSize: 11, lineHeight: 15, textShadowColor: 'white', textShadowRadius: 5 },
  voiceTest: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,.94)' },
  voiceTestText: { color: '#246BFD', fontSize: 11, fontWeight: '700' },
  returnToCar: { alignSelf: 'flex-end', backgroundColor: 'white', borderRadius: 18, paddingHorizontal: 13, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, elevation: 3 }, returnText: { color: '#246BFD', fontSize: 12, fontWeight: '700' },
  diagnosticsToggle: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: 'white' },
  diagnosticsPanel: { width: 300, maxWidth: '100%', padding: 10, borderRadius: 12, backgroundColor: 'white' },
  diagnosticsText: { color: '#152644', fontSize: 11, lineHeight: 16 },
  diagnosticsActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  diagnosticsAction: { backgroundColor: '#DCEAFB', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
});
