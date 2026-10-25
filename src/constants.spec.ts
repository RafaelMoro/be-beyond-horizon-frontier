import { readFileSync } from 'node:fs';
import { INITIAL_RESPONSE } from './constants.js';

describe('INITIAL_RESPONSE', () => {
  it('has exactly the legacy keys and defaults, with the package.json version', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(INITIAL_RESPONSE).toStrictEqual({
      version,
      success: true,
      message: null,
      data: null,
      error: null,
    });
  });
});
