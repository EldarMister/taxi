import type { DispatchInput, MerchantOrder, OrderAction } from '../../domain/types';
import { actionStatus, activeAtlas, allowedActions, canDispatch, scopedOrders } from './model';

type Command = { kind: 'action'; action: OrderAction; reason?: string } | { kind: 'dispatch'; input: DispatchInput };
type Dependencies = { load: () => Promise<MerchantOrder[]>; send: (orderId: string, command: Command) => Promise<unknown> };
const failureMessage = 'Не удалось проверить результат. Обновите заказы перед повторной отправкой.';
export class OrderCommandCoordinator {
  private pending = new Map<string, Promise<MerchantOrder[]>>();
  private uncertain = new Map<string, Command>();
  constructor(private readonly restaurantId: string, private readonly deps: Dependencies) {}
  isUncertain(orderId: string): boolean { return this.uncertain.has(orderId); }
  execute(orderId: string, command: Command): Promise<MerchantOrder[]> {
    const running = this.pending.get(orderId);
    if (running) return running;
    const task = this.run(orderId, command).finally(() => { this.pending.delete(orderId); });
    this.pending.set(orderId, task);
    return task;
  }
  private async snapshot(orderId: string): Promise<{ orders: MerchantOrder[]; order: MerchantOrder }> {
    const orders = scopedOrders(await this.deps.load(), this.restaurantId);
    const order = orders.find(item => item.id === orderId);
    if (!order) throw new Error('Заказ недоступен в этом ресторане. Обновите список.');
    return { orders, order };
  }
  private applied(order: MerchantOrder, command: Command): boolean {
    if (command.kind === 'action') return order.status === actionStatus[command.action];
    return command.input.method === 'ATLAS_CAR' ? activeAtlas(order) || order.deliveryMethod === 'ATLAS_CAR' && order.status === 'COMPLETED'
      : order.deliveryMethod === 'OWN' && ['DELIVERING', 'COMPLETED'].includes(order.status);
  }
  private async run(orderId: string, command: Command): Promise<MerchantOrder[]> {
    // A fresh snapshot precedes every critical command, including after a lost response.
    let snapshot: { orders: MerchantOrder[]; order: MerchantOrder };
    try { snapshot = await this.snapshot(orderId); }
    catch (error) { if (this.uncertain.has(orderId)) throw new Error(failureMessage); throw error; }
    const previous = this.uncertain.get(orderId);
    if (previous) {
      this.uncertain.delete(orderId);
      if (this.applied(snapshot.order, previous)) return snapshot.orders;
      // A completed/failed Atlas attempt still proves creation; require a new quote and confirmation.
      if (previous.kind === 'dispatch' && previous.input.method === 'ATLAS_CAR' && snapshot.order.atlasDelivery) {
        throw new Error('Предыдущий вызов найден. Проверьте его статус и заново рассчитайте доставку.');
      }
    }
    if (this.applied(snapshot.order, command)) return snapshot.orders;
    if (command.kind === 'action' && !allowedActions(snapshot.order).includes(command.action)) throw new Error('Статус заказа изменился. Доступные действия обновлены.');
    if (command.kind === 'dispatch' && !canDispatch(snapshot.order)) throw new Error('Заказ уже передан в доставку или больше не готов к отправке.');
    if (command.kind === 'dispatch' && command.input.method === 'ATLAS_CAR' && (!Number.isSafeInteger(command.input.expectedPrice) || command.input.expectedPrice! <= 0)) throw new Error('Сначала рассчитайте стоимость Atlas.');
    try {
      await this.deps.send(orderId, command);
      this.uncertain.set(orderId, command);
      const updated = await this.snapshot(orderId);
      this.uncertain.delete(orderId);
      return updated.orders;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status && status >= 400 && status < 500) {
        this.uncertain.delete(orderId);
        await this.deps.load().catch(() => undefined);
        throw error;
      }
      this.uncertain.set(orderId, command);
      try {
        const updated = await this.snapshot(orderId);
        if (this.applied(updated.order, command)) { this.uncertain.delete(orderId); return updated.orders; }
      } catch { /* The next user action must reconcile before it may send again. */ }
      throw new Error(failureMessage);
    }
  }
}
