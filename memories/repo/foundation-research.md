# foundation research notes (2026-10-25)

- `@nestjs/config` 12 `validationSchema` takes a Standard Schema; Joi works only from v18 (has `~standard`). Joi 17 does not.
- Joi under Node ESM: use `import Joi from 'joi'`. `import * as Joi` has no named exports at runtime (CJS `module.exports = internals.root()`), but passes under Vitest.
- Nest 12 reverses global filters before matching: register a `@Catch()` catch-all before the HttpException filter.
- GitHub Actions `services:` can't pass `--replSet`, so a service Mongo is standalone (no transactions).
- Docker on this machine is Windows Docker Desktop without WSL integration; a mongod 8.2.6 binary for mongodb-memory-server is cached in `~/.cache/mongodb-binaries`.
- `ConfigModule` loads `.env` (prod DB) in tests too; predefined `process.env` wins, so guard the URI the app actually uses.
