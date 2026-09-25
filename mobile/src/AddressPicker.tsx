import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomPanel } from './BottomPanel';
import { shortAddress } from './address';
import { api, messageOf } from './api';
import { searchAddresses } from './native/search';
import { Coordinate, Order, Point, User } from './types';
import { colors, Icon, PickupIcon, s, tr } from './ui';
import { useTheme } from './design/theme';
import { useThemeStyles } from './design/themeStyles';

type Field = 'pickup' | 'dropoff';
export function AddressPicker({ field, center, pickup, dropoff, savedPlace, language, onFieldChange, onSelect, onClose, onMap, onLocation }: {
  field: Field; center?: Coordinate | null; pickup?: Point | null; dropoff?: Point | null; language: User['language'];
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
        const points = await searchAddresses(search.query, center || undefined, controller.signal, language);
        if (live) setResults(points);
      } catch (e) { if (live) setError(messageOf(e)); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; controller.abort(); };
  }, [search, query, field, center?.latitude, center?.longitude, language]);
  const submitSearch = () => { if (query.trim().length >= 2) setSearch({ query: query.trim(), field, id: ++sequence.current }); };
  const changeQuery = (value: string) => { setEdited(true); setSearch(null); setQuery(value); };
  const requestClose = (action?: () => void) => { Keyboard.dismiss(); afterClose.current = action ?? null; setCloseRequested(true); };
  const close = () => { const action = afterClose.current; afterClose.current = null; action?.(); onClose(); };
  const visibleResults = query.trim() ? results : recent;
  const waiting = edited && !search && query.trim().length >= 2;
  return <BottomPanel expanded closeRequested={closeRequested} onClose={close} label={t('Закрыть поиск')}>
        <View style={[a.routeCard, isDark && { backgroundColor: palette.elevated, shadowOpacity: 0 }]}>{(savedPlace ? ['dropoff'] as const : ['pickup', 'dropoff'] as const).map((item, index) => {
          const active = item === field;
          const point = savedPlace?.point || (item === 'pickup' ? pickup : dropoff);
          return <View key={item} style={[a.routeRow, !savedPlace && index === 0 && { borderBottomWidth: 1, borderBottomColor: palette.line }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t(item === 'pickup' ? 'Изменить место подачи' : 'Изменить пункт назначения')} onPress={() => activateField(item)} style={[a.pin, active && { backgroundColor: palette.accent }]}>{item === 'pickup' ? <PickupIcon color={active ? palette.accentText : palette.ink}/> : <Icon name="flag" color={active ? palette.accentText : palette.ink}/>}</Pressable>
            <View style={{ flex: 1 }}><Text style={a.caption}>{savedPlace ? t(savedPlace.title) : t(item === 'pickup' ? 'Точка посадки' : 'Пункт назначения')}</Text>{active ? <TextInput ref={input} autoFocus={!!savedPlace} selectTextOnFocus accessibilityLabel={t('Найти адрес')} testID="address-search" value={query} onChangeText={changeQuery} placeholder={t(savedPlace ? 'Введите адрес' : item === 'pickup' ? 'Откуда поедем?' : 'Куда едем?')} placeholderTextColor={palette.muted} style={a.input} returnKeyType="search" onSubmitEditing={submitSearch}/> : <Pressable accessibilityRole="button" onPress={() => activateField(item)}><Text numberOfLines={1} style={a.address}>{shortAddress(point?.address) || t(item === 'pickup' ? 'Откуда поедем?' : 'Куда едем?')}</Text></Pressable>}</View>
            {active && <><Pressable accessibilityRole="button" accessibilityLabel={t('Очистить адрес')} onPress={() => { changeQuery(''); input.current?.focus(); }} style={a.clear}><Icon name="close" size={21}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('Выбрать на карте')} onPress={() => requestClose(onMap)} style={[a.map, { backgroundColor: isDark ? palette.elevated : colors.pale, borderColor: palette.line }]}><Text style={{ color: palette.ink, fontSize: 12, fontWeight: '600' }}>{t('Карта')}</Text></Pressable></>}
          </View>;
        })}</View>
        {(field === 'pickup' || savedPlace) && <Pressable accessibilityRole="button" onPress={() => requestClose(onLocation)} style={a.gps}><Icon name="navigate" color={palette.accent}/><View><Text style={[s.body, isDark && { color: palette.ink }]}>{t('Ваше местоположение')}</Text><Text style={[s.caption, isDark && { color: palette.muted }]}>{t('Определим по GPS')}</Text></View></Pressable>}
        <ScrollView style={a.results} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {(loading || waiting) && <View style={a.loading}><ActivityIndicator color={palette.accent}/><Text style={[s.muted, isDark && { color: palette.muted }]}>{t('Ищем адреса…')}</Text></View>}
          {!!error && <View style={{ paddingVertical: 24, gap: 14 }}><Text accessibilityRole="alert" style={{ color: isDark ? palette.ink : colors.danger, lineHeight: 22 }}>{t(error)}</Text><Pressable onPress={submitSearch} accessibilityRole="button"><Text style={{ color: palette.accent, fontSize: 16 }}>{t('Повторить поиск')}</Text></Pressable></View>}
          {visibleResults.map((point, index) => {
            const place = point.address.includes(' · ');
            const separator = point.address.indexOf(',');
            const address = place ? point.address.split(',')[0] : shortAddress(point.address);
            const subtitle = place && separator >= 0 ? shortAddress(point.address.slice(separator + 1)) : '';
            return <Pressable key={`${point.latitude}:${point.longitude}:${index}`} accessibilityRole="button" accessibilityLabel={point.address} onPress={() => requestClose(() => onSelect(point))} style={a.result}><View style={a.resultPin}><Icon name="location" size={26} color={palette.muted}/></View><View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={[a.address, { color: palette.accent }]}>{address}</Text>{!!subtitle && <Text numberOfLines={2} style={a.caption}>{subtitle}</Text>}</View></Pressable>;
          })}
          {!loading && !waiting && !error && !visibleResults.length && <View style={{ paddingVertical: 24, gap: 8 }}><Text style={a.address}>{t(search?.query === query.trim() ? 'Адрес не найден' : savedPlace ? 'Выберите адрес' : field === 'pickup' ? 'Откуда поедем?' : 'Куда отправимся?')}</Text><Text style={a.caption}>{t(search?.query === query.trim() ? 'Уточните название улицы или выберите точку на карте.' : savedPlace ? 'Введите улицу или выберите точку на карте.' : 'Начните вводить улицу или название места.')}</Text></View>}
        </ScrollView>
  </BottomPanel>;
}
const baseA = StyleSheet.create({
  routeCard: { backgroundColor: 'white', marginHorizontal: 12, paddingHorizontal: 12, borderRadius: 26, elevation: 3, shadowColor: colors.ink, shadowOpacity: .07, shadowRadius: 18, shadowOffset: { width: 0, height: 5 } },
  caption: { fontSize: 12, lineHeight: 16, color: colors.muted }, address: { fontSize: 15, lineHeight: 20, color: colors.ink },
  routeRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 }, pin: { width: 38, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 16, color: colors.ink, paddingVertical: 5, minHeight: 35 }, clear: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }, map: { paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderRadius: 18 },
  gps: { paddingHorizontal: 22, paddingVertical: 14, flexDirection: 'row', gap: 18, alignItems: 'center' }, results: { flex: 1, minHeight: 0, backgroundColor: 'white', marginTop: 8 }, loading: { paddingVertical: 25, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  result: { minHeight: 65, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, resultPin: { width: 28, height: 35, justifyContent: 'center', alignItems: 'center' },
});
