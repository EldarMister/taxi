import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from './design/theme';
import { useMotionPreference } from './design/motion';
import { fonts } from './design/typography';
import { Icon, money, tr } from './ui';
import { BalanceTopupSheet } from './BalanceTopupSheet';
import { balanceCopy } from './balanceTopup';
import type { Balance, Language } from './types';

const HISTORY_LAYOUT = LinearTransition.duration(180).easing(Easing.bezier(.23, 1, .32, 1));
const HISTORY_ENTER = FadeIn.duration(140);
const HISTORY_EXIT = FadeOut.duration(100);

function Wallet({ size, color }: { size: number; color: string }) {
  return <Svg width={size} height={size} viewBox="0 0 32 32" fill="none"><Path d="M5 9.5 24 5.6c1.3-.3 2.3.6 2.3 1.9v3M5 10.5h22a3 3 0 0 1 3 3V27a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V13.5a3 3 0 0 1 3-3Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/><Circle cx="23.5" cy="20" r="1.7" fill={color}/></Svg>;
}

export function DriverBalanceScreen({ balance, loading, error, language, onRefresh, onMenu }: {
  balance: Balance | null; loading: boolean; error?: string | null; language: Language;
  onRefresh: () => void; onMenu: () => void;
}) {
  const { isDark, palette } = useTheme();
  const reducedMotion = useMotionPreference();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scale = Math.max(.78, Math.min(1.15, width / 426.5));
  const c = isDark ? palette : { background: '#FBFBFD', ink: '#1E2028', muted: '#737B8C', line: '#E2E4EC', accent: '#3478F6' };
  const t = tr(language), say = (key: Parameters<typeof balanceCopy>[1]) => balanceCopy(language, key);
  const locale = language === 'en' ? 'en-US' : language === 'ky' ? 'ky-KG' : 'ru-RU';
  const regular = { color: c.muted, fontFamily: fonts.regular }, bold = { color: c.ink, fontFamily: fonts.bold };
  const divider = { borderBottomWidth: 1, borderBottomColor: c.line };
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const arrow = useSharedValue(0);
  useEffect(() => {
    const next = historyExpanded ? 1 : 0;
    arrow.set(reducedMotion !== false ? next : withTiming(next, { duration: 180, easing: Easing.bezier(.23, 1, .32, 1) }));
    return () => cancelAnimation(arrow);
  }, [historyExpanded, reducedMotion, arrow]);
  const arrowStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${arrow.get() * 180}deg` }] }));
  const layout = reducedMotion === false ? HISTORY_LAYOUT : undefined;
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={c.background}/>
    <View style={{ paddingTop: insets.top + 32 * scale, paddingLeft: Math.max(insets.left, 20 * scale), paddingRight: Math.max(insets.right, 15 * scale) }}>
      <View style={{ height: 52 * scale, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text pointerEvents="none" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={{ ...bold, position: 'absolute', left: 100 * scale, right: 105 * scale, fontSize: 19 * scale, lineHeight: 28 * scale, letterSpacing: -.5, textAlign: 'center' }}>{t('Баланс')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Меню')} onPress={onMenu} hitSlop={6} style={{ width: 44, minHeight: 44, justifyContent: 'center' }}><Icon name="menu-outline" size={27 * scale} color={c.ink}/></Pressable>
        <Pressable testID="balance-topup-open" accessibilityRole="button" accessibilityLabel={say('topup')} onPress={() => setTopupOpen(true)} hitSlop={10} style={({ pressed }) => ({ minHeight: 34 * scale, maxWidth: '28%', paddingHorizontal: 14 * scale, justifyContent: 'center', borderRadius: 25 * scale, backgroundColor: isDark ? '#1E2028' : c.accent, opacity: pressed ? .75 : 1 })}><Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 13 * scale, lineHeight: 20 * scale }}>{say('topup')}</Text></Pressable>
      </View>
    </View>
    <ScrollView testID="driver-balance-scroll" showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.accent}/>} contentContainerStyle={{ paddingLeft: Math.max(insets.left, 20 * scale), paddingRight: Math.max(insets.right, 20 * scale), paddingBottom: 24 * scale }}>
      <View style={{ ...divider, alignItems: 'center', paddingTop: 16 * scale, paddingBottom: 24 * scale }}>
        <Wallet color={c.ink} size={32 * scale}/>
        <Text style={{ ...regular, fontSize: 14 * scale, lineHeight: 20 * scale, marginTop: 15 * scale }}>{t('Депозит для комиссии')}</Text>
        <Text testID="balance-deposit" accessibilityLabel={`${t('Депозит для комиссии')}: ${balance ? money(balance.deposit) : '—'}`} style={{ ...bold, fontSize: 42 * scale, lineHeight: 52 * scale, letterSpacing: -1.2, textAlign: 'center', marginTop: 4 * scale, maxWidth: '100%' }} adjustsFontSizeToFit numberOfLines={1}>{balance ? money(balance.deposit) : '—'}</Text>
        <Text style={{ ...regular, fontSize: Math.max(12, 13.5 * scale), lineHeight: 20 * scale, textAlign: 'center', marginTop: 4 * scale }}>{say('commissionHint')}</Text>
      </View>
      {[['Доход наличными', balance?.cashIncome], ['Комиссия сервиса', balance?.commissionTotal]].map(([label, amount]) => <View key={label} style={{ ...divider, minHeight: 50 * scale, paddingVertical: 12 * scale, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ ...regular, flex: 1, fontSize: Math.max(12, 15.5 * scale), lineHeight: 23 * scale }}>{t(String(label))}</Text>
        <Text style={{ ...bold, fontSize: 18 * scale, lineHeight: 25 * scale, flexShrink: 1, textAlign: 'right' }}>{amount == null ? '—' : money(Number(amount))}</Text>
      </View>)}
      <View style={{ ...divider, flexDirection: 'row', alignItems: 'flex-start', gap: 16 * scale, paddingVertical: 16 * scale }}>
        <Icon name="information-circle-outline" color={c.muted} size={25 * scale}/>
        <Text style={{ ...regular, flex: 1, fontSize: Math.max(12, 13.5 * scale), lineHeight: 20 * scale }}>{t('Наличные вы получаете от пассажиров. Они не зачисляются на депозит.')}</Text>
      </View>
      <Animated.View collapsable={false} layout={layout}>
        <Pressable testID="balance-history-toggle" accessibilityRole="button" accessibilityLabel={t('История операций')} accessibilityState={{ expanded: historyExpanded }} onPress={() => setHistoryExpanded(value => !value)} style={({ pressed }) => ({ ...divider, minHeight: 54 * scale, paddingVertical: 13.5 * scale, flexDirection: 'row', alignItems: 'center', gap: 14 * scale, opacity: pressed ? .65 : 1 })}>
          <Text style={{ ...bold, flex: 1, fontSize: 18.5 * scale, lineHeight: 26 * scale, letterSpacing: -.5 }}>{t('История операций')}</Text>
          <Animated.View style={arrowStyle}><Icon name="chevron-down" size={22 * scale} color={c.ink}/></Animated.View>
        </Pressable>
        {historyExpanded && <Animated.View testID="balance-history-content" entering={reducedMotion === false ? HISTORY_ENTER : undefined} exiting={reducedMotion === false ? HISTORY_EXIT : undefined}>
          {loading && <ActivityIndicator testID="balance-history-loading" style={{ marginVertical: 15 * scale }} color={c.accent}/>}
          {error ? <View style={{ paddingVertical: 20 * scale, gap: 8 }}><Text style={{ ...regular, fontSize: 13 }}>{say('failed')}</Text><Pressable accessibilityRole="button" onPress={onRefresh}><Text style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 14 }}>{t('Обновить')}</Text></Pressable></View> : balance?.operations.length === 0 && !loading ? <Text style={{ ...regular, fontSize: 14, paddingVertical: 24 }}>{t('Операций пока нет')}</Text> : balance?.operations.map(operation => <View testID={`balance-operation-${operation.id}`} key={operation.id} style={{ ...divider, minHeight: 85 * scale, paddingVertical: 11.5 * scale, flexDirection: 'row', alignItems: 'center', gap: 12 * scale }}>
            <View style={{ flex: 1, gap: 3 * scale }}>
              <Text style={{ ...bold, fontSize: 15 * scale, lineHeight: 21 * scale }}>{operation.note || t(operation.kind === 'COMMISSION' ? 'Комиссия за поездку' : 'Пополнение депозита')}</Text>
              <Text style={{ ...regular, fontSize: Math.max(11, 12 * scale), lineHeight: 17 * scale }}>{new Date(operation.createdAt).toLocaleString(locale, { timeZone: 'Asia/Bishkek', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</Text>
              <Text style={{ ...regular, fontSize: Math.max(11, 12 * scale), lineHeight: 17 * scale }}>{t('Остаток:')} {money(operation.balanceAfter)}</Text>
            </View>
            <Text style={{ ...bold, flexShrink: 1, maxWidth: '40%', fontSize: 18 * scale, lineHeight: 25 * scale, textAlign: 'right' }}>{Number(operation.amount) > 0 ? '+' : ''}{money(operation.amount)}</Text>
          </View>)}
        </Animated.View>}
      </Animated.View>
      {!balance && !historyExpanded && (loading ? <ActivityIndicator style={{ marginVertical: 20 }} color={c.accent}/> : <Pressable accessibilityRole="button" onPress={onRefresh} style={{ paddingVertical: 20 }}><Text style={{ ...regular, textAlign: 'center', fontSize: 14 }}>{error ? say('failed') : t('Потяните вниз, чтобы обновить')} · {t('Обновить')}</Text></Pressable>)}
    </ScrollView>
    {topupOpen && <BalanceTopupSheet language={language} onClose={() => setTopupOpen(false)}/>}
  </View>;
}
