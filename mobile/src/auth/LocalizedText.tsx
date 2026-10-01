import React from 'react';
import { Text as NativeText, type TextProps } from 'react-native';
import { en } from '../en';
import { selectedLanguage } from './languageStore';

export function translateInterfaceText(value: string): string {
  if (selectedLanguage() !== 'en') return value;
  const translated = en[value];
  if (translated) return translated;
  const trimmed = value.trim();
  return en[trimmed] ? value.replace(trimmed, en[trimmed]) : value;
}

function translateChildren(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') return translateInterfaceText(children);
  if (Array.isArray(children)) return children.map(translateChildren);
  return children;
}

export function LocalizedText({ children, ...props }: TextProps) {
  return <NativeText {...props}>{translateChildren(children)}</NativeText>;
}
