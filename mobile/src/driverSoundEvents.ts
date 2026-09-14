import { ChatMessage, isActive, Order, User } from './types';

export type DriverSound = 'new-order' | 'passenger-message' | 'trip-completed';
export type SoundSink = {
  play: (kind: DriverSound, key: string, expiresAt?: number) => void;
  cancel: (key: string) => void;
  stop: () => void;
};

/** One event ledger for socket delivery, polling and push-triggered refreshes. */
export class DriverSoundEvents {
  private user: User | null = null;
  private foreground = true;
  private seen = new Set<string>();
  private ringing = new Set<string>();
  constructor(private sink: SoundSink, private now = Date.now) {}

  setUser(user: User | null) {
    if (this.user?.id !== user?.id || this.user?.role !== user?.role) {
      this.sink.stop(); this.seen.clear(); this.ringing.clear();
    }
    this.user = user;
    if (!this.enabled()) { this.sink.stop(); this.ringing.clear(); }
  }
  isDriver() { return this.user?.role === 'DRIVER'; }
  setForeground(value: boolean) {
    this.foreground = value;
    if (!value) { this.sink.stop(); this.ringing.clear(); }
  }
  private enabled() { return this.isDriver() && this.user?.notifications === true; }
  private emit(kind: DriverSound, key: string, expiresAt?: number) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    if (this.enabled() && this.foreground) this.sink.play(kind, key, expiresAt);
  }
  offers(offers: Order[], order: Order | null) {
    const valid = this.user?.driverProfile?.online && !isActive(order)
      ? offers.filter(item => item.status === 'SEARCHING' && (!item.searchExpiresAt || Date.parse(item.searchExpiresAt) > this.now())) : [];
    const keys = new Set(valid.map(item => `offer:${item.id}`));
    for (const key of this.ringing) if (!keys.has(key)) this.sink.cancel(key);
    this.ringing = keys;
    for (const item of valid) this.emit('new-order', `offer:${item.id}`, item.searchExpiresAt ? Date.parse(item.searchExpiresAt) : undefined);
  }
  stopOffer(id: string) { this.sink.cancel(`offer:${id}`); this.ringing.delete(`offer:${id}`); }
  order(next: Order | null, previous: Order | null) {
    if (next && next.status !== 'SEARCHING') this.stopOffer(next.id);
    if (next?.status === 'COMPLETED' && next.driver?.id === this.user?.id && previous?.id === next.id && previous.status !== 'COMPLETED')
      this.emit('trip-completed', `completed:${next.id}`);
  }
  message(message: ChatMessage, order: Order | null) {
    if (!isActive(order) || order?.driver?.id !== this.user?.id || message.orderId !== order?.id || message.senderId !== order?.client?.id) return;
    if (!Number.isFinite(Date.parse(message.createdAt)) || this.now() - Date.parse(message.createdAt) > 30000) return;
    this.emit('passenger-message', `message:${message.id}`);
  }
}
