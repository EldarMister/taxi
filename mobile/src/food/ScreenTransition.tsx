import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useMotionPreference } from '../design/motion';
import { motion } from '../design/tokens';

export type ScreenDirection = 'forward' | 'back';

type CachedPage = { node: React.ReactNode };
type LeavingPage = { routeKey: string; direction: ScreenDirection };

const isRestaurantPage = (routeKey: string) => routeKey.startsWith('restaurant:');
const isDishPage = (routeKey: string) => routeKey.startsWith('dish:');
// DishScreen owns its sheet animation. CartScreen is a regular full screen;
// skipping its transition used to produce an abrupt cut into/out of the cart.
const isSheetPage = isDishPage;
const preservesLocalState = (routeKey: string) => routeKey === 'restaurants' || routeKey === 'favorites' || isRestaurantPage(routeKey);

/**
 * A deliberately small navigator transition. Catalog pages stay mounted while
 * they are below a detail page, which preserves their search/category/scroll
 * state without coupling those screens to navigation internals.
 */
export function ScreenTransition({ routeKey, direction, children }: {
  routeKey: string;
  direction: ScreenDirection;
  children: React.ReactNode;
}) {
  const reducedMotion = useMotionPreference();
  const progress = useRef(new Animated.Value(1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const previousRoute = useRef(routeKey);
  const sheetUnderlay = useRef<string | null>(null);
  const pages = useRef(new Map<string, CachedPage>([[routeKey, { node: children }]])).current;
  const [leaving, setLeaving] = useState<LeavingPage | null>(null);
  const [, requestCacheCleanup] = useState(0);

  pages.set(routeKey, { node: children });
  if (isSheetPage(routeKey) && previousRoute.current !== routeKey) {
    sheetUnderlay.current = preservesLocalState(previousRoute.current) || previousRoute.current === 'cart' ? previousRoute.current
      : [...pages.keys()].reverse().find(isRestaurantPage) ?? 'restaurants';
  }

  // Only one restaurant page needs to be kept alive: the one whose category
  // and scroll position the user can navigate back to.
  if (isRestaurantPage(routeKey)) {
    for (const key of pages.keys()) {
      if (isRestaurantPage(key) && key !== routeKey && key !== previousRoute.current && key !== leaving?.routeKey) pages.delete(key);
    }
  }
  for (const key of pages.keys()) {
    if (isSheetPage(routeKey) && key === sheetUnderlay.current) continue;
    if (!preservesLocalState(key) && key !== routeKey && key !== previousRoute.current && key !== leaving?.routeKey) pages.delete(key);
  }

  useLayoutEffect(() => {
    animation.current?.stop();
    if (reducedMotion !== false) {
      progress.setValue(1);
      previousRoute.current = routeKey;
      setLeaving(null);
      // When leaving is already null React would otherwise skip a render, so a
      // non-persistent previous page could remain cached until unrelated state
      // changes. Run the normal render-time cache pruning immediately.
      requestCacheCleanup(value => value + 1);
      return;
    }
    const previous = previousRoute.current;
    if (previous === routeKey) return;
    if (isSheetPage(routeKey) || isSheetPage(previous)) {
      progress.setValue(1);
      previousRoute.current = routeKey;
      setLeaving(null);
      requestCacheCleanup(value => value + 1);
      return;
    }
    previousRoute.current = routeKey;
    progress.setValue(0);
    setLeaving({ routeKey: previous, direction });
    animation.current = Animated.timing(progress, {
      toValue: 1,
      duration: motion.enter,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.current.start(({ finished }) => { if (finished) setLeaving(null); });
    return () => animation.current?.stop();
  }, [progress, reducedMotion, routeKey]);

  return <View style={styles.root}>
    {[...pages.entries()].map(([key, page]) => {
      const isCurrent = key === routeKey;
      const isLeaving = key === leaving?.routeKey;
      const isSheetUnderlay = isSheetPage(routeKey) && key === sheetUnderlay.current;
      const hidden = !isCurrent && !isLeaving && !isSheetUnderlay;
      const transitionDirection = leaving?.direction ?? direction;
      const incomingOffset = transitionDirection === 'forward' ? 28 : -28;
      const outgoingOffset = transitionDirection === 'forward' ? -18 : 18;
      return <Animated.View
        key={key}
        pointerEvents={isCurrent ? 'auto' : 'none'}
        accessibilityElementsHidden={!isCurrent}
        importantForAccessibility={isCurrent ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.page,
          isSheetUnderlay && styles.sheetUnderlay,
          hidden && styles.hidden,
          isLeaving && styles.leaving,
          isLeaving && {
            opacity: progress.interpolate({ inputRange: [0, .82, 1], outputRange: [1, .15, 0] }),
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, outgoingOffset] }) }],
          },
          isCurrent && leaving && {
            opacity: progress.interpolate({ inputRange: [0, .18, 1], outputRange: [0, 0, 1] }),
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [incomingOffset, 0] }) }],
          },
        ]}
      >{page.node}</Animated.View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  page: { flex: 1 },
  sheetUnderlay: { ...StyleSheet.absoluteFillObject },
  leaving: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  hidden: { display: 'none' },
});
