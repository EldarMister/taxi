import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Switch } from '../../ui';

export const c = { blue: '#087FFF', ink: '#111318', muted: '#8A9099', pale: '#F5F6F8', white: '#FFFFFF', line: '#ECEEF2', red: '#D94848', green: '#23865E' };
export function T({ style, muted, bold, ...props }: TextProps & { muted?: boolean; bold?: boolean }) {
  return <Text {...props} style={[{ fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_400Regular', color: muted ? c.muted : c.ink, fontSize: 14, lineHeight: 21 }, style]}/>;
}
export function Action({ label, onPress, secondary, danger, busy, disabled, icon, small }: { label: string; onPress: () => void; secondary?: boolean; danger?: boolean; busy?: boolean; disabled?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name']; small?: boolean }) {
  const color = danger ? c.red : secondary ? c.ink : c.white;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [u.action, small && { minHeight: 42, paddingHorizontal: 13, borderRadius: 16 }, { backgroundColor: danger ? '#FFF0F0' : secondary ? c.pale : c.blue, opacity: disabled || busy ? .5 : pressed ? .8 : 1, transform: [{ scale: pressed ? .985 : 1 }] }]}>
    {busy ? <ActivityIndicator size="small" color={color}/> : icon ? <Ionicons name={icon} size={18} color={color}/> : null}<T bold style={{ color, fontSize: small ? 12 : 14 }}>{label}</T>
  </Pressable>;
}
export function IconAction({ icon, label, onPress, disabled, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [u.iconAction, { opacity: disabled ? .3 : pressed ? .6 : 1 }]}><Ionicons name={icon} size={20} color={danger ? c.red : c.ink}/></Pressable>;
}
export function Input({ label, style, ...props }: TextInputProps & { label: string }) {
  return <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, gap: 7 }}><T muted style={u.label}>{label}</T><TextInput {...props} accessibilityLabel={label} placeholderTextColor={c.muted} style={[u.input, props.multiline && { minHeight: 96, textAlignVertical: 'top' }, style]}/></View>;
}
export function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <View style={u.row}><View style={{ flex: 1 }}><T bold>{label}</T>{!!hint && <T muted style={u.hint}>{hint}</T>}</View><Switch accessibilityLabel={label} accessibilityState={{ disabled }} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: '#DDE1E7', true: c.blue }} thumbColor={c.white}/></View>;
}
export function Pill({ label, selected, onPress, disabled }: { label: string; selected?: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[u.pill, { backgroundColor: selected ? c.ink : c.white, opacity: disabled ? .5 : 1 }]}><T bold style={{ color: selected ? c.white : c.ink, fontSize: 12 }}>{label}</T></Pressable>;
}
export function Panel({ title, visible, onClose, children, footer, busy, wide }: React.PropsWithChildren<{ title: string; visible: boolean; onClose: () => void; footer?: React.ReactNode; busy?: boolean; wide?: boolean }>) {
  const [reduced, setReduced] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduced); const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced); return () => listener.remove(); }, []);
  return <Modal visible={visible} transparent statusBarTranslucent animationType={reduced ? 'none' : 'slide'} onRequestClose={() => !busy && onClose()}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={u.modalOverlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть окно" disabled={busy} onPress={onClose}/>
      <View accessibilityViewIsModal style={[u.panel, wide && { maxWidth: 800 }]}>
        <View style={u.handle}/><View style={[u.row, { paddingHorizontal: 20, paddingBottom: 16 }]}><T bold style={{ fontSize: 21, lineHeight: 28, flex: 1 }}>{title}</T><IconAction icon="close" label="Закрыть" onPress={onClose} disabled={busy}/></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 20 }} showsVerticalScrollIndicator={false}>{children}</ScrollView>
        {footer && <View style={[u.panelFooter, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
export function Message({ text, success }: { text: string; success?: boolean }) {
  return <View accessibilityLiveRegion="polite" style={[u.message, success && { backgroundColor: '#EAF7EF' }]}><Ionicons name={success ? 'checkmark-circle' : 'information-circle-outline'} size={20} color={success ? c.green : c.red}/><T style={{ flex: 1, color: success ? c.green : c.red, fontSize: 13 }}>{text}</T></View>;
}
export const u = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { backgroundColor: c.white, padding: 18, borderRadius: 24, gap: 16 },
  action: { minHeight: 50, borderRadius: 18, paddingHorizontal: 20, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  iconAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  input: { borderRadius: 16, backgroundColor: c.pale, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_400Regular', fontSize: 14, color: c.ink, minHeight: 48 },
  label: { fontSize: 12, lineHeight: 17 }, hint: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  pill: { borderRadius: 18, minHeight: 42, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(13,23,37,0.38)', justifyContent: 'flex-end', alignItems: 'center' },
  panel: { backgroundColor: c.white, borderTopLeftRadius: 30, borderTopRightRadius: 30, maxHeight: '93%', width: '100%', maxWidth: 620, paddingTop: 10 },
  handle: { alignSelf: 'center', backgroundColor: '#D9DDE4', width: 36, height: 4, borderRadius: 2, marginBottom: 14 },
  panelFooter: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: Platform.OS === 'ios' ? 30 : 20, borderTopWidth: 1, borderTopColor: c.line, gap: 10 },
  message: { borderRadius: 16, backgroundColor: '#FFF1F0', padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  divider: { height: 1, backgroundColor: c.line },
});

