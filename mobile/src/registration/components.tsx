import React from 'react';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type ImageSourcePropType, type ImageStyle } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useTheme } from '../design/theme';
import { Icon, colors } from '../ui';
import type { RegistrationUpload, VerificationStatus } from './types';

export function RegistrationHeader({ onBack, onHelp, step, total, title }: { onBack?: () => void; onHelp: () => void; step?: number; total?: number; title?: string }) {
  const { palette } = useTheme();
  return <View style={c.header}>
    <View style={c.headerRow}>
      {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Назад" hitSlop={12} onPress={onBack} style={[c.iconButton, { backgroundColor: palette.surface, borderColor: palette.line }]}><Icon name="chevron-back" size={22} color={palette.ink}/></Pressable> : <View style={c.iconButtonPlaceholder}/>}
      {!!title && <Text numberOfLines={1} style={[c.headerTitle, { color: palette.ink }]}>{title}</Text>}
      <Pressable accessibilityRole="button" hitSlop={12} onPress={onHelp} style={c.helpButton}><Text style={[c.helpText, { color: palette.accent }]}>Помощь</Text></Pressable>
    </View>
    {step != null && total ? <RegistrationProgress step={step} total={total}/> : null}
  </View>;
}

export function RegistrationProgress({ step, total }: { step: number; total: number }) {
  const { palette } = useTheme(); const active = Math.max(0, Math.min(total, step));
  return <View style={c.progressRow}><View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: total, now: active }} style={c.progressSegments}>{Array.from({ length: total }, (_, index) => <View key={index} style={[c.progressSegment, { backgroundColor: index < active ? palette.accent : palette.line }]}/>)}</View><Text style={[c.progressText, { color: palette.muted }]}>Шаг {step} из {total}</Text></View>;
}

export function PrimaryButton({ label, onPress, disabled, busy, icon }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; icon?: React.ComponentProps<typeof Icon>['name'] }) {
  const { palette } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled, busy: !!busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [c.primaryButton, { backgroundColor: palette.accent }, (disabled || busy) && c.disabled, pressed && !disabled && c.pressed]}>{busy ? <ActivityIndicator color={palette.accentText}/> : <>{icon ? <Icon name={icon} size={20} color={palette.accentText}/> : null}<Text style={[c.primaryText, { color: palette.accentText }]}>{label}</Text></>}</Pressable>;
}

export function SecondaryButton({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const { palette } = useTheme();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [c.secondaryButton, pressed && c.pressed, disabled && c.disabled]}><Text style={[c.secondaryText, { color: danger ? colors.danger : palette.accent }]}>{label}</Text></Pressable>;
}

export function FormInput({ label, value, onChangeText, placeholder, error, optional, keyboardType, autoCapitalize = 'sentences', maxLength, multiline, disabled }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; error?: string; optional?: boolean; keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']; autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize']; maxLength?: number; multiline?: boolean; disabled?: boolean }) {
  const { palette } = useTheme();
  return <View style={[c.field, disabled && c.readOnly]}><Text style={[c.label, { color: error ? colors.danger : palette.muted }]}>{label}{optional ? ' · необязательно' : ' *'}{disabled ? ' · только чтение' : ''}</Text><TextInput editable={!disabled} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.muted} keyboardType={keyboardType} autoCapitalize={autoCapitalize} maxLength={maxLength} multiline={multiline} returnKeyType={multiline ? 'default' : 'done'} style={[c.input, multiline && c.multiline, { color: palette.ink, borderColor: error ? colors.danger : palette.line, backgroundColor: palette.surface }]}/>{error ? <Text accessibilityRole="alert" style={c.fieldError}>{error}</Text> : null}</View>;
}

export function SelectInput({ label, value, placeholder, onPress, error, optional, disabled }: { label: string; value?: string; placeholder: string; onPress: () => void; error?: string; optional?: boolean; disabled?: boolean }) {
  const { palette } = useTheme();
  return <View style={[c.field, disabled && c.readOnly]}><Text style={[c.label, { color: error ? colors.danger : palette.muted }]}>{label}{optional ? ' · необязательно' : ' *'}{disabled ? ' · только чтение' : ''}</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[c.select, { borderColor: error ? colors.danger : palette.line, backgroundColor: palette.surface }]}><Text style={[c.inputText, { color: value ? palette.ink : palette.muted }]}>{value || placeholder}</Text><Icon name="chevron-down" size={18} color={palette.muted}/></Pressable>{error ? <Text accessibilityRole="alert" style={c.fieldError}>{error}</Text> : null}</View>;
}

function parseDate(value: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12);
  return date.getFullYear() === Number(match[3]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[1]) ? date : null;
}

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

export function NativeDateInput({ label, value, onChange, error, disabled, minimumDate, maximumDate }: { label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean; minimumDate?: Date; maximumDate?: Date }) {
  const { palette } = useTheme();
  const initial = parseDate(value) || maximumDate || new Date();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const open = () => {
    if (disabled) return;
    const current = parseDate(value) || maximumDate || new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: current, mode: 'date', display: 'default', minimumDate, maximumDate, onChange: (event: DateTimePickerEvent, date?: Date) => { if (event.type === 'set' && date) onChange(formatDate(date)); } });
      return;
    }
    setDraft(current); setIosOpen(true);
  };
  return <View style={[c.field, disabled && c.readOnly]}><Text style={[c.label, { color: error ? colors.danger : palette.muted }]}>{label} *{disabled ? ' · только чтение' : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'не выбрана'}`} accessibilityState={{ disabled }} disabled={disabled} onPress={open} style={[c.select, { borderColor: error ? colors.danger : palette.line, backgroundColor: palette.surface }]}><Text style={[c.inputText, { color: value ? palette.ink : palette.muted }]}>{value || 'Выберите дату'}</Text><Icon name="calendar-outline" size={20} color={palette.accent}/></Pressable>{error ? <Text accessibilityRole="alert" style={c.fieldError}>{error}</Text> : null}<Modal transparent visible={iosOpen} animationType="slide" onRequestClose={() => setIosOpen(false)}><Pressable style={[c.backdrop, { backgroundColor: palette.backdrop }]} onPress={() => setIosOpen(false)}/><View style={[c.dateSheet, { backgroundColor: palette.surface }]}><View style={c.dateSheetHeader}><Pressable onPress={() => setIosOpen(false)}><Text style={[c.dateAction, { color: palette.muted }]}>Отмена</Text></Pressable><Text style={[c.dateTitle, { color: palette.ink }]}>{label}</Text><Pressable onPress={() => { onChange(formatDate(draft)); setIosOpen(false); }}><Text style={[c.dateAction, { color: palette.accent }]}>Готово</Text></Pressable></View><DateTimePicker value={draft} mode="date" display="spinner" minimumDate={minimumDate} maximumDate={maximumDate} onChange={(_, date) => date && setDraft(date)}/></View></Modal></View>;
}

export function MultiSelect({ options, values, onChange, error, columns = 2, disabled }: { options: { value: string; label: string }[]; values: string[]; onChange: (values: string[]) => void; error?: string; columns?: number; disabled?: boolean }) {
  const { palette } = useTheme();
  return <View style={disabled && c.readOnly}><View style={c.chips}>{options.map(option => { const selected = values.includes(option.value); return <Pressable key={option.value} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={() => onChange(selected ? values.filter(value => value !== option.value) : [...values, option.value])} style={[c.chip, { width: columns === 1 ? '100%' : columns === 3 ? '31%' : '48%', borderColor: selected ? palette.accent : palette.line, backgroundColor: selected ? palette.elevated : palette.surface }]}><Text style={[c.chipText, { color: selected ? palette.accent : palette.ink }]}>{option.label}</Text>{selected ? <Icon name="checkmark-circle" size={18} color={palette.accent}/> : null}</Pressable>; })}</View>{error ? <Text accessibilityRole="alert" style={c.fieldError}>{error}</Text> : null}</View>;
}

export function ToggleRow({ title, description, value, onValueChange, disabled }: { title: string; description?: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  const { palette } = useTheme();
  return <View style={[c.toggleRow, disabled && c.readOnly, { borderColor: palette.line, backgroundColor: palette.surface }]}><View style={{ flex: 1, gap: 3 }}><Text style={[c.toggleTitle, { color: palette.ink }]}>{title}</Text>{description ? <Text style={[c.toggleDescription, { color: palette.muted }]}>{description}</Text> : null}</View><Switch disabled={disabled} value={value} onValueChange={onValueChange} trackColor={{ false: palette.line, true: palette.accent }} thumbColor="#FFFFFF"/></View>;
}

const statusCopy: Record<VerificationStatus, { label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'gray' }> = {
  NOT_UPLOADED: { label: 'Не загружено', tone: 'gray' }, DRAFT: { label: 'Черновик', tone: 'gray' }, UPLOADING: { label: 'Загрузка', tone: 'blue' }, UPLOADED: { label: 'Загружено', tone: 'green' }, UNDER_REVIEW: { label: 'Проверяется', tone: 'amber' }, APPROVED: { label: 'Одобрено', tone: 'green' }, ACTIVE: { label: 'Действует', tone: 'green' }, BLOCKED: { label: 'Заблокировано', tone: 'red' }, CORRECTION_REQUIRED: { label: 'Исправьте', tone: 'red' }, REJECTED: { label: 'Отклонено', tone: 'red' }, EXPIRING: { label: 'Истекает', tone: 'amber' }, EXPIRED: { label: 'Просрочено', tone: 'red' }, QUEUED: { label: 'В очереди', tone: 'amber' },
};

export function StatusBadge({ status }: { status: VerificationStatus }) {
  const { isDark } = useTheme(); const copy = statusCopy[status] || statusCopy.NOT_UPLOADED; const tones = { blue: ['#EAF4FF', '#087FFF'], green: ['#E9F8F1', '#15945A'], amber: ['#FFF6DE', '#A46900'], red: ['#FFF0F1', '#C74747'], gray: [isDark ? '#292929' : '#F0F3F7', '#708099'] } as const;
  return <View style={[c.badge, { backgroundColor: tones[copy.tone][0] }]}><Text style={[c.badgeText, { color: tones[copy.tone][1] }]}>{copy.label}</Text></View>;
}

export function UploadCard({ title, hint, upload, onPress, onDelete, required = true, image, profile, disabled }: { title: string; hint?: string; upload?: RegistrationUpload; onPress: () => void; onDelete?: () => void; required?: boolean; image?: boolean; profile?: boolean; disabled?: boolean }) {
  const { palette } = useTheme(); const hasImage = !!upload?.localUri || !!upload?.remoteUrl;
  const previewUri = upload?.localUri || (upload?.remoteUrl ? /^https?:\/\//i.test(upload.remoteUrl) ? upload.remoteUrl : `${api.baseUrl}${upload.remoteUrl.startsWith('/') ? '' : '/'}${upload.remoteUrl}` : undefined);
  const accessToken = api.getTokens()?.accessToken;
  const previewSource = previewUri ? { uri: previewUri, ...(upload?.remoteUrl && !upload.localUri && !/^https?:\/\//i.test(upload.remoteUrl) && accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}) } : undefined;
  if (profile) return <View style={[c.profileUploadCard, disabled && c.readOnly, { borderColor: upload?.reasonText ? colors.danger : palette.line, backgroundColor: palette.surface }]}><Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={c.profileUploadMain}>{previewSource && upload?.mimeType?.startsWith('image/') ? <Image source={previewSource} style={c.profileImage as ImageStyle}/> : <View style={[c.profilePlaceholder, { backgroundColor: '#EAF4FF' }]}><Image source={require('../../assets/registration/profile-avatar-3d.png')} resizeMode="cover" style={c.profilePlaceholderImage}/><View style={[c.profileAdd, { backgroundColor: palette.accent }]}><Icon name="add" size={21} color="#FFFFFF"/></View></View>}<View style={c.profileCopy}><View style={c.uploadTitleRow}><Text style={[c.profileUploadTitle, { color: palette.ink }]}>{title}</Text>{upload ? <StatusBadge status={upload.status}/> : null}</View><Text style={[c.profileUploadHint, { color: palette.muted }]}>{upload?.reasonText || hint || 'Фото увидят клиенты после назначения заказа'}</Text><View style={[c.profileUploadButton, { backgroundColor: palette.elevated }]}><Icon name={upload ? 'refresh-outline' : 'cloud-upload-outline'} size={18} color={palette.accent}/><Text style={[c.profileUploadButtonText, { color: palette.accent }]}>{upload ? 'Заменить фото' : 'Нажмите, чтобы загрузить'}</Text></View></View></Pressable>{hasImage && onDelete && !disabled ? <Pressable accessibilityRole="button" accessibilityLabel={`Удалить ${title}`} hitSlop={8} onPress={onDelete} style={c.profileDelete}><Icon name="trash-outline" size={18} color={colors.danger}/></Pressable> : null}</View>;
  return <View style={[c.uploadCard, disabled && c.readOnly, { borderColor: upload?.reasonText ? colors.danger : palette.line, backgroundColor: palette.surface }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={c.uploadMain}>{previewSource && image && upload?.mimeType?.startsWith('image/') ? <Image source={previewSource} style={c.uploadImage as ImageStyle}/> : <View style={[c.uploadIcon, { backgroundColor: palette.elevated }]}><Icon name={hasImage ? 'document-text-outline' : 'add'} size={24} color={palette.accent}/></View>}<View style={{ flex: 1, gap: 5 }}><View style={c.uploadTitleRow}><Text style={[c.uploadTitle, { color: palette.ink }]}>{title}</Text>{upload ? <StatusBadge status={upload.status}/> : null}</View><Text style={[c.uploadHint, { color: palette.muted }]}>{upload?.reasonText || hint || (required ? 'Обязательно' : 'Необязательно')}</Text>{upload?.status === 'UPLOADING' ? <View style={[c.tinyTrack, { backgroundColor: palette.line }]}><View style={[c.tinyFill, { width: `${Math.round((upload.progress || .2) * 100)}%`, backgroundColor: palette.accent }]}/></View> : null}</View><Icon name="chevron-forward" size={18} color={palette.muted}/></Pressable>
    {hasImage && onDelete && !disabled ? <Pressable accessibilityRole="button" accessibilityLabel={`Удалить ${title}`} hitSlop={8} onPress={onDelete} style={c.deleteButton}><Icon name="trash-outline" size={18} color={colors.danger}/></Pressable> : null}
  </View>;
}

export const DocumentCard = UploadCard;
export const PhotoUploader = UploadCard;

export function InfoCard({ title, text, tone = 'blue' }: { title?: string; text: string; tone?: 'blue' | 'amber' | 'green' }) {
  const { palette } = useTheme(); const bg = tone === 'amber' ? '#FFF6DE' : tone === 'green' ? '#EAF8F1' : palette.elevated; const color = tone === 'amber' ? '#A46900' : tone === 'green' ? '#15945A' : palette.accent;
  return <View style={[c.infoCard, { backgroundColor: bg }]}><Icon name={tone === 'green' ? 'checkmark-circle-outline' : 'information-circle-outline'} size={21} color={color}/><View style={{ flex: 1, gap: 3 }}>{title ? <Text style={[c.infoTitle, { color: palette.ink }]}>{title}</Text> : null}<Text style={[c.infoText, { color: palette.muted }]}>{text}</Text></View></View>;
}

export function ErrorCard({ title = 'Не удалось сохранить', text, onRetry }: { title?: string; text: string; onRetry?: () => void }) {
  return <View style={c.errorCard}><Icon name="alert-circle-outline" size={22} color={colors.danger}/><View style={{ flex: 1, gap: 3 }}><Text style={c.errorTitle}>{title}</Text><Text style={c.errorText}>{text}</Text>{onRetry ? <Pressable onPress={onRetry}><Text style={c.errorAction}>Повторить</Text></Pressable> : null}</View></View>;
}

export function OfflineState({ queued, onRetry }: { queued?: boolean; onRetry?: () => void }) {
  return <View style={c.offline}><InfoCard title="Нет подключения" text={queued ? 'Последний черновик сохранён. Изменения отправятся после восстановления сети.' : 'Проверьте подключение к интернету и повторите попытку.'}/>{onRetry ? <Pressable accessibilityRole="button" onPress={onRetry}><Text style={c.errorAction}>Повторить</Text></Pressable> : null}</View>;
}

export function LoadingState() {
  const { palette } = useTheme();
  return <View style={c.loading}>{[100, 68, 100, 100, 82].map((width, index) => <View key={index} style={[c.skeleton, { width: `${width}%`, height: index < 2 ? 22 : 62, backgroundColor: palette.elevated }]}/>)}</View>;
}

export function EmptyState({ icon = 'file-tray-outline', title, text, action }: { icon?: React.ComponentProps<typeof Icon>['name']; title: string; text: string; action?: React.ReactNode }) {
  const { palette } = useTheme();
  return <View style={c.empty}><View style={[c.heroIcon, { backgroundColor: palette.elevated }]}><Icon name={icon} size={42} color={palette.accent}/></View><Text style={[c.emptyTitle, { color: palette.ink }]}>{title}</Text><Text style={[c.emptyText, { color: palette.muted }]}>{text}</Text>{action}</View>;
}

export function BottomActionSheet({ visible, title, children, onClose }: { visible: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const { palette } = useTheme(); const insets = useSafeAreaInsets();
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}><Pressable style={[c.backdrop, { backgroundColor: palette.backdrop }]} onPress={onClose}/><View style={[c.sheet, { backgroundColor: palette.surface, paddingBottom: Math.max(18, insets.bottom + 8) }]}><View style={[c.handle, { backgroundColor: palette.line }]}/><View style={c.sheetHeader}><Text style={[c.sheetTitle, { color: palette.ink }]}>{title}</Text><Pressable onPress={onClose} hitSlop={10}><Icon name="close" color={palette.muted}/></Pressable></View><ScrollView bounces={false} contentContainerStyle={c.sheetContent}>{children}</ScrollView></View></Modal>;
}

export function OptionSheet({ visible, title, options, selected, onSelect, onClose }: { visible: boolean; title: string; options: { value: string; label: string }[]; selected?: string; onSelect: (value: string) => void; onClose: () => void }) {
  const { palette } = useTheme();
  return <BottomActionSheet visible={visible} title={title} onClose={onClose}>{options.map(option => <Pressable key={option.value} onPress={() => { onSelect(option.value); onClose(); }} style={[c.optionRow, { borderColor: palette.line }]}><Text style={[c.optionText, { color: palette.ink }]}>{option.label}</Text>{selected === option.value ? <Icon name="checkmark-circle" color={palette.accent}/> : null}</Pressable>)}</BottomActionSheet>;
}

export function SectionTitle({ title, description }: { title: string; description?: string }) {
  const { palette } = useTheme(); return <View style={c.sectionTitle}><Text style={[c.screenTitle, { color: palette.ink }]}>{title}</Text>{description ? <Text style={[c.screenDescription, { color: palette.muted }]}>{description}</Text> : null}</View>;
}

export function ChoiceCard({ title, description, selected, onPress, icon, image, disabled }: { title: string; description: string; selected: boolean; onPress: () => void; icon: React.ComponentProps<typeof Icon>['name']; image?: ImageSourcePropType; disabled?: boolean }) {
  const { palette } = useTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [c.choiceCard, disabled && c.readOnly, { borderColor: selected ? palette.accent : palette.line, backgroundColor: selected ? '#F4F9FF' : palette.surface }, pressed && c.pressed]}><View style={[c.choiceIcon, { backgroundColor: selected ? '#E7F2FF' : palette.elevated }]}>{image ? <Image source={image} resizeMode="contain" style={c.choiceImage}/> : <><View style={c.choiceGlow}/><Icon name={icon} size={34} color={palette.accent}/></>}</View><View style={c.choiceCopy}><Text style={[c.choiceTitle, { color: palette.ink }]}>{title}</Text><Text style={[c.choiceDescription, { color: palette.muted }]}>{description}</Text></View><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={25} color={selected ? palette.accent : palette.line}/></Pressable>;
}

export function CheckboxRow({ label, checked, onPress, error, disabled }: { label: string; checked: boolean; onPress: () => void; error?: string; disabled?: boolean }) {
  const { palette } = useTheme(); return <View style={disabled && c.readOnly}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={c.checkboxRow}><Icon name={checked ? 'checkbox' : 'square-outline'} color={error ? colors.danger : checked ? palette.accent : palette.muted} size={23}/><Text style={[c.checkboxText, { color: palette.ink }]}>{label}</Text></Pressable>{error ? <Text style={c.fieldError}>{error}</Text> : null}</View>;
}

export function VehicleCard({ title, subtitle, onPress, status = 'DRAFT' }: { title: string; subtitle: string; onPress?: () => void; status?: VerificationStatus }) {
  const { palette } = useTheme(); return <Pressable disabled={!onPress} onPress={onPress} style={[c.vehicleCard, { backgroundColor: palette.surface, borderColor: palette.line }]}><View style={[c.vehicleIcon, { backgroundColor: palette.elevated }]}><Icon name="car-sport-outline" size={28} color={palette.accent}/></View><View style={{ flex: 1, gap: 4 }}><Text style={[c.choiceTitle, { color: palette.ink }]}>{title}</Text><Text style={[c.choiceDescription, { color: palette.muted }]}>{subtitle}</Text></View><StatusBadge status={status}/></Pressable>;
}

export const DocumentCamera = View;

const c = StyleSheet.create({
  header: { gap: 14, paddingTop: 4 }, headerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, iconButton: { width: 42, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', elevation: 2, shadowColor: '#17345E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: .10, shadowRadius: 5 }, iconButtonPlaceholder: { width: 42, height: 42 }, helpButton: { minWidth: 66, height: 42, alignItems: 'flex-end', justifyContent: 'center' }, helpText: { fontSize: 14, fontWeight: '700' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, progressSegments: { height: 5, flex: 1, flexDirection: 'row', gap: 4 }, progressSegment: { flex: 1, height: 5, borderRadius: 999 }, progressText: { fontSize: 11, fontWeight: '700', minWidth: 66, textAlign: 'right' },
  primaryButton: { minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 18 }, primaryText: { fontSize: 16, fontWeight: '700' }, disabled: { opacity: .42 }, pressed: { opacity: .78 }, secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, secondaryText: { fontSize: 14, fontWeight: '600' },
  field: { gap: 6 }, label: { fontSize: 11, fontWeight: '600' }, input: { minHeight: 52, borderRadius: 13, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 }, multiline: { minHeight: 104, textAlignVertical: 'top', paddingTop: 14 }, select: { minHeight: 52, borderRadius: 13, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inputText: { fontSize: 15 }, fieldError: { color: colors.danger, fontSize: 11, lineHeight: 15, marginTop: 2 }, dateSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24 }, dateSheetHeader: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, dateTitle: { fontSize: 16, fontWeight: '800' }, dateAction: { fontSize: 14, fontWeight: '700' },
  readOnly: { opacity: .58 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  toggleRow: { minHeight: 66, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }, toggleTitle: { fontSize: 14, fontWeight: '600' }, toggleDescription: { fontSize: 11, lineHeight: 15 }, badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }, badgeText: { fontSize: 9, lineHeight: 11, fontWeight: '700' },
  uploadCard: { borderWidth: 1, borderRadius: 15, overflow: 'hidden' }, uploadMain: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11 }, uploadIcon: { width: 52, height: 52, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, uploadImage: { width: 62, height: 52, borderRadius: 11 }, uploadTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }, uploadTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 }, uploadHint: { fontSize: 11, lineHeight: 15 }, tinyTrack: { height: 3, borderRadius: 3, overflow: 'hidden' }, tinyFill: { height: 3, borderRadius: 3 }, deleteButton: { position: 'absolute', right: 8, bottom: 5, padding: 5 }, profileUploadCard: { minHeight: 166, borderWidth: 1, borderRadius: 23, overflow: 'hidden' }, profileUploadMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 }, profilePlaceholder: { width: 116, height: 116, borderRadius: 22, alignItems: 'center', justifyContent: 'flex-end', overflow: 'visible' }, profilePlaceholderImage: { width: 116, height: 116, borderRadius: 22 }, profileImage: { width: 116, height: 116, borderRadius: 22 }, profileHead: { position: 'absolute', top: 23, width: 39, height: 39, borderRadius: 20, backgroundColor: '#BDD0E8' }, profileBody: { width: 72, height: 49, borderTopLeftRadius: 34, borderTopRightRadius: 34, backgroundColor: '#BDD0E8' }, profileAdd: { position: 'absolute', right: -8, bottom: -8, width: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, profileCopy: { flex: 1, gap: 9 }, profileUploadTitle: { fontSize: 17, fontWeight: '800', flexShrink: 1 }, profileUploadHint: { fontSize: 12, lineHeight: 17 }, profileUploadButton: { minHeight: 42, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'stretch' }, profileUploadButtonText: { fontSize: 12, lineHeight: 16, fontWeight: '800', flexShrink: 1 }, profileDelete: { position: 'absolute', right: 8, bottom: 6, padding: 6 },
  infoCard: { borderRadius: 14, padding: 13, flexDirection: 'row', gap: 10 }, infoTitle: { fontSize: 13, fontWeight: '700' }, infoText: { fontSize: 11, lineHeight: 16 }, errorCard: { borderRadius: 14, padding: 13, flexDirection: 'row', gap: 10, backgroundColor: '#FFF0F1' }, errorTitle: { color: '#882E35', fontSize: 13, fontWeight: '700' }, errorText: { color: '#A34A52', fontSize: 11, lineHeight: 16 }, errorAction: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 3 },
  offline: { gap: 6 },
  loading: { gap: 14, paddingTop: 12 }, skeleton: { borderRadius: 11 }, empty: { alignItems: 'center', paddingVertical: 30, gap: 12 }, heroIcon: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { fontSize: 24, lineHeight: 30, fontWeight: '800', textAlign: 'center' }, emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 310 },
  backdrop: { ...StyleSheet.absoluteFillObject }, sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 }, handle: { width: 42, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 8 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 }, sheetTitle: { fontSize: 20, fontWeight: '800' }, sheetContent: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 }, optionRow: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, optionText: { fontSize: 15, fontWeight: '500' },
  sectionTitle: { gap: 7 }, screenTitle: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -.65 }, screenDescription: { fontSize: 14, lineHeight: 21 }, choiceCard: { minHeight: 124, borderWidth: 1.4, borderRadius: 22, paddingHorizontal: 13, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 13, elevation: 2, shadowColor: '#17345E', shadowOffset: { width: 0, height: 7 }, shadowOpacity: .07, shadowRadius: 13 }, choiceIcon: { width: 96, height: 92, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, choiceImage: { width: 106, height: 98 }, choiceGlow: { position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,.55)', transform: [{ translateX: 20 }, { translateY: 24 }] }, choiceCopy: { flex: 1, gap: 5 }, choiceTitle: { fontSize: 16, fontWeight: '800' }, choiceDescription: { fontSize: 12, lineHeight: 17 }, checkboxRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkboxText: { fontSize: 13, lineHeight: 18, flex: 1 }, vehicleCard: { minHeight: 76, borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 11 }, vehicleIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
