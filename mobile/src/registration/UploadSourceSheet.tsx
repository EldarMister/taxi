import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomPanel } from '../BottomPanel';
import { LocalizedText as Text } from '../auth/LocalizedText';
import { fonts } from '../design/typography';
import { Icon } from '../ui';
import { useRegistrationDesign } from './design';

export type UploadSource = 'camera' | 'gallery' | 'file';
export function UploadSourceSheet({ title, onClose, onSelect }: { title: string; onClose: () => void; onSelect: (source: UploadSource) => void }) {
  const { palette } = useRegistrationDesign(), [closing, setClosing] = useState(false), selected = useRef<UploadSource | null>(null);
  const options = [{ source: 'camera', title: 'Камера', icon: 'camera-outline' }, { source: 'gallery', title: 'Галерея', icon: 'image-outline' }, { source: 'file', title: 'Файл', icon: 'document-outline' }] as const;
  return <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={() => setClosing(true)}><GestureHandlerRootView style={{ flex: 1 }}>
    <BottomPanel closeRequested={closing} label="Закрыть выбор источника" onClose={() => { const source = selected.current; onClose(); if (source) onSelect(source); }} handleStyle={{ transform: [{ translateY: 2 }] }} surfaceStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
      <View style={s.content}><Text style={[s.title, { color: palette.ink }]}>{title}</Text><View testID="upload-source-row" style={s.row}>{options.map(option => <Pressable key={option.source} accessibilityRole="button" accessibilityLabel={option.title} onPress={() => { selected.current = option.source; setClosing(true); }} style={({ pressed }) => [s.tile, { borderColor: palette.line, backgroundColor: palette.elevated }, pressed && { opacity: .7 }]}><Icon name={option.icon} size={31} color={palette.ink}/><Text style={[s.label, { color: palette.ink }]}>{option.title}</Text></Pressable>)}</View></View>
    </BottomPanel>
  </GestureHandlerRootView></Modal>;
}
const s = StyleSheet.create({ content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 34, gap: 14 }, title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 27 }, row: { flexDirection: 'row', gap: 8 }, tile: { flex: 1, minWidth: 0, height: 96, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 10 }, label: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 } });
