import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel } from './BottomPanel';
import { useTheme } from './design/theme';
import { fonts } from './design/typography';
import { tr } from './ui';
import { balanceCopy } from './balanceTopup';
import type { Language } from './types';

export function BalanceTopupSheet({ language, onClose }: { language: Language; onClose: () => void }) {
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scale = Math.max(.78, Math.min(1.15, width / 426.5));
  const ink = isDark ? palette.ink : '#1E2028', muted = isDark ? palette.muted : '#737B8C', line = isDark ? palette.line : '#E2E4EC';
  const [closing, setClosing] = useState(false);
  const say = (key: Parameters<typeof balanceCopy>[1]) => balanceCopy(language, key);
  return <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={() => setClosing(true)}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomPanel onClose={onClose} closeRequested={closing} label={tr(language)('Закрыть')} handlePlacement="outside" handleStyle={{ width: 45 * scale, backgroundColor: '#9B9DA3' }} surfaceStyle={{ borderTopLeftRadius: 22 * scale, borderTopRightRadius: 22 * scale }} bottomPadding={Math.max(insets.bottom, 20) + 7 * scale}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingTop: 31 * scale, paddingHorizontal: Math.max(20 * scale, insets.left, insets.right) }}>
          <Text accessibilityRole="header" style={{ color: ink, fontFamily: fonts.bold, fontSize: 24 * scale, lineHeight: 32 * scale, letterSpacing: -.6 }}>{say('title')}</Text>
          <Text style={{ color: muted, fontFamily: fonts.regular, fontSize: Math.max(12, 15 * scale), lineHeight: 23 * scale, marginTop: 6 * scale, marginBottom: 18 * scale }}>{say('subtitle')}</Text>
          {[
            { id: 'mbank', title: 'MBANK', logo: require('../assets/balance/mbank.png') },
            { id: 'obank', title: 'O!Bank', logo: require('../assets/balance/obank.webp') },
            { id: 'kompanion', title: say('kompanion'), logo: require('../assets/balance/kompanon.png') },
          ].map(method => <Pressable key={method.id} testID={`balance-topup-${method.id}`} accessibilityRole="button" accessibilityLabel={`${method.title}. ${say('unavailable')}`} accessibilityState={{ disabled: true }} disabled style={{ borderTopWidth: 1, borderTopColor: line, minHeight: 78 * scale, paddingVertical: 15 * scale, flexDirection: 'row', alignItems: 'center', gap: 22 * scale }}>
            <Image source={method.logo} accessible={false} resizeMode="contain" style={{ width: 41 * scale, height: 41 * scale }}/>
            <View style={{ flex: 1, gap: 3 * scale }}><Text style={{ color: muted, fontFamily: fonts.semibold, fontSize: 16 * scale, lineHeight: 22 * scale }}>{method.title}</Text><Text style={{ color: muted, fontFamily: fonts.regular, fontSize: Math.max(12, 13 * scale), lineHeight: 20 * scale }}>{say('unavailable')}</Text></View>
            <Text style={{ color: muted, backgroundColor: isDark ? palette.elevated : '#EFF0F3', fontFamily: fonts.semibold, fontSize: 12 * scale, lineHeight: 17 * scale, paddingHorizontal: 14 * scale, paddingVertical: 5 * scale, borderRadius: 20 * scale }}>{say('soon')}</Text>
          </Pressable>)}
        </ScrollView>
      </BottomPanel>
    </GestureHandlerRootView>
  </Modal>;
}
