import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { Language, User } from './types';
import { tr } from './ui';
import { permissionPalettes, type PermissionPalette } from './permissionPalette';

type Props = {
  step: 'notifications' | 'overlay' | 'location' | 'battery';
  language: Language;
  role: User['role'];
  size: number;
  dark?: boolean;
};

const blue = '#2F70FF';

function SettingsSwitch({ x, y, active = false, tone }: { x: number; y: number; active?: boolean; tone: PermissionPalette }) {
  return <G>
    <Rect x={x} y={y} width={39} height={21} rx={10.5} fill={active ? blue : tone.frame}/>
    <Circle cx={x + (active ? 28.5 : 10.5)} cy={y + 10.5} r={8.5} fill="#FFFFFF"/>
  </G>;
}

function PlaceholderRow({ y, toggle = false, tone }: { y: number; toggle?: boolean; tone: PermissionPalette }) {
  return <G>
    <Rect x={55} y={y} width={31} height={29} rx={7} fill={tone.frame}/>
    <Rect x={99} y={y + 8} width={toggle ? 88 : 94} height={13} rx={4} fill={tone.frame}/>
    {toggle && <SettingsSwitch x={233} y={y + 5} tone={tone}/>}
  </G>;
}

// Decorative settings diagrams stay vector based, so their lines and labels remain sharp at any screen size.
export function PermissionIllustration({ step, language, role, size, dark = false }: Props) {
  const t = tr(language);
  const tone = permissionPalettes[dark ? 'dark' : 'light'];
  const locationLabel = t(role === 'DRIVER' ? 'Разрешить в любом режиме' : 'При использовании приложения');
  const rowLabel = t(step === 'notifications' ? 'Уведомления' : step === 'battery' ? 'Энергосбережение' : 'ATLAS');
  const gradientId = `permission-fade-${step}`;

  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    <Svg width={size} height={size} viewBox="0 0 320 320">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tone.background} stopOpacity="0"/>
          <Stop offset="0.2" stopColor={tone.background} stopOpacity="0.08"/>
          <Stop offset="0.6" stopColor={tone.background} stopOpacity="0.76"/>
          <Stop offset="1" stopColor={tone.background} stopOpacity="1"/>
        </LinearGradient>
      </Defs>

      <Rect x={30} y={16} width={260} height={310} rx={40} stroke={tone.frame} strokeWidth={16} fill={tone.background}/>

      {(step === 'notifications' || step === 'overlay') && <G>
        <PlaceholderRow y={60} tone={tone}/>
        <Rect x={38} y={100} width={244} height={54} rx={15} fill={tone.shadow}/>
        <Rect x={38} y={98} width={244} height={53} rx={15} fill={tone.surface}/>
        <Rect x={55} y={111} width={32} height={30} rx={7} fill={step === 'notifications' ? blue : tone.icon}/>
        {step === 'notifications' ? <G>
          <Path d="M71 116c-4 0-6 3-6 7v4l-2.5 4h17l-2.5-4v-4c0-4-2-7-6-7Z" fill="#FFFFFF"/>
          <Circle cx={71} cy={115.5} r={1.5} fill="#FFFFFF"/>
          <Path d="M68.5 133a2.5 2.5 0 0 0 5 0" fill="#FFFFFF"/>
        </G> : <G stroke={blue} strokeWidth={1.8} fill={tone.surface}>
          <Rect x={62} y={117} width={13} height={12} rx={2}/>
          <Rect x={67} y={122} width={13} height={12} rx={2}/>
        </G>}
        <SvgText x={99} y={130} fill={tone.ink} fontFamily="Inter_400Regular" fontSize={Math.min(13, 126 / (rowLabel.length * .54))}>{rowLabel}</SvgText>
        <SettingsSwitch x={233} y={116} active tone={tone}/>
        <PlaceholderRow y={163} toggle tone={tone}/>
        <PlaceholderRow y={207} toggle tone={tone}/>
      </G>}

      {step === 'location' && <G>
        <Circle cx={160} cy={69} r={28} fill={tone.halo}/>
        <Path d="M160 55c-6 0-10.5 4.6-10.5 10.3 0 7.4 10.5 17.8 10.5 17.8s10.5-10.4 10.5-17.8C170.5 59.6 166 55 160 55Z" fill={blue}/>
        <Circle cx={160} cy={65.2} r={3.8} fill="#FFFFFF"/>
        <Rect x={82} y={111} width={156} height={18} rx={6} fill={tone.placeholder}/>
        <Circle cx={65} cy={164} r={10.5} fill={blue}/>
        <Circle cx={65} cy={164} r={4.5} fill="#FFFFFF"/>
        <SvgText x={89} y={169} fill={tone.ink} fontFamily="Inter_400Regular" fontSize={Math.min(12.3, 178 / (locationLabel.length * .53))}>{locationLabel}</SvgText>
        <Circle cx={65} cy={197} r={10.5} fill={tone.radio}/>
        <Circle cx={65} cy={197} r={4.5} fill={tone.background}/>
        <Rect x={89} y={189} width={144} height={16} rx={5} fill={tone.frame}/>
        <Circle cx={65} cy={230} r={10.5} fill={tone.radio}/>
        <Circle cx={65} cy={230} r={4.5} fill={tone.background}/>
        <Rect x={89} y={222} width={107} height={16} rx={5} fill={tone.frame}/>
      </G>}

      {step === 'battery' && <G>
        <Rect x={55} y={72} width={40} height={38} rx={9} fill={tone.frame}/>
        <Rect x={112} y={84} width={128} height={15} rx={5} fill={tone.frame}/>
        <Rect x={55} y={122} width={210} height={16} rx={5} fill={tone.frame}/>
        <Path d="M60 122h63v16H60a5 5 0 0 1-5-5v-6a5 5 0 0 1 5-5Z" fill={tone.placeholder}/>
        <Rect x={22} y={162} width={276} height={58} rx={17} fill={tone.shadow}/>
        <Rect x={22} y={158} width={276} height={58} rx={17} fill={tone.surface}/>
        <SvgText x={42} y={193} fill={tone.ink} fontFamily="Inter_400Regular" fontSize={Math.min(17, 188 / (rowLabel.length * .53))}>{rowLabel}</SvgText>
        <SettingsSwitch x={239} y={177} active tone={tone}/>
        <PlaceholderRow y={236} tone={tone}/>
      </G>}

      <Rect x={0} y={213} width={320} height={107} fill={`url(#${gradientId})`}/>
    </Svg>
  </View>;
}
