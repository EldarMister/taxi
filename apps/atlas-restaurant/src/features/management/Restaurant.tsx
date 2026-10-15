import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../data/api';
import { can, type Catalog, type Profile } from '../../domain/types';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Photo,
  Row,
  Screen,
  Sheet,
  SwitchRow,
  Text,
  tokens,
} from '../../ui';
import { useCommand } from '../../app/hooks';
import { MediaField } from '../menu/MediaField';
import type { ManagementProps } from './Management';
import { deliveryFields, saveDeliveryFields, saveProfileFields } from './model';
import { StaffScreen } from './Staff';

export function RestaurantScreen({
  detail,
  membership,
  onChanged,
  profile,
  logout,
}: ManagementProps & { profile: Profile; logout: () => void }) {
  const [panel, setPanel] = useState<'info' | 'delivery' | 'staff' | null>(
      null,
    ),
    [exit, setExit] = useState(false);
  const catalog = detail.catalog;
  const links = [
    {
      key: 'info' as const,
      title: 'О ресторане',
      body: 'Фотографии, контакты и адрес',
      icon: 'storefront-outline' as const,
      permission: 'restaurant.manage' as const,
    },
    {
      key: 'delivery' as const,
      title: 'Доставка',
      body: 'Стоимость, минимальный заказ и время',
      icon: 'bicycle-outline' as const,
      permission: 'delivery.manage' as const,
    },
    {
      key: 'staff' as const,
      title: 'Команда',
      body: 'Менеджеры и права доступа',
      icon: 'people-outline' as const,
      permission: 'staff.manage' as const,
    },
  ];
  return (
    <Screen>
      <Text variant="title">Мой ресторан</Text>
      <View
        style={{
          borderRadius: 28,
          overflow: 'hidden',
          backgroundColor: 'white',
        }}
      >
        <Photo
          imageUrl={catalog.heroImageUrl || catalog.imageUrl}
          imageKey={catalog.heroImageKey || catalog.imageKey}
          label={catalog.name}
          style={{ width: '100%', height: 180 }}
        />
        <View style={{ padding: 22, gap: 8 }}>
          <Text variant="title">{catalog.name}</Text>
          <Text variant="caption">
            {catalog.cuisine} · {catalog.address}
          </Text>
          <Row>
            <Ionicons name="star" size={16} color="#ECA529" />
            <Text variant="label">
              {catalog.rating} · {catalog.reviewCount} отзывов
            </Text>
          </Row>
          <Text variant="caption">
            {catalog.isOpen === false ? 'Сейчас закрыт' : 'Принимаем заказы'}
          </Text>
        </View>
      </View>
      {links
        .filter((link) => can(membership, link.permission))
        .map((link) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={link.title}
            key={link.key}
            onPress={() => setPanel(link.key)}
          >
            <Card>
              <Row>
                <View
                  style={{
                    padding: 14,
                    borderRadius: 18,
                    backgroundColor: tokens.blueSoft,
                  }}
                >
                  <Ionicons name={link.icon} size={23} color={tokens.blue} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="heading">{link.title}</Text>
                  <Text variant="caption">{link.body}</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={tokens.muted}
                />
              </Row>
            </Card>
          </Pressable>
        ))}
      <Card>
        <Text variant="heading">{profile.user.name || 'Ваш аккаунт'}</Text>
        <Text variant="caption">
          {membership.role === 'OWNER' ? 'Владелец' : 'Менеджер'} ·{' '}
          {profile.user.phone}
        </Text>
        <Text variant="caption">Atlas Restaurant · 2.0.0</Text>
        <Button
          secondary
          title="Выйти из аккаунта"
          onPress={() => setExit(true)}
        />
      </Card>
      {exit && (
        <Sheet title="Выйти из аккаунта?" onClose={() => setExit(false)}>
          <Text>Для следующего входа понадобятся телефон и пароль.</Text>
          <Button danger title="Выйти" onPress={logout} />
          <Button secondary title="Остаться" onPress={() => setExit(false)} />
        </Sheet>
      )}
      {(panel === 'info' || panel === 'delivery') && (
        <ProfileEditor
          key={panel}
          kind={panel}
          {...{ detail, membership, onChanged }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'staff' && (
        <StaffScreen
          restaurantId={catalog.id}
          membership={membership}
          ownId={profile.user.id}
          onClose={() => setPanel(null)}
        />
      )}
    </Screen>
  );
}

function ProfileEditor({
  detail: initialDetail,
  membership,
  kind,
  onChanged,
  onClose,
}: ManagementProps & { kind: 'info' | 'delivery'; onClose: () => void }) {
  const [detail, setDetail] = useState(initialDetail),
    [draft, setDraft] = useState(initialDetail.catalog);
  const [uploading, setUploading] = useState(false),
    [categories, setCategories] = useState(draft.categories.join(', '));
  const [latitude, setLatitude] = useState(draft.latitude?.toString() || ''),
    [longitude, setLongitude] = useState(draft.longitude?.toString() || '');
  const [numbers, setNumbers] = useState(() => deliveryFields(draft));
  const command = useCommand();
  const set = <K extends keyof Catalog>(key: K, value: Catalog[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    if (uploading) return;
    return command.run(async () => {
      if (
        !can(
          membership,
          kind === 'info' ? 'restaurant.manage' : 'delivery.manage',
        ) ||
        membership.restaurantId !== detail.catalog.id
      )
        throw new Error('Нет доступа к настройкам этого ресторана.');
      const next =
        kind === 'info'
          ? saveProfileFields(
              detail.catalog,
              draft,
              categories,
              latitude,
              longitude,
            )
          : saveDeliveryFields(detail.catalog, numbers);
      await api.saveCatalog(detail.catalog.id, next, detail.updatedAt);
      onChanged();
      onClose();
    });
  };
  const reload = () =>
    command.run(async () => {
      const latest = await api.restaurant(detail.catalog.id);
      setDetail(latest);
      setDraft(latest.catalog);
      setCategories(latest.catalog.categories.join(', '));
      setLatitude(latest.catalog.latitude?.toString() ?? '');
      setLongitude(latest.catalog.longitude?.toString() ?? '');
      setNumbers(deliveryFields(latest.catalog));
    });
  return (
    <Sheet
      title={kind === 'info' ? 'О ресторане' : 'Условия доставки'}
      onClose={onClose}
      busy={command.busy || uploading}
    >
      <View
        pointerEvents={command.busy || uploading ? 'none' : 'auto'}
        style={{ gap: 18 }}
      >
        {kind === 'info' ? (
          <>
            <MediaField
              restaurantId={draft.id}
              label="Главное фото"
              value={draft.imageUrl}
              imageKey={draft.imageKey}
              onChange={(url) => set('imageUrl', url)}
              onBusyChange={setUploading}
              disabled={command.busy || uploading}
            />
            <MediaField
              restaurantId={draft.id}
              label="Обложка"
              value={draft.heroImageUrl}
              imageKey={draft.heroImageKey}
              aspect={16 / 9}
              onChange={(url) => set('heroImageUrl', url)}
              onBusyChange={setUploading}
              disabled={command.busy || uploading}
            />
            <Field
              label="Название"
              value={draft.name}
              onChange={(value) => set('name', value)}
            />
            <Field
              label="Кухня"
              value={draft.cuisine}
              onChange={(value) => set('cuisine', value)}
            />
            <Field
              label="Категории кухни через запятую"
              value={categories}
              onChange={setCategories}
            />
            <Field
              label="Адрес"
              value={draft.address}
              onChange={(value) => set('address', value)}
            />
            <Field
              label="Телефон"
              value={draft.phone || ''}
              onChange={(value) => set('phone', value || null)}
            />
            <Field
              label="Широта точки выдачи"
              value={latitude}
              onChange={setLatitude}
              numeric
            />
            <Field
              label="Долгота точки выдачи"
              value={longitude}
              onChange={setLongitude}
              numeric
            />
            <SwitchRow
              title="Принимаем заказы"
              value={draft.isOpen !== false}
              onChange={(value) => set('isOpen', value)}
            />
          </>
        ) : (
          <>
            <Card style={{ backgroundColor: tokens.blueSoft }}>
              <Ionicons name="bicycle-outline" size={34} color={tokens.blue} />
              <Text variant="heading">От кухни до двери</Text>
              <Text variant="caption">
                Эти условия видит клиент при оформлении заказа. Доставка машины
                Atlas рассчитывается отдельно.
              </Text>
            </Card>
            {(
              [
                ['deliveryFee', 'Стоимость доставки, сом'],
                ['minimumOrder', 'Минимальный заказ, сом'],
                [
                  'freeDeliveryThreshold',
                  'Бесплатная доставка от, сом (0 — без порога)',
                ],
                ['etaMin', 'Минимальное время, минут'],
                ['etaMax', 'Максимальное время, минут'],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={numbers[key]}
                onChange={(value) =>
                  setNumbers((previous) => ({ ...previous, [key]: value }))
                }
                numeric
              />
            ))}
          </>
        )}
      </View>
      <ErrorNotice error={command.error} />
      {command.error && (
        <Button
          secondary
          title="Отменить правки и загрузить актуальную версию"
          disabled={uploading}
          busy={command.busy}
          onPress={() => void reload()}
        />
      )}
      <Button
        title="Сохранить изменения"
        disabled={uploading}
        busy={command.busy}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}
