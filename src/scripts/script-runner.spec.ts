import { assertApplyTarget, parseScriptArgs } from './script-runner.js';

describe('parseScriptArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseScriptArgs([])).toEqual({ apply: false });
  });

  it('parses --apply, --db and --r4-map', () => {
    expect(
      parseScriptArgs(['--apply', '--db=x', '--r4-map=/tmp/m.json']),
    ).toEqual({ apply: true, db: 'x', r4Map: '/tmp/m.json' });
  });

  it.each([[['--force']], [['budget']], [['--', '--apply']], [['--']]])(
    'rejects %j',
    (argv) => {
      expect(() => parseScriptArgs(argv)).toThrow();
    },
  );
});

describe('assertApplyTarget', () => {
  it('lets a dry run through without --db', () => {
    expect(assertApplyTarget({ apply: false }, 'prod')).toBe(true);
  });

  it('refuses --apply without --db or with another name', () => {
    expect(assertApplyTarget({ apply: true }, 'prod')).toBe(false);
    expect(assertApplyTarget({ apply: true, db: 'other' }, 'prod')).toBe(false);
  });

  it('accepts --apply with the connected db name', () => {
    expect(assertApplyTarget({ apply: true, db: 'prod' }, 'prod')).toBe(true);
  });
});
