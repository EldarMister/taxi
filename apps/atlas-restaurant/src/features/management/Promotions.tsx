import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../data/api';
import { can, entityId, money, type Promotion } from '../../domain/types';
import {
  Button,
  Card,
  Chip,
  Empty,
  ErrorNotice,
  Field,
  Row,
  Screen,
  Sheet,
  SwitchRow,
  Text,
  tokens,
} from '../../ui';
import { useCommand } from '../../app/hooks';
import type { ManagementProps } from './Management';
import {
  dateInput,
  positiveNumber,
  promotionDateValue,
  validatePromotion,
} from './model';

const freshPromotion = (): Promotion => ({
  id: entityId('promo'),
  title: '',
  type: 'PERCENT',
  value: 10,
  minSubtotal: 0,
  active: true,
  dishIds: [],
});

export function PromotionsScreen({
  detail,
  membership,
  onChanged,
  initialCreate = false,
}: ManagementProps & { initialCreate?: boolean }) {
  const [editing, setEditing] = useState<Promotion | null>(() =>
    initialCreate ? freshPromotion() : null,
  );
  if (
    !can(membership, 'promotions.manage') ||
    membership.restaurantId !== detail.catalog.id
  )
    return (
      <Empty
        title="Нет доступа к акциям"
        body="Права доступа назначает владелец ресторана."
      />
    );
  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text variant="title">Повод заказать</Text>
        <Text variant="caption">Акции, которые увидят ваши гости</Text>
      </View>
      <Button
        title="Создать акцию"
        icon="add"
        disabled={(detail.catalog.promotions?.length ?? 0) >= 30}
        onPress={() => setEditing(freshPromotion())}
      />
      {(detail.catalog.promotions || []).map((promo) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Изменить акцию ${promo.title}`}
          key={promo.id}
          onPress={() => setEditing(promo)}
        >
          <PromotionPreview promo={promo} />
        </Pressable>
      ))}
      {!detail.catalog.promotions?.length && (
        <Empty
          icon="pricetag-outline"
          title="Первый приятный повод"
          body="Скидка на любимые блюда или бесплатная доставка — выберите, чем порадовать гостей."
        />
      )}
      {editing && (
        <PromotionEditor
          key={editing.id}
          {...{ detail, membership, onChanged }}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  );
}

function PromotionPreview({ promo }: { promo: Promotion }) {
  return (
    <Card
      style={{
        backgroundColor: promo.active ? tokens.blueSoft : tokens.surface,
        padding: 24,
      }}
    >
      <Row>
        <View style={{ flex: 1 }}>
          <Text variant="caption">ATLAS · ПРЕДЛОЖЕНИЕ РЕСТОРАНА</Text>
          <Text variant="title" style={{ color: tokens.blue, marginTop: 14 }}>
            {promo.type === 'FREE_DELIVERY'
              ? 'Доставка за 0 сом'
              : promo.type === 'PERCENT'
                ? `−${promo.value}%`
                : `−${money(promo.value)}`}
          </Text>
        </View>
        <Ionicons
          name={
            promo.type === 'FREE_DELIVERY'
              ? 'bicycle-outline'
              : 'pricetag-outline'
          }
          size={36}
          color={tokens.blue}
        />
      </Row>
      <Text variant="heading">{promo.title || 'Название вашей акции'}</Text>
      <Text variant="caption">
        {promo.minSubtotal
          ? `При заказе от ${money(promo.minSubtotal)}`
          : 'Без минимальной суммы'}{' '}
        · {promo.dishIds.length ? `${promo.dishIds.length} блюд` : 'Всё меню'}
      </Text>
      <Text variant="label">
        {promo.active ? 'Включена' : 'Приостановлена'}
        {promo.endsAt ? ` · до ${dateInput(promo.endsAt)}` : ''}
      </Text>
    </Card>
  );
}

function PromotionEditor({
  detail: initialDetail,
  membership,
  initial,
  onChanged,
  onClose,
}: ManagementProps & { initial: Promotion; onClose: () => void }) {
  const [detail, setDetail] = useState(initialDetail),
    [draft, setDraft] = useState(initial);
  const [value, setValue] = useState(String(initial.value)),
    [minimum, setMinimum] = useState(String(initial.minSubtotal));
  const [starts, setStarts] = useState(dateInput(initial.startsAt)),
    [ends, setEnds] = useState(dateInput(initial.endsAt));
  const [choose, setChoose] = useState(!!initial.dishIds.length),
    [confirm, setConfirm] = useState(false);
  const command = useCommand();
  const baseline = detail.catalog.promotions?.find(
    (promo) => promo.id === initial.id,
  );

  const submit = (remove = false) =>
    command.run(async () => {
      if (
        !can(membership, 'promotions.manage') ||
        membership.restaurantId !== detail.catalog.id
      )
        throw new Error('Нет доступа к акциям этого ресторана.');
      const promo = remove
        ? draft
        : validatePromotion(
            {
              ...draft,
              title: draft.title.trim(),
              value:
                draft.type === 'FREE_DELIVERY'
                  ? 0
                  : positiveNumber(value, 'Размер скидки'),
              minSubtotal: positiveNumber(minimum, 'Минимальный заказ'),
              dishIds:
                choose && draft.type !== 'FREE_DELIVERY' ? draft.dishIds : [],
              startsAt: promotionDateValue(starts, baseline?.startsAt),
              endsAt: promotionDateValue(ends, baseline?.endsAt, true),
            },
            choose,
          );
      if (
        !remove &&
        promo.dishIds.some(
          (id) => !detail.catalog.dishes.some((dish) => dish.id === id),
        )
      )
        throw new Error(
          'Некоторые выбранные блюда больше не существуют. Обновите акцию.',
        );
      const current = detail.catalog.promotions || [];
      const promotions = remove
        ? current.filter((item) => item.id !== promo.id)
        : current.some((item) => item.id === promo.id)
          ? current.map((item) => (item.id === promo.id ? promo : item))
          : [...current, promo];
      if (promotions.length > 30)
        throw new Error('В ресторане может быть до 30 акций.');
      await api.saveCatalog(
        detail.catalog.id,
        { ...detail.catalog, promotions },
        detail.updatedAt,
      );
      onChanged();
      onClose();
    });
  const reload = () =>
    command.run(async () => {
      const latest = await api.restaurant(detail.catalog.id);
      const promo = latest.catalog.promotions?.find(
        (item) => item.id === initial.id,
      );
      if (baseline && !promo) {
        onClose();
        return;
      }
      const next = promo ?? freshPromotion();
      setDetail(latest);
      setDraft(next);
      setValue(String(next.value));
      setMinimum(String(next.minSubtotal));
      setStarts(dateInput(next.startsAt));
      setEnds(dateInput(next.endsAt));
      setChoose(!!next.dishIds.length);
      setConfirm(false);
    });
  return (
    <Sheet title="Редактор акции" onClose={onClose} busy={command.busy}>
      <View pointerEvents={command.busy ? 'none' : 'auto'} style={{ gap: 18 }}>
        <PromotionPreview
          promo={{
            ...draft,
            value: Number(value) || 0,
            minSubtotal: Number(minimum) || 0,
          }}
        />
        <Field
          label="Название"
          value={draft.title}
          onChange={(title) => setDraft({ ...draft, title })}
        />
        <Row style={{ flexWrap: 'wrap' }}>
          {(['PERCENT', 'FIXED', 'FREE_DELIVERY'] as const).map(
            (type, index) => (
              <Chip
                key={type}
                title={['Процент', 'Сумма', 'Доставка'][index]}
                active={draft.type === type}
                onPress={() => setDraft({ ...draft, type })}
              />
            ),
          )}
        </Row>
        {draft.type !== 'FREE_DELIVERY' && (
          <Field
            label={draft.type === 'PERCENT' ? 'Скидка, %' : 'Скидка, сом'}
            value={value}
            onChange={setValue}
            numeric
          />
        )}
        <Field
          label="Минимальный заказ, сом"
          value={minimum}
          onChange={setMinimum}
          numeric
        />
        <Row>
          <View style={{ flex: 1 }}>
            <Field
              label="Начало"
              placeholder="ГГГГ-ММ-ДД"
              value={starts}
              onChange={setStarts}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Окончание"
              placeholder="ГГГГ-ММ-ДД"
              value={ends}
              onChange={setEnds}
            />
          </View>
        </Row>
        <Text variant="caption">
          Даты по времени Бишкека. Новое окончание — включительно. Пустые даты
          не ограничивают срок; существующее точное время сохраняется.
        </Text>
        <SwitchRow
          title="Акция включена"
          value={draft.active}
          onChange={(active) => setDraft({ ...draft, active })}
        />
        {draft.type !== 'FREE_DELIVERY' && (
          <>
            <SwitchRow
              title="Выбрать блюда"
              value={choose}
              onChange={setChoose}
            />
            {choose &&
              detail.catalog.dishes.map((dish) => (
                <SwitchRow
                  key={dish.id}
                  title={dish.name}
                  value={draft.dishIds.includes(dish.id)}
                  onChange={(checked) =>
                    setDraft({
                      ...draft,
                      dishIds: checked
                        ? [...draft.dishIds, dish.id]
                        : draft.dishIds.filter((id) => id !== dish.id),
                    })
                  }
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
          busy={command.busy}
          onPress={() => void reload()}
        />
      )}
      <Button
        title="Сохранить акцию"
        busy={command.busy}
        onPress={() => void submit()}
      />
      {baseline && (
        <Button
          danger
          title="Удалить акцию"
          disabled={command.busy}
          onPress={() => setConfirm(true)}
        />
      )}
      {confirm && (
        <Card style={{ backgroundColor: '#FFF0EC' }}>
          <Text>
            Удалить акцию? Скидка перестанет действовать на новые заказы.
          </Text>
          <Button
            danger
            title="Да, удалить"
            busy={command.busy}
            onPress={() => void submit(true)}
          />
          <Button
            secondary
            title="Оставить"
            disabled={command.busy}
            onPress={() => setConfirm(false)}
          />
        </Card>
      )}
    </Sheet>
  );
}
