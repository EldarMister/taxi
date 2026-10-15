import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useMotionPreference } from './design/motion';
import { useTheme } from './design/theme';
import { driverAction } from './design/tokens';
import type { Order, User } from './types';
import { Icon, money, tr } from './ui';

const OFFER_DURATION_MS = 30_000;
const OFFER_BLUE = '#246BFD';

function remainingTime(deadline: number, now: number) {
  return Number.isFinite(deadline) ? Math.max(0, deadline - now) : 0;
}

function remainingSeconds(deadline: number, now: number) {
  return Math.min(30, Math.ceil(remainingTime(deadline, now) / 1000));
}

/** The server owns expiration and dispatch; this button only displays its deadline. */
export function DriverOfferAcceptButton({ offer, language, busy, onAccept }: {
  offer: Order; language: User['language']; busy: boolean; onAccept: (offer: Order) => void | Promise<void>;
}) {
  const { isDark } = useTheme();
  const reduced = useMotionPreference();
  const t = tr(language);
  // Offers for later drivers have their own deadline, independent of order.createdAt.
  // A malformed/missing deadline fails closed instead of leaving acceptance open.
  const deadline = useMemo(() => offer.searchExpiresAt ? Date.parse(offer.searchExpiresAt) : Number.NaN, [offer.searchExpiresAt]);
  const offerKey = `${offer.id}:${offer.searchExpiresAt || ''}`;
  const [clock, setClock] = useState(() => ({ key: offerKey, seconds: remainingSeconds(deadline, Date.now()) }));
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const activeKey = useRef(offerKey);
  const acceptance = useRef<{ key: string } | null>(null);
  const wasBusy = useRef(busy);
  const progress = useSharedValue(Math.min(1, remainingTime(deadline, Date.now()) / OFFER_DURATION_MS));
  const width = useSharedValue(0);
  const seconds = clock.key === offerKey ? clock.seconds : remainingSeconds(deadline, Date.now());

  useEffect(() => {
    activeKey.current = offerKey;
    acceptance.current = null;
    setPendingKey(null);
    return () => { activeKey.current = ''; acceptance.current = null; };
  }, [offerKey]);

  useEffect(() => {
    // The parent clears busy after a failed request, allowing another deliberate tap.
    if (wasBusy.current && !busy) {
      acceptance.current = null;
      setPendingKey(null);
    }
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = !AppState.currentState || AppState.currentState === 'active';
    const stopTick = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const synchronize = (restartAnimation: boolean) => {
      if (disposed) return;
      stopTick();
      const remaining = remainingTime(deadline, Date.now());
      const currentSeconds = Math.min(30, Math.ceil(remaining / 1000));
      setClock(previous => previous.key === offerKey && previous.seconds === currentSeconds ? previous : { key: offerKey, seconds: currentSeconds });
      if (restartAnimation || reduced !== false || remaining === 0) {
        cancelAnimation(progress);
        progress.set(Math.min(1, remaining / OFFER_DURATION_MS));
        if (active && reduced === false && remaining > 0) {
          // Clip one translated layer on the UI thread; the trailing edge drains left.
          const animation = withTiming(0, { duration: Math.min(OFFER_DURATION_MS, remaining), easing: Easing.linear, reduceMotion: ReduceMotion.Never });
          progress.set(remaining > OFFER_DURATION_MS ? withDelay(remaining - OFFER_DURATION_MS, animation) : animation);
        }
      }
      if (active && remaining > 0) {
        // Only the numeral (and reduced-motion fill) crosses the JS thread per second.
        const untilNextSecond = remaining - (Math.ceil(remaining / 1000) - 1) * 1000;
        timer = setTimeout(() => synchronize(false), Math.max(1, untilNextSecond));
      }
    };
    synchronize(true);
    const subscription = AppState.addEventListener('change', state => {
      if (disposed) return;
      active = state === 'active';
      if (active) synchronize(true);
      else { stopTick(); cancelAnimation(progress); }
    });
    return () => { disposed = true; stopTick(); cancelAnimation(progress); subscription.remove(); };
  }, [deadline, offerKey, progress, reduced]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() - 1) * width.get() }] }));
  const submitted = pendingKey === offerKey;
  const disabled = busy || submitted || seconds === 0 || offer.status !== 'SEARCHING';
  const accept = () => {
    // Recheck the absolute deadline even when JS was suspended or the parent is stale.
    if (busy || activeKey.current !== offerKey || acceptance.current?.key === offerKey || offer.status !== 'SEARCHING' || remainingTime(deadline, Date.now()) <= 0) return;
    const attempt = { key: offerKey };
    acceptance.current = attempt;
    setPendingKey(offerKey);
    const settle = () => {
      if (activeKey.current !== offerKey || acceptance.current !== attempt) return;
      acceptance.current = null;
      setPendingKey(null);
    };
    try {
      const operation = onAccept(offer);
      // A fast failure can batch busy=true and busy=false into one parent render.
      // The returned promise also releases the fence, without touching a newer tap.
      if (operation) void Promise.resolve(operation).then(settle, settle);
    } catch (error) { settle(); throw error; }
  };
  const secondUnit = language === 'en' ? 's' : 'с';

  return <Pressable
    testID="driver-offer-accept"
    accessibilityRole="button"
    accessibilityLabel={`${money(offer.price)} · ${t('Принять')}`}
    accessibilityValue={{ min: 0, max: 30, now: seconds, text: `${seconds} ${secondUnit}` }}
    accessibilityState={{ disabled, busy: busy || submitted }}
    disabled={disabled}
    onPress={accept}
    onLayout={event => width.set(event.nativeEvent.layout.width)}
    pressRetentionOffset={{ top: 16, bottom: 16, left: 16, right: 16 }}
    style={({ pressed }) => [styles.button, { backgroundColor: isDark ? '#303030' : '#2F322E' }, (busy || submitted) && { opacity: .7 }, seconds === 0 && { opacity: .45 }, pressed && !disabled && { opacity: .88 }]}
  >
    <Animated.View testID="driver-offer-countdown-fill" pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: OFFER_BLUE }, fillStyle]}/>
    <View pointerEvents="none" style={styles.content}>
      <View style={styles.side}><Text testID="driver-offer-seconds" numberOfLines={1} adjustsFontSizeToFit style={styles.seconds}>{seconds} {secondUnit}</Text></View>
      <View style={styles.center}>
        <Text testID="driver-offer-accept-price" numberOfLines={1} adjustsFontSizeToFit style={styles.price}>{money(offer.price)}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.label}>{t('Принять')}</Text>
      </View>
      <View style={[styles.side, styles.right]}>{busy || submitted ? <ActivityIndicator color="#FFFFFF" size="small"/> : <Icon name="flash" color="#FFFFFF" size={25}/>}</View>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: '100%', minHeight: driverAction.height, borderRadius: driverAction.height / 2, overflow: 'hidden', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 17, paddingVertical: 12, gap: 6 },
  side: { width: 48, flexShrink: 0 },
  right: { alignItems: 'flex-end' },
  center: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  price: { color: '#FFFFFF', fontSize: 23, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  label: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  seconds: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
