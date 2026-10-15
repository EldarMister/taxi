import type { Membership, RestaurantDetail } from '../../domain/types';

export type ManagementProps = {
  detail: RestaurantDetail;
  membership: Membership;
  onChanged: () => void;
};
export { PromotionsScreen } from './Promotions';
export { RestaurantScreen } from './Restaurant';
