import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from './design/theme';
import { fonts } from './design/typography';
import { Icon, money, tr } from './ui';
import type { Balance, Language } from './types';

export function DriverBalanceScreen({ balance, loading, language, onRefresh, onMenu }: {
  balance: Balance | null; loading: boolean; language: Language; onRefresh: () => void; onMenu: () => void;
}) {
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scale = Math.max(.78, Math.min(1.15, width / 426.5));
  const c = isDark ? palette : { background: '#FBFBFD', ink: '#1E2028', muted: '#737B8C', line: '#E2E4EC', accent: '#3478F6' };
  const t = tr(language);
  const locale = language === 'en' ? 'en-US' : 'ru-RU';
  const regular = { color: c.muted, fontFamily: fonts.regular };
  const bold = { color: c.ink, fontFamily: fonts.bold };
  const divider = { borderBottomWidth: 1, borderBottomColor: c.line };
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={c.background}/>
    <View style={{ paddingTop: insets.top + 8 * scale, paddingLeft: Math.max(insets.left, 18 * scale), paddingRight: Math.max(insets.right, 18 * scale) }}>
      <View style={{ height: 50 * scale, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Меню')} onPress={onMenu} hitSlop={8} style={{ width: 36 * scale, minHeight: 44, justifyContent: 'center' }}><Icon name="menu-outline" size={27 * scale} color={c.ink}/></Pressable>
        <Text style={{ ...bold, flex: 1, fontSize: 20 * scale, lineHeight: 28 * scale, letterSpacing: -.5, textAlign: 'center' }}>{t('Баланс')}</Text>
        <View style={{ width: 36 * scale }}/>
      </View>
    </View>
    <ScrollView testID="driver-balance-scroll" showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.accent}/>} contentContainerStyle={{ paddingLeft: Math.max(insets.left, 19.5 * scale), paddingRight: Math.max(insets.right, 19.5 * scale), paddingBottom: Math.max(insets.bottom, 16) + 24 * scale }}>
      {balance ? <>
        <View style={{ ...divider, alignItems: 'center', paddingTop: 19 * scale, paddingBottom: 20 * scale }}>
          <Icon name="wallet-outline" color={c.ink} size={34 * scale}/>
          <Text style={{ ...regular, fontSize: 14 * scale, lineHeight: 20 * scale, marginTop: 10 * scale }}>{t('Депозит для комиссии')}</Text>
          <Text accessibilityLabel={`${t('Депозит для комиссии')}: ${money(balance.deposit)}`} style={{ ...bold, fontSize: 44 * scale, lineHeight: 56 * scale, letterSpacing: -1.2, textAlign: 'center', marginTop: 6 * scale }} adjustsFontSizeToFit numberOfLines={1}>{money(balance.deposit)}</Text>
          <Text style={{ ...regular, fontSize: 14 * scale, lineHeight: 21 * scale, textAlign: 'center', marginTop: 2 * scale, paddingHorizontal: 22 * scale }}>{t('Пополнение через администратора. Комиссия списывается после завершения поездки.')}</Text>
        </View>
        {[['Доход наличными', balance.cashIncome], ['Комиссия сервиса', balance.commissionTotal]].map(([label, amount]) => <View key={label} style={{ ...divider, minHeight: 50 * scale, paddingVertical: 12 * scale, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ ...regular, flex: 1, fontSize: 15.5 * scale, lineHeight: 23 * scale }}>{t(String(label))}</Text>
          <Text style={{ ...bold, fontSize: 18 * scale, lineHeight: 25 * scale, flexShrink: 1, textAlign: 'right' }}>{money(Number(amount))}</Text>
        </View>)}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 * scale, paddingTop: 16 * scale, paddingBottom: 32 * scale }}>
          <Icon name="information-circle-outline" color={c.muted} size={25 * scale}/>
          <Text style={{ ...regular, flex: 1, fontSize: 13.5 * scale, lineHeight: 20 * scale }}>{t('Наличные вы получаете от пассажиров. Они не зачисляются на депозит.')}</Text>
        </View>
        <Text style={{ ...bold, fontSize: 20 * scale, lineHeight: 28 * scale, letterSpacing: -.5, marginBottom: 14 * scale }}>{t('История операций')}</Text>
        <View style={{ borderTopWidth: 1, borderTopColor: c.line }}>
          {balance.operations.length === 0 ? <Text style={{ ...regular, fontSize: 14, paddingVertical: 24 }}>{t('Операций пока нет')}</Text> : balance.operations.map(operation => <View testID={`balance-operation-${operation.id}`} key={operation.id} style={{ ...divider, minHeight: 85 * scale, paddingVertical: 12 * scale, flexDirection: 'row', alignItems: 'center', gap: 12 * scale }}>
            <View style={{ flex: 1, gap: 3 * scale }}>
              <Text style={{ ...bold, fontSize: 15 * scale, lineHeight: 21 * scale }}>{operation.note || t(operation.kind === 'COMMISSION' ? 'Комиссия за поездку' : 'Пополнение депозита')}</Text>
              <Text style={{ ...regular, fontSize: 12.5 * scale, lineHeight: 17 * scale }}>{new Date(operation.createdAt).toLocaleString(locale)}</Text>
              <Text style={{ ...regular, fontSize: 12.5 * scale, lineHeight: 17 * scale }}>{t('Остаток:')} {money(operation.balanceAfter)}</Text>
            </View>
            <Text style={{ ...bold, flexShrink: 1, maxWidth: '40%', fontSize: 18 * scale, lineHeight: 25 * scale, textAlign: 'right' }}>{Number(operation.amount) > 0 ? '+' : ''}{money(operation.amount)}</Text>
          </View>)}
        </View>
      </> : <View style={{ paddingVertical: 60, alignItems: 'center' }}>{loading ? <ActivityIndicator color={c.accent}/> : <Text style={{ ...regular, fontSize: 14 }}>{t('Потяните вниз, чтобы обновить')}</Text>}</View>}
    </ScrollView>
  </View>;
}
