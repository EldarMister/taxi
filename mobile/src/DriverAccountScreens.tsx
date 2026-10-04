import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api } from './api';
import { useTheme, type ThemePreference } from './design/theme';
import { fonts } from './design/typography';
import type { Language, User } from './types';
import { Avatar, Car, Icon, localize, ToggleSwitch, tr } from './ui';
import type { Page } from './AccountScreens';

export type DriverPreferencesPatch = Partial<Pick<NonNullable<User['driverProfile']>, 'acceptsEconomy' | 'acceptsComfort' | 'acceptsDeliveryCar' | 'acceptsDeliveryFood' | 'acceptsDeliveryTruck'>>;

function useAccountDesign() {
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  return { scale: Math.max(.72, Math.min(1.2, width / 426.5)), isDark,
    colors: isDark ? { background: '#111111', ink: '#F4F4F7', secondary: '#A3A5B1', line: '#33343D', inactive: '#373840', accent: '#1677FF' }
      : { background: '#FDFDFF', ink: '#171B2B', secondary: '#808598', line: '#E2E3EE', inactive: '#E2E3E9', accent: '#1677FF' } };
}

function AccountHeader({ title, menuLabel, onMenu, profile = false }: { title: string; menuLabel: string; onMenu: () => void; profile?: boolean }) {
  const { scale, colors, isDark } = useAccountDesign();
  const insets = useSafeAreaInsets();
  return <View style={{ paddingTop: insets.top + 8 * scale, paddingBottom: profile ? 0 : 10 * scale, backgroundColor: colors.background }}>
    <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.background}/>
    <View style={{ height: 50 * scale, flexDirection: 'row', alignItems: 'center', paddingLeft: Math.max(insets.left, (profile ? 13.5 : 19.5) * scale), paddingRight: Math.max(insets.right, (profile ? 13.5 : 19.5) * scale) }}>
      <Pressable accessibilityRole="button" accessibilityLabel={menuLabel} onPress={onMenu} hitSlop={8} style={({ pressed }) => ({ width: 36 * scale, height: 44 * scale, justifyContent: 'center', opacity: pressed ? .6 : 1 })}><Icon name="menu-outline" color={colors.ink} size={27 * scale}/></Pressable>
      <Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.bold, fontSize: 19 * scale, lineHeight: 26 * scale, textAlign: 'center', letterSpacing: -.5 }}>{title}</Text>
      <View style={{ width: 36 * scale }}/>
    </View>
  </View>;
}

function AccountToggle({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const { scale, colors } = useAccountDesign();
  return <View style={{ width: 51 * scale, height: 31 * scale, justifyContent: 'center', alignItems: 'center' }}><View style={{ transform: [{ scale }] }}><ToggleSwitch label={label} value={value} disabled={disabled} onValueChange={onChange} accentColor={colors.accent} inactiveColor={colors.inactive}/></View></View>;
}

function SettingRow({ title, caption, icon, value, disabled = false, unavailable = false, onChange, height = 68, indented = false, fullDivider = false }: { title: string; caption?: string; icon?: React.ComponentProps<typeof Icon>['name']; value: boolean; disabled?: boolean; unavailable?: boolean; onChange: (value: boolean) => void; height?: number; indented?: boolean; fullDivider?: boolean }) {
  const { scale, colors } = useAccountDesign();
  return <View style={[styles.settingRow, { minHeight: height * scale, borderBottomColor: colors.line, marginLeft: indented && !fullDivider ? 17 * scale : 0, paddingLeft: indented && fullDivider ? 17 * scale : 0, paddingVertical: 9 * scale }]}>
    {icon && <View style={{ width: 46 * scale }}><Icon name={icon} size={25 * scale} color={colors.ink}/></View>}
    <View style={{ flex: 1, gap: 3 * scale, marginRight: 10 * scale }}><Text style={{ color: unavailable ? colors.secondary : colors.ink, fontFamily: fonts.bold, fontSize: 15.5 * scale, lineHeight: 22 * scale, letterSpacing: -.2 }}>{title}</Text>{caption ? <Text style={{ color: colors.secondary, fontFamily: fonts.regular, fontSize: 13 * scale, lineHeight: 18 * scale, letterSpacing: -.15 }}>{caption}</Text> : null}</View>
    <AccountToggle label={title} value={value} disabled={disabled} onChange={onChange}/>
  </View>;
}

export function DriverSettingsScreen({ user, saving, voiceEnabled, onVoiceEnabledChange, notificationGranted, onNotifications, onOpenNotificationSettings, themePreference, onThemePreferenceChange, onLanguage, onPreferences, onMenu }: {
  user: User; saving: boolean; voiceEnabled: boolean; onVoiceEnabledChange?: (value: boolean) => void; notificationGranted: boolean | null;
  onNotifications: (value: boolean) => void; onOpenNotificationSettings: () => void; themePreference: ThemePreference;
  onThemePreferenceChange: (value: ThemePreference) => void; onLanguage: (value: Language) => Promise<boolean>; onPreferences: (patch: DriverPreferencesPatch) => void; onMenu: () => void;
}) {
  const { scale, colors } = useAccountDesign();
  const insets = useSafeAreaInsets();
  const t = tr(user.language), local = (ru: string, ky: string) => localize(user.language, ru, ky);
  const profile = user.driverProfile;
  const [deliveryOpen, setDeliveryOpen] = useState(true);
  const [languageOpen, setLanguageOpen] = useState(false);
  const driverClass = t(profile?.transportClass === 'COMFORT' ? 'Комфорт' : profile?.transportClass === 'TRUCK' ? 'Грузовой' : 'Эконом');
  const comfortAvailable = profile?.transportClass === 'COMFORT';
  const carAvailable = profile?.transportClass !== 'TRUCK';
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <AccountHeader title={t('Настройки')} menuLabel={t('Меню')} onMenu={onMenu}/>
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingLeft: Math.max(insets.left, 19.5 * scale), paddingRight: Math.max(insets.right, 19.5 * scale), paddingBottom: Math.max(insets.bottom, 16) + 14 * scale }}>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }}>
        {onVoiceEnabledChange && <SettingRow title={local('Озвучивать маршрут', 'Маршрутту үн менен айтуу')} icon="volume-high-outline" value={voiceEnabled} onChange={onVoiceEnabledChange} height={64}/>}
        {profile && <>
          <View style={{ minHeight: 72 * scale, paddingTop: 15 * scale, paddingBottom: 13 * scale, gap: 4 * scale }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 15.5 * scale, lineHeight: 22 * scale }}>{local('Какие заказы принимать', 'Кайсы буюртмаларды кабыл алуу')}</Text><Text style={{ color: colors.secondary, fontFamily: fonts.regular, fontSize: 13 * scale, lineHeight: 18 * scale, letterSpacing: -.15 }}>{user.language === 'en' ? `Assigned class: ${driverClass}` : user.language === 'ky' ? `Унаа классы: ${driverClass}` : `Назначенный класс: ${driverClass}`}</Text></View>
          <SettingRow title={t('Эконом')} caption={t('Обычные поездки')} value={!!profile.acceptsEconomy} disabled={saving || !carAvailable} unavailable={!carAvailable} onChange={acceptsEconomy => onPreferences({ acceptsEconomy })}/>
          <SettingRow title={t('Комфорт')} caption={comfortAvailable ? local('Поездки Комфорт', 'Комфорт сапарлары') : local('Недоступен вам', 'Сиз үчүн жеткиликсиз')} value={!!profile.acceptsComfort} disabled={saving || !comfortAvailable} unavailable={!comfortAvailable} onChange={acceptsComfort => onPreferences({ acceptsComfort })} height={71}/>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Доставка')} accessibilityState={{ expanded: deliveryOpen }} onPress={() => setDeliveryOpen(value => !value)} style={({ pressed }) => [styles.settingRow, { minHeight: 48.5 * scale, borderBottomColor: colors.line, opacity: pressed ? .6 : 1 }]}><Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.bold, fontSize: 15.5 * scale, lineHeight: 22 * scale }}>{t('Доставка')}</Text><Icon name={deliveryOpen ? 'chevron-up' : 'chevron-down'} size={20 * scale} color={colors.ink}/></Pressable>
          {deliveryOpen && <View>
            <SettingRow title={t('Доставка на машине')} caption={carAvailable ? t('Небольшие чистые грузы') : local('Недоступен вам', 'Сиз үчүн жеткиликсиз')} value={!!profile.acceptsDeliveryCar} disabled={saving || !carAvailable} unavailable={!carAvailable} onChange={acceptsDeliveryCar => onPreferences({ acceptsDeliveryCar })} indented height={64}/>
            <SettingRow title={t('Доставка еды')} caption={carAvailable ? t('Из ресторанов') : local('Недоступен вам', 'Сиз үчүн жеткиликсиз')} value={profile.acceptsDeliveryFood ?? false} disabled={saving || !carAvailable} unavailable={!carAvailable} onChange={acceptsDeliveryFood => onPreferences({ acceptsDeliveryFood })} indented fullDivider height={67.5}/>
            {profile.transportClass === 'TRUCK' && <SettingRow title={t('Грузовая доставка')} caption={t('Крупные грузы')} value={!!profile.acceptsDeliveryTruck} disabled={saving} onChange={acceptsDeliveryTruck => onPreferences({ acceptsDeliveryTruck })} indented/>}
          </View>}
        </>}
        <SettingRow title={t('Уведомления')} icon="notifications-outline" value={user.notifications && notificationGranted !== false} disabled={saving} onChange={onNotifications} height={66}/>
        {user.notifications && notificationGranted === false && <Pressable accessibilityRole="button" onPress={onOpenNotificationSettings} style={{ paddingVertical: 12 * scale }}><Text style={{ color: colors.secondary, fontSize: 13 * scale }}>{t('Разрешение телефона выключено')} · {t('Открыть настройки')}</Text></Pressable>}
        <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 15.5 * scale, lineHeight: 22 * scale, paddingTop: 16 * scale, paddingBottom: 4 * scale }}>{local('Тема оформления', 'Көрүнүш темасы')}</Text>
        {([{ value: 'system', ru: 'Как в системе', ky: 'Түзмөктөгүдөй' }, { value: 'light', ru: 'Светлая', ky: 'Жарык' }, { value: 'dark', ru: 'Тёмная', ky: 'Караңгы' }] as const).map(option => {
          const selected = themePreference === option.value;
          return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={local(option.ru, option.ky)} accessibilityState={{ selected, checked: selected }} onPress={() => onThemePreferenceChange(option.value)} style={({ pressed }) => [styles.settingRow, { minHeight: 51 * scale, borderBottomColor: colors.line, opacity: pressed ? .6 : 1 }]}><Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.regular, fontSize: 16 * scale, lineHeight: 22 * scale }}>{local(option.ru, option.ky)}</Text><Icon name={selected ? 'radio-button-on' : 'radio-button-off'} color={selected ? colors.accent : colors.secondary} size={27 * scale}/></Pressable>;
        })}
        <Pressable accessibilityRole="button" accessibilityLabel={t('Язык интерфейса')} onPress={() => setLanguageOpen(true)} style={({ pressed }) => [styles.settingRow, { minHeight: 59 * scale, borderBottomColor: colors.line, opacity: pressed ? .6 : 1 }]}><Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.bold, fontSize: 15.5 * scale, lineHeight: 22 * scale }}>{t('Язык интерфейса')}</Text><Icon name="chevron-forward" size={20 * scale} color={colors.secondary}/></Pressable>
      </View>
    </ScrollView>
    <Modal visible={languageOpen} transparent animationType="slide" onRequestClose={() => setLanguageOpen(false)}><View style={styles.modalRoot}><Pressable accessibilityLabel={t('Закрыть')} onPress={() => setLanguageOpen(false)} style={styles.backdrop}/><View style={{ backgroundColor: colors.background, padding: 20, paddingBottom: Math.max(insets.bottom, 20) }}><View style={styles.modalHeader}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 18 }}>{t('Язык интерфейса')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} hitSlop={8} onPress={() => setLanguageOpen(false)}><Icon name="close" color={colors.ink}/></Pressable></View>{(['ru', 'ky', 'en'] as Language[]).map(language => <Pressable key={language} accessibilityRole="radio" accessibilityLabel={language === 'ru' ? 'Русский' : language === 'ky' ? 'Кыргызча' : 'English'} accessibilityState={{ checked: user.language === language, disabled: saving }} disabled={saving} onPress={() => void onLanguage(language).then(saved => { if (saved) setLanguageOpen(false); })} style={[styles.settingRow, { minHeight: 58, borderBottomColor: colors.line }]}><Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.regular, fontSize: 17 }}>{language === 'ru' ? 'Русский' : language === 'ky' ? 'Кыргызча' : 'English'}</Text><Icon name={user.language === language ? 'radio-button-on' : 'radio-button-off'} color={user.language === language ? colors.accent : colors.secondary} size={24}/></Pressable>)}</View></View></Modal>
  </View>;
}

export function DriverProfileScreen({ user, busy, editing, editor, onEdit, onOnline, onNavigate, onMenu }: { user: User; busy: boolean; editing: boolean; editor: React.ReactNode; onEdit: () => void; onOnline: (value: boolean) => void; onNavigate: (page: Page) => void; onMenu: () => void }) {
  const { scale, colors } = useAccountDesign();
  const insets = useSafeAreaInsets(), t = tr(user.language), profile = user.driverProfile;
  const local = (ru: string, ky: string) => localize(user.language, ru, ky);
  const photo = profile?.carPhotoUrl;
  const photoUri = photo ? /^https?:\/\//i.test(photo) ? photo : `${api.baseUrl}/${photo.replace(/^\/+/, '')}` : null;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <AccountHeader title={t('Профиль')} menuLabel={t('Меню')} onMenu={onMenu} profile/>
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingLeft: Math.max(insets.left, 18.5 * scale), paddingRight: Math.max(insets.right, 18.5 * scale), paddingBottom: Math.max(insets.bottom, 16) + 16 * scale }}>
      <Pressable accessibilityRole="button" accessibilityLabel={local('Редактировать профиль', 'Профилди түзөтүү')} accessibilityState={{ expanded: editing }} onPress={onEdit} style={({ pressed }) => [styles.profilePerson, { minHeight: 106 * scale, paddingTop: 18 * scale, paddingBottom: 14 * scale, gap: 20 * scale, borderBottomColor: colors.line, opacity: pressed ? .6 : 1 }]}>
        <View><Avatar user={user} size={74 * scale} fallbackBackground={colors.inactive} fallbackColor={colors.ink}/>{profile && <View style={{ position: 'absolute', right: 4 * scale, bottom: 3 * scale, width: 18 * scale, height: 18 * scale, borderRadius: 9 * scale, borderWidth: 2.5 * scale, borderColor: colors.background, backgroundColor: profile.online ? '#4ABB70' : colors.secondary }}/>}</View>
        <View style={{ flex: 1, gap: 5 * scale }}><Text numberOfLines={2} style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 18 * scale, lineHeight: 24 * scale }}>{user.name || t('Профиль')}</Text><Text style={{ color: colors.secondary, fontFamily: fonts.regular, fontSize: 13.5 * scale, lineHeight: 19 * scale }}>{user.phone}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 * scale, marginTop: 2 * scale }}><Icon name="star" size={18 * scale} color={colors.ink}/><Text style={{ color: colors.ink, fontFamily: fonts.medium, fontSize: 15 * scale, lineHeight: 20 * scale }}>{profile?.rating == null ? '—' : Number(profile.rating).toFixed(1)}</Text></View></View>
        <Icon name={editing ? 'chevron-down' : 'chevron-forward'} color={colors.secondary} size={20 * scale}/>
      </Pressable>
      {editing && <View style={{ paddingVertical: 16 * scale, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }}>{editor}</View>}
      {profile && <>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Автомобиль')} onPress={() => onNavigate('registration')} style={({ pressed }) => [styles.profilePerson, { minHeight: 104 * scale, gap: 18 * scale, borderBottomColor: colors.line, opacity: pressed ? .6 : 1 }]}>
          <View style={{ width: 116 * scale, alignItems: 'center' }}>{photoUri ? <Image source={{ uri: photoUri, headers: { Authorization: `Bearer ${api.getTokens()?.accessToken ?? ''}` } }} resizeMode="contain" style={{ width: 116 * scale, height: 70 * scale }}/> : <Car size={130 * scale}/>}</View>
          <View style={{ flex: 1, gap: 6 * scale }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 16 * scale, lineHeight: 21 * scale }}>{profile.carMake || '—'}</Text><Text style={{ color: colors.ink, fontFamily: fonts.regular, fontSize: 15 * scale, lineHeight: 20 * scale }}>{profile.carPlate || '—'}</Text><Text style={{ color: colors.secondary, fontFamily: fonts.regular, fontSize: 13 * scale, lineHeight: 18 * scale, letterSpacing: -.15 }}>{profile.carColor || '—'}</Text></View><Icon name="chevron-forward" color={colors.secondary} size={20 * scale}/>
        </Pressable>
        <View style={[styles.settingRow, { minHeight: 76 * scale, borderBottomColor: colors.line }]}><View style={{ flex: 1, gap: 3 * scale, marginRight: 10 * scale }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 16 * scale, lineHeight: 22 * scale }}>{t(profile.online ? 'На линии' : 'Не на линии')}</Text><Text style={{ color: colors.secondary, fontFamily: fonts.regular, fontSize: 13 * scale, lineHeight: 18 * scale, letterSpacing: -.15 }}>{profile.verified ? profile.online ? local('Готов принимать заказы', 'Буюртмаларды кабыл алууга даяр') : local('Включите, чтобы принимать заказы', 'Буюртмаларды алуу үчүн күйгүзүңүз') : t('Ожидаем подтверждение')}</Text></View><AccountToggle label={t('На линии')} value={profile.online} disabled={busy || !profile.verified} onChange={onOnline}/></View>
      </>}
      {([{ icon: 'shield-checkmark-outline', label: 'Допуски и документы', page: 'registration' }, { icon: 'settings-outline', label: 'Настройки', page: 'settings' }, { icon: 'help-circle-outline', label: 'Поддержка', page: 'support' }, { icon: 'receipt-outline', label: 'История заказов', page: 'history' }] as const).map((item, index) => <Pressable key={item.page} accessibilityRole="button" accessibilityLabel={t(item.label)} onPress={() => onNavigate(item.page)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: (index === 0 ? 67 : 60) * scale, opacity: pressed ? .6 : 1 })}>
        <View style={{ width: 49 * scale }}><Icon name={item.icon} size={26 * scale} color={colors.ink}/></View><View style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', borderBottomWidth: index < 3 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.line }}><Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.regular, fontSize: 15 * scale, lineHeight: 22 * scale, letterSpacing: -.4 }}>{t(item.label)}</Text><Icon name="chevron-forward" color={colors.secondary} size={20 * scale}/></View>
      </Pressable>)}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }}/>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  settingRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  profilePerson: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,20,30,.3)' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
});
