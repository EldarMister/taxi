import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../data/api';
import {
  can,
  permissions,
  type Membership,
  type StaffMember,
} from '../../domain/types';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Row,
  SectionTitle,
  Sheet,
  Skeleton,
  SwitchRow,
  Text,
  tokens,
} from '../../ui';
import { useCommand, useResource } from '../../app/hooks';
import {
  grantPermission,
  initialManagerPermissions,
  staffEditable,
  staffInput,
} from './model';

export function StaffScreen({
  restaurantId,
  membership,
  ownId,
  onClose,
}: {
  restaurantId: string;
  membership: Membership;
  ownId: string;
  onClose: () => void;
}) {
  const resource = useResource<{ staff: StaffMember[] }>(
    can(membership, 'staff.manage')
      ? `/${encodeURIComponent(restaurantId)}/staff`
      : null,
  );
  const [editing, setEditing] = useState<StaffMember | null>(null);
  return (
    <Sheet title="Команда ресторана" onClose={onClose}>
      <Button
        title="Добавить менеджера"
        icon="person-add-outline"
        disabled={!can(membership, 'staff.manage')}
        onPress={() =>
          setEditing({
            id: '',
            name: '',
            phone: '+996',
            role: 'MANAGER',
            permissions: initialManagerPermissions(membership),
            active: true,
          })
        }
      />
      <Text variant="caption">
        Каждому сотруднику — только необходимые права. Владелец сохраняет полный
        доступ.
      </Text>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.loading && <Skeleton />}
      {resource.data?.staff.map((person) => {
        const editable = staffEditable(membership, person, ownId);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${person.name || 'Менеджер'}: ${editable ? 'изменить доступ' : 'просмотр'}`}
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
            key={person.id}
            onPress={() => setEditing(person)}
          >
            <Card style={{ backgroundColor: tokens.canvas }}>
              <Row>
                <Ionicons
                  name={
                    person.role === 'OWNER'
                      ? 'shield-checkmark-outline'
                      : 'person-outline'
                  }
                  size={26}
                  color={tokens.blue}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">{person.name || 'Менеджер'}</Text>
                  <Text variant="caption">{person.phone}</Text>
                </View>
                <Text variant="caption">
                  {person.role === 'OWNER'
                    ? 'Владелец'
                    : person.active
                      ? 'Активен'
                      : 'Отключён'}
                </Text>
              </Row>
              {!editable &&
                person.role === 'MANAGER' &&
                person.id !== ownId && (
                  <Text variant="caption">
                    Права этого сотрудника изменяет владелец.
                  </Text>
                )}
            </Card>
          </Pressable>
        );
      })}
      {editing && (
        <StaffEditor
          initial={editing}
          restaurantId={restaurantId}
          membership={membership}
          onClose={() => setEditing(null)}
          onSaved={() => {
            resource.reload();
            setEditing(null);
          }}
        />
      )}
    </Sheet>
  );
}

function StaffEditor({
  initial,
  restaurantId,
  membership,
  onClose,
  onSaved,
}: {
  initial: StaffMember;
  restaurantId: string;
  membership: Membership;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial),
    [password, setPassword] = useState('');
  const command = useCommand();
  const submit = () =>
    command.run(async () => {
      if (membership.restaurantId !== restaurantId)
        throw new Error('Ресторан изменён. Откройте команду заново.');
      await api.saveStaff(
        restaurantId,
        staffInput(draft, initial, password, membership),
        initial.id || undefined,
      );
      onSaved();
    });
  return (
    <Sheet
      title={initial.id ? 'Доступ сотрудника' : 'Новый менеджер'}
      onClose={onClose}
      busy={command.busy}
    >
      <View pointerEvents={command.busy ? 'none' : 'auto'} style={{ gap: 18 }}>
        <Field
          label="Имя"
          value={draft.name}
          onChange={(name) => setDraft({ ...draft, name })}
        />
        <Field
          label="Телефон"
          value={draft.phone}
          onChange={(phone) => setDraft({ ...draft, phone })}
        />
        <Field
          label={initial.id ? 'Новый пароль (необязательно)' : 'Пароль'}
          value={password}
          onChange={setPassword}
          secure
          placeholder="Не менее 12 символов"
        />
        <SwitchRow
          title="Доступ к ресторану"
          value={draft.active}
          onChange={(active) => setDraft({ ...draft, active })}
        />
        <SectionTitle title="Права доступа" />
        {permissions
          .filter(([key]) => can(membership, key))
          .map(([key, label]) => (
            <SwitchRow
              key={key}
              title={label}
              value={draft.permissions.includes(key)}
              onChange={(checked) =>
                setDraft({
                  ...draft,
                  permissions: grantPermission(draft.permissions, key, checked),
                })
              }
            />
          ))}
      </View>
      <ErrorNotice error={command.error} />
      <Button
        title="Сохранить сотрудника"
        busy={command.busy}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}
