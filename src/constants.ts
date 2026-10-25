import { readFileSync } from 'node:fs';
import type { GeneralResponse } from './response.interface.js';

// Read from package.json, not `npm_package_version`: that is only set under `pnpm run`, so it is undefined on Lambda.
// This file must sit directly in src/ so `../package.json` resolves to the repo root from both src/ and dist/.
export const VERSION_RESPONSE: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export const INITIAL_RESPONSE: GeneralResponse = {
  version: VERSION_RESPONSE,
  success: true,
  message: null,
  data: null,
  error: null,
};
