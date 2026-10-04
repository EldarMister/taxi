import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { api, messageOf, requestId } from './api';
import { ChatMessage, User } from './types';
import { Icon, localize } from './ui';
import { useTheme } from './design/theme';
import { BottomPanel } from './BottomPanel';

export { AddressPicker } from './AddressPicker';

type ChatProps = { orderId: string; user: User; peerName?: string; incoming: ChatMessage | null; onClose: () => void; onError: (message: string) => void };

export function ChatOverlay({ orderId, user, peerName, incoming, onClose, onError }: ChatProps) {
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const say = (ru: string, ky: string) => localize(user.language, ru, ky);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ uri: string } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachmentClosing, setAttachmentClosing] = useState(false);
  const pendingPhotoSource = useRef<'camera' | 'library' | null>(null);
  const key = useRef<{ signature: string; id: string } | null>(null);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const canSend = !!text.trim() || !!photo;
  const composerColor = isDark ? '#1B1D1D' : '#F1F4F8';
  const bubbleColor = isDark ? '#1B1D1D' : '#FFFFFF';
  const photoCardColor = isDark ? '#242526' : '#F4F4F4';
  const photoCardBorder = isDark ? '#343637' : '#ECEDEF';
  const photoIconColor = isDark ? '#ECEDEF' : '#25282C';

  const add = (message: ChatMessage) => setMessages(current => current.some(item => item.id === message.id)
    ? current : [...current, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  async function refresh() {
    try {
      const list = await api.request<ChatMessage[]>(`/orders/${orderId}/messages`);
      setMessages(current => {
        const combined = new Map([...current, ...list].map(item => [item.id, item]));
        return [...combined.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
    } catch (error) { onError(messageOf(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 10000); return () => clearInterval(timer); }, [orderId]);
  useEffect(() => { if (incoming?.orderId === orderId) add(incoming); }, [incoming?.id]);

  async function choosePhoto(source: 'camera' | 'library') {
    if (picking || sending) return;
    setPicking(true);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error(say('Разрешите доступ к камере, чтобы сделать фото.', 'Сүрөткө тартуу үчүн камерага уруксат бериңиз.'));
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: .82,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const resize = Math.max(asset.width, asset.height) > 1600
        ? [{ resize: asset.width >= asset.height ? { width: 1600 } : { height: 1600 } }] : [];
      const normalized = await ImageManipulator.manipulateAsync(asset.uri, resize,
        { compress: .8, format: ImageManipulator.SaveFormat.JPEG });
      setPhoto({ uri: normalized.uri });
    } catch (error) { onError(messageOf(error)); }
    finally { setPicking(false); }
  }

  const dismissComposerKeyboard = () => { input.current?.blur(); Keyboard.dismiss(); };
  const closeChat = () => { dismissComposerKeyboard(); onClose(); };
  const openAttachmentMenu = () => {
    dismissComposerKeyboard(); pendingPhotoSource.current = null;
    setAttachmentClosing(false); setAttachmentOpen(true);
  };
  const closeAttachmentMenu = () => setAttachmentClosing(true);
  const finishAttachmentClose = () => {
    const source = pendingPhotoSource.current;
    pendingPhotoSource.current = null;
    setAttachmentOpen(false); setAttachmentClosing(false);
    if (source) void choosePhoto(source);
  };
  const selectPhotoSource = (source: 'camera' | 'library') => {
    if (picking || sending || attachmentClosing) return;
    pendingPhotoSource.current = source;
    closeAttachmentMenu();
  };

  async function send() {
    const body = text.trim();
    if ((!body && !photo) || sending) return;
    const signature = `${body}\n${photo?.uri ?? ''}`;
    if (key.current?.signature !== signature) key.current = { signature, id: requestId() };
    setSending(true);
    try {
      let message: ChatMessage;
      if (photo) {
        const form = new FormData();
        form.append('image', { uri: photo.uri, name: 'chat-photo.jpg', type: 'image/jpeg' } as unknown as Blob);
        form.append('text', body);
        form.append('clientMessageId', key.current.id);
        message = await api.upload<ChatMessage>(`/orders/${orderId}/messages/photo`, form);
      } else {
        message = await api.post<ChatMessage>(`/orders/${orderId}/messages`, { text: body, clientMessageId: key.current.id });
      }
      add(message);
      setText('');
      setPhoto(null);
      key.current = null;
      dismissComposerKeyboard();
    } catch (error) { onError(messageOf(error)); }
    finally { setSending(false); }
  }

  const messageImage = (message: ChatMessage) => message.photoUrl ? {
    uri: `${api.baseUrl}${message.photoUrl}`,
    headers: { Authorization: `Bearer ${api.getTokens()?.accessToken ?? ''}` },
  } : null;

  return <Modal animationType="slide" onRequestClose={attachmentOpen ? closeAttachmentMenu : closeChat}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
      {/* Android Modal already resizes for the keyboard; extra padding can leave the composer lifted. */}
      <KeyboardAvoidingView accessibilityElementsHidden={attachmentOpen} importantForAccessibility={attachmentOpen ? 'no-hide-descendants' : 'auto'}
        style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={Platform.OS === 'ios'}>
        <View style={{ height: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: palette.line }}>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Назад', 'Артка')} onPress={closeChat}
            style={{ width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="chevron-back" size={27} color={palette.ink}/></Pressable>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: isDark ? '#343637' : '#E4EBF3', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person" size={22} color={palette.muted}/>
          </View>
          <View style={{ flex: 1 }}><Text testID="chat-peer-title" numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '700' }}>{user.role === 'DRIVER' ? say('Пассажир', 'Жүргүнчү') : peerName || say('Чат', 'Чат')}</Text>
            <Text style={{ color: palette.muted, fontSize: 12 }}>{say('Поездка', 'Сапар')}</Text></View>
        </View>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {loading && <ActivityIndicator color={palette.accent}/>}
          {!loading && !messages.length && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Icon name="chatbubble-ellipses-outline" size={38} color={palette.muted}/>
            <Text style={{ color: palette.muted, fontSize: 15 }}>{say('Напишите первое сообщение', 'Биринчи билдирүүнү жазыңыз')}</Text>
          </View>}
          {messages.map(message => {
            const mine = message.senderId === user.id;
            const source = messageImage(message);
            return <View key={message.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', borderRadius: 18,
              borderBottomRightRadius: mine ? 5 : 18, borderBottomLeftRadius: mine ? 18 : 5,
              backgroundColor: mine ? isDark ? '#343637' : '#DCEBFB' : bubbleColor,
              padding: source ? 6 : 12, borderWidth: isDark && !mine ? 1 : 0, borderColor: palette.line }}>
              {source && <Pressable accessibilityRole="button" accessibilityLabel={say('Открыть фотографию', 'Сүрөттү ачуу')} onPress={() => setViewer(source.uri)}>
                <Image source={source} resizeMode="cover" style={{ width: 220, height: 180, borderRadius: 13 }}/>
              </Pressable>}
              {!!message.text && <Text style={{ color: palette.ink, fontSize: 15, lineHeight: 21, paddingHorizontal: source ? 6 : 0, paddingTop: source ? 7 : 0 }}>{message.text}</Text>}
              <Text style={{ color: palette.muted, fontSize: 10, textAlign: 'right', marginTop: 5, paddingHorizontal: source ? 6 : 0 }}>
                {new Date(message.createdAt).toLocaleTimeString(user.language === 'ky' ? 'ky-KG' : user.language === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>;
          })}
        </ScrollView>
        {photo && <View style={{ paddingHorizontal: 18, paddingVertical: 8, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={{ uri: photo.uri }} style={{ width: 56, height: 56, borderRadius: 11 }}/>
          <Text style={{ flex: 1, color: palette.muted, fontSize: 13 }}>{say('Фото готово к отправке', 'Сүрөт жөнөтүүгө даяр')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Убрать фото', 'Сүрөттү алып салуу')} onPress={() => setPhoto(null)}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={22} color={palette.muted}/></Pressable>
        </View>}
        <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Прикрепить фото', 'Сүрөт тиркөө')} disabled={sending || picking} onPress={openAttachmentMenu}
            style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: composerColor, alignItems: 'center', justifyContent: 'center', opacity: sending || picking ? .5 : 1 }}>
            {picking ? <ActivityIndicator color={palette.muted}/> : <Icon name="add" size={28} color={palette.muted}/>}
          </Pressable>
          <TextInput ref={input} accessibilityLabel={say('Сообщение', 'Билдирүү')} value={text} onChangeText={setText} multiline maxLength={1000}
            placeholder={say('Сообщение...', 'Билдирүү...')} placeholderTextColor={palette.muted}
            style={{ flex: 1, minHeight: 46, maxHeight: 118, borderRadius: 23, backgroundColor: composerColor, paddingHorizontal: 16,
              paddingVertical: 11, color: palette.ink, fontSize: 15, lineHeight: 21 }}/>
          {canSend && <Pressable accessibilityRole="button" accessibilityLabel={say('Отправить сообщение', 'Билдирүү жөнөтүү')}
            accessibilityState={{ disabled: sending }} disabled={sending} onPress={() => void send()}
            style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent }}>
            {sending ? <ActivityIndicator color={palette.accentText}/> : <Icon name="arrow-up" size={23} color={palette.accentText}/>}
          </Pressable>}
        </View>
      </KeyboardAvoidingView>
      {attachmentOpen && <BottomPanel onClose={finishAttachmentClose} closeRequested={attachmentClosing}
        handlePlacement="inside" label={say('Закрыть выбор фото', 'Сүрөт тандоону жабуу')} bottomPadding={Math.max(36, insets.bottom + 18)}>
        <View testID="chat-photo-sheet" style={chatStyles.sheet}>
          <Text accessibilityRole="header" style={[chatStyles.sheetTitle, { color: palette.ink }]}>{say('Добавить фото', 'Сүрөт кошуу')}</Text>
          <View testID="chat-photo-options" style={chatStyles.sheetActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Сделать фото', 'Сүрөткө тартуу')}
            disabled={picking || sending || attachmentClosing}
            onPress={() => selectPhotoSource('camera')} style={({ pressed }) => [chatStyles.sheetAction, { backgroundColor: photoCardColor, borderColor: photoCardBorder, opacity: pressed || attachmentClosing ? .7 : 1 }]}>
            <Icon name="camera-outline" size={36} color={photoIconColor}/>
            <Text style={[chatStyles.sheetActionTitle, { color: palette.ink }]}>{say('Камера', 'Камера')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={say('Выбрать из галереи', 'Галереядан тандоо')}
            disabled={picking || sending || attachmentClosing}
            onPress={() => selectPhotoSource('library')} style={({ pressed }) => [chatStyles.sheetAction, { backgroundColor: photoCardColor, borderColor: photoCardBorder, opacity: pressed || attachmentClosing ? .7 : 1 }]}>
            <Icon name="image-outline" size={36} color={photoIconColor}/>
            <Text style={[chatStyles.sheetActionTitle, { color: palette.ink }]}>{say('Галерея', 'Галерея')}</Text>
          </Pressable>
          </View>
        </View>
      </BottomPanel>}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable onPress={() => setViewer(null)} style={{ flex: 1, backgroundColor: '#050505', justifyContent: 'center' }}>
          {viewer && <Image source={{ uri: viewer, headers: { Authorization: `Bearer ${api.getTokens()?.accessToken ?? ''}` } }} resizeMode="contain" style={{ width: '100%', height: '85%' }}/>}
          <View style={{ position: 'absolute', top: 52, right: 20 }}><Icon name="close" size={30} color="#FFFFFF"/></View>
        </Pressable>
      </Modal>
    </SafeAreaView>
    </GestureHandlerRootView>
  </Modal>;
}

const chatStyles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 12, gap: 18 },
  sheetTitle: { fontSize: 21, fontWeight: '400' },
  sheetActions: { flexDirection: 'row', gap: 10 },
  sheetAction: { flex: 1, minWidth: 0, minHeight: 112, borderWidth: 1, borderRadius: 17, paddingHorizontal: 8, paddingVertical: 20, alignItems: 'center', justifyContent: 'center', gap: 8 },
  sheetActionTitle: { fontSize: 17, fontWeight: '400', textAlign: 'center' },
});
