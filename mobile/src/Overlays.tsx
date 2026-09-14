import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, messageOf, requestId } from './api';
import { ChatMessage, User } from './types';
import { Button, colors, Empty, Icon, IconButton, s, tr } from './ui';
import { useTheme } from './design/theme';

export { AddressPicker } from './AddressPicker';

export function ChatOverlay({ orderId, user, incoming, onClose, onError }: { orderId: string; user: User; incoming: ChatMessage | null; onClose: () => void; onError: (message: string) => void }) {
  const theme = useTheme();
  const t = tr(user.language); const [messages, setMessages] = useState<ChatMessage[]>([]); const [text, setText] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const key = useRef<{ text: string; id: string } | null>(null); const scroll = useRef<ScrollView>(null);
  const add = (message: ChatMessage) => setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  async function refresh() { try { const list = await api.request<ChatMessage[]>(`/orders/${orderId}/messages`); setMessages(current => { const combined = new Map([...current, ...list].map(item => [item.id, item])); return [...combined.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }); } catch (e) { onError(messageOf(e)); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 10000); return () => clearInterval(timer); }, [orderId]);
  useEffect(() => { if (incoming?.orderId === orderId) add(incoming); }, [incoming?.id]);
  async function send() { const body = text.trim(); if (!body) return; if (key.current?.text !== body) key.current = { text: body, id: requestId() }; setSending(true); try { const message = await api.post<ChatMessage>(`/orders/${orderId}/messages`, { text: body, clientMessageId: key.current.id }); add(message); setText(''); key.current = null; } catch (e) { onError(messageOf(e)); } finally { setSending(false); } }
  return <Modal animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.isDark ? theme.palette.background : '#F4F8FD' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={[s.spread, { padding: 18, backgroundColor: theme.isDark ? theme.palette.surface : 'white', borderBottomWidth: theme.isDark ? 1 : 0, borderBottomColor: theme.palette.line }]}>
          <IconButton name="arrow-back" label={t('Назад')} onPress={onClose}/>
          <Text style={[s.h2, theme.isDark && { color: theme.palette.ink }]}>{t('Чат')}</Text>
          <View style={{ width: 44 }}/>
        </View>
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, gap: 12, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {loading && <ActivityIndicator color={theme.isDark ? theme.palette.accent : colors.blue}/>}
          {!loading && messages.length === 0 && (theme.isDark ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}><Icon name="chatbubbles-outline" color={theme.palette.ink} size={42}/><Text style={{ color: theme.palette.ink, fontSize: 17, fontWeight: '600' }}>{t('Напишите первое сообщение')}</Text></View> : <Empty icon="chatbubbles-outline" title={t('Напишите первое сообщение')}/>)}
          {messages.map(message => {
            const mine = message.senderId === user.id;
            return <View key={message.id} style={{ backgroundColor: theme.isDark ? mine ? theme.palette.accent : theme.palette.surface : mine ? colors.blue : 'white', alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%', padding: 13, borderRadius: 18, borderBottomRightRadius: mine ? 5 : 18, borderBottomLeftRadius: mine ? 18 : 5, ...(theme.isDark && !mine ? { borderWidth: 1, borderColor: theme.palette.line } : {}) }}>
              <Text style={{ color: theme.isDark ? mine ? theme.palette.accentText : theme.palette.ink : mine ? 'white' : colors.ink, fontSize: 16, lineHeight: 23 }}>{message.text}</Text>
              <Text style={{ color: theme.isDark ? mine ? '#555555' : theme.palette.muted : mine ? '#C9E5FF' : colors.muted, fontSize: 10, marginTop: 6, textAlign: 'right' }}>{new Date(message.createdAt).toLocaleTimeString(user.language === 'ky' ? 'ky-KG' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>;
          })}
        </ScrollView>
        <View style={[s.row, { padding: 16, backgroundColor: theme.isDark ? theme.palette.surface : 'white', alignItems: 'flex-end', borderTopWidth: theme.isDark ? 1 : 0, borderTopColor: theme.palette.line }]}>
          <TextInput accessibilityLabel={t('Ваше сообщение')} value={text} onChangeText={setText} multiline maxLength={1000} placeholder={t('Ваше сообщение')} placeholderTextColor={theme.isDark ? theme.palette.muted : undefined} style={[s.input, { flex: 1, maxHeight: 100 }, theme.isDark && { backgroundColor: theme.palette.elevated, borderColor: theme.palette.line, color: theme.palette.ink }]}/>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Отправить сообщение")} disabled={sending || !text.trim()} onPress={send} style={{ backgroundColor: theme.isDark ? theme.palette.accent : colors.blue, borderRadius: 18, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', opacity: sending || !text.trim() ? .5 : 1 }}>
            {sending ? <ActivityIndicator color={theme.isDark ? theme.palette.accentText : 'white'}/> : <Icon name="send" color={theme.isDark ? theme.palette.accentText : 'white'}/>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
