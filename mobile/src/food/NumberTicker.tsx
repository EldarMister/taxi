import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

type Props = {
  value: number;
  /** Supply the screen's existing money formatter, or a counter formatter. */
  format?: (value: number) => string;
  style?: StyleProp<TextStyle>;
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  height?: number;
  duration?: number;
  accessibilityLabel?: string;
};

type DigitProps = {
  digit: number;
  digitHeight: number;
  digitWidth: number;
  duration: number;
  place: number;
  reducedMotion: boolean;
  textStyle: TextStyle;
};

const DIGITS = Array.from({ length: 10 }, (_, digit) => String(digit));
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function useReducedMotion() {
  // Until the system preference is known, show the new value without motion.
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (mounted) setReducedMotion(enabled); })
      .catch(() => { if (mounted) setReducedMotion(false); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return reducedMotion;
}

function glyphStyle(style: TextStyle): TextStyle {
  const {
    alignSelf, bottom, flex, flexBasis, flexGrow, flexShrink, height, left,
    margin, marginBottom, marginEnd, marginHorizontal, marginLeft, marginRight,
    marginStart, marginTop, marginVertical, maxHeight, maxWidth, minHeight,
    minWidth, position, right, top, width, ...textOnlyStyle
  } = style;
  // Layout belongs to the whole ticker. A minWidth on every digit clips a
  // compact quantity control and makes amounts much wider than their Text.
  return textOnlyStyle;
}

const DigitDrum = memo(function DigitDrum({
  digit, digitHeight, digitWidth, duration, place, reducedMotion, textStyle,
}: DigitProps) {
  const translateY = useRef(new Animated.Value(-digit * digitHeight)).current;
  const previousDigit = useRef(digit);
  const previousHeight = useRef(digitHeight);

  useEffect(() => {
    const target = -digit * digitHeight;
    const changed = previousDigit.current !== digit || previousHeight.current !== digitHeight;
    previousDigit.current = digit;
    previousHeight.current = digitHeight;
    translateY.stopAnimation();
    if (!changed || reducedMotion) {
      translateY.setValue(target);
      return;
    }
    const animation = Animated.timing(translateY, {
      toValue: target,
      duration,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [digit, digitHeight, duration, reducedMotion, translateY]);

  return <View style={[styles.drum, { width: digitWidth, height: digitHeight }]}>
    <Animated.View testID={`number-ticker-digit-${place}`} style={{ transform: [{ translateY }] }}>
      {DIGITS.map(item => <Text
        key={item}
        accessible={false}
        style={[styles.digit, textStyle, { width: digitWidth, height: digitHeight, lineHeight: digitHeight }]}
      >{item}</Text>)}
    </Animated.View>
  </View>;
});

/** Scrolls changed digits while keeping separators and the currency suffix still. */
export function NumberTicker({
  value,
  format = String,
  style,
  textStyle,
  containerStyle,
  height,
  duration = 240,
  accessibilityLabel,
}: Props) {
  const reducedMotion = useReducedMotion();
  const formatted = format(value);
  const flatStyle = StyleSheet.flatten([style, textStyle]) || {};
  const drumTextStyle = useMemo(() => glyphStyle(flatStyle), [flatStyle]);
  const fontSize = typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 16;
  const requestedHeight = height ?? (typeof flatStyle.lineHeight === 'number' ? flatStyle.lineHeight : Math.ceil(fontSize * 1.25));
  // Android clips rounded numerals if the mask exactly matches the font box.
  const digitHeight = Math.max(requestedHeight, Math.ceil(fontSize * 1.3));
  const digitWidth = Math.max(1, Math.ceil(fontSize * 0.64));
  const digitCount = (formatted.match(/\d/g) || []).length;
  const justifyContent = flatStyle.textAlign === 'center' ? 'center' : flatStyle.textAlign === 'right' ? 'flex-end' : 'flex-start';
  let digitPosition = digitCount - 1;

  return <View
    accessible
    accessibilityRole="text"
    accessibilityLabel={accessibilityLabel ?? formatted}
    style={[
      styles.container,
      { minHeight: digitHeight, justifyContent },
      // Preserve sizing and alignment when replacing an existing Text node.
      { alignSelf: flatStyle.alignSelf, flex: flatStyle.flex, flexGrow: flatStyle.flexGrow,
        flexShrink: flatStyle.flexShrink, width: flatStyle.width, minWidth: flatStyle.minWidth,
        maxWidth: flatStyle.maxWidth, margin: flatStyle.margin, marginLeft: flatStyle.marginLeft,
        marginRight: flatStyle.marginRight },
      containerStyle,
    ]}
  >
    {Array.from(formatted).map((character, index) => {
      if (/\d/.test(character)) {
        const place = digitPosition--;
        return <DigitDrum
          key={`digit-${place}`}
          digit={Number(character)}
          digitHeight={digitHeight}
          digitWidth={digitWidth}
          duration={duration}
          place={place}
          reducedMotion={reducedMotion}
          textStyle={drumTextStyle}
        />;
      }
      return <Text
        key={`character-${index}-${character}`}
        accessible={false}
        testID={`number-ticker-character-${index}`}
        style={[styles.staticCharacter, drumTextStyle, { height: digitHeight, lineHeight: digitHeight }]}
      >{character}</Text>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flexDirection: 'row', overflow: 'visible' },
  drum: { overflow: 'hidden' },
  digit: { includeFontPadding: false, fontVariant: ['tabular-nums'], textAlign: 'center', textAlignVertical: 'center' },
  staticCharacter: { includeFontPadding: false, fontVariant: ['tabular-nums'], textAlignVertical: 'center' },
});
