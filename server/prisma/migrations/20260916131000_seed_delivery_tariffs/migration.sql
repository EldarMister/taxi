INSERT INTO "Tariff" ("id","name","description","kind","requiredClass","basePrice","pricePerKm","pricePerMinute","minimumPrice","commissionBps","active") VALUES
('delivery-car','Доставка','Небольшие чистые грузы на легковой машине','DELIVERY_CAR','ECONOMY',22,16,2,22,1000,true),
('delivery-truck','Грузовой','Крупные и тяжёлые грузы','DELIVERY_TRUCK','TRUCK',257,35,4,257,1000,true)
ON CONFLICT ("id") DO NOTHING;
