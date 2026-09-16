import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useMotionPreference } from './design/motion';
import { useTheme } from './design/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SuccessCelebrationProps = {
  size?: number;
  variant?: 'order' | 'thankYou';
  onAnimationEnd?: () => void;
  testID?: string;
};

const CONFETTI = [
  { angle: -90, radius: .45, length: 13, width: 5, color: '#22C55E' },
  { angle: -55, radius: .47, length: 14, width: 6, color: '#007AFF' },
  { angle: -25, radius: .47, length: 12, width: 5, color: '#22C55E' },
  { angle: 8, radius: .47, length: 15, width: 6, color: '#007AFF' },
  { angle: 43, radius: .47, length: 14, width: 6, color: '#22C55E' },
  { angle: 76, radius: .46, length: 12, width: 5, color: '#007AFF' },
  { angle: 139, radius: .46, length: 12, width: 5, color: '#38D987' },
  { angle: 172, radius: .48, length: 14, width: 6, color: '#22C55E' },
  { angle: 211, radius: .46, length: 13, width: 5, color: '#007AFF' },
  { angle: 246, radius: .47, length: 13, width: 6, color: '#007AFF' },
] as const;

/** A 1.2-second, one-shot confirmation from the supplied completion reference. */
export function SuccessCelebration({ size = 190, variant = 'order', onAnimationEnd, testID }: SuccessCelebrationProps) {
  const { isDark } = useTheme();
  const reducedMotion = useMotionPreference();
  const circle = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(72)).current;
  const rings = useRef(new Animated.Value(0)).current;
  const particles = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion === null) return;
    if (reducedMotion) {
      circle.setValue(1);
      check.setValue(0);
      rings.setValue(1);
      particles.setValue(1);
      onAnimationEnd?.();
      return;
    }
    circle.setValue(0);
    check.setValue(72);
    rings.setValue(0);
    particles.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(circle, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(check, { toValue: 0, duration: 250, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(rings, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(particles, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) onAnimationEnd?.(); });
    return () => animation.stop();
  }, [check, circle, rings, particles, reducedMotion]);

  const center = size / 2;
  const circleSize = size * .56;
  const haloSize = size * .74;
  const ringSize = size * .64;
  const particleOpacity = particles.interpolate({ inputRange: [0, .32, 1], outputRange: [0, 1, .95] });

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={variant === 'thankYou' ? 'Спасибо за ваш отзыв' : 'Заказ успешно выполнен'}
      style={{ width: size, height: size, alignSelf: 'center' }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          isDark && { backgroundColor: '#123B29', borderColor: '#1B6840' },
          {
            left: center - haloSize / 2,
            top: center - haloSize / 2,
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            opacity: rings.interpolate({ inputRange: [0, .55, 1], outputRange: [0, .42, .7] }),
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pulseRing,
          isDark && { borderColor: '#49D77F' },
          {
            left: center - ringSize / 2,
            top: center - ringSize / 2,
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            opacity: rings.interpolate({ inputRange: [0, .02, 1], outputRange: [0, .6, 0] }),
            transform: [{ scale: rings.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pulseRing,
          isDark && { borderColor: '#49D77F' },
          {
            left: center - ringSize / 2,
            top: center - ringSize / 2,
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            opacity: rings.interpolate({ inputRange: [0, .35, 1], outputRange: [0, .45, 0] }),
            transform: [{ scale: rings.interpolate({ inputRange: [0, 1], outputRange: [.94, 1.38] }) }],
          },
        ]}
      />
      {CONFETTI.map(({ angle, radius, length, width, color }, index) => {
        const radians = angle * Math.PI / 180;
        const x = Math.cos(radians) * size * radius;
        const y = Math.sin(radians) * size * radius;
        return (
          <Animated.View
            key={index}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: center + x - width / 2,
              top: center + y - length / 2,
              width,
              height: length,
              borderRadius: width / 2,
              backgroundColor: variant === 'thankYou' && index % 3 === 0 ? '#FFC928' : color,
              opacity: particleOpacity,
              transform: [
                { translateX: particles.interpolate({ inputRange: [0, 1], outputRange: [-x * .36, 0] }) },
                { translateY: particles.interpolate({ inputRange: [0, 1], outputRange: [-y * .36, 0] }) },
                { rotate: `${angle + 90}deg` },
              ],
            }}
          />
        );
      })}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.successShadow,
          {
            left: center - circleSize / 2,
            top: center - circleSize / 2,
            width: circleSize,
            height: circleSize,
            borderRadius: circleSize / 2,
            transform: [{ scale: circle }],
          },
        ]}
      >
        <LinearGradient
          colors={['#5FE18D', '#22C55E', '#10AD5F']}
          start={{ x: .08, y: .08 }}
          end={{ x: .92, y: .96 }}
          style={[styles.successCircle, { borderRadius: circleSize / 2 }]}
        >
          <Svg width="100%" height="100%" viewBox="0 0 120 120">
            <AnimatedPath
              d="M34 61 L51 78 L86 43"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="72 72"
              strokeDashoffset={check}
            />
          </Svg>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
    backgroundColor: '#DCFFE7',
    borderWidth: 11,
    borderColor: '#E9FFF0',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#A9F3C3',
  },
  successShadow: {
    position: 'absolute',
    shadowColor: '#22C55E',
    shadowOpacity: .25,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  successCircle: {
    width: '100%',
    height: '100%',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
});

export default SuccessCelebration;
