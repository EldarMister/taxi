import React, { PropsWithChildren } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette } from '../design/tokens';

export const c = { ...palette, canvas: '#F6F8FB', line: '#E9EDF2', muted: '#84909C', soft: '#EFF5FC' };
export function Button({ title, onPress, busy, disabled, secondary, danger }: { title: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={busy || disabled} style={({ pressed }) => [s.button, { backgroundColor: danger ? '#FFF0F0' : secondary ? c.soft : c.blue, opacity: disabled || busy ? .45 : pressed ? .7 : 1 }]}>{busy ? <ActivityIndicator color={secondary ? c.blue : 'white'}/> : <Text style={[s.buttonText, { color: danger ? c.danger : secondary ? c.blue : 'white' }]}>{title}</Text>}</Pressable>;
}
export function Field({ label, value, onChange, placeholder, numeric, secure, multiline }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean; secure?: boolean; multiline?: boolean }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.muted} keyboardType={numeric ? 'decimal-pad' : 'default'} secureTextEntry={secure} autoCapitalize={secure ? 'none' : 'sentences'} autoCorrect={!secure} multiline={multiline} style={[s.input, multiline && { minHeight: 86, textAlignVertical: 'top' }]}/></View>;
}
export function Toggle({ title, subtitle, value, onChange }: { title: string; subtitle?: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={s.row}><View style={s.flex}><Text style={s.body}>{title}</Text>{subtitle ? <Text style={s.caption}>{subtitle}</Text> : null}</View><Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ false: '#DDE2E9', true: c.blue }} thumbColor="white"/></View>;
}
export function Empty({ title, body, icon = 'restaurant-outline' }: { title: string; body?: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  return <View style={s.empty}><View style={s.emptyIcon}><Ionicons name={icon} color={c.blue} size={32}/></View><Text style={s.heading}>{title}</Text>{body ? <Text style={[s.caption, { textAlign: 'center', lineHeight: 21 }]}>{body}</Text> : null}</View>;
}
export function Sheet({ title, visible, onClose, children }: PropsWithChildren<{ title: string; visible: boolean; onClose: () => void }>) {
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={s.screen}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={s.modalHeader}><Text style={[s.heading, s.flex]}>{title}</Text><Pressable onPress={onClose} accessibilityLabel="Закрыть" style={s.iconButton}><Ionicons name="close" size={25} color={c.ink}/></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.form}>{children}</ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>;
}
export function Card({ children }: PropsWithChildren) { return <View style={s.card}>{children}</View>; }
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, flex: { flex: 1 },
  body: { color: c.ink, fontSize: 15, fontFamily: 'Inter_500Medium' },
  caption: { color: c.muted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },
  heading: { color: c.ink, fontSize: 21, fontFamily: 'Inter_700Bold' },
  title: { color: c.ink, fontSize: 29, fontFamily: 'Inter_800ExtraBold' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  card: { borderRadius: 22, padding: 17, backgroundColor: 'white', borderWidth: 1, borderColor: c.line, gap: 9 },
  form: { padding: 20, paddingBottom: 48, gap: 16 },
  field: { gap: 8 }, label: { color: c.inkSoft, fontSize: 13, fontFamily: 'Inter_500Medium' },
  input: { paddingHorizontal: 15, paddingVertical: 14, minHeight: 50, borderRadius: 15, backgroundColor: c.canvas, borderWidth: 1, borderColor: c.line, color: c.ink, fontFamily: 'Inter_400Regular', fontSize: 15 },
  button: { borderRadius: 16, paddingHorizontal: 18, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  iconButton: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.canvas },
  modalHeader: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: c.line },
  chip: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 100, backgroundColor: c.canvas },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 44, gap: 13, paddingHorizontal: 24 },
  emptyIcon: { width: 70, height: 70, borderRadius: 24, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 14, borderRadius: 15, backgroundColor: '#FFF2F0', color: c.danger, fontSize: 14 },
});
