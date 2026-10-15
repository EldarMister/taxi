import type { Language, Order, User } from './types';

export const DRIVER_OFFER_CATEGORY = 'atlas-driver-offer-v1';
export const DRIVER_OFFER_ACCEPT = 'atlas-order-accept';
export const DRIVER_OFFER_SKIP = 'atlas-order-skip';

export function driverOfferButtons(language: Language = 'ru') {
  const titles = language === 'ky' ? ['Алуу', 'Өткөрүп жиберүү'] : language === 'en' ? ['Accept', 'Skip'] : ['Взять', 'Пропустить'];
  return [DRIVER_OFFER_ACCEPT, DRIVER_OFFER_SKIP].map((identifier, index) => ({ identifier, buttonTitle: titles[index], options: { opensAppToForeground: true } }));
}

export type DriverOfferAction = { action: 'accept' | 'skip'; orderId: string; recipientId: string; expiresAt: number };

export function parseDriverOfferAction(actionIdentifier: string | undefined, data: Record<string, unknown>): DriverOfferAction | null {
  if (data.event !== 'order:offer' || ![DRIVER_OFFER_ACCEPT, DRIVER_OFFER_SKIP].includes(actionIdentifier ?? '')) return null;
  const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value);
  if (!validId(data.orderId) || !validId(data.recipientId) || typeof data.offerExpiresAt !== 'string') return null;
  const expiresAt = Date.parse(data.offerExpiresAt);
  return Number.isFinite(expiresAt) ? { action: actionIdentifier === DRIVER_OFFER_ACCEPT ? 'accept' : 'skip', orderId: data.orderId, recipientId: data.recipientId, expiresAt } : null;
}

type Dependencies = {
  getUser: () => User | null;
  getOrder: () => Order | null;
  loadOffers: () => Promise<Order[]>;
  accept: (offer: Order) => Promise<void>;
  skip: (offer: Order) => Promise<void>;
  now?: () => number;
};

/** Notification data selects an offer; only the authenticated API can authorize it. */
export async function performDriverOfferAction(intent: DriverOfferAction, dependencies: Dependencies): Promise<'done' | 'expired' | 'ignored'> {
  const validAccount = () => {
    const user = dependencies.getUser();
    return user?.role === 'DRIVER' && user.id === intent.recipientId;
  };
  if (!validAccount()) return 'ignored';
  const active = dependencies.getOrder();
  if (active && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(active.status)) {
    if (active.id === intent.orderId) return 'done';
    throw new Error('У вас уже есть активный заказ');
  }
  const now = dependencies.now ?? Date.now;
  if (intent.expiresAt <= now()) return 'expired';
  const offers = await dependencies.loadOffers();
  if (!validAccount()) return 'ignored';
  const offer = offers.find(item => item.id === intent.orderId && item.status === 'SEARCHING');
  if (!offer || intent.expiresAt <= now() || (offer.searchExpiresAt && Date.parse(offer.searchExpiresAt) <= now())) return 'expired';
  // Recheck after awaiting the API: a socket may have assigned another trip.
  const latest = dependencies.getOrder();
  if (latest && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(latest.status)) {
    if (latest.id === intent.orderId) return 'done';
    throw new Error('У вас уже есть активный заказ');
  }
  await dependencies[intent.action](offer);
  return 'done';
}
