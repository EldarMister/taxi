import React, { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, messageOf } from './api';
import { useTheme } from './design/theme';
import type { User } from './types';
import { Button, Icon, Logo, colors } from './ui';

type Photo = { uri: string; name: string; type: 'image/jpeg' };

async function choosePhoto(profile: boolean): Promise<Photo | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: profile,
    aspect: profile ? [1, 1] : undefined,
    quality: .85,
    allowsMultipleSelection: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const actions: ImageManipulator.Action[] = profile
    ? [{ resize: { width: 720, height: 720 } }]
    : asset.width > 1280 ? [{ resize: { width: 1280 } }] : [];
  const normalized = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: .8, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: normalized.uri, name: profile ? 'profile.jpg' : 'vehicle.jpg', type: 'image/jpeg' };
}

export function DriverRegistrationScreen({ onRegistered, onLogout }: { onRegistered: (user: User) => void; onLogout: () => Promise<void> }) {
  const { isDark, palette } = useTheme();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [carMake, setCarMake] = useState('');
  const [carPlate, setCarPlate] = useState('');
  const [carColor, setCarColor] = useState('');
  const [transport, setTransport] = useState<'ECONOMY' | 'TRUCK'>('ECONOMY');
  const [vehiclePhoto, setVehiclePhoto] = useState<Photo | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = firstName.trim().length >= 2 && lastName.trim().length >= 2 && carMake.trim().length >= 2 && carPlate.trim().length >= 2 && !!vehiclePhoto;
  const inputStyle = [r.input, isDark && { backgroundColor: palette.elevated, color: palette.ink, borderColor: palette.line }];

  const pick = async(profile: boolean) => {
    try {
      const photo = await choosePhoto(profile);
      if (photo) (profile ? setProfilePhoto : setVehiclePhoto)(photo);
    } catch (e) { setError(messageOf(e)); }
  };
  const submit = async() => {
    if (!ready || busy || !vehiclePhoto) return;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('firstName', firstName.trim());
      form.append('lastName', lastName.trim());
      form.append('carMake', carMake.trim());
      form.append('carPlate', carPlate.trim().toUpperCase());
      if (carColor.trim()) form.append('carColor', carColor.trim());
      form.append('requestedTransportClass', transport);
      form.append('vehiclePhoto', vehiclePhoto as unknown as Blob);
      if (profilePhoto) form.append('profilePhoto', profilePhoto as unknown as Blob);
      onRegistered(await api.upload<User>('/driver/register', form));
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  };

  return <SafeAreaView style={[r.screen, isDark && { backgroundColor: palette.background }]}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={r.content}>
        <View style={r.header}><Logo/><Pressable disabled={busy} onPress={() => void onLogout()}><Text style={[r.logout, { color: palette.accent }]}>Выйти</Text></Pressable></View>
        <View><Text style={[r.title, { color: palette.ink }]}>Регистрация в Atlas pro</Text><Text style={[r.subtitle, { color: palette.muted }]}>Заполните данные водителя. После проверки администратор назначит класс автомобиля и откроет доступ к заказам.</Text></View>
        <View style={r.classRow}>{([['ECONOMY','Легковая'],['TRUCK','Грузовая']] as const).map(([value,label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: transport === value }} onPress={() => setTransport(value)} style={[r.classCard, { borderColor: transport === value ? palette.accent : palette.line, backgroundColor: isDark ? palette.elevated : transport === value ? '#EDF6FF' : '#FFFFFF' }]}><Icon name={value === 'TRUCK' ? 'bus-outline' : 'car-outline'} color={palette.accent} size={28}/><Text style={[r.classTitle, { color: palette.ink }]}>{label}</Text><Text style={[r.classHint, { color: palette.muted }]}>{value === 'TRUCK' ? 'Для крупных грузов' : 'Такси и небольшие грузы'}</Text></Pressable>)}</View>
        <View style={r.fields}>
          <View style={r.names}><TextInput value={firstName} onChangeText={setFirstName} placeholder="Имя" placeholderTextColor={palette.muted} maxLength={60} style={[...inputStyle, { flex: 1 }]}/><TextInput value={lastName} onChangeText={setLastName} placeholder="Фамилия" placeholderTextColor={palette.muted} maxLength={60} style={[...inputStyle, { flex: 1 }]}/></View>
          <TextInput value={carMake} onChangeText={setCarMake} placeholder="Марка и модель машины" placeholderTextColor={palette.muted} maxLength={80} style={inputStyle}/>
          <TextInput value={carPlate} onChangeText={setCarPlate} placeholder="Госномер машины" placeholderTextColor={palette.muted} autoCapitalize="characters" maxLength={20} style={inputStyle}/>
          <TextInput value={carColor} onChangeText={setCarColor} placeholder="Цвет машины (необязательно)" placeholderTextColor={palette.muted} maxLength={40} style={inputStyle}/>
        </View>
        <PhotoPicker title="Фото машины" hint="Обязательно. Машина должна быть видна полностью." photo={vehiclePhoto} onPress={() => void pick(false)} palette={palette}/>
        <PhotoPicker title="Фото профиля" hint="Необязательно. Можно добавить позже." photo={profilePhoto} onPress={() => void pick(true)} palette={palette}/>
        {!!error && <Text accessibilityRole="alert" style={r.error}>{error}</Text>}
        <Button label="Отправить на проверку" busy={busy} disabled={!ready} onPress={() => void submit()}/>
        {busy && <ActivityIndicator color={palette.accent}/>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function PhotoPicker({ title, hint, photo, onPress, palette }: { title: string; hint: string; photo: Photo | null; onPress: () => void; palette: ReturnType<typeof useTheme>['palette'] }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[r.photo, { borderColor: palette.line, backgroundColor: palette.elevated }]}>{photo ? <Image source={{ uri: photo.uri }} resizeMode="cover" style={r.photoImage}/> : <View style={[r.photoIcon, { backgroundColor: palette.surface }]}><Icon name="camera-outline" color={palette.accent} size={30}/></View>}<View style={{ flex: 1, gap: 4 }}><Text style={[r.photoTitle, { color: palette.ink }]}>{title}</Text><Text style={[r.photoHint, { color: palette.muted }]}>{photo ? 'Фото выбрано · нажмите, чтобы заменить' : hint}</Text></View><Icon name="chevron-forward" color={palette.muted} size={19}/></Pressable>;
}

const r = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6FAFD' }, content: { padding: 20, paddingBottom: 40, gap: 18 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, logout: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 29, lineHeight: 36, fontWeight: '800', letterSpacing: -.7 }, subtitle: { marginTop: 8, fontSize: 14, lineHeight: 21 }, classRow: { flexDirection: 'row', gap: 10 }, classCard: { flex: 1, borderWidth: 1.5, borderRadius: 20, padding: 14, gap: 6 }, classTitle: { fontSize: 16, fontWeight: '700' }, classHint: { fontSize: 11, lineHeight: 15 },
  fields: { gap: 10 }, names: { flexDirection: 'row', gap: 10 }, input: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: '#DCE5ED', backgroundColor: '#FFFFFF', color: colors.ink, paddingHorizontal: 15, fontSize: 15 },
  photo: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderRadius: 18, padding: 12 }, photoIcon: { width: 58, height: 58, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, photoImage: { width: 72, height: 58, borderRadius: 13 }, photoTitle: { fontSize: 15, fontWeight: '700' }, photoHint: { fontSize: 11, lineHeight: 16 }, error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
