# Implementation Guidelines

**Last Updated:** 2026-10-25

Technical conventions for implementing features in be-beyond-horizon-frontier. See [REPO_CONTEXT.md](./REPO_CONTEXT.md) for current architecture.

> Sections marked _(adopt when needed)_ describe conventions to apply the first time that concern appears — they are not in the codebase yet. Flip them to real sections, with file paths, once implemented.

---

## NestJS Module Creation

The Nest CLI is a dev dependency, so run it through pnpm:

```bash
pnpm nest g mo <module-name>
# Creates src/<module-name>/<module-name>.module.ts and adds it to AppModule imports
```

- Confirm the module name with the user during the **planning phase**, before implementation.
- Module names are singular, kebab-case (`account`, `record`, `budget`).
- After generating, check the generated relative imports end in `.js` (see [Imports](#imports)); fix them if the schematic left them off.

### Module Structure

```
src/<module-name>/
├── <module-name>.module.ts
├── <module-name>.constants.ts   (if needed)
├── <module-name>.interface.ts   (if needed)
├── <module-name>.utils.ts       (if needed)
├── controllers/
│   └── <module-name>.controller.ts
├── services/
│   ├── <module-name>.service.ts
│   └── <module-name>.service.spec.ts
├── entities/                     (if persisted)
├── dtos/
│   ├── <module-name>.dto.ts              (request DTOs)
│   └── <module-name>-responses.dto.ts    (response DTOs)
└── guards/                       (if custom guards needed)
```

The CLI writes to the path you give it, so include the subdirectory:

```bash
pnpm nest g s <module-name>/services/<name>      # src/<module-name>/services/<name>.service.ts + .spec.ts
pnpm nest g co <module-name>/controllers/<name>  # src/<module-name>/controllers/<name>.controller.ts + .spec.ts
```

Both are registered in the nearest module's `providers` / `controllers` automatically. Pass **`--flat`** (otherwise the CLI adds an extra `<name>/` folder, e.g. `services/user/user.service.ts`), and generate the module first so the CLI registers into it, not `AppModule`:

```bash
pnpm nest g s user/services/user --flat
pnpm nest g co user/controllers/user --flat --no-spec
pnpm nest g gu auth/guards/jwt-auth --flat
```

**Controllers must stay thin:** no business logic, no orchestration across services, no conditionals beyond pulling the authenticated user off the request. Pass inputs through and let the service own every decision.

---

## Module Dependencies and Exports

Export a service to make it usable elsewhere; import the **module**, never the service file, to consume it.

```typescript
// account/account.module.ts
@Module({
  providers: [AccountService],
  exports: [AccountService], // ← available to importing modules
})
export class AccountModule {}

// record/record.module.ts
@Module({
  imports: [AccountModule], // ← the module, not the service
  providers: [RecordService], // RecordService can now inject AccountService
  controllers: [RecordController],
  exports: [RecordService],
})
export class RecordModule {}
```

Inject via constructor:

```typescript
constructor(private readonly accountService: AccountService) {}
```

---

## File Organization

### Imports

The project is ESM (`"type": "module"`, `"module": "nodenext"`), so **relative imports carry the `.js` extension** even though the file is `.ts`:

```typescript
import { AppService } from './app.service.js';
```

Without it the import fails to resolve under Node ESM. Package imports (`@nestjs/common`) take no extension.

Imports are relative — `tsconfig.json` defines no `paths`. If deep relative chains (`../../../`) start appearing, add an alias once rather than living with them. Vitest already resolves tsconfig `paths` through `vite-tsconfig-paths` in both configs; `nest build` (plain `tsc`) does **not** rewrite them in the emitted JS, so verify the built app with `pnpm run build && pnpm run start:prod` before relying on an alias at runtime.

### File Naming

| Kind        | Pattern                                       |
| ----------- | --------------------------------------------- |
| Modules     | `<name>.module.ts` (singular, kebab-case)     |
| Services    | `<name>.service.ts`                           |
| Controllers | `<name>.controller.ts`                        |
| Entities    | `<name>.entity.ts`                            |
| DTOs        | `<name>.dto.ts` / `<module>-responses.dto.ts` |
| Unit tests  | `<file>.spec.ts` (co-located)                 |
| E2E tests   | `test/<name>.e2e-spec.ts`                     |
| Constants   | `<module>.constants.ts`                       |
| Interfaces  | `<module>.interface.ts`                       |
| Utils       | `<module>.utils.ts`                           |

---

## Keep the Legacy HTTP Contract

This repo is the rewrite of a legacy backend, and the existing frontend must keep working against it. When a route is ported, its path, method, status codes, request body, cookies and response shape match the legacy route unless the user explicitly approves a change. The research doc for a ported route records the legacy contract; the plan validates against it.

---

## API Documentation _(adopt when needed)_

Once OpenAPI docs land (`@nestjs/swagger` + its CLI plugin in `nest-cli.json` → `compilerOptions.plugins`), record here where Swagger UI is mounted.

- The plugin infers `@ApiProperty` on DTOs from TS types plus existing `class-validator` decorators — no manual `@ApiProperty` needed unless the generated schema is missing or wrong.
- Every handler gets `@ApiOperation({ summary })` and an `@ApiResponse({ status, description })` per status it can produce; every controller gets `@ApiTags`.
- Where a response is deliberately vague for security reasons, say so in the `description`.

---

## Testing Conventions

Tests run on **Vitest** with `globals: true` (`describe`, `it`, `expect`, `vi` need no import). Unit specs (`*.spec.ts`) live next to the source and run with `vitest.config.ts`; e2e specs (`test/*.e2e-spec.ts`) run with `vitest.config.e2e.ts`. Run a single file with `pnpm test <name>` (Vitest filters by path substring).

```typescript
describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MyService],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

### Mocking dependencies

Replace collaborators with `useValue` rather than pulling in their real modules:

```typescript
const mockAccountService = { findById: vi.fn() };

const module: TestingModule = await Test.createTestingModule({
  providers: [
    RecordService,
    { provide: AccountService, useValue: mockAccountService },
  ],
}).compile();
```

### E2E tests

Build the app with `createTestApp()` and close it with `closeTestApp(app)` (`test/create-test-app.ts`); never `Test.createTestingModule(...).createNestApplication()` by hand, or the pipe, filters, CORS and cookie-parser are missing. Test-only controllers go in `createTestApp({ controllers: [...] })`, declared inside the spec. E2E never uses `.env`: `test/setup-env.ts` points it at `MONGO_TEST_URI` or an in-memory replica set and the `budget-master-e2e` DB, which `closeTestApp` drops.

### Console output

Silence logs unless the test asserts on them:

```typescript
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

---

## DTOs Are the Source of Truth — Derive Types, Don't Duplicate

When a service or interface needs a type that mirrors a response DTO, alias the DTO instead of writing a parallel interface:

```typescript
// dtos/account-responses.dto.ts
export class AccountDataDto {
  name: string;
  // ...
}

// account.interface.ts
export type FormattedAccountData = AccountDataDto;
```

**Why:** the DTO already carries the validation decorators and canonical shape. Parallel interfaces drift — a new DTO field silently fails to reach the interface. Typing response literals with the DTO-derived alias makes missing or extra fields a compile error.

Same pattern for entities: `export type AccountDoc = Account;`

---

## Error Handling

The global filters (`src/exceptions/`, registered in `src/configure-app.ts`) already turn every error into an enveloped response (see `REPO_CONTEXT.md` → Error filters):

- `HttpException`s keep their status and body (`GeneralAppExceptionFilter`).
- Generic library errors are mapped **once** in `CatchAllExceptionFilter`: CastError / BSONError / mongoose ValidationError → 400, E11000 → 409, exposed body-parser `http-errors` (413 …) keep their status. Anything else becomes a generic enveloped 500 and is logged.

So services don't need try/catch just to avoid a raw 500. Throw Nest exceptions for domain outcomes (`NotFoundException`, `UnauthorizedException`, …).

**Never `throw new BadRequestException(e.message)`** (or any `HttpException` wrapping a caught error's message) around service code: library messages leak internals and user data (E11000 messages contain emails).

Route-specific legacy texts and statuses are mapped **explicitly in that route's story**, by catching the specific error in the service. Examples: E11000 on signup → 400 `'Try with other email.'`; reset-password jsonwebtoken errors → 400 with `err.message`, as legacy `verifyToken` does.

### Logging rule

A log line carries the method, the **route pattern** (`req.route?.path`) and the status. It never includes `req.originalUrl`/`req.url` (reset-password URLs carry a live token), bodies, cookies, the `Authorization` header, `keyValue` or emails.

---

## Config

- Keys are validated by `envSchema` in `src/config.ts` and exposed through `registerAs('config', …)`. Add a new key to both, and to `.env.example`, with its legacy name.
- Inject the typed object: `constructor(@Inject(config.KEY) private readonly c: ConfigType<typeof config>) {}`. Never read `process.env` in services.
- `.env` points at the prod DB. Never point tests at it.

## Database

- The connection lives in `AppModule` (`MongooseModule.forRootAsync` + `mongooseOptions` in `src/mongoose-options.ts`). Feature modules register their schemas with `MongooseModule.forFeature`.
- `autoIndex` is off outside tests (`start:dev` hits prod), so production indexes come from S8's script, not from schema `index`/`unique` at boot.

## DTOs and the ValidationPipe

The global `ValidationPipe` runs with `whitelist`, `forbidNonWhitelisted` and `transform: true`:

- Unknown properties are rejected with 400 (`property X should not exist`).
- With `transform: true`, property initializers become defaults, so don't add them unless the contract has that default.
- Nested DTOs need `@ValidateNested()` + `@Type(() => Child)`.

---

## Auth

- Every route is protected by the global `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`, `APP_GUARD` in `AuthModule`). Mark open routes with `@Public()` from `src/auth/decorators/public.decorator.ts` (handler or class). Test-only e2e controllers need it too.
- Protected handlers type the request as `AuthenticatedRequest` (`src/auth/auth.interface.ts`) and pass `req.user.sub` to the service; the controller does nothing else with it.
- Guard ordering: authentication (`JwtAuthGuard`) always before any authorization guard.
- Don't make a `JwtModule` global: `AuthModule` and `UserModule` each own one with a different key.

---

## Method Parameters — Destructure Past 3

A method taking **more than 3 parameters** receives a single destructured object instead:

```typescript
// ✅
private async syncAccount({
  account,
  provider,
  options,
  messages,
}: {
  account: AccountDoc;
  provider: string;
  options: SyncOptions;
  messages: string[];
}): Promise<SyncResult> { }

// ❌
private async syncAccount(
  account: AccountDoc,
  provider: string,
  options: SyncOptions,
  messages: string[],
): Promise<SyncResult> { }
```

Call sites become self-documenting, argument order stops mattering, and adding a parameter doesn't break existing callers.

---

## Type Safety — No `any`

Define an interface instead of reaching for `any`. `tsconfig.json` is `strict` (implicit `any` fails the build), but `oxlint.json` turns `@typescript-eslint/no-explicit-any` **off** — an explicit `any` is a convention the tooling will _not_ catch for you.

1. Locate (or create) `<module>.interface.ts` in the module folder.
2. Define the shape based on the data actually flowing through.
3. Import it and replace the `any`.

```typescript
// src/account/account.interface.ts
export interface AccountSyncPayload {
  externalId: string;
  name: string;
  tags: string[];
}
```

Types that mirror a DTO are aliased, not redeclared — see [DTOs Are the Source of Truth](#dtos-are-the-source-of-truth--derive-types-dont-duplicate).

---

## Lint and Format Priorities

`pnpm run lint` runs `oxlint src/ test/` with **no** `--fix`; formatting is Prettier's job (`pnpm run format`, config in `.prettierrc`). CI runs lint on every PR.

**Address:** lint errors, unused variables and imports, `no-floating-promises` warnings (set in `oxlint.json` — `await` or explicitly handle every promise), `any` usage.

**Ignore unless asked:** spacing and line breaks (Prettier owns these), naming conventions.

Functionality first, type safety second, formatting last. Reach for an `oxlint-disable` comment only when the rule genuinely doesn't apply to that context — and say why on the same line.

---

## Running Tests

**Run them** after changes that could affect outcomes, when verifying a fix, or when debugging a failure.

**Don't run them** when the suite just passed with no code change since, repeatedly in succession, or after edits that can't affect any test.

Batch related changes and test once. Prefer a targeted run — `pnpm test <file>` or `pnpm test -t "<name>"` — over the full suite.

---

## Keeping This Document Current

Update when a new module pattern is established, a recurring mistake is identified, or a convention changes.

**Related:** [REPO_CONTEXT.md](./REPO_CONTEXT.md) — current codebase architecture.
