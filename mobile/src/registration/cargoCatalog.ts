// Small and medium commercial vehicles used for local deliveries.
// This catalog intentionally excludes passenger cars, tractor units and heavy trucks.
export const cargoVehicleCatalog: Record<string, string[]> = {
  Hyundai: ['Porter', 'Porter II', 'H-100', 'Mighty'],
  GAZ: ['Газель', 'Газель Бизнес', 'Газель NEXT', 'Газель NN', 'Соболь', 'Соболь Бизнес', 'Соболь NN'],
  Kia: ['Bongo', 'Bongo III', 'K2500', 'K2700', 'K3000'],
  Ford: ['Transit', 'Transit Custom', 'Transit Connect'],
  'Mercedes-Benz': ['Sprinter', 'Vito', 'Citan'],
  Volkswagen: ['Transporter', 'Crafter', 'Caddy'],
  Toyota: ['Dyna', 'ToyoAce', 'TownAce', 'LiteAce', 'HiAce'],
  Nissan: ['Atlas', 'Cabstar', 'NV200', 'Caravan', 'Vanette'],
  Isuzu: ['Elf', 'N-Series'],
  Mitsubishi: ['Canter', 'Delica Cargo'],
  Mazda: ['Bongo', 'Bongo Brawny', 'Titan'],
  Renault: ['Master', 'Trafic', 'Kangoo'],
  Peugeot: ['Boxer', 'Expert', 'Partner'],
  Citroen: ['Jumper', 'Jumpy', 'Berlingo'],
  Fiat: ['Ducato', 'Scudo', 'Doblo'],
  Opel: ['Movano', 'Vivaro', 'Combo'],
  UAZ: ['Профи', 'Карго', '3303', '39094', '3741'],
  Iveco: ['Daily'],
};
export const deliveryCargoTypes = ['Каблук', 'Грузовой минивэн', 'Фургон', 'Бортовой', 'Тентованный', 'Рефрижератор'];
