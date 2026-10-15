import React, { forwardRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { Icon } from '../ui';
import { translateInterfaceText } from '../auth/LocalizedText';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (value: string) => void;
};

export const ClearableTextInput = forwardRef<TextInput, Props>(function ClearableTextInput({ value, onChangeText, onFocus, onBlur, style, accessibilityLabel, editable = true, multiline, ...inputProps }, ref) {
  const [focused, setFocused] = useState(false);
  const showClear = focused && !!value && editable && !multiline;
  const clear = () => onChangeText('');

  return <View style={styles.wrapper}>
    <TextInput
      ref={ref}
      {...inputProps}
      value={value}
      onChangeText={onChangeText}
      onFocus={event => { setFocused(true); onFocus?.(event); }}
      onBlur={event => { setFocused(false); onBlur?.(event); }}
      accessibilityLabel={accessibilityLabel}
      editable={editable}
      multiline={multiline}
      style={[style, showClear && styles.inputWithClear]}
    />
    {showClear ? <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${translateInterfaceText('Очистить')} ${accessibilityLabel || ''}`.trim()}
      testID={inputProps.testID ? `${inputProps.testID}-clear` : undefined}
      hitSlop={8}
      onPress={clear}
      style={styles.clearButton}
    ><Icon name="close-circle" size={19} color="#858B95"/></Pressable> : null}
  </View>;
});

const styles = {
  wrapper: { position: 'relative' as const },
  inputWithClear: { paddingRight: 50 },
  clearButton: { position: 'absolute' as const, right: 7, top: 0, bottom: 0, width: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
};
