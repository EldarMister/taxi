-- Keep the editable banner record while replacing the old Sushi Roll placement
-- with the single home promo. The guards preserve any banner already edited by an admin.
UPDATE "Banner"
SET "title" = 'Быстрые заказы рядом!',
    "subtitle" = 'Всё, что нужно — уже рядом',
    "imageUrl" = NULL,
    "imageKey" = 'nearby-promo',
    "actionType" = 'TAXI',
    "restaurantId" = NULL,
    "updatedAt" = now()
WHERE "id" = 'caa7bb4c-6380-46b2-ae76-465a597ee3f6'
  AND "title" = 'Sushi Roll — Вкусные роллы'
  AND "actionType" = 'RESTAURANT'
  AND "restaurantId" = 'sushi-roll';
