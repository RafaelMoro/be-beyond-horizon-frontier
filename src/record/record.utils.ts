import {
  ABBREVIATED_MONTHS,
  FULL_DATE_MONTHS,
  FULL_DATE_WEEKDAYS,
  MEXICO_CITY_TZ,
} from './record.constants.js';

const mexicoCityParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MEXICO_CITY_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

// Legacy changeTimezone on a UTC host: the Mexico City wall clock written as UTC, ms dropped. Independent of process TZ.
export function toMexicoCityWallClock(date: Date): Date {
  const p = Object.fromEntries(
    mexicoCityParts
      .formatToParts(date)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  );
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  );
}

// Legacy formatDateToString, UTC getters (the stored date is already the wall clock).
export function formatDateToString(date: Date): {
  fullDate: string;
  formattedTime: string;
} {
  const hour = date.getUTCHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    fullDate: `${FULL_DATE_WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${FULL_DATE_MONTHS[date.getUTCMonth()]}, ${date.getUTCFullYear()}`,
    formattedTime: `${pad(hour)}:${pad(date.getUTCMinutes())}${hour <= 11 ? 'am' : 'pm'}`,
  };
}

export function formatNumberToCurrency(amount: number): string {
  return currency.format(amount);
}

// Jan..Dec + 4 digits (D11, Q3), else null → the legacy 200 empty answer. UTC bounds, [start, end).
export function getMonthBounds(
  month: string,
  year: string,
): { startDate: Date; endDate: Date } | null {
  const m = (ABBREVIATED_MONTHS as readonly string[]).indexOf(month);
  if (m < 0 || !/^\d{4}$/.test(year)) return null;
  const y = Number(year);
  return {
    startDate: new Date(Date.UTC(y, m, 1)),
    endDate: new Date(Date.UTC(y, m + 1, 1)),
  };
}
