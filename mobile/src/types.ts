export type Language = "ru" | "ky";
export type Point = { latitude: number; longitude: number; address: string };
export type Coordinate = {
  latitude: number;
  longitude: number;
  recordedAt?: string;
};
export type DriverProfile = {
  verified: boolean;
  online: boolean;
  carMake: string;
  carColor: string;
  carPlate: string;
  rating: number | null;
  completedTrips?: number;
};
export type User = {
  id: string;
  phone: string;
  name: string;
  photoUrl?: string | null;
  role: "CLIENT" | "DRIVER" | "ADMIN";
  notifications: boolean;
  language: Language;
  driverProfile?: DriverProfile | null;
};
export type Tokens = { accessToken: string; refreshToken: string };
export type Session = Tokens & { user: User };
export type Tariff = {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  pricePerKm?: number;
  pricePerMinute?: number;
  minimumPrice: number;
};
export type Quote = {
  id: string;
  price: number;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Coordinate[];
  expiresAt: string;
  currency: string;
  development?: boolean;
  routeProvider?: string;
};
export type OrderStatus =
  | "SEARCHING"
  | "ASSIGNED"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_DRIVER";
export type DriverLocation = Coordinate & { driverId: string; timestamp: number; receivedAt: number; accuracy: number; heading?: number; speed?: number;
  tripId?: string; trackingSessionId?: string; trackingStartedAt?: number; sequence?: number; measuredAt?: number; accuracyM?: number; speedMps?: number; bearingDeg?: number;
  schemaVersion?: 1; orderId?: string; assignmentId?: string; trackingStartedAtMs?: number; measuredAtMs?: number; courseDeg?: number | null;
  stateVersion?: number; receivedAtMs?: number };
export type DriverLocationUpdate = {
  schemaVersion: 1;
  orderId: string;
  assignmentId: string;
  trackingSessionId: string;
  trackingStartedAtMs: number;
  sequence: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedMps: number | null;
  courseDeg: number | null;
  measuredAtMs: number;
};
export type Order = {
  driverLocation?: DriverLocation | null;
  id: string;
  assignmentId?: string | null;
  status: OrderStatus;
  pickup: Point;
  dropoff: Point;
  price: number;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Coordinate[];
  comment?: string;
  passenger?: { name: string; phone?: string } | null;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
  driver?: User | null;
  client?: User;
  searchExpiresAt?: string;
  tariff?: Tariff;
  rating?: number | null;
  clientRating?: number | null;
  driverRating?: number | null;
  routeProvider?: string;
};
export const normalizePoint = ({
  latitude,
  longitude,
  address,
}: Point): Point => ({ latitude, longitude, address });
export type ChatMessage = {
  id: string;
  orderId: string;
  senderId: string;
  text: string;
  createdAt: string;
  clientMessageId?: string;
};
export type Balance = {
  deposit: number;
  cashIncome: number;
  commissionTotal: number;
  currency: "KGS";
  operations: {
    id: string;
    kind: string;
    amount: number;
    balanceAfter: number;
    note: string;
    createdAt: string;
  }[];
};
export type AppConfig = {
  supportPhone?: string;
  currency: string;
  development: boolean;
};
export const ACTIVE_STATUSES: OrderStatus[] = [
  "SEARCHING",
  "ASSIGNED",
  "ARRIVED",
  "IN_PROGRESS",
];
export const isActive = (order: Order | null) =>
  !!order && ACTIVE_STATUSES.includes(order.status);
