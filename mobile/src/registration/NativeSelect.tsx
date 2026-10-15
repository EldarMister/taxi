import React, { useRef, useState } from 'react';
import { Keyboard, Modal, NativeModules, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui';
import { fonts } from '../design/typography';
import { LocalizedText as Text, translateInterfaceText } from '../auth/LocalizedText';
import { useRegistrationDesign } from './design';

export function NativeSelect({ title, value, options, onChange, disabled, children }: {
  title: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
  disabled?: boolean; children?: React.ReactNode;
}) {
  const { palette } = useRegistrationDesign(), insets = useSafeAreaInsets();
  const picker = useRef<Picker<string>>(null);
  const selecting = useRef(false);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value || options[0]?.value || '');
  const show = async () => {
    Keyboard.dismiss();
    if (Platform.OS !== 'android') { setDraft(value || options[0]?.value || ''); setOpen(true); return; }
    const wheel = NativeModules.AtlasNumberPicker;
    if (!wheel || !options.length || !options.every(option => /^-?\d+$/.test(option.value))) { picker.current?.focus(); return; }
    if (selecting.current) return;
    selecting.current = true;
    try {
      const next: string | null = await wheel.open(translateInterfaceText(title), options.map(option => title === 'Регион' ? option.value : translateInterfaceText(option.label)), options.map(option => option.value), value, translateInterfaceText('Готово'), translateInterfaceText('Отмена'));
      if (next && next !== value && options.some(option => option.value === next)) onChange(next);
    } catch { picker.current?.focus(); }
    finally { selecting.current = false; }
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${value || 'не выбран'}`} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={() => { void show(); }}>
      {children || <View style={[s.field, { borderColor: palette.line, backgroundColor: palette.surface }]}><Text style={[s.value, { color: value ? palette.ink : palette.muted }]}>{value || 'Выберите'}</Text><Icon name="chevron-down" color={palette.ink} size={20}/></View>}
    </Pressable>
    {Platform.OS === 'android' && <View style={s.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Picker ref={picker} mode="dialog" prompt={title} selectedValue={value} onValueChange={next => { if (next && next !== value) onChange(next); }} enabled={!disabled}>
        <Picker.Item label={value ? title : 'Выберите'} value=""/>{options.map(option => <Picker.Item key={option.value} label={option.label} value={option.value}/>) }
      </Picker>
    </View>}
    {Platform.OS === 'ios' && <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.backdrop }]} onPress={() => setOpen(false)}/>
      <View style={[s.modal, { backgroundColor: palette.surface, paddingBottom: insets.bottom }]}>
        <View style={s.toolbar}><Pressable onPress={() => setOpen(false)}><Text style={[s.action, { color: palette.muted }]}>Отмена</Text></Pressable><Text style={[s.title, { color: palette.ink }]}>{title}</Text><Pressable onPress={() => { onChange(draft); setOpen(false); }}><Text style={[s.action, { color: palette.accent }]}>Готово</Text></Pressable></View>
        <Picker selectedValue={draft} onValueChange={setDraft} itemStyle={{ color: palette.ink, fontFamily: fonts.regular }}>{options.map(option => <Picker.Item key={option.value} label={option.label} value={option.value}/>)}</Picker>
      </View>
    </Modal>}
  </>;
}
const s = StyleSheet.create({
  field: { minHeight: 48, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  value: { fontFamily: fonts.regular, fontSize: 16 }, hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  modal: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  toolbar: { padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { fontFamily: fonts.semibold, fontSize: 16 }, action: { fontFamily: fonts.semibold, fontSize: 15 },
});
