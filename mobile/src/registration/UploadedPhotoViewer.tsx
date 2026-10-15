import React from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { Icon } from '../ui';
import { LocalizedText as Text } from '../auth/LocalizedText';
import { useRegistrationDesign } from './design';
import type { RegistrationUpload } from './types';

export function UploadedPhotoViewer({ upload, title, onClose, onReplace }: { upload: RegistrationUpload; title: string; onClose: () => void; onReplace?: () => void }) {
  const { palette } = useRegistrationDesign();
  const uri = upload.localUri || (upload.remoteUrl && (/^https?:\/\//.test(upload.remoteUrl) ? upload.remoteUrl : `${api.baseUrl}${upload.remoteUrl.startsWith('/') ? '' : '/'}${upload.remoteUrl}`));
  const token = api.getTokens()?.accessToken;
  return <Modal visible animationType="none" onRequestClose={onClose}><SafeAreaView style={[s.screen, { backgroundColor: palette.background }]}><View style={s.header}><Pressable accessibilityLabel="Назад" onPress={onClose} style={s.back}><Icon name="arrow-back" size={24} color={palette.ink}/></Pressable><Text style={[s.title, { color: palette.ink }]}>{title}</Text>{onReplace&&<Pressable accessibilityRole="button" onPress={onReplace}><Text style={{ color: palette.accent, fontSize: 14 }}>Заменить</Text></Pressable>}</View>{uri && upload.mimeType?.startsWith('image/') ? <Image source={{ uri, ...(token && upload.remoteUrl && !upload.localUri && !/^https?:\/\//.test(upload.remoteUrl) ? { headers: { Authorization: `Bearer ${token}` } } : {}) }} resizeMode="contain" style={s.image}/> : <View style={s.file}><Icon name="document-outline" size={48} color={palette.ink}/><Text style={{ color: palette.ink }}>{upload.name || 'PDF'}</Text></View>}</SafeAreaView></Modal>;
}
const s = StyleSheet.create({ screen: { flex: 1 }, header: { paddingHorizontal: 16, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 40, height: 44, justifyContent: 'center' }, title: { flex: 1, fontSize: 18, fontWeight: '600' }, image: { flex: 1, margin: 16 }, file: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 } });
