// Week/date helpers for the meal plan. Everything is an absolute calendar date in
// the device's LOCAL timezone — never UTC — so "Today" and the shown week track the
// phone's clock (a UTC `toISOString().slice(0,10)` would flip the day near midnight).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Local YYYY-MM-DD for a Date (built from local parts, not UTC). */
export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today as a local YYYY-MM-DD. */
export function todayISO(): string {
  return toISO(new Date());
}

/** Midnight-local Date for a YYYY-MM-DD string (no timezone drift). */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The Monday (local midnight) of the week containing `d`. Weeks are Mon–Sun. */
export function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // Sun(0)->6, Mon(1)->0, ... Sat(6)->5
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

/** `n` days after `d` (local). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The seven local dates Mon→Sun for a week starting at `monday`. */
export function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** "03 Aug 2026 – 09 Aug 2026" for the Mon–Sun week starting at `monday`. */
export function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  return `${formatDay(monday)} – ${formatDay(sunday)}`;
}

/** "03 Aug 2026". */
function formatDay(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Long weekday name, e.g. "Friday". */
export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()];
}
