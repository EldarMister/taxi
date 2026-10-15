import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { NativeSelect } from './NativeSelect';
import { useRegistrationDesign } from './design';
import { fonts } from '../design/typography';
import { LocalizedText as Text } from '../auth/LocalizedText';

/** Native numeric presets without narrowing the existing accepted range. */
export function NativeNumberInput({ label, value, options, onChange, disabled, optional, error, signed = false }: {
  label: string; value: string; options: number[]; onChange: (value: string) => void;
  disabled?: boolean; optional?: boolean; error?: string; signed?: boolean;
}) {
  const { palette } = useRegistrationDesign();
  const [manual, setManual] = useState(false);
  const choices = [...new Set(options.map(String).concat(value ? [value] : []))].sort((a, b) => Number(a) - Number(b));
  return <View style={{ gap: 6 }}>
    <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: palette.muted }}>{label}{optional ? '' : ' *'}</Text>
    {manual ? <View style={{ gap: 6 }}><TextInput autoFocus editable={!disabled} accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType={signed ? 'numbers-and-punctuation' : 'decimal-pad'} style={{ minHeight: 48, fontFamily: fonts.regular, fontSize: 16, color: palette.ink, backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14 }}/><Pressable onPress={() => setManual(false)}><Text style={{ fontFamily: fonts.regular, fontSize: 12, color: palette.accent }}>Выбрать из списка</Text></Pressable></View> : <NativeSelect title={label} value={value} disabled={disabled} options={[...(optional ? [{ value: '__clear__', label: 'Не указано' }] : []), ...choices.map(item => ({ value: item, label: item })), { value: '__manual__', label: 'Ввести другое значение' }]} onChange={next => { if (next === '__manual__') setManual(true); else onChange(next === '__clear__' ? '' : next); }}/ >}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#CA4149', fontFamily: fonts.regular, fontSize: 12 }}>{error}</Text>}
  </View>;
}
