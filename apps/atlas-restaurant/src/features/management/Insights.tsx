import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../data/api';
import {
  can,
  money,
  type Membership,
  type RestaurantDetail,
  type Stats,
  type StatsPeriod,
} from '../../domain/types';
import {
  Button,
  Card,
  Chip,
  Empty,
  ErrorNotice,
  Photo,
  Row,
  Screen,
  SectionTitle,
  Skeleton,
  SwitchRow,
  Text,
  tokens,
} from '../../ui';
import { useCommand, useResource } from '../../app/hooks';
import { useOrdersFeed } from '../orders/feed';
export type Destination =
  | 'home'
  | 'orders'
  | 'menu'
  | 'promotions'
  | 'stats'
  | 'restaurant';
export function Dashboard({
  detail,
  membership,
  onChanged,
  navigate,
  revision,
}: {
  detail: RestaurantDetail;
  membership: Membership;
  onChanged: () => void;
  navigate: (tab: Destination, create?: boolean) => void;
  revision: number;
}) {
  const [snapshot, setSnapshot] = useState(detail);
  useEffect(() => {
    setSnapshot((previous) =>
      detail.catalog.id !== previous.catalog.id ||
      detail.updatedAt >= previous.updatedAt
        ? detail
        : previous,
    );
  }, [detail]);
  const catalog = snapshot.catalog;
  const feed = useOrdersFeed();
  const stats = useResource<Stats>(
    can(membership, 'stats.read') ? `/${catalog.id}/stats?period=day` : null,
    revision,
  );
  const command = useCommand();
  const placed = feed.orders.filter((o) => o.status === 'PLACED').length,
    preparing = feed.orders.filter(
      (o) => o.status === 'CONFIRMED' || o.status === 'PREPARING',
    ).length;
  const stopped = catalog.dishes.filter((d) => !d.available);
  const popular = useMemo(() => {
    const count = new Map<string, number>();
    for (const order of feed.orders.filter((o) => o.status === 'COMPLETED'))
      for (const item of order.items)
        count.set(item.dishId, (count.get(item.dishId) || 0) + item.quantity);
    return catalog.dishes
      .filter((d) => count.has(d.id))
      .sort((a, b) => count.get(b.id)! - count.get(a.id)!)
      .slice(0, 4)
      .map((d) => ({ dish: d, count: count.get(d.id)! }));
  }, [feed.orders, catalog.dishes]);
  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="caption">ВАШ РЕСТОРАН, КАЖДЫЙ ДЕНЬ</Text>
        <Text variant="title">Хорошего дня!</Text>
      </View>
      <View
        style={{
          borderRadius: 28,
          backgroundColor: 'white',
          overflow: 'hidden',
        }}
      >
        <Photo
          imageUrl={catalog.heroImageUrl || catalog.imageUrl}
          imageKey={catalog.heroImageKey || catalog.imageKey}
          style={{ height: 165, width: '100%' }}
        />
        <View style={{ padding: 20, gap: 14 }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{catalog.name}</Text>
              <Text variant="caption">{catalog.cuisine}</Text>
            </View>
            <View
              style={{
                backgroundColor:
                  catalog.isOpen === false ? tokens.surface : tokens.greenSoft,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 20,
              }}
            >
              <Text
                variant="label"
                style={{
                  color: catalog.isOpen === false ? tokens.muted : tokens.green,
                }}
              >
                {catalog.isOpen === false ? 'Закрыт' : 'Открыт'}
              </Text>
            </View>
          </Row>
          {can(membership, 'restaurant.manage') && (
            <SwitchRow
              title="Принимаем заказы"
              subtitle="Можно поставить кухню на паузу"
              value={catalog.isOpen !== false}
              disabled={command.busy}
              onChange={(isOpen) =>
                void command.run(async () => {
                  if (membership.restaurantId !== catalog.id)
                    throw new Error('Ресторан изменён. Обновите экран.');
                  const result = await api.saveCatalog(
                    catalog.id,
                    { ...catalog, isOpen },
                    snapshot.updatedAt,
                  );
                  setSnapshot(result);
                  onChanged();
                })
              }
            />
          )}
        </View>
      </View>
      <ErrorNotice error={command.error} />
      {can(membership, 'orders.read') && (
        <>
          <SectionTitle
            title="На кухне сейчас"
            action="Все заказы"
            onPress={() => navigate('orders')}
          />
          <Row style={{ alignItems: 'stretch' }}>
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              onPress={() => navigate('orders')}
            >
              <Card style={{ backgroundColor: tokens.blue, padding: 20 }}>
                <Ionicons name="receipt-outline" size={23} color="white" />
                <Text
                  variant="title"
                  style={{ color: 'white', fontSize: 38, lineHeight: 44 }}
                >
                  {placed}
                </Text>
                <Text variant="label" style={{ color: 'white' }}>
                  Новые заказы
                </Text>
              </Card>
            </Pressable>
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              onPress={() => navigate('orders')}
            >
              <Card>
                <Ionicons name="flame-outline" size={23} color={tokens.coral} />
                <Text variant="title" style={{ fontSize: 38, lineHeight: 44 }}>
                  {preparing}
                </Text>
                <Text variant="label">Готовим</Text>
              </Card>
            </Pressable>
          </Row>
          <ErrorNotice
            error={feed.error}
            retry={() => void feed.refresh().catch(() => undefined)}
          />
        </>
      )}
      {can(membership, 'stats.read') && (
        <>
          <SectionTitle
            title="Сегодня в цифрах"
            action="Статистика"
            onPress={() => navigate('stats')}
          />
          <ErrorNotice error={stats.error} retry={stats.reload} />
          {stats.loading ? (
            <Skeleton />
          ) : (
            stats.data && (
              <Card>
                <Row style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text variant="caption">Выручка</Text>
                    <Text
                      variant="heading"
                      style={{ fontSize: 26, lineHeight: 33 }}
                    >
                      {money(stats.data.revenue)}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 1,
                      alignSelf: 'stretch',
                      backgroundColor: tokens.line,
                    }}
                  />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text variant="caption">Средний чек</Text>
                    <Text
                      variant="heading"
                      style={{ fontSize: 24, lineHeight: 33 }}
                    >
                      {money(stats.data.averageOrder)}
                    </Text>
                  </View>
                </Row>
                <Text variant="caption">
                  По завершённым заказам · время Бишкека
                </Text>
              </Card>
            )
          )}
        </>
      )}
      {(can(membership, 'menu.manage') ||
        can(membership, 'promotions.manage')) && (
        <>
          <SectionTitle title="Для ваших гостей" />
          <Row style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
            {can(membership, 'menu.manage') && (
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button
                  secondary
                  title="Добавить блюдо"
                  icon="add-circle-outline"
                  onPress={() => navigate('menu', true)}
                />
              </View>
            )}
            {can(membership, 'promotions.manage') && (
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button
                  secondary
                  title="Создать акцию"
                  icon="pricetag-outline"
                  onPress={() => navigate('promotions', true)}
                />
              </View>
            )}
          </Row>
        </>
      )}
      {stopped.length > 0 && can(membership, 'menu.manage') && (
        <Pressable accessibilityRole="button" onPress={() => navigate('menu')}>
          <Card style={{ backgroundColor: '#FFF0EC' }}>
            <Row>
              <Ionicons
                name="pause-circle-outline"
                size={26}
                color={tokens.danger}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="heading">В стоп-листе: {stopped.length}</Text>
                <Text variant="caption">
                  {stopped
                    .slice(0, 3)
                    .map((d) => d.name)
                    .join(', ')}
                  {stopped.length > 3 ? '…' : ''}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={tokens.danger}
              />
            </Row>
          </Card>
        </Pressable>
      )}
      {can(membership, 'orders.read') && (
        <>
          <SectionTitle title="Любимые блюда гостей" />
          {popular.length ? (
            <Card>
              {popular.map(({ dish, count }) => (
                <Row key={dish.id}>
                  <Photo
                    imageUrl={dish.imageUrl}
                    imageKey={dish.imageKey}
                    style={{ width: 58, height: 58, borderRadius: 17 }}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text variant="label">{dish.name}</Text>
                    <Text variant="caption">
                      {count} порций в завершённых заказах
                    </Text>
                  </View>
                  <Text variant="label">{money(dish.price)}</Text>
                </Row>
              ))}
              <Text variant="caption">По последним 200 заказам</Text>
            </Card>
          ) : (
            <Empty
              title="Здесь будут фавориты"
              body="Популярные блюда появятся после первых завершённых заказов."
            />
          )}
        </>
      )}
    </Screen>
  );
}
export function AnalyticsScreen({
  restaurantId,
  revision,
}: {
  restaurantId: string;
  revision: number;
}) {
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const data = useResource<Stats>(
    `/${restaurantId}/stats?period=${period}`,
    revision,
  );
  const stats = data.data;
  const max = Math.max(1, ...(stats?.byDay.map((d) => d.revenue) || []));
  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text variant="title">Как идут дела</Text>
        <Text variant="caption">Статистика вашего ресторана</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {(
          [
            ['day', 'Сегодня'],
            ['week', 'Неделя'],
            ['month', 'Месяц'],
            ['all', 'Всё время'],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            title={label}
            active={period === key}
            onPress={() => setPeriod(key)}
          />
        ))}
      </ScrollView>
      <ErrorNotice error={data.error} retry={data.reload} />
      {data.loading && <Skeleton />}
      {stats && (
        <>
          <Card style={{ backgroundColor: tokens.blue, padding: 26 }}>
            <Text variant="label" style={{ color: '#DDEEFF' }}>
              Выручка
            </Text>
            <Text
              variant="title"
              style={{ color: 'white', fontSize: 40, lineHeight: 48 }}
            >
              {money(stats.revenue)}
            </Text>
            <Text variant="caption" style={{ color: '#DDEEFF' }}>
              По завершённым заказам
            </Text>
          </Card>
          <Row style={{ alignItems: 'stretch' }}>
            <View style={{ flex: 1 }}>
              <Card>
                <Text variant="caption">Заказы</Text>
                <Text variant="title">{stats.totalOrders}</Text>
              </Card>
            </View>
            <View style={{ flex: 1 }}>
              <Card>
                <Text variant="caption">Средний чек</Text>
                <Text variant="heading">{money(stats.averageOrder)}</Text>
              </Card>
            </View>
          </Row>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text>Завершено</Text>
              <Text variant="heading" style={{ color: tokens.green }}>
                {stats.completedOrders}
              </Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text>Отменено</Text>
              <Text variant="heading" style={{ color: tokens.danger }}>
                {stats.cancelledOrders}
              </Text>
            </Row>
          </Card>
          <SectionTitle title="Динамика по дням" />
          {stats.byDay.length ? (
            <Card>
              <ScrollView
                horizontal
                contentContainerStyle={{ gap: 14, paddingTop: 16 }}
              >
                {stats.byDay.map((day) => (
                  <View
                    key={day.date}
                    accessibilityLabel={`${day.date}: ${money(day.revenue)}, ${day.orders} заказов`}
                    style={{ width: 52, gap: 7, alignItems: 'center' }}
                  >
                    <Text variant="caption" style={{ fontSize: 10 }}>
                      {day.revenue}
                    </Text>
                    <View
                      style={{
                        height: 120,
                        width: 28,
                        justifyContent: 'flex-end',
                        backgroundColor: tokens.blueSoft,
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <View
                        style={{
                          height: Math.round((day.revenue / max) * 120),
                          backgroundColor: tokens.blue,
                          borderRadius: 8,
                        }}
                      />
                    </View>
                    <Text variant="caption" style={{ fontSize: 10 }}>
                      {day.date.slice(8)}.{day.date.slice(5, 7)}
                    </Text>
                    <Text variant="caption" style={{ fontSize: 10 }}>
                      {day.orders} зак.
                    </Text>
                  </View>
                ))}
              </ScrollView>
              <Text variant="caption">Сом · дни по времени Бишкека</Text>
            </Card>
          ) : (
            <Empty
              icon="bar-chart-outline"
              title="Данные ещё появятся"
              body="В этом периоде нет заказов. Попробуйте выбрать другой период."
            />
          )}
        </>
      )}
    </Screen>
  );
}
