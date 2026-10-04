import type { FoodRestaurantReview } from './types';

export type RestaurantReviewSort = 'default' | 'newest' | 'highest' | 'lowest';

/** Only customer feedback supplied by the catalog is rendered. */
export function sortRestaurantReviews(reviews: FoodRestaurantReview[] | undefined, sort: RestaurantReviewSort) {
  const result = (reviews ?? []).filter(review => review && typeof review.id === 'string' &&
    typeof review.text === 'string' && review.text.trim().length > 0 &&
    typeof review.authorName === 'string' && Number.isFinite(review.rating) &&
    review.rating >= 1 && review.rating <= 5);
  if (sort === 'newest') result.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  if (sort === 'highest') result.sort((a, b) => b.rating - a.rating);
  if (sort === 'lowest') result.sort((a, b) => a.rating - b.rating);
  return result;
}
