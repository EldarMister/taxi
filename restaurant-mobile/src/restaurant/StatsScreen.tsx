import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { restaurantApi } from './api';
import { Button, Card, Empty, c, s } from './ui';
import { Stats, money } from './types';

export function StatsScreen({ restaurantId }: { restaurantId: string }) {
  const [period, setPeriod] = useState('week');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    restaurantApi.request<Stats>(`/${restaurantId}/stats?period=${period}`).then(next => { if (active) setStats(next); }).catch(error => { if (active) setError((error as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [restaurantId, period, revision]);
  return <>
    <Text style={s.title}>Статистика</Text>
    <View style={s.chips}>{[['day', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']].map(([value, label]) => <Pressable key={value} onPress={() => setPeriod(value)} style={[s.chip, period === value && { backgroundColor: c.blue }]}><Text style={[s.label, period === value && { color: 'white' }]}>{label}</Text></Pressable>)}</View>
    {error ? <><Text style={s.error}>{error}</Text><Button title="Повторить загрузку" secondary onPress={() => setRevision(value => value + 1)}/></> : null}
    {loading ? <Text style={s.caption}>Обновляем статистику…</Text> : null}
    {stats ? <>
      <View style={[s.card, { backgroundColor: c.blue, borderColor: c.blue, gap: 12, padding: 24 }]}><Text style={[s.label, { color: '#DDEEFF' }]}>Выручка</Text><Text style={[s.title, { color: 'white', fontSize: 34 }]}>{money(stats.revenue)}</Text><Text style={[s.caption, { color: '#DDEEFF' }]}>По завершённым заказам</Text></View>
      <View style={s.row}><View style={s.flex}><Card><Text style={s.caption}>Всего заказов</Text><Text style={s.title}>{stats.totalOrders}</Text></Card></View><View style={s.flex}><Card><Text style={s.caption}>Средний чек</Text><Text style={[s.heading, { paddingVertical: 6 }]}>{money(stats.averageOrder)}</Text></Card></View></View>
      <Card><View style={s.row}><Text style={[s.body, s.flex]}>Завершено</Text><Text style={[s.heading, { color: c.green }]}>{stats.completedOrders}</Text></View><View style={s.row}><Text style={[s.body, s.flex]}>Отменено</Text><Text style={[s.heading, { color: c.danger }]}>{stats.cancelledOrders}</Text></View></Card>
      <Text style={s.heading}>По дням</Text>
      {stats.byDay?.length ? <Card>{stats.byDay.map(day => <View key={day.date} style={{ paddingVertical: 9, gap: 8 }}><View style={s.row}><Text style={[s.body, s.flex]}>{new Date(day.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</Text><Text style={s.body}>{money(day.revenue)}</Text></View><View style={{ height: 8, borderRadius: 8, backgroundColor: c.soft, overflow: 'hidden' }}><View style={{ height: 8, width: `${Math.max(0, day.revenue) / Math.max(1, ...stats.byDay.map(item => item.revenue)) * 100}%`, backgroundColor: c.blue }}/></View><Text style={s.caption}>{day.orders} заказов</Text></View>)}</Card> : <Empty icon="bar-chart-outline" title="Пока нет статистики" body="Она появится после первых заказов."/>}
    </> : null}
  </>;
}
