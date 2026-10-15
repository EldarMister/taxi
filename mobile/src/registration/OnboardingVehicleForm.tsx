import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '../ui';
import { fonts } from '../design/typography';
import { LocalizedText as Text } from '../auth/LocalizedText';
import { FormInput, SectionTitle } from './components';
import { useRegistrationFieldFocus } from './RegistrationKeyboardLayout';
import { NativeSelect } from './NativeSelect';
import { VehicleSelectionSheet } from './VehicleSelectionSheet';
import { useRegistrationDesign } from './design';
import { currentPlateRegions, formatPlate, legacyPlateRegions, plateFormats, plateLetters, readPlate, switchPlate, validPlate, vehicleColors, vehicleYearRange, type PlateParts } from './vehicleData';
import type { VehicleDraft } from './types';

export function OnboardingVehicleForm({ title, description, vehicle, path, cargo = false, onChange, canEdit, error, children }: {
  title: string; description: string; vehicle: VehicleDraft; path: string; onChange: (value: Partial<VehicleDraft>) => void;
  canEdit: (path: string) => boolean; error?: string; children?: React.ReactNode;
  cargo?: boolean;
}) {
  const revealField = useRegistrationFieldFocus();
  const { palette } = useRegistrationDesign();
  const [sheet, setSheet] = useState<'brand' | 'model' | 'color' | null>(null);
  const plate = readPlate(vehicle), { minimum, maximum } = vehicleYearRange();
  const years = Array.from({ length: maximum - minimum + 1 }, (_, index) => ({ value: String(maximum - index), label: String(maximum - index) }));
  const regions = plate.format === 'CURRENT' ? currentPlateRegions : legacyPlateRegions;
  const changePlate = (parts: PlateParts) => onChange({ plate: parts, ...(validPlate(parts) && { plateNumber: formatPlate(parts) }) });
  const disabled = (field: string) => !canEdit(`${path}.${field}`);
  const label = (value: string) => <Text style={[s.label, { color: palette.muted }]}>{value} *</Text>;
  const field = (name: string, value: string, placeholder: string, kind: 'brand' | 'model' | 'color', unavailable = false) => <View style={s.half}>{label(name)}<Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ disabled: unavailable || disabled(kind) }} disabled={unavailable || disabled(kind)} onPress={() => setSheet(kind)} style={[s.field, { backgroundColor: palette.surface, borderColor: palette.line, opacity: unavailable || disabled(kind) ? .55 : 1, paddingVertical: unavailable ? 8 : 10 }]}>
    {kind === 'color' && !!value && <View style={[s.color, { backgroundColor: vehicleColors.find(item => item.value === value)?.color || palette.line, borderColor: palette.muted }]}/>}<Text style={[s.value, { flex: 1, color: value ? palette.ink : palette.muted, fontSize: unavailable ? 12 : 16, lineHeight: unavailable ? 16 : 22 }]}>{value || placeholder}</Text><Icon name="chevron-down" size={20} color={palette.ink}/>
  </Pressable></View>;
  return <View style={s.form}>
    <SectionTitle title={title} description={description}/>
    <View style={{ gap: 6 }}>{label('Владение')}<View style={s.columns}>{([{ value: 'OWN', title: 'Собственный' }, { value: 'RENT', title: 'Арендованный' }] as const).map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.title} accessibilityState={{ checked: vehicle.ownership === option.value, disabled: disabled('ownership') }} disabled={disabled('ownership')} onPress={() => onChange({ ownership: option.value })} style={[s.half, s.field, { borderColor: vehicle.ownership === option.value ? palette.accent : palette.line, backgroundColor: palette.surface, opacity: disabled('ownership') ? .55 : 1 }]}><Text style={[s.option, { color: palette.ink }]}>{option.title}</Text></Pressable>)}</View></View>
    {children}
    <View style={s.columns}>{field('Марка', vehicle.brand, 'Выберите', 'brand')}{field('Модель', vehicle.model, vehicle.brand ? 'Выберите' : 'Сначала выберите марку', 'model', !vehicle.brand)}</View>
    <View style={s.columns}><View style={s.half}>{label('Год')}<NativeSelect title="Год выпуска" value={vehicle.year} options={years} disabled={disabled('year')} onChange={year => onChange({ year })}/></View>{field('Цвет', vehicle.color, 'Выберите', 'color')}</View>
    <View style={{ gap: 6 }}>{label('Государственный номер')}<View style={s.columns}>{plateFormats.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.description} accessibilityState={{ checked: plate.format === option.value, disabled: disabled('plateNumber') }} disabled={disabled('plateNumber')} onPress={() => changePlate(switchPlate(plate, option.value))} style={[s.half, s.field, { backgroundColor: palette.surface, borderColor: plate.format === option.value ? palette.accent : palette.line }]}><Text style={[s.option, { color: palette.ink }]}>{option.label}</Text></Pressable>)}</View>
      <View style={[s.plateLabels, { marginTop: 5 }]}>{['Регион', 'Номер', 'Серия'].map((value, index) => <Text key={value} style={[s.label, { color: palette.muted, flex: index === 0 ? .9 : 1.1 }]}>{value}</Text>)}</View>
      <View style={[s.plate, { borderColor: palette.line, backgroundColor: palette.surface }]}>
        <View style={s.region}><NativeSelect title="Регион" value={plate.region} options={regions} disabled={disabled('plateNumber')} onChange={region => changePlate({ ...plate, region })}><View style={s.regionContent}><Text style={[s.plateValue, { color: plate.region ? palette.ink : palette.muted }]}>{plate.region || '—'}</Text><Icon name="chevron-down" size={20} color={palette.ink}/></View></NativeSelect></View>
        <TextInput onFocus={revealField} accessibilityLabel="Номер автомобиля" editable={!disabled('plateNumber')} value={plate.digits} onChangeText={digits => changePlate({ ...plate, digits: digits.replace(/\D/g, '').slice(0, plate.format === 'CURRENT' ? 3 : 4) })} keyboardType="number-pad" placeholder={plate.format === 'CURRENT' ? '000' : '0000'} placeholderTextColor={palette.muted} style={[s.plateInput, { color: palette.ink, borderLeftColor: palette.line }]}/>
        <TextInput onFocus={revealField} accessibilityLabel="Буквенная серия" editable={!disabled('plateNumber')} value={plate.series} onChangeText={series => changePlate({ ...plate, series: plateLetters(series).slice(0, plate.format === 'CURRENT' ? 3 : 2) })} autoCapitalize="characters" autoCorrect={false} placeholder={plate.format === 'CURRENT' ? 'AAA' : 'AA'} placeholderTextColor={palette.muted} style={[s.plateInput, { color: palette.ink, borderLeftColor: palette.line }]}/>
      </View>
      {!!vehicle.plate && !validPlate(plate) && <Text style={{ color: palette.muted, fontFamily: fonts.regular, fontSize: 12 }}>Укажите регион, номер и серию полностью</Text>}
      {!vehicle.plate && !!vehicle.plateNumber && !plate.region && <FormInput label="Сохранённый номер" value={vehicle.plateNumber} onChangeText={plateNumber => onChange({ plateNumber: plateNumber.toUpperCase() })} disabled={disabled('plateNumber')}/>}
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#CA4149', fontFamily: fonts.regular, fontSize: 13 }}>{error}</Text>}
    {!!sheet && <VehicleSelectionSheet kind={sheet} cargo={cargo} brand={vehicle.brand} selected={sheet === 'brand' ? vehicle.brand : sheet === 'model' ? vehicle.model : vehicle.color}
      onBrand={brand => { onChange({ brand, ...(!disabled('model') && { model: brand === vehicle.brand ? vehicle.model : '' }) }); setSheet(disabled('model') ? null : 'model'); }} onBack={() => setSheet(disabled('brand') ? null : 'brand')}
      onSelect={value => { onChange(sheet === 'color' ? { color: value } : { model: value }); setSheet(null); }} onClose={() => setSheet(null)}/>}
  </View>;
}
const s = StyleSheet.create({
  form: { gap: 19 }, columns: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' }, half: { flex: 1, gap: 4, minWidth: 0 },
  label: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 16 }, field: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, borderWidth: 1 },
  value: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 }, option: { fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 21, flexShrink: 1 }, color: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  plateLabels: { flexDirection: 'row', paddingHorizontal: 0, gap: 10 }, plate: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, minHeight: 53, paddingVertical: 8 },
  region: { flex: .9 }, regionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 36 },
  plateValue: { fontFamily: fonts.regular, fontSize: 18 }, plateInput: { fontFamily: fonts.regular, fontSize: 18, minHeight: 36, flex: 1.1, textAlign: 'left', paddingLeft: 18, paddingRight: 8, borderLeftWidth: 1, paddingVertical: 2 },
});
