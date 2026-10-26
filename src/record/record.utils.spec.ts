import {
  formatDateToString,
  formatNumberToCurrency,
  getMonthBounds,
  toExpenseIds,
  toMexicoCityWallClock,
} from './record.utils.js';

// Research §4 golden vectors (legacy under TZ=UTC).
const VECTORS = [
  [
    '2025-02-03T20:05:30.123Z',
    '2025-02-03T14:05:30.000Z',
    'Lun, 3 Feb, 2025',
    '14:05pm',
  ],
  [
    '2025-03-01T03:30:00Z',
    '2025-02-28T21:30:00.000Z',
    'Vie, 28 Feb, 2025',
    '21:30pm',
  ],
  [
    '2026-10-25T06:00:00Z',
    '2026-10-25T00:00:00.000Z',
    'Dom, 25 Oct, 2026',
    '00:00am',
  ],
] as const;

describe('record.utils', () => {
  describe('toMexicoCityWallClock + formatDateToString', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    for (const tz of [undefined, 'America/Mexico_City', 'Asia/Tokyo']) {
      it(`golden vectors with process TZ ${tz ?? '(default)'}`, () => {
        if (tz) process.env.TZ = tz;
        for (const [input, stored, fullDate, formattedTime] of VECTORS) {
          const shifted = toMexicoCityWallClock(new Date(input));
          expect(shifted.toISOString()).toBe(stored);
          expect(formatDateToString(shifted)).toStrictEqual({
            fullDate,
            formattedTime,
          });
        }
      });
    }

    it('applies the pre-2022 DST offset and drops milliseconds', () => {
      expect(
        toMexicoCityWallClock(
          new Date('2022-07-01T05:30:00.999Z'),
        ).toISOString(),
      ).toBe('2022-07-01T00:30:00.000Z');
    });

    it("uses 'Sept' for September and 'am' through 11h", () => {
      expect(
        formatDateToString(new Date('2025-09-07T11:59:00Z')),
      ).toStrictEqual({
        fullDate: 'Dom, 7 Sept, 2025',
        formattedTime: '11:59am',
      });
      expect(
        formatDateToString(new Date('2025-09-07T12:00:00Z')).formattedTime,
      ).toBe('12:00pm');
    });
  });

  it('formatNumberToCurrency', () => {
    expect(formatNumberToCurrency(1234.5)).toBe('$1,234.50');
    expect(formatNumberToCurrency(-5)).toBe('-$5.00');
    expect(formatNumberToCurrency(0.125)).toBe('$0.13');
    expect(formatNumberToCurrency(0)).toBe('$0.00');
  });

  describe('getMonthBounds', () => {
    it('Feb and the December roll-over, in UTC', () => {
      expect(getMonthBounds('Feb', '2025')).toStrictEqual({
        startDate: new Date('2025-02-01T00:00:00.000Z'),
        endDate: new Date('2025-03-01T00:00:00.000Z'),
      });
      expect(getMonthBounds('Dec', '2025')).toStrictEqual({
        startDate: new Date('2025-12-01T00:00:00.000Z'),
        endDate: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    it.each([
      ['jan', '2025'],
      ['January', '2025'],
      ['13', '2025'],
      ['Jan', '25'],
      ['Jan', '20250'],
      ['Jan', '2025a'],
    ])('null for %s/%s', (month, year) => {
      expect(getMonthBounds(month, year)).toBeNull();
    });
  });
});

describe('toExpenseIds', () => {
  const A = '64b7f0c2a1b2c3d4e5f60801';
  const B = '64b7f0c2a1b2c3d4e5f60802';

  it('accepts id strings, expense objects and a mix; dedupes in input order', () => {
    expect(toExpenseIds([])).toStrictEqual([]);
    expect(toExpenseIds([A, B])).toStrictEqual([A, B]);
    expect(toExpenseIds([{ _id: B, shortName: 'x' }, A])).toStrictEqual([B, A]);
    expect(toExpenseIds([A, { _id: A }, A.toUpperCase(), B])).toStrictEqual([
      A,
      B,
    ]);
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['{}', {}],
    ['{ _id: 5 }', { _id: 5 }],
    ['an operator object', { _id: { $ne: null } }],
    ['a 12-char string', 'abcdefghijkl'],
    ['an array', [A]],
  ])('null on %s', (_, bad) => {
    expect(toExpenseIds([A, bad])).toBeNull();
  });
});
