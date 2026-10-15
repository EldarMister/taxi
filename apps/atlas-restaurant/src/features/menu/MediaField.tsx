import React, { useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from '../../data/api';
import { Photo } from '../../ui';
import { cropRegion } from './model';
import { Action, IconAction, Message, Panel, T, c, u } from './ui';

export function MediaField({ restaurantId, value, imageKey, onChange, label, aspect = 1, disabled, onBusyChange }: {
  restaurantId: string; value?: string | null; imageKey?: string | null; onChange: (url: string) => void; label: string;
  aspect?: number; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1), [position, setPosition] = useState({ x: .5, y: .5 });
  const lock = useRef(false);
  const width = Math.min(useWindowDimensions().width - 40, 460), height = width / aspect;
  const region = asset ? cropRegion(asset.width, asset.height, aspect, zoom, position.x, position.y) : null;
  async function choose() {
    if (disabled || lock.current) return;
    lock.current = true;
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!result.granted) throw new Error('Разрешите доступ к фотографиям в настройках устройства.');
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false });
      if (result.canceled) return;
      const image = result.assets[0];
      if (!image.width || !image.height) throw new Error('Не удалось прочитать фотографию. Выберите другой файл.');
      setZoom(1); setPosition({ x: .5, y: .5 }); setAsset(image);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть фотографии.'); }
    finally { lock.current = false; }
  }
  async function upload() {
    if (!asset || !region || lock.current) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const result = await ImageManipulator.manipulateAsync(asset.uri, [{ crop: region }, { resize: { width: Math.min(1600, region.width) } }], { compress: .85, format: ImageManipulator.SaveFormat.JPEG });
      const uploaded = await api.upload(restaurantId, { uri: result.uri, name: 'restaurant-photo.jpg', mimeType: 'image/jpeg' });
      onChange(uploaded.url); setAsset(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить фотографию. Повторите попытку.'); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const scale = region ? width / region.width : 1;
  return <View style={{ gap: 10 }}>
    <T muted style={u.label}>{label}</T>
    <Photo imageUrl={value} imageKey={imageKey} label={label} style={{ width: '100%', height: aspect === 1 ? 190 : 150, borderRadius: 22 }}/>
    <Action label={value || imageKey ? 'Заменить фотографию' : 'Загрузить фотографию'} icon="image-outline" secondary onPress={() => void choose()} disabled={disabled || busy}/>
    {!asset && !!error && <Message text={error}/>}
    <Panel visible={!!asset} title="Кадрирование" onClose={() => setAsset(undefined)} busy={busy} footer={<Action label="Использовать фото" onPress={() => void upload()} busy={busy}/>}> 
      <T muted>Настройте масштаб и положение кадра стрелками. Обрезка применяется только к новой копии.</T>
      {asset && region && <View style={{ width, height, maxWidth: '100%', overflow: 'hidden', borderRadius: 24, backgroundColor: c.pale, alignSelf: 'center' }}>
        <Image source={{ uri: asset.uri }} style={{ position: 'absolute', width: asset.width * scale, height: asset.height * scale, left: -region.originX * scale, top: -region.originY * scale }} resizeMode="stretch"/>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: 1, borderColor: 'rgba(255,255,255,.7)', borderRadius: 24 }]}/>
      </View>}
      <View style={[u.row, { justifyContent: 'center' }]}><IconAction icon="remove" label="Уменьшить фото" disabled={zoom <= 1 || busy} onPress={() => setZoom(Math.max(1, zoom - .25))}/><T bold>Масштаб {Math.round(zoom * 100)}%</T><IconAction icon="add" label="Увеличить фото" disabled={zoom >= 3 || busy} onPress={() => setZoom(Math.min(3, zoom + .25))}/></View>
      <View style={[u.row, { justifyContent: 'center' }]}>{(['left', 'up', 'down', 'right'] as const).map(direction => <IconAction key={direction} icon={direction === 'left' ? 'arrow-back' : direction === 'right' ? 'arrow-forward' : direction === 'up' ? 'arrow-up' : 'arrow-down'} label={`Сместить кадр: ${direction === 'left' ? 'влево' : direction === 'right' ? 'вправо' : direction === 'up' ? 'вверх' : 'вниз'}`} disabled={busy}
        onPress={() => setPosition(p => ({ x: Math.max(0, Math.min(1, p.x + (direction === 'left' ? -.1 : direction === 'right' ? .1 : 0))), y: Math.max(0, Math.min(1, p.y + (direction === 'up' ? -.1 : direction === 'down' ? .1 : 0))) }))}/>)}</View>
      {!!error && <Message text={error}/>}
    </Panel>
  </View>;
}
