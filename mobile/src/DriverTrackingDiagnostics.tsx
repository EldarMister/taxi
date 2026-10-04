import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NavigationFix } from './navigation';
import type { useDriverNavigation } from './useDriverNavigation';
import { useTheme } from './design/theme';
import { freezeDriverGps, getDriverTrackingDiagnostics, replayDriverGps, startDriverGpsRecording,
  stopDriverGpsDiagnostic, stopDriverGpsRecording } from './native/driverTracking';
import { exportTrackingRecording, getTrackingRecording, recordTrackingEvent } from './native/trackingRecorder';

export const trackingDiagnosticsEnabled = typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TRACKING_DIAGNOSTICS === '1';

export function DriverTrackingDiagnostics({ navigation, top }: { navigation: ReturnType<typeof useDriverNavigation>; top: number }) {
  const theme = useTheme(), palette = theme.palette;
  const [open, setOpen] = React.useState(false);
  const [details, setDetails] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState(getDriverTrackingDiagnostics);
  const [trace, setTrace] = React.useState<NavigationFix[]>([]);
  const latest = React.useRef(navigation);
  const recordedRoute = React.useRef<{ fileName: string | null; version: number; route: typeof navigation.route } | null>(null);
  latest.current = navigation;
  const refresh = () => setDiagnostics(getDriverTrackingDiagnostics());
  React.useEffect(() => {
    if (!trackingDiagnosticsEnabled) return;
    const timer = setInterval(() => {
      const journal = getTrackingRecording();
      if (journal.recording) {
        const current = latest.current;
        recordTrackingEvent('navigation', { progress: current.progress, gpsStatus: current.gpsStatus,
          offRouteCount: current.offRouteCount, routeVersion: current.routeVersion,
          rerouteReason: current.rerouteReason, followDriver: current.followDriver });
        const previous = recordedRoute.current;
        if (current.route && (!previous || previous.fileName !== journal.fileName
          || previous.version !== current.routeVersion || previous.route !== current.route)) {
          recordTrackingEvent('route', { routeVersion: current.routeVersion,
            geometry: current.route.geometry,
            steps: current.route.steps.map(step => ({ maneuver: step.maneuver,
              distanceMeters: step.distanceMeters, geometry: step.geometry })) });
          recordedRoute.current = { fileName: journal.fileName, version: current.routeVersion, route: current.route };
        }
      } else {
        recordedRoute.current = null;
      }
      refresh();
    }, 1000);
    return () => { clearInterval(timer); stopDriverGpsDiagnostic(); };
  }, []);
  const recording = diagnostics.recording;
  const ink = { color: palette.ink };
  const toggleRecording = () => {
    if (recording.recording) setTrace(stopDriverGpsRecording());
    else if (!startDriverGpsRecording()) Alert.alert('Запись не началась', getTrackingRecording().error || 'Сначала вернитесь к живому GPS.');
    refresh();
  };
  const save = async () => {
    setSaving(true);
    try {
      const destination = await exportTrackingRecording();
      if (destination) Alert.alert('Файл сохранён', `${getTrackingRecording().fileName}\nПрикрепите этот файл к сообщению после поездки.`);
    } catch (error) { Alert.alert('Не удалось сохранить файл', error instanceof Error ? error.message : 'Попробуйте ещё раз.'); }
    finally { setSaving(false); refresh(); }
  };
  const canSave = !!recording.fileName && !recording.recording && !saving;
  if (!trackingDiagnosticsEnabled) return null;
  return <>
    <Pressable testID="driver-recording-open" accessibilityRole="button" accessibilityLabel="Диагностика поездки"
      onPress={() => { refresh(); setOpen(true); }} style={[styles.toggle, { top, backgroundColor: palette.surface }]}>
      <Text style={[styles.toggleText, ink]}>{recording.recording ? '🔴 Запись идёт' : 'Запись поездки'}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={[styles.backdrop, { backgroundColor: palette.backdrop }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть диагностику" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)}/>
        <View testID="driver-tracking-diagnostics" style={[styles.card, { backgroundColor: palette.surface }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.title, ink]}>Запись поездки</Text>
            <Text style={[styles.description, { color: palette.muted }]}>Данные GPS и связи помогут проверить движение на карте. Уже записанные данные останутся на телефоне после закрытия приложения.</Text>
            <Text testID="driver-recording-status" style={[styles.status, ink]}>{recording.recording ? 'Запись идёт' : recording.fileName ? 'Запись остановлена' : 'Запись ещё не начата'} · точек: {recording.points}</Text>
            {!!recording.error && <Text style={[styles.description, ink]}>{recording.error}</Text>}
            <Pressable testID="driver-recording-toggle" accessibilityRole="button" accessibilityLabel={recording.recording ? 'Остановить запись GPS' : 'Начать запись GPS'}
              onPress={toggleRecording} style={[styles.primary, { backgroundColor: palette.accent }]}>
              <Text style={[styles.buttonText, { color: palette.accentText }]}>{recording.recording ? 'Остановить запись' : 'Начать запись'}</Text>
            </Pressable>
            <Pressable testID="driver-recording-save" accessibilityRole="button" accessibilityLabel="Сохранить диагностическую запись в файл" disabled={!canSave}
              onPress={save} style={[styles.secondary, { borderColor: palette.line }, !canSave && styles.disabled]}>
              <Text style={[styles.buttonText, ink]}>{saving ? 'Сохраняем…' : 'Сохранить файл'}</Text>
            </Pressable>
            {!!recording.fileName && !recording.recording && <Text style={[styles.description, { color: palette.muted }]}>Выберите папку для файла и после поездки прикрепите его к сообщению. Последняя запись доступна после перезапуска.</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="Показать данные GPS" onPress={() => setDetails(value => !value)} style={styles.detailsToggle}>
              <Text style={[styles.description, { color: palette.muted }]}>{details ? 'Скрыть данные GPS' : 'Данные GPS и тестовые режимы'}</Text>
            </Pressable>
            {details && <>
              <Text selectable style={[styles.data, ink]}>{[
                `Исходная: ${diagnostics.raw ? `${diagnostics.raw.latitude.toFixed(6)}, ${diagnostics.raw.longitude.toFixed(6)}` : '—'}`,
                `Обработанная: ${diagnostics.processed ? `${diagnostics.processed.latitude.toFixed(6)}, ${diagnostics.processed.longitude.toFixed(6)}` : '—'}`,
                `Точность: ${diagnostics.processed?.accuracy?.toFixed(0) ?? '—'} м · возраст: ${diagnostics.ageMs == null ? '—' : Math.max(0, Math.round(diagnostics.ageMs / 1000)) + ' с'}`,
                `Курс: ${diagnostics.processed?.heading?.toFixed(0) ?? '—'}° · скорость: ${diagnostics.processed?.speed?.toFixed(1) ?? '—'} м/с`,
                `Сессия: ${diagnostics.trackingSessionId || '—'} · № ${diagnostics.sequence}`,
                `Связь: ${diagnostics.transportStatus} · отброс: ${diagnostics.lastDropReason || '—'}`,
                `Режим GPS: ${diagnostics.diagnosticMode}`,
              ].join('\n')}</Text>
              <Text style={[styles.description, { color: palette.muted }]}>Заморозка и повтор приостанавливают отправку координат. Для поездки оставьте живой GPS.</Text>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Заморозить GPS-точку" onPress={() => { freezeDriverGps(); refresh(); }} style={[styles.small, { backgroundColor: palette.elevated }]}><Text style={ink}>Заморозить</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Воспроизвести GPS-трассу" disabled={trace.length < 2} onPress={() => { replayDriverGps(trace); refresh(); }} style={[styles.small, { backgroundColor: palette.elevated }, trace.length < 2 && styles.disabled]}><Text style={ink}>Повтор</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к живому GPS" onPress={() => { stopDriverGpsDiagnostic(); refresh(); }} style={[styles.small, { backgroundColor: palette.elevated }]}><Text style={ink}>Живой GPS</Text></Pressable>
              </View>
            </>}
            <Pressable accessibilityRole="button" accessibilityLabel="Вернуться на карту" onPress={() => setOpen(false)} style={styles.detailsToggle}><Text style={[styles.buttonText, ink]}>Вернуться на карту</Text></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  toggle: { position: 'absolute', left: 14, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, elevation: 3 },
  toggleText: { fontSize: 12, fontWeight: '600' },
  backdrop: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { borderRadius: 24, maxHeight: '85%', overflow: 'hidden' },
  content: { padding: 22, gap: 14 },
  title: { fontSize: 24, fontWeight: '700' },
  description: { fontSize: 13, lineHeight: 19 },
  status: { fontSize: 15, fontWeight: '600' },
  primary: { borderRadius: 14, padding: 16, alignItems: 'center' },
  secondary: { borderRadius: 14, borderWidth: 1, padding: 16, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
  detailsToggle: { paddingVertical: 8 },
  data: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  small: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  disabled: { opacity: .4 },
});
