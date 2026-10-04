import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TaxiMap, { type MapSelectionPanel } from '../native/TaxiMap';
import { BISHKEK, searchAddresses, type MapPoint } from '../native/mapkit';
import { getCurrentPosition, getLocationPermissionState } from '../native/location';
import { AddressPicker } from '../AddressPicker';
import { BottomPanel } from '../BottomPanel';
import { Icon } from '../ui';
import { shortAddress } from '../address';
import { messageOf } from '../api';
import { useTheme } from '../design/theme';
import { fonts } from '../design/typography';
import { FoodButton } from './components';
import { useFoodT } from './i18n';
import { useFoodStyles } from './foodTheme';
import type { CheckoutDetails } from './CheckoutScreens';
import type { Language, Point } from '../types';

export function FoodAddressPicker({ details, defaultPoint, language, onSave, onClose }: {
  details: CheckoutDetails;
  defaultPoint?: MapPoint | null;
  language: Language;
  onSave: (details: CheckoutDetails) => void;
  onClose: () => void;
}) {
  const t = useFoodT();
  const s = useFoodStyles(styles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(details);
  const [point, setPoint] = useState<MapPoint>(details.addressPoint ? { ...details.addressPoint, address: details.address } : defaultPoint ?? BISHKEK);
  const [needsSavedAddress, setNeedsSavedAddress] = useState(() => !details.addressPoint && !!details.address && details.address !== defaultPoint?.address);
  const [locating, setLocating] = useState(false);
  const interacted = useRef(false);
  const locationRequest = useRef(0);
  const [focus, setFocus] = useState<MapPoint | null>(null);
  const [panelHeight, setPanelHeight] = useState(320 + insets.bottom);
  const [searchOpen, setSearchOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentClosing, setCommentClosing] = useState(false);
  const [commentDraft, setCommentDraft] = useState(details.comment);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { locationRequest.current++; }, []);

  useEffect(() => {
    let live = true;
    void getLocationPermissionState().then(value => { if (live) setLocationEnabled(value.granted && value.servicesEnabled); }).catch(() => undefined);
    // Older saved carts may have only an address. Resolve it before centering,
    // instead of presenting the taxi pickup as the selected food destination.
    if (!details.addressPoint && details.address && details.address !== defaultPoint?.address) {
      const controller = new AbortController();
      void searchAddresses(details.address, defaultPoint ?? BISHKEK, controller.signal, language).then(points => {
        if (live && !interacted.current && points[0]) { setPoint(points[0]); setFocus(points[0]); setNeedsSavedAddress(false); }
      }).catch(() => undefined);
      return () => { live = false; controller.abort(); };
    }
    return () => { live = false; };
  }, []);

  const changeField = (key: 'entrance' | 'floor' | 'apartment' | 'intercom', value: string) => setDraft(current => ({ ...current, [key]: value }));
  const close = () => { Keyboard.dismiss(); onClose(); };
  const closeComment = () => { Keyboard.dismiss(); setCommentClosing(true); };
  const finishCommentClose = () => { Keyboard.dismiss(); setCommentOpen(false); setCommentClosing(false); };
  const locate = async () => {
    interacted.current = true;
    const request = ++locationRequest.current;
    setLocating(true);
    try { const next = await getCurrentPosition(); if (request !== locationRequest.current) return; setPoint(next); setFocus(next); setNeedsSavedAddress(false); setLocationEnabled(true); setError(''); }
    catch (reason) { if (request === locationRequest.current) setError(messageOf(reason)); }
    finally { if (request === locationRequest.current) setLocating(false); }
  };
  const mapInteraction = (action: 'move' | 'locate-start' | 'locate-success') => {
    interacted.current = true;
    locationRequest.current++;
    setLocating(false);
    if (action !== 'locate-start') { setNeedsSavedAddress(false); setError(''); }
  };
  const save = (selection: MapSelectionPanel) => {
    if (needsSavedAddress || locating || !selection.ready || selection.moving || selection.locatingAddress || !selection.address || selection.address === 'Точка на карте') return;
    Keyboard.dismiss();
    onSave({ ...draft, address: selection.address, addressPoint: { latitude: selection.point.latitude, longitude: selection.point.longitude } });
  };
  const renderPanel = (selection: MapSelectionPanel) => <View style={[s.panel, { paddingBottom: Math.max(insets.bottom, 14) }]}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={s.fields}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Найти адрес')} onPress={() => { locationRequest.current++; setLocating(false); setPoint({ ...selection.point, address: selection.address }); setSearchOpen(true); }} style={s.address}>
        <View style={{ flex: 1 }}><Text numberOfLines={2} style={s.addressText}>{selection.moving ? t('Выбираем точку…') : needsSavedAddress ? details.address : selection.address || t('Определяем адрес…')}</Text><Text style={s.caption}>{t('Адрес доставки')}</Text></View>
        <Icon name="chevron-forward" size={23} color={theme.palette.ink}/>
      </Pressable>
      <View style={s.row}>{(['entrance', 'floor'] as const).map((key, index) => <TextInput key={key} accessibilityLabel={t(index ? 'Этаж' : 'Подъезд')} placeholder={t(index ? 'Этаж' : 'Подъезд')} value={draft[key] ?? ''} onChangeText={value => changeField(key, value)} placeholderTextColor={theme.palette.muted} style={s.input} maxLength={20} returnKeyType="done"/>)}</View>
      <View style={s.row}>{(['apartment', 'intercom'] as const).map((key, index) => <TextInput key={key} accessibilityLabel={t(index ? 'Домофон' : 'Квартира')} placeholder={t(index ? 'Домофон' : 'Квартира')} value={draft[key] ?? ''} onChangeText={value => changeField(key, value)} placeholderTextColor={theme.palette.muted} style={s.input} maxLength={30} returnKeyType="done"/>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Комментарий курьеру')} onPress={() => { setCommentDraft(draft.comment); setCommentClosing(false); setCommentOpen(true); }} style={s.comment}><Text style={[s.commentText, !!draft.comment && s.filledComment]} numberOfLines={1}>{draft.comment || t('Комментарий курьеру')}</Text><Icon name="chevron-forward" size={23} color={theme.palette.ink}/></Pressable>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
      {needsSavedAddress && <Text style={s.caption}>{t('Уточните адрес через поиск или выберите точку на карте.')}</Text>}
      {selection.address === 'Точка на карте' && <Text accessibilityRole="alert" style={s.error}>{t('Не удалось определить адрес. Уточните его через поиск.')}</Text>}
    </ScrollView>
    <FoodButton label={t('Готово')} disabled={needsSavedAddress || locating || !selection.ready || selection.moving || selection.locatingAddress || !selection.address || selection.address === 'Точка на карте'} onPress={() => save(selection)} style={s.done}/>
  </View>;

  return <Modal visible animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (searchOpen) setSearchOpen(false); else if (commentOpen) closeComment(); else close(); }}>
    <GestureHandlerRootView style={s.screen}>
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={Platform.OS === 'ios'} pointerEvents={commentOpen ? 'none' : 'auto'} accessibilityElementsHidden={commentOpen} importantForAccessibility={commentOpen ? 'no-hide-descendants' : 'auto'}>
      <TaxiMap theme={theme.resolved} language={language} passengerView pickup={point} focusPoint={focus} selectionMode="pickup" selectionAppearance="food" onSelectionInteraction={mapInteraction} renderSelectionPanel={renderPanel} onPanelHeight={setPanelHeight} showUserPosition={locationEnabled} contentTopInset={insets.top}/>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Назад')} onPress={close} style={[s.back, { bottom: panelHeight + 12 }]}><Icon name="arrow-back" size={26} color={theme.palette.ink}/></Pressable>
      {searchOpen && <AddressPicker field="dropoff" savedPlace={{ title: 'Адрес доставки', point: { ...point, address: shortAddress(point.address || draft.address) } as Point }} center={point} language={language} onFieldChange={() => undefined} onSelect={next => { interacted.current = true; locationRequest.current++; setLocating(false); setNeedsSavedAddress(false); setError(''); setPoint(next); setFocus(next); }} onClose={() => setSearchOpen(false)} onMap={() => setSearchOpen(false)} onLocation={() => { void locate(); }}/>} 
    </KeyboardAvoidingView>
    {commentOpen && <BottomPanel label={t('Закрыть')} closeRequested={commentClosing} onClose={finishCommentClose} bottomPadding={Math.max(insets.bottom, 16)}>
      <ScrollView testID="food-courier-comment" keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.commentSheet}>
        <View style={s.commentHeader}><Text style={s.commentTitle}>{t('Комментарий курьеру')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} disabled={commentClosing} onPress={closeComment} style={s.close}><Icon name="close" size={24} color={theme.palette.ink}/></Pressable></View>
        <TextInput autoFocus multiline textAlignVertical="top" accessibilityLabel={t('Комментарий курьеру')} placeholder={t('Как вас найти?')} placeholderTextColor={theme.palette.muted} value={commentDraft} onChangeText={setCommentDraft} editable={!commentClosing} maxLength={300} style={s.commentInput}/>
        <FoodButton label={t('Сохранить')} disabled={commentClosing} onPress={() => { if (commentClosing) return; setDraft(current => ({ ...current, comment: commentDraft.trim() })); closeComment(); }}/>
      </ScrollView>
    </BottomPanel>}
    </GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  panel: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 16, paddingTop: 10 },
  fields: { maxHeight: 300 },
  address: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5', paddingBottom: 11 },
  addressText: { color: '#222222', fontFamily: fonts.regular, fontSize: 16, lineHeight: 21 },
  caption: { color: '#999999', fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 12 },
  input: { flex: 1, minWidth: 0, height: 55, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5', fontFamily: fonts.regular, color: '#222222', fontSize: 16, paddingVertical: 10 },
  comment: { height: 55, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center', gap: 12 },
  commentText: { flex: 1, color: '#999999', fontFamily: fonts.regular, fontSize: 16 },
  filledComment: { color: '#222222' },
  done: { marginTop: 20, minHeight: 56, borderRadius: 16 },
  back: { position: 'absolute', left: 10, width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000000', shadowRadius: 8, shadowOpacity: .1, shadowOffset: { width: 0, height: 3 } },
  error: { color: '#B74747', fontSize: 13, paddingVertical: 8 },
  commentSheet: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingTop: 12, gap: 14 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  commentTitle: { flex: 1, fontSize: 23, fontFamily: fonts.bold, color: '#222222' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#F5F4F2' },
  commentInput: { minHeight: 110, maxHeight: 200, fontSize: 16, fontFamily: fonts.regular, color: '#222222', padding: 14, borderRadius: 15, backgroundColor: '#F5F4F2' },
});
