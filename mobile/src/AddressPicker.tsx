import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomPanel } from './BottomPanel';
import { shortAddress } from './address';
import { addressCategoryLabel, addressDistanceOrigin, addressMatches, addressResultDistance, addressResultIcon } from './addressSearchPresentation';
import { AddressPlaceIcon } from './AddressPlaceIcon';
import { api, messageOf } from './api';
import { searchAddresses } from './native/search';
import { Coordinate, Order, Point, User } from './types';
import { colors, Icon, PickupIcon, s, tr } from './ui';
import { useTheme } from './design/theme';
import { useThemeStyles } from './design/themeStyles';

type Field = 'pickup' | 'dropoff';
export function AddressPicker({ field, center, userLocation, pickup, dropoff, savedPlace, language, onFieldChange, onSelect, onClose, onMap, onLocation }: {
  field: Field; center?: Coordinate | null; userLocation?: Coordinate | null; pickup?: Point | null; dropoff?: Point | null; language: User['language'];
  savedPlace?: { title: string; point?: Point | null };
  onFieldChange: (field: Field) => void; onSelect: (point: Point) => void; onClose: () => void; onMap: () => void; onLocation: () => void;
}) {
  const { isDark, palette } = useTheme();
  const a = useThemeStyles(baseA);
  const t = tr(language);
  const input = useRef<TextInput>(null);
  const focusNextField = useRef(false);
  const [query, setQuery] = useState(shortAddress((savedPlace?.point || (field === 'pickup' ? pickup : dropoff))?.address));
  const [results, setResults] = useState<Point[]>([]);
  const [recent, setRecent] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [edited, setEdited] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  const sequence = useRef(0);
  const [search, setSearch] = useState<{ query: string; field: Field; id: number } | null>(null);
  const distanceOrigin = addressDistanceOrigin(field, userLocation, pickup, !!savedPlace);
  const searchCenter = distanceOrigin || center;
  useEffect(() => { setQuery(shortAddress((savedPlace?.point || (field === 'pickup' ? pickup : dropoff))?.address)); setEdited(false); setSearch(null); setResults([]); setError(''); if (focusNextField.current) { input.current?.focus(); focusNextField.current = false; } }, [field, savedPlace?.title]);
  useEffect(() => {
    if (!edited || query.trim().length < 2 || search) return;
    const timer = setTimeout(() => setSearch({query:query.trim(),field,id:++sequence.current}),250);
    return () => clearTimeout(timer);
  }, [edited,query,field,search]);
  useEffect(() => {
    let live = true;
    void api.request<Order[]>('/orders/history?period=all').then(orders => {
      const seen = new Set<string>();
      const points = orders.filter(order => order.status === 'COMPLETED').map(order => order.dropoff).filter(point => { if (seen.has(point.address)) return false; seen.add(point.address); return true; }).slice(0, 7);
      if (live) setRecent(points);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const activateField = (next: Field) => { if (next === field) input.current?.focus(); else { focusNextField.current = true; onFieldChange(next); } };
  useEffect(() => {
    setResults([]); setError('');
    if (!search || search.query !== query.trim() || search.field !== field) { setLoading(false); return; }
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const points = await searchAddresses(search.query, searchCenter || undefined, controller.signal, language);
        if (live) setResults(points);
      } catch (e) { if (live) setError(messageOf(e)); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; controller.abort(); };
  }, [search, query, field, searchCenter?.latitude, searchCenter?.longitude, language]);
  const submitSearch = () => { if (query.trim().length >= 2) setSearch({ query: query.trim(), field, id: ++sequence.current }); };
  const changeQuery = (value: string) => { setEdited(true); setSearch(null); setQuery(value); };
  const requestClose = (action?: () => void) => { Keyboard.dismiss(); afterClose.current = action ?? null; setCloseRequested(true); };
  const close = () => { const action = afterClose.current; afterClose.current = null; action?.(); onClose(); };
  const visibleResults = query.trim() ? results : recent;
  const waiting = edited && !search && query.trim().length >= 2;
  const highlighted = (text: string) => addressMatches(text, query).map((part, index) => part.matched
    ? <Text key={index} style={[a.match, isDark && { color: '#75B7FF' }]}>{part.text}</Text> : part.text);
  return <BottomPanel expanded surfaceStyle={a.surface} closeRequested={closeRequested} onClose={close} label={t('Закрыть поиск')}>
        <View style={[a.routeCard, isDark && { backgroundColor: palette.elevated, shadowOpacity: 0 }]}>{(savedPlace ? [field] : ['pickup', 'dropoff'] as const).map((item, index) => {
          const active = item === field;
          const point = savedPlace?.point || (item === 'pickup' ? pickup : dropoff);
          const iconColor = active ? isDark ? palette.accentText : colors.ink : palette.ink;
          return <View key={item} style={a.routeRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={savedPlace ? t(savedPlace.title) : t(item === 'pickup' ? 'Изменить место подачи' : 'Изменить пункт назначения')} onPress={() => activateField(item)} style={[a.pin, active && { backgroundColor: palette.accent }]}>{savedPlace ? <Icon name="location" color={iconColor}/> : item === 'pickup' ? <PickupIcon color={iconColor}/> : <Icon name="flag" color={iconColor}/>}</Pressable>
            <View style={[a.routeContent, !savedPlace && index === 0 && a.routeDivider]}>
            <View style={a.routeText}><Text style={a.caption}>{savedPlace ? t(savedPlace.title) : t(item === 'pickup' ? 'Точка посадки' : 'Пункт назначения')}</Text>{active ? <TextInput ref={input} autoFocus={!!savedPlace} selectTextOnFocus accessibilityLabel={t('Найти адрес')} testID="address-search" value={query} onChangeText={changeQuery} placeholder={t(savedPlace ? 'Введите адрес' : item === 'pickup' ? 'Откуда поедем?' : 'Куда едем?')} placeholderTextColor={palette.muted} style={a.input} returnKeyType="search" onSubmitEditing={submitSearch}/> : <Pressable accessibilityRole="button" onPress={() => activateField(item)}><Text numberOfLines={1} style={a.address}>{shortAddress(point?.address) || t(item === 'pickup' ? 'Откуда поедем?' : 'Куда едем?')}</Text></Pressable>}</View>
            {active && <><Pressable accessibilityRole="button" accessibilityLabel={t('Очистить адрес')} onPress={() => { changeQuery(''); input.current?.focus(); }} style={a.clear}><Icon name="close" size={21}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('Выбрать на карте')} onPress={() => requestClose(onMap)} style={[a.map, { backgroundColor: isDark ? palette.elevated : colors.pale, borderColor: palette.line }]}><Text style={{ color: palette.ink, fontSize: 12, fontWeight: '600' }}>{t('Карта')}</Text></Pressable></>}
            </View>
          </View>;
        })}</View>
        {(field === 'pickup' || savedPlace) && <Pressable accessibilityRole="button" onPress={() => requestClose(onLocation)} style={a.gps}><View style={a.gpsIcon}><Icon name="navigate" color={palette.ink}/></View><View style={a.gpsText}><Text style={[s.body, isDark && { color: palette.ink }]}>{t('Ваше местоположение')}</Text></View></Pressable>}
        <ScrollView style={a.results} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {(loading || waiting) && <View style={a.loading}><ActivityIndicator color={palette.accent}/><Text style={[s.muted, isDark && { color: palette.muted }]}>{t('Ищем адреса…')}</Text></View>}
          {!!error && <View style={{ paddingVertical: 24, gap: 14 }}><Text accessibilityRole="alert" style={{ color: isDark ? palette.ink : colors.danger, lineHeight: 22 }}>{t(error)}</Text><Pressable onPress={submitSearch} accessibilityRole="button"><Text style={{ color: palette.accent, fontSize: 16 }}>{t('Повторить поиск')}</Text></Pressable></View>}
          {visibleResults.map((point, index) => {
            const place = point.address.includes(' · ');
            const separator = point.address.indexOf(' · ');
            const address = shortAddress(place ? point.address.slice(0, separator) : point.address);
            const street = place ? shortAddress(point.address.slice(separator + 3)) : '';
            const category = addressCategoryLabel(point, language);
            const subtitle = [category, street].filter(Boolean).join(' · ');
            const distance = addressResultDistance(distanceOrigin, point, language);
            return <Pressable key={`${point.latitude}:${point.longitude}:${index}`} accessibilityRole="button" accessibilityLabel={point.address} onPress={() => requestClose(() => onSelect(point))} style={a.result}>
              <View style={a.resultPin}><AddressPlaceIcon name={addressResultIcon(point)} size={25} color={isDark ? '#B0B6BE' : '#555C63'}/>{!!distance && <Text testID="address-distance" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} style={a.distance}>{distance}</Text>}</View>
              <View style={a.resultText}><Text numberOfLines={2} style={a.address}>{highlighted(address)}</Text>{!!subtitle && <Text numberOfLines={2} style={a.caption}>{highlighted(subtitle)}</Text>}</View>
            </Pressable>;
          })}
          {!loading && !waiting && !error && !visibleResults.length && search?.query === query.trim() && <View style={{ paddingVertical: 24, gap: 8 }}><Text style={a.address}>{t('Адрес не найден')}</Text><Text style={a.caption}>{t('Уточните название улицы или выберите точку на карте.')}</Text></View>}
        </ScrollView>
  </BottomPanel>;
}
const baseA = StyleSheet.create({
  surface: { paddingTop: 0 },
  routeCard: { backgroundColor: 'white', marginHorizontal: 8, paddingHorizontal: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 28, elevation: 4, shadowColor: colors.ink, shadowOpacity: .09, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  caption: { fontSize: 13, lineHeight: 18, color: colors.muted }, address: { fontSize: 16, lineHeight: 22, color: colors.ink }, match: { color: '#087FFF' },
  routeRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeContent: { minHeight: 64, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }, routeText: { flex: 1, minWidth: 0, paddingVertical: 7 },
  routeDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pin: { width: 40, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 16, color: colors.ink, paddingVertical: 2, minHeight: 30 }, clear: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }, map: { paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderRadius: 18 },
  gps: { paddingHorizontal: 16, marginTop: 15, flexDirection: 'row', gap: 12, alignItems: 'center' }, gpsIcon: { width: 48, alignItems: 'center' },
  gpsText: { flex: 1, minHeight: 61, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  results: { flex: 1, minHeight: 0, backgroundColor: 'white', marginTop: 14 }, loading: { paddingVertical: 25, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  result: { minHeight: 74, flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  resultText: { flex: 1, paddingVertical: 13, gap: 2, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  resultPin: { width: 48, paddingVertical: 12, gap: 5, justifyContent: 'center', alignItems: 'center' },
  distance: { fontSize: 10, lineHeight: 13, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
