import { createMissingIndexes } from './db-indexes.js';
import { runScript } from './script-runner.js';

// node dist/scripts/db-indexes.cli.js [--apply --db=<name>]
await runScript(createMissingIndexes);
