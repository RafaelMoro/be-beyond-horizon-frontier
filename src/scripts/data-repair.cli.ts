import { repairData } from './data-repair.js';
import { runScript } from './script-runner.js';

// node dist/scripts/data-repair.cli.js [--apply --db=<name>] [--r4-map=<file outside the repo>]
await runScript(repairData);
