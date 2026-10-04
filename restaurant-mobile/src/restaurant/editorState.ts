/** Dates in restaurant schedules are entered in Kyrgyzstan local time (UTC+6). */
export function restaurantDateInput(value?: string | null) {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 6 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
}
export function restaurantDateValue(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Invalid date');
  const timestamp = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}+06:00`).toISOString();
  if (restaurantDateInput(timestamp) !== value) throw new RangeError('Invalid date');
  return timestamp;
}
