import type { FoodPaymentMethod } from './types';

export type CheckoutDetails = {
  fulfillment: 'DELIVERY';
  address: string;
  addressPoint?: { latitude: number; longitude: number };
  /** Instructions for the courier; retained for existing saved checkouts. */
  comment: string;
  paymentMethod: FoodPaymentMethod;
  entrance?: string;
  floor?: string;
  apartment?: string;
  intercom?: string;
  restaurantComment?: string;
  cutleryCount?: number;
  recipientPhone?: string;
  leaveAtDoor?: boolean;
};

/** Preserve all instructions in the existing order API's comment field. */
export function formatCheckoutComment(details: CheckoutDetails): string {
  const instructions = [
    details.entrance?.trim() && `Подъезд: ${details.entrance.trim()}`,
    details.floor?.trim() && `Этаж: ${details.floor.trim()}`,
    details.apartment?.trim() && `Квартира: ${details.apartment.trim()}`,
    details.intercom?.trim() && `Домофон: ${details.intercom.trim()}`,
    details.recipientPhone?.trim() && `Телефон получателя: ${details.recipientPhone.trim()}`,
    details.leaveAtDoor && 'Оставить у двери',
    typeof details.cutleryCount === 'number' && `Приборы: ${details.cutleryCount}`,
    details.restaurantComment?.trim() && `Ресторану: ${details.restaurantComment.trim()}`,
  ].filter(Boolean);
  // Preserve pending orders' pre-upgrade signatures when no new details exist.
  if (!instructions.length) return details.comment.trim();
  if (details.comment.trim()) instructions.push(`Курьеру: ${details.comment.trim()}`);
  return instructions.join('\n');
}
