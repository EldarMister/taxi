import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PointAnnotation, type PointAnnotationRef } from '@maplibre/maplibre-react-native';
import { Icon, PickupIcon, colors, tr } from '../ui';
import type { Language } from '../types';
import type { MapPoint } from './mapkit';

export type EndpointPresentation = 'compact' | 'detailed' | 'focused';
export type EndpointAppearance = 'passenger' | 'driver';
export type EndpointMetrics = { label: string; value: string };
export interface EndpointMarkerProps {
  id: string;
  field: 'pickup' | 'dropoff';
  point: MapPoint;
  dark: boolean;
  language: Language;
  presentation?: EndpointPresentation;
  appearance?: EndpointAppearance;
  styleRevision?: number;
  metrics?: EndpointMetrics | null;
  pickupEtaMinutes?: number | null;
  routeLabel?: string;
  onPress?: () => void;
  onEdit?: () => void;
}

// Every presentation uses this exact bitmap canvas and the same ground point.
// Changing a label must never change the geographic anchor during camera zoom.
export const ENDPOINT_FRAME = { width: 360, height: 112, groundX: 130, groundY: 104 } as const;
export const ENDPOINT_ANCHOR = { x: ENDPOINT_FRAME.groundX / ENDPOINT_FRAME.width, y: ENDPOINT_FRAME.groundY / ENDPOINT_FRAME.height };

/** Committed coordinates are drawn by MapLibre's GL renderer, along with roads.
 * Android PointAnnotation snapshots its child; the live selection pin belongs
 * outside MapView instead, where its lift/spinner can animate normally. */
export const EndpointMarker = memo(function EndpointMarker({
  id, field, point, dark, language, presentation = 'detailed', appearance = 'passenger', metrics, pickupEtaMinutes,
  routeLabel, styleRevision = 0, onPress, onEdit,
}: EndpointMarkerProps) {
  const annotation = useRef<PointAnnotationRef>(null);
  const frame = useRef<number | null>(null);
  const mounted = useRef(true);
  const coordinate = useMemo(() => [point.longitude, point.latitude], [point.longitude, point.latitude]);
  const t = tr(language);
  const title = t(field === 'pickup' ? 'Место подачи' : 'Место назначения');
  const focused = presentation === 'focused';
  const eta = pickupEtaMinutes != null && Number.isFinite(pickupEtaMinutes) && pickupEtaMinutes >= 0
    ? String(Math.max(1, Math.ceil(pickupEtaMinutes))) : null;
  const driver = appearance === 'driver';
  const foreground = dark ? '#101010' : '#FFFFFF';
  const timeOnly = !driver && field === 'pickup' && presentation !== 'detailed' && eta != null;
  const routeParts = routeLabel?.split(' · ');
  const detail = routeParts?.length ? { label: routeParts[0], value: routeParts.slice(1).join(' · ') } : metrics;
  const [headWidth, setHeadWidth] = useState(200);

  const refreshBitmap = useCallback(() => {
    if (!mounted.current) return;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    // Wait for native text/layout commits. This runs only for changed content,
    // font completion or layout, never for a camera frame or zoom notification.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (mounted.current) annotation.current?.refresh();
      });
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    // Icon's font loads asynchronously on a cold start. Refresh the cached
    // annotation after that shared font promise, even if its bounds stay fixed.
    void Ionicons.loadFont().then(refreshBitmap, () => {});
    return () => {
      mounted.current = false;
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [refreshBitmap]);
  useEffect(refreshBitmap, [refreshBitmap, field, appearance, presentation, dark, language, eta, metrics?.label, metrics?.value, routeLabel, styleRevision]);

  return <PointAnnotation ref={annotation} id={id} coordinate={coordinate} anchor={ENDPOINT_ANCHOR}
    draggable={false} onSelected={() => { if (focused) onEdit?.(); else (onPress ?? onEdit)?.(); }}>
    <View testID={`${field}-endpoint-bitmap`} collapsable={false} onLayout={refreshBitmap}
      accessible accessibilityRole={onPress || onEdit ? 'button' : 'image'}
      accessibilityLabel={[title, focused ? t('Изменить') : detail?.label, focused ? '' : detail?.value].filter(Boolean).join(', ')}
      style={s.frame}>
      <View testID={`${field}-endpoint-shadow`} style={s.shadow}><View style={s.shadowMiddle}/><View style={s.shadowCore}/></View>
      <View testID={`${field}-endpoint-stem`} style={[s.stem, dark && s.darkStem]}/>
      <View testID={`${field}-endpoint-head`} onLayout={event => {
        const width = event.nativeEvent.layout.width;
        setHeadWidth(previous => previous === width ? previous : width);
        refreshBitmap();
      }} style={[s.head, focused && { left: ENDPOINT_FRAME.groundX - headWidth / 2 }]}>
        {/* Android offscreen View.draw does not include elevation shadows. These
            static translucent halos are captured into the same GL bitmap. */}
        <View pointerEvents="none" style={s.badgeShadowOuter}/>
        <View pointerEvents="none" style={s.badgeShadowInner}/>
        <View testID={`${field}-endpoint-surface`} pointerEvents="none" style={[s.surface, dark && s.darkSurface]}/>
        <View testID={`${field}-endpoint-icon`} style={[s.icon, driver && s.routeIcon, dark && s.darkIcon]}>
          {driver ? <Text testID={`driver-${field}-letter`} onTextLayout={refreshBitmap} maxFontSizeMultiplier={1.2}
            style={[s.routeLetter, { color: foreground }]}>{field === 'pickup' ? 'А' : 'Б'}</Text>
            : timeOnly ? <><Text onTextLayout={refreshBitmap} maxFontSizeMultiplier={1.15} style={[s.etaValue, { color: foreground }]}>{eta}</Text>
              <Text onTextLayout={refreshBitmap} maxFontSizeMultiplier={1.15} style={[s.etaUnit, { color: foreground }]}>{t('мин')}</Text></>
            : field === 'pickup' ? <PickupIcon color={foreground} size={22}/> : <Icon name="flag" color={foreground} size={22}/>}
        </View>
        {(focused || presentation === 'detailed' && detail) && <View testID={`${field}-endpoint-detail`}
          style={[s.detail, focused && s.focusedDetail]}>
          <Text onTextLayout={refreshBitmap} numberOfLines={1} maxFontSizeMultiplier={1.2}
            style={[s.detailLabel, focused && s.focusedTitle, dark && s.darkText]}>{focused ? `${title} ›` : detail?.label}</Text>
          <Text onTextLayout={refreshBitmap} numberOfLines={1} maxFontSizeMultiplier={1.2}
            style={[s.detailValue, focused && s.focusedSubtitle, dark && s.darkText]}>{focused ? t('Изменить') : detail?.value}</Text>
        </View>}
      </View>
    </View>
  </PointAnnotation>;
});

const s = StyleSheet.create({
  frame: { width: ENDPOINT_FRAME.width, height: ENDPOINT_FRAME.height, alignSelf: 'flex-start' },
  head: { position: 'absolute', left: ENDPOINT_FRAME.groundX - 22, top: 38, height: 44, flexDirection: 'row', alignItems: 'center' },
  surface: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 16, backgroundColor: '#FFFFFF' },
  darkSurface: { backgroundColor: '#24272D' },
  badgeShadowOuter: { position: 'absolute', top: -2, left: -4, right: -4, height: 52, borderRadius: 20, backgroundColor: 'rgba(14, 25, 40, .04)' },
  badgeShadowInner: { position: 'absolute', top: 0, left: -2, right: -2, height: 48, borderRadius: 18, backgroundColor: 'rgba(14, 25, 40, .07)' },
  icon: { width: 44, height: 44, borderRadius: 16, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  routeIcon: { backgroundColor: '#246BFD' },
  darkIcon: { backgroundColor: '#FFFFFF' },
  routeLetter: { color: '#FFFFFF', fontSize: 22, lineHeight: 28, fontWeight: '800' },
  detail: { height: 44, maxWidth: 116, paddingLeft: 5, paddingRight: 10, borderTopRightRadius: 16, borderBottomRightRadius: 16, justifyContent: 'center' },
  focusedDetail: { maxWidth: 166 },
  detailLabel: { color: '#20252B', fontSize: 11, lineHeight: 14 },
  detailValue: { color: '#20252B', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  focusedTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  focusedSubtitle: { fontSize: 11, lineHeight: 15, fontWeight: '400' },
  darkText: { color: '#FFFFFF' },
  etaValue: { color: '#FFFFFF', fontSize: 20, lineHeight: 23, fontWeight: '700' },
  etaUnit: { color: '#FFFFFF', fontSize: 11, lineHeight: 13 },
  stem: { position: 'absolute', top: 82, left: ENDPOINT_FRAME.groundX - 1.5, width: 3, height: 22, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: colors.ink },
  darkStem: { backgroundColor: '#FFFFFF' },
  shadow: { position: 'absolute', left: ENDPOINT_FRAME.groundX - 10, top: ENDPOINT_FRAME.groundY - 6, width: 20, height: 12, borderRadius: 10, backgroundColor: 'rgba(20, 28, 38, .06)', alignItems: 'center', justifyContent: 'center' },
  shadowMiddle: { position: 'absolute', width: 14, height: 9, borderRadius: 7, backgroundColor: 'rgba(20, 28, 38, .10)' },
  shadowCore: { width: 8, height: 6, borderRadius: 4, backgroundColor: 'rgba(20, 28, 38, .18)' },
});
