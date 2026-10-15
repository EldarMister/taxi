import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LocalizedText as Text } from '../auth/LocalizedText';
import { api } from '../api';
import { fonts } from '../design/typography';
import { Icon } from '../ui';
import { useRegistrationDesign } from './design';
import { uploadedPhoto } from './photoUploads';
import type { RegistrationUpload } from './types';

export function VehiclePhotoCard({ title, upload, disabled, onPress, onView, onDelete }: { title: string; upload?: RegistrationUpload; disabled?: boolean; onPress: () => void; onView?: () => void; onDelete?: () => void }) {
  const { palette } = useRegistrationDesign(), compact = useWindowDimensions().width < 390;
  const successful = uploadedPhoto(upload), pending = upload?.status === 'UPLOADING' || upload?.status === 'QUEUED';
  const shown = upload?.pendingDelete ? undefined : upload;
  const uri = shown?.localUri || (shown?.remoteUrl ? /^https?:\/\//.test(shown.remoteUrl) ? shown.remoteUrl : `${api.baseUrl}${shown.remoteUrl.startsWith('/') ? '' : '/'}${shown.remoteUrl}` : undefined);
  const token = api.getTokens()?.accessToken;
  const source = uri ? { uri, ...(shown?.remoteUrl && !shown.localUri && token && !/^https?:\/\//.test(shown.remoteUrl) ? { headers: { Authorization: `Bearer ${token}` } } : {}) } : undefined;
  const status = pending ? upload?.status === 'UPLOADING' ? 'Загружается' : 'Ожидает загрузки' : successful ? 'Загружено' : '';
  const mainDisabled = !!pending || !!disabled && !(successful && onView);
  const state = !!status && <View style={s.status}>{pending ? <ActivityIndicator size="small" color={palette.ink}/> : <Icon name="checkmark" size={17} color={palette.ink}/>}<Text style={[s.statusText, { color: palette.ink }]}>{status}</Text></View>;
  return <View style={[s.card, { borderColor: palette.line, backgroundColor: palette.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${successful ? 'Просмотреть' : 'Добавить'}: ${title}`} accessibilityState={{ disabled: mainDisabled }} disabled={mainDisabled} onPress={successful && onView ? onView : onPress} style={s.main}>
      {source && shown?.mimeType?.startsWith('image/') ? <Image source={source} style={s.thumbnail}/> : <View style={[s.placeholder, { backgroundColor: palette.elevated, borderColor: palette.line }]}><Icon name={source ? 'document-outline' : 'add'} size={27} color={palette.ink}/></View>}
      <View style={s.copy}><Text style={[s.title, { color: palette.ink }]}>{title}</Text><Text style={[s.hint, { color: palette.muted }]}>{upload?.reasonText || 'Обязательный ракурс'}</Text>{compact && state}</View>
    </Pressable>
    {!compact && state}
    {shown && onDelete && !disabled && <Pressable accessibilityRole="button" accessibilityLabel={`Удалить ${title}`} disabled={pending} onPress={onDelete} hitSlop={5} style={[s.action, { borderColor: palette.line }]}><Icon name="trash-outline" size={20} color={palette.ink}/></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel={`${successful ? 'Заменить' : 'Добавить'} ${title}`} accessibilityState={{ disabled: !!disabled || !!pending }} disabled={disabled || pending} onPress={onPress} hitSlop={5} style={s.arrow}><Icon name="chevron-forward" size={21} color={palette.ink}/></Pressable>
  </View>;
}
const s = StyleSheet.create({
  card: { minHeight: 74, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, gap: 5 },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 52, height: 52, borderRadius: 10 }, placeholder: { width: 52, height: 52, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 4 }, title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 }, hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }, statusText: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14, flexShrink: 1 }, action: { width: 30, height: 32, borderLeftWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' }, arrow: { width: 24, height: 42, alignItems: 'center', justifyContent: 'center' },
});
