import React, { useState } from 'react';
import { View } from 'react-native';
import type { FoodOption } from '../../domain/types';
import { type DraftGroup, type DraftOption, newMenuId } from './model';
import { Action, IconAction, Input, Panel, Pill, T, Toggle, c, u } from './ui';

export function ModifiersEditor({ groups, options, onChange }: { groups: DraftGroup[]; options: FoodOption[]; onChange: (next: DraftGroup[]) => void }) {
  const [libraryGroup, setLibraryGroup] = useState<string>();
  const total = groups.reduce((sum, group) => sum + group.options.length, 0);
  const used = new Set(groups.flatMap(group => group.options.map(option => option.id)));
  const library = options.filter(option => !used.has(option.id));
  const updateGroup = (id: string, patch: Partial<DraftGroup>) => onChange(groups.map(group => group.id === id ? { ...group, ...patch } : group));
  const updateOption = (group: DraftGroup, id: string, patch: Partial<DraftOption>) => updateGroup(group.id, { options: group.options.map(option => option.id === id ? { ...option, ...patch } : option) });
  const addOption = (group: DraftGroup, option?: FoodOption) => updateGroup(group.id, { options: [...group.options, { ...(option ?? { id: newMenuId('option'), name: '', price: 0, imageKey: '', priceScope: 'PER_PORTION' as const }), priceText: String(option?.price ?? 0), selectedByDefault: false }], maxText: group.options.length === 0 ? '1' : group.maxText });
  const addGroup = (name: string) => onChange([...groups, { id: newMenuId('group'), name, minText: name === 'Размер порции' ? '1' : '0', maxText: '1', options: [] }]);
  return <View style={{ gap: 18 }}>
    <View><T bold style={{ fontSize: 19 }}>Настройка блюда</T><T muted style={u.hint}>Размер, соус, острота и другие дополнения. До 10 вариантов на блюдо.</T></View>
    {groups.map((group, index) => <View key={group.id} style={[u.card, { backgroundColor: '#F7F8FA', padding: 16 }]}>
      <View style={u.row}><T bold style={{ flex: 1 }}>Группа {index + 1}</T><IconAction icon="trash-outline" label={`Удалить группу ${group.name || index + 1}`} danger onPress={() => onChange(groups.filter(item => item.id !== group.id))}/></View>
      <Input label="Название группы" placeholder="Например, соус" maxLength={150} value={group.name} onChangeText={name => updateGroup(group.id, { name })}/>
      <Toggle label="Обязательный выбор" hint="Покупатель должен выбрать хотя бы один вариант" value={Number(group.minText) > 0} onChange={required => updateGroup(group.id, { minText: required ? '1' : '0', maxText: required && Number(group.maxText) < 1 ? '1' : group.maxText })}/>
      <View style={u.row}><Input label="Минимум" keyboardType="number-pad" value={group.minText} onChangeText={minText => updateGroup(group.id, { minText })}/><Input label="Максимум" keyboardType="number-pad" value={group.maxText} onChangeText={maxText => updateGroup(group.id, { maxText })}/></View>
      {group.options.map((option, optionIndex) => <View key={option.id} style={[u.card, { padding: 14, borderRadius: 18, gap: 12 }]}>
        <View style={u.row}><T muted style={{ flex: 1, fontSize: 12 }}>Вариант {optionIndex + 1}</T><IconAction icon="close" label={`Убрать вариант ${option.name || optionIndex + 1}`} onPress={() => {
          const next = group.options.filter(item => item.id !== option.id);
          updateGroup(group.id, { options: next, minText: String(Math.min(Number(group.minText) || 0, next.length)), maxText: String(Math.min(Number(group.maxText) || next.length, next.length)) });
        }}/></View>
        <Input label="Название варианта" placeholder="Например, сырный" maxLength={150} value={option.name} onChangeText={name => updateOption(group, option.id, { name })}/>
        <Input label="Доплата, сом" keyboardType="number-pad" value={option.priceText} onChangeText={priceText => updateOption(group, option.id, { priceText })}/>
        <T muted style={u.label}>Как считать доплату</T>
        <View style={u.wrap}><Pill label="За каждую порцию" selected={option.priceScope !== 'PER_ITEM'} onPress={() => updateOption(group, option.id, { priceScope: 'PER_PORTION' })}/><Pill label="За позицию заказа" selected={option.priceScope === 'PER_ITEM'} onPress={() => updateOption(group, option.id, { priceScope: 'PER_ITEM' })}/></View>
        <Toggle label="Выбран по умолчанию" value={option.selectedByDefault} onChange={selectedByDefault => {
          if (selectedByDefault && Number(group.maxText) === 1) updateGroup(group.id, { options: group.options.map(item => ({ ...item, selectedByDefault: item.id === option.id })) });
          else updateOption(group, option.id, { selectedByDefault });
        }}/>
      </View>)}
      <Action label="Добавить вариант" secondary small icon="add" disabled={total >= 10} onPress={() => addOption(group)}/>
      {library.length > 0 && <Action label="Выбрать из меню" secondary small icon="copy-outline" disabled={total >= 10} onPress={() => setLibraryGroup(group.id)}/>}
    </View>)}
    {groups.length < 10 && <View style={u.wrap}>{['Размер порции', 'Острота', 'Соусы', 'Добавки'].map(name => <Pill key={name} label={`+ ${name}`} onPress={() => addGroup(name)}/>)}</View>}
    <T muted style={u.hint}>{total} из 10 вариантов. Изменения общих вариантов применяются только к этому блюду.</T>
    <Panel title="Дополнения из меню" visible={!!libraryGroup} onClose={() => setLibraryGroup(undefined)}>
      {library.map(option => <Action key={option.id} secondary label={`${option.name} · +${option.price} сом`} onPress={() => { const group = groups.find(item => item.id === libraryGroup); if (group && total < 10) addOption(group, option); setLibraryGroup(undefined); }}/>) }
    </Panel>
  </View>;
}
