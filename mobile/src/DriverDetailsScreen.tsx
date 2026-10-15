import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api, messageOf } from './api';
import { Avatar, Button, IconButton, tr } from './ui';
import { fonts } from './design/typography';
import type { User } from './types';
import { useRegistrationDesign } from './registration/design';
import { RegistrationKeyboardLayout } from './registration/RegistrationKeyboardLayout';
import { FormInput, NativeDateInput, OptionSheet, SelectInput } from './registration/components';
import { OnboardingVehicleForm } from './registration/OnboardingVehicleForm';
import { NativeNumberInput } from './registration/NativeNumberInput';
import { cityOptionsFor } from './registration/workCities';
import { emptyVehicleDraft, type RegistrationConfig, type RegistrationUpload, type VehicleDraft } from './registration/types';
import { readPlate, validPlate } from './registration/vehicleData';
import { VehiclePhotoCard } from './registration/VehiclePhotoCard';
import { UploadedPhotoViewer } from './registration/UploadedPhotoViewer';

export type DriverDetails = { version: number; personal: Record<string, string>; vehicles: {key:string;label:string;usage:'TAXI'|'CARGO';vehicle:VehicleDraft}[];uploads:RegistrationUpload[];config:RegistrationConfig };
const photoSides = [{side:'front',title:'Спереди'},{side:'back',title:'Сзади'},{side:'left',title:'Левая сторона'},{side:'right',title:'Правая сторона'}];
const displayDate = (value:string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value;
export function DriverDetailsScreen({kind,user,onBack,onUser,onAvatar,onRemoveAvatar,avatarBusy,onDeleteAccount,deleting=false,onLogout}: {kind:'personal'|'vehicles';user:User;onBack:()=>void;onUser:(user:User)=>void;onAvatar:()=>void;onRemoveAvatar:()=>void;avatarBusy:boolean;onDeleteAccount:()=>void;deleting?:boolean;onLogout:()=>void}) {
  const {palette,isDark}=useRegistrationDesign(), insets=useSafeAreaInsets(), t=tr(user.language);
  const [details,setDetails]=useState<DriverDetails|null>(null), [personal,setPersonal]=useState<Record<string,string>>({}), [selected,setSelected]=useState(''), [vehicle,setVehicle]=useState<VehicleDraft>(emptyVehicleDraft);
  const [loading,setLoading]=useState(true), [error,setError]=useState(''), [editing,setEditing]=useState(false), [saving,setSaving]=useState(false), [options,setOptions]=useState<'city'|'type'|null>(null), [viewed,setViewed]=useState<{title:string;upload:RegistrationUpload}|null>(null);
  const mounted=useRef(true), request=useRef(0), savingRef=useRef(false);
  const accept=(data:DriverDetails) => {setDetails(data);setPersonal({...data.personal,birthDate:displayDate(data.personal?.birthDate||'')});const primary=user.driverProfile?.transportClass==='TRUCK'?'cargoVehicle':'taxiVehicle';const next=data.vehicles.find(v=>v.key===primary)||data.vehicles[0];setSelected(next?.key||'');setVehicle({...emptyVehicleDraft(),...next?.vehicle});};
  async function load() {const revision=++request.current;setLoading(true);setError('');try {const data=await api.request<DriverDetails>('/driver/profile-details');if(mounted.current&&revision===request.current)accept(data);}catch(e){if(mounted.current&&revision===request.current)setError(messageOf(e));}finally{if(mounted.current&&revision===request.current)setLoading(false);}}
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;request.current++;};},[]);
  useEffect(()=>{const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{if(viewed){setViewed(null);return true;}if(options){setOptions(null);return true;}if(!savingRef.current)onBack();return true;});return()=>subscription.remove();},[onBack,viewed,options]);
  const item=details?.vehicles.find(v=>v.key===selected), title=kind==='personal'?'Личные данные':'Автомобиль', cargo=item?.usage==='CARGO';
  const vehicleValid=!!vehicle.brand&&!!vehicle.model&&!!vehicle.year&&!!vehicle.color&&!!vehicle.ownership&&!!vehicle.plateNumber&&(!vehicle.plate||validPlate(readPlate(vehicle)))&&(!cargo||!!vehicle.type&&!!vehicle.capacityKg);
  async function save() {
    if(!details||savingRef.current)return;
    savingRef.current=true;setSaving(true);setError('');
    try {const next=await api.patch<DriverDetails>('/driver/profile-details',{version:details.version,...(kind==='personal'?{personal:Object.fromEntries(['firstName','lastName','middleName','birthDate','city'].map(key=>[key,personal[key]||'']))}:{vehicleKey:selected,vehicle:Object.fromEntries(['ownership','brand','model','year','color','plateNumber','plate','type','capacityKg'].filter(key=>(vehicle as any)[key]!==undefined).map(key=>[key,(vehicle as any)[key]]))})});const updated=await api.request<User>('/users/me');if(mounted.current){accept(next);onUser(updated);setEditing(false);}}
    catch(e){if(mounted.current)setError(messageOf(e));}
    finally{savingRef.current=false;if(mounted.current)setSaving(false);}
  }
  const header=<View testID="driver-details-header" style={[s.header,{borderBottomColor:palette.line,paddingTop:insets.top+12,paddingLeft:Math.max(insets.left,12),paddingRight:Math.max(insets.right,12)}]}><IconButton name="chevron-back" label={t('Назад')} onPress={()=>{if(!savingRef.current)onBack();}}/><Text style={[s.heading,{color:palette.ink}]}>{t(title)}</Text><View style={{width:44}}/></View>;
  const footer=details&&!loading?<View style={[s.footer,{borderTopColor:palette.line}]}><Button label={t(editing?'Сохранить':'Редактировать')} busy={saving} disabled={avatarBusy||kind==='vehicles'&&!item||editing&&(kind==='personal'?!personal.firstName?.trim()||!personal.lastName?.trim()||!personal.birthDate||!personal.city:!vehicleValid)} onPress={()=>editing?void save():setEditing(true)}/></View>:null;
  const row=(label:string,value?:string)=><View key={label} style={[s.row,{borderBottomColor:palette.line}]}><Text style={[s.label,{color:palette.muted}]}>{t(label)}</Text><Text style={[s.value,{color:palette.ink}]}>{value||'—'}</Text></View>;
  return <View style={{flex:1,backgroundColor:palette.background}}><StatusBar style={isDark?'light':'dark'} backgroundColor={palette.background}/><RegistrationKeyboardLayout header={header} footer={footer} contentContainerStyle={s.content}>
    {loading&&<ActivityIndicator color={palette.accent}/>}
    {!!error&&<View style={{gap:12}}><Text accessibilityRole="alert" style={{color:'#D55555',fontFamily:fonts.regular}}>{error}</Text>{!details&&<Button label={t('Повторить')} onPress={()=>void load()}/>}{!!details&&<Pressable onPress={()=>{setEditing(false);void load();}}><Text style={{color:palette.accent}}>{t('Обновить данные')}</Text></Pressable>}</View>}
    {details&&kind==='personal'&&<>
      <View style={{alignItems:'center',gap:12}}><Avatar user={user} size={88}/><Button secondary label={t(user.photoUrl?'Изменить фото':'Выбрать фото')} busy={avatarBusy} disabled={saving} onPress={onAvatar}/>{!!user.photoUrl&&<Pressable accessibilityRole="button" accessibilityLabel={t('Удалить фото')} disabled={avatarBusy||saving} onPress={()=>Alert.alert(t('Удалить фото?'),'', [{text:t('Оставить'),style:'cancel'},{text:t('Удалить'),style:'destructive',onPress:onRemoveAvatar}])} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:'#D55555',fontFamily:fonts.medium}}>{t('Удалить фото')}</Text></Pressable>}</View>
      {row('Телефон',user.phone)}
      {editing?<><FormInput label="Фамилия" value={personal.lastName||''} maxLength={80} disabled={saving} onChangeText={lastName=>setPersonal(p=>({...p,lastName}))}/><FormInput label="Имя" value={personal.firstName||''} maxLength={80} disabled={saving} onChangeText={firstName=>setPersonal(p=>({...p,firstName}))}/><FormInput label="Отчество" optional value={personal.middleName||''} maxLength={80} disabled={saving} onChangeText={middleName=>setPersonal(p=>({...p,middleName}))}/><NativeDateInput label="Дата рождения" value={personal.birthDate||''} maximumDate={new Date()} disabled={saving} onChange={birthDate=>setPersonal(p=>({...p,birthDate}))}/><SelectInput label="Город работы" value={personal.city} placeholder="Выберите город" disabled={saving} onPress={()=>setOptions('city')}/></>:<>{row('Фамилия',personal.lastName)}{row('Имя',personal.firstName)}{row('Отчество',personal.middleName)}{row('Дата рождения',personal.birthDate)}{row('Город работы',personal.city)}</>}
    </>}
    {kind==='personal'&&!editing&&<Pressable accessibilityRole="button" accessibilityLabel={t('Выйти из аккаунта')} disabled={deleting} onPress={onLogout} style={{minHeight:54,alignItems:'center',justifyContent:'center'}}><Text style={{color:palette.ink,fontFamily:fonts.medium,fontSize:14}}>{t('Выйти из аккаунта')}</Text></Pressable>}
    {kind==='personal'&&!editing&&<Pressable accessibilityRole="button" accessibilityLabel={t('Удалить аккаунт')} disabled={deleting||saving||avatarBusy} onPress={onDeleteAccount} style={{minHeight:54,alignItems:'center',justifyContent:'center',opacity:deleting?.5:1}}><Text style={{color:'#D55555',fontFamily:fonts.medium,fontSize:14}}>{t(deleting?'Удаление…':'Удалить аккаунт')}</Text></Pressable>}
    {details&&kind==='vehicles'&&<>
      {item&&editing?<OnboardingVehicleForm title={item.label} description="" vehicle={vehicle} path={selected} cargo={cargo} onChange={patch=>setVehicle(current=>({...current,...patch}))} canEdit={()=>!saving}>
        {cargo&&<><SelectInput label="Тип транспорта" value={vehicle.type} placeholder="Выберите тип" disabled={saving} onPress={()=>setOptions('type')}/><NativeNumberInput label="Грузоподъёмность, кг" value={vehicle.capacityKg} options={[500,750,1000,1500,2000,2500,3000,3500,5000]} disabled={saving} onChange={capacityKg=>setVehicle(v=>({...v,capacityKg}))}/></>}
      </OnboardingVehicleForm>:item?<>{row('Марка',vehicle.brand)}{row('Модель',vehicle.model)}{row('Год выпуска',vehicle.year)}{row('Цвет',vehicle.color)}{row('Государственный номер',vehicle.plateNumber)}{row('Владение',vehicle.ownership==='RENT'?'Арендованный':vehicle.ownership==='OWN'?'Собственный':'')}{cargo&&<>{row('Тип транспорта',vehicle.type)}{row('Грузоподъёмность, кг',vehicle.capacityKg)}</>}
        {photoSides.map(({side,title})=>{const prefix=item.key==='taxiVehicle'?'taxi_photo_':item.key==='cargoVehicle'?'cargo_photo_':`vehicle_${item.key}_photo_`;const upload=details.uploads.find(u=>u.slotKey===prefix+side);return upload?<VehiclePhotoCard key={side} title={title} upload={upload} disabled onPress={()=>{}} onView={()=>setViewed({title,upload})}/>:null;})}
      </>:<Text style={{color:palette.muted}}>{t('Автомобиль не добавлен')}</Text>}
    </>}
  </RegistrationKeyboardLayout>
    {details&&<OptionSheet visible={!!options} title={options==='city'?'Город работы':'Тип транспорта'} options={options==='city'?cityOptionsFor(details.config):details.config.cargoVehicleTypes.map(value=>({value,label:value}))} selected={options==='city'?personal.city:vehicle.type} onSelect={value=>options==='city'?setPersonal(p=>({...p,city:value})):setVehicle(v=>({...v,type:value}))} onClose={()=>setOptions(null)}/>}
    {viewed&&<UploadedPhotoViewer title={viewed.title} upload={viewed.upload} onClose={()=>setViewed(null)}/>}
  </View>;
}
const s=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth},heading:{flex:1,textAlign:'center',fontFamily:fonts.bold,fontSize:21},content:{padding:20,gap:18,paddingBottom:30},footer:{padding:18,borderTopWidth:StyleSheet.hairlineWidth},row:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,gap:5},label:{fontFamily:fonts.regular,fontSize:12},value:{fontFamily:fonts.medium,fontSize:16,lineHeight:23}});

