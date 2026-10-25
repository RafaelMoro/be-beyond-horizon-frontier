# Plan: S3 — mail (real forgot-password email)

**Status:** APPROVED (owner, 2026-10-25, as written; Resend's own `console.error` outside production accepted; real delivery skipped). Implementing on `feat/mail`, run-all.

**Branch:** `feat/mail` (from `main` v0.4.0) · **Date:** 2026-10-25 · **Research:** [`ai-research/mail.research.md`](../ai-research/mail.research.md)
· Memory: [`memories/repo/mail-research.md`](../memories/repo/mail-research.md), [`memories/repo/mail-planning.md`](../memories/repo/mail-planning.md)

Owner decisions applied (`~/projects/notes/budget-master/be-refactor.md`):
- **E3.M1–M6** (all as the research recommended): M1 `<Head>` moves inside `<Tailwind>`, copy and classes unchanged;
  M2 `RESEND_API_KEY` / `MAILER_MAIL` optional (required when `NODE_ENV=production`), missing → no-op, tests blank
  both; M3 `.tsx` under `src/` + `jsx: react-jsx`, we render the HTML and pass `html:`; M4 `AbortSignal.timeout(5000)`;
  M5 the timing difference of the awaited send is accepted (S8 rate limit); M6 module `mail`. A failed send (returned
  `{ error }` or thrown) is contained: the log carries only `error.name` / `statusCode`, the route still answers 201.
- D12 (link base = `FRONTEND_URI`), D18 (no hardcoded domain), D16 (manual checks run on the prod DB and clean up),
  E2.A4 (S3 implements S2's port), E2.A5 (always 201 `'Email Sent'`).
- **Ops, owner's (not in this plan):** verify the `beyond-horizon-frontier` domain in Resend, set `MAILER_MAIL` on it,
  rotate `RESEND_API_KEY`.

AC numbers below are the **research's AC1–AC5**. Owner's S3 AC1 → research AC1, AC2 → AC2, AC3 → AC3 + AC4.

## Scope guard

**In:** deps (`resend`, `@react-email/components`, `react`, `@types/react`), the two env keys (schema, `registerAs`,
`.env.example`, `test/setup-env.ts`, `config.spec.ts`), `jsx` in `tsconfig.json`, the ported template, the `mail`
module bound to `FORGOT_PASSWORD_MAILER`, removal of the S2 no-op from `UserModule`, docs (`REPO_CONTEXT.md`).

**Out (don't add):** a plain-text part, the `react-email` dev server / `email dev` script, `react:` payloads,
`@react-email/render` as a direct dep, retries or a queue, idempotency keys, rate limiting (S8), any change to
`UserService.forgotPassword` logic or the HTTP contract, other mail types, an e2e send against real Resend,
nodemailer/handlebars (never ported).

## Module name

`mail` (M6, decided). `src/mail/`, `MailModule`, `MailService`.

---

## Phase 1 — Dependencies, env keys, JSX build, ported template

**Changes**

1. `package.json` / `pnpm-lock.yaml` — `pnpm add -E resend @react-email/components react` and
   `pnpm add -D -E @types/react` (research versions: `resend` 6.34.1, `@react-email/components` 1.0.12, `react` 19.3.1,
   `@types/react` 19.3.0). Exact pins: the snapshot depends on the renderer version (research assumption).
   `react-dom` is a peer of `@react-email/render`: add it (`-E`, 19.3.1) only if pnpm reports it missing or the
   render throws on `react-dom/server`; `@types/react-dom` is not needed (`skipLibCheck`).
2. `tsconfig.json` — modify: add `"jsx": "react-jsx"` to `compilerOptions`. `tsconfig.build.json` needs no change
   (`include ["src"]` picks up `.tsx`).
3. `package.json` `format` script — modify the globs to `"src/**/*.{ts,tsx}"` (otherwise Prettier skips the template).
4. `src/config.ts` — modify.
   - `envSchema`: add `RESEND_API_KEY` and `MAILER_MAIL` as strings that **allow `''`** (setup-env blanks them, and
     Joi rejects empty strings by default) and become required **and non-empty** when `NODE_ENV` is `production`
     (`Joi.string().allow('').when('NODE_ENV', { is: 'production', then: <required, invalid('')> })`).
     `MAILER_MAIL` is not `.email()`-validated: `Name <addr>` must pass.
   - `registerAs`: add `mailer: { email: process.env.MAILER_MAIL, resendApiKey: process.env.RESEND_API_KEY }`
     (legacy shape). Update the "Only the keys the app consumes" comment if it names stories.
5. `src/config.spec.ts` — modify: cases (a) `base` without the keys passes (`NODE_ENV=development`); (b) both `''`
   passes in development; (c) `NODE_ENV=production` without `RESEND_API_KEY` fails, same for `MAILER_MAIL`;
   (d) production with `''` fails; (e) `MAILER_MAIL: 'Budget Master <no-reply@example.com>'` passes.
6. `.env.example` — modify: add `RESEND_API_KEY=` and `MAILER_MAIL=` with a comment: optional outside production
   (missing → forgot-password logs a warning and sends nothing); `MAILER_MAIL` must be on a domain verified in Resend,
   `Name <addr>` allowed; rotate the old key.
7. `test/setup-env.ts` — modify: `process.env.RESEND_API_KEY = ''` and `process.env.MAILER_MAIL = ''`, with a
   one-line why (a developer's `.env` key would otherwise give the e2e run a live client).
8. `src/mail/templates/reset-password.tsx` — create (hand-authored; the CLI doesn't scaffold it).
   - Port `be-budgt-master` `origin/develop:emails/ResetPassword.tsx`: same props `{ url, firstName, lastName }`,
     same copy (incl. the `Reestablecer` typo in the title), same classes incl. `hover:` / `focus:`. **Only change
     (M1):** `<Head>` moves inside `<Tailwind>` (`Html > Tailwind > Head + Body`). No `import * as React` (react-jsx).
   - Also export `renderResetPassword(props): Promise<string>` = `render(<ResetPassword {...props} />)` with
     `render` from `@react-email/components` (no `pretty`). This keeps JSX out of the service and is what the
     snapshot tests: the exact HTML sent.
   - Importers use `./templates/reset-password.js` (nodenext maps it to the `.tsx`).
9. `src/mail/templates/reset-password.spec.ts` — create: see coverage below. A `.spec.ts` (the unit include is
   `**/*.spec.ts`), calling `renderResetPassword`, no JSX in the spec.

**Edge cases**
- If the render throws `cannot be inlined`, `<Head>` is still outside `<Tailwind>`: fix the tree, don't drop classes.
- React escapes `firstName` / `lastName` (user-controlled at signup); the spec pins that.

**Test coverage**
- `config.spec.ts`: the cases in 5.
- `reset-password.spec.ts`: fixed props (`url: 'http://localhost:4100/reset-password/raw.one.time'`, names) →
  `toMatchSnapshot()` (snapshot file committed); the HTML contains `href="<that url>"`, `Hola A B`, the
  `Recuperar contraseña` button text and the title; names with `<b>&` come out escaped (no raw `<b>`).

**Success criteria**
- `pnpm test config reset-password` passes; `pnpm run lint`, `pnpm run build` pass (build proves the `.tsx` compiles
  with `jsx: react-jsx`).

---

## Phase 2 — `mail` module behind `FORGOT_PASSWORD_MAILER`, failure containment, docs

**Changes**

1. `pnpm nest g mo mail` → `src/mail/mail.module.ts`, registered in `AppModule` imports (verify, keep it; harmless,
   `UserModule` also imports it). Then `pnpm nest g s mail/services/mail --flat` → `src/mail/services/mail.service.ts`
   + `.spec.ts`, registered in `MailModule`. Check generated relative imports end in `.js`.
2. `src/mail/mail.constants.ts` — create: `FORGOT_PASSWORD_SUBJECT = 'Recupera tu contraseña en Budget Master'`
   (legacy text), `MAIL_SEND_TIMEOUT_MS = 5000` (M4).
3. `src/mail/services/mail.service.ts` — populate. `@Injectable() class MailService implements ForgotPasswordMailer`
   (port types imported from `../../user/user.interface.js`).
   - Constructor: `@Inject(config.KEY) c: ConfigType<typeof config>`. If `c.mailer.resendApiKey` **and**
     `c.mailer.email` are non-empty → `this.resend = new Resend(key)`; else `this.resend = null`. Construct only when
     the key exists: `new Resend()` falls back to `process.env` and throws without a key.
   - `private readonly logger = new Logger('ForgotPasswordMailer')` (same context as the S2 no-op).
   - `async sendForgotPasswordEmail({ email, firstName, lastName, oneTimeToken }): Promise<void>`:
     - `resend === null` → `logger.warn('forgot-password mail not configured')`, return (S2 no-op, moved here, M2).
     - `url = \`${c.frontendUri}/reset-password/${oneTimeToken}\`` (D12; `FRONTEND_URI` is validated without a
       trailing slash; the JWT is URL-safe, no encoding).
     - Inside one `try`: `html = await renderResetPassword({ url, firstName, lastName })`, then
       `const { data, error } = await this.resend.emails.send({ from: c.mailer.email, to: email, subject, html },
       { signal: AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS) })`.
     - `error` → `logger.error(\`forgot-password mail failed (${error.name}, ${error.statusCode})\`)`. A timeout
       arrives here too (the aborted fetch is returned as `{ error }`).
     - Success → `logger.log(\`forgot-password mail sent (${data?.id})\`)` (Resend id, not identifying; "log the send").
     - `catch (e)` → `logger.error(\`forgot-password mail failed (${e instanceof Error ? e.name : 'unknown'})\`)`.
       Covers a render throw and the SDK's narrow abort race.
     - **Never** put `email`, names, `url`, `oneTimeToken`, `error.message` or the error object in a log line, and
       never rethrow: the method always resolves, so `UserService.forgotPassword` (no try/catch, unchanged) always
       answers 201 and a failed send can't become an enumerating 500.
4. `src/mail/mail.module.ts` — populate: `providers: [MailService, { provide: FORGOT_PASSWORD_MAILER, useExisting:
   MailService }]`, `exports: [FORGOT_PASSWORD_MAILER]`. `useExisting` keeps the e2e's
   `app.get(FORGOT_PASSWORD_MAILER, { strict: false })` + `vi.spyOn` working on the same instance `UserService` holds.
5. `src/user/user.module.ts` — modify: delete `logger`, `noopMailer`, the `FORGOT_PASSWORD_MAILER` provider and the
   now-unused imports (`Logger`, `ForgotPasswordMailer`, `FORGOT_PASSWORD_MAILER`); add `MailModule` to `imports`.
   `user.constants.ts` / `user.interface.ts` stay (the port stays in `user`, direction per E2.A4).
6. `src/user/user.module.spec.ts` — delete. It reads the no-op from `UserModule`'s provider metadata, which no longer
   exists; its assertion moves to `mail.service.spec.ts`.
7. `src/user/services/user.service.spec.ts` — modify (`forgotPassword` block): add "answers only after the send
   resolves": the mailer mock returns a pending promise, `forgotPassword` is still pending after a microtask flush,
   resolves with `sent` once the mailer's promise resolves (AC1).
8. `test/auth-users.e2e-spec.ts` — no change expected (verify it passes with the real binding and blank keys).
9. `ai-skills/REPO_CONTEXT.md` — modify: `mail/` in the structure tree (module, constants, service, `templates/`),
   config keys (`RESEND_API_KEY`, `MAILER_MAIL`, optional unless production, missing → warn + no send), the
   forgot-password row (sends via Resend, failures logged and still 201), drop "no-op mailer until S3", JSX note
   (`jsx: react-jsx`, templates are `.tsx` under `src/mail/templates`), tech stack line (resend, react-email).

**Edge cases**
- `MAILER_MAIL` set but `RESEND_API_KEY` blank (or the reverse) → no-op, not a half-configured client.
- `error.statusCode` can be `null`: the log line just prints it.
- In development the SDK itself `console.error`s `[Resend API Error]` with the full Resend error (our logger can't
  stop it; silent under `NODE_ENV=production`). Recipient addresses can appear there in Resend's testing-mode error.
  Accepted per research; see open question 2.
- A failed send leaves a stored token hash nobody received: harmless, the next request overwrites it.

**Test coverage** (`mail.service.spec.ts`, `vi.mock('resend')` so `Resend` is a mock class whose `emails.send` is a
`vi.fn()`; config passed as `{ provide: config.KEY, useValue }`; `Logger.prototype` spied)
- No key / no sender / both `''` → fixed warn `'forgot-password mail not configured'` once, `Resend` never constructed,
  resolves.
- Success → `send` called once with `{ from, to, subject: FORGOT_PASSWORD_SUBJECT, html }` and an options object with
  `signal: expect.any(AbortSignal)`; `html` contains `href="http://localhost:4100/reset-password/raw.one.time"`;
  resolves; one `log` line.
- `{ data: null, error: { name: 'validation_error', statusCode: 403, message: '… secret@example.invalid …' } }` →
  resolves; one `error` line containing the name and status.
- `send` rejects (`new TypeError(...)`) → resolves; one `error` line with `TypeError`.
- Every case: no log call (`log`/`warn`/`error`, all args stringified) contains the email, names, token, URL or
  Resend `message`.
- `user.service.spec.ts`: the ordering case in 7.
- e2e (existing): app boots with blank mail keys (AC5); forgot/reset flow still passes through the real binding.

**Success criteria**
- Automatic: `pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e` all pass.
- Manual (orchestrator; local server on the **prod DB** with the owner's legacy `.env` copied in as `.env` (with the `MONGO_HOST` S1 needs, as in S2's manual check), which has
  `RESEND_API_KEY`, `MAILER_MAIL` on the expired `budget-master.space` and `NODE_ENV=development`). Proves the
  "failed send → logged safely, still 201" path. Let `TS=$(date +%s)`, `EMAIL=e2e-manual-$TS@example.invalid`.
  1. `pnpm run build && pnpm run start:prod` (also proves the emitted `react/jsx-runtime` import runs under Node ESM)
     → boots, no `Config validation error`.
  2. `POST /users` `{ email: $EMAIL, password: 'Manual-1234', firstName: 'Manual', lastName: 'Check', middleName: '' }`
     → 201 `'User created'`.
  3. `POST /users/forgot-password` `{ email: $EMAIL }` → 201, body `{ …, message: 'Email Sent', data: null }`.
     Server log: exactly one `[ForgotPasswordMailer] forgot-password mail failed (<name>, <status>)` line (expected
     403 unverified domain or 422 for the `.invalid` recipient). That line has no `$EMAIL`, no `Manual`/`Check`, no
     `reset-password`, no token. The SDK's own `[Resend API Error]` console line may appear (development): note it,
     it is not ours.
  4. `POST /users/forgot-password` `{ email: e2e-manual-$TS-unknown@example.invalid }` → same 201 body, **no**
     `ForgotPasswordMailer` log line.
  5. Clean-up (same phase, D16): `POST /auth` `{ email: $EMAIL, password: 'Manual-1234' }` → 201 + `accessToken`
     cookie; `DELETE /users` with that cookie → 200 `'User deleted.'`; `POST /auth` again → 401. Stop the server
     and remove the copied `.env` if it was copied for the check.
  6. **Optional, only if the owner provides a verified sender:** set `MAILER_MAIL` to it, sign up an inbox the owner
     controls (e.g. a `+bm-manual-$TS` alias), forgot-password → log `forgot-password mail sent (<id>)`; the mail has
     subject `Recupera tu contraseña en Budget Master`, Spanish copy, and the button links to
     `${FRONTEND_URI}/reset-password/<token>`. Then delete that user as in step 5.

---

## AC → phase mapping

| AC | Validated by |
|---|---|
| 1. 201 `'Email Sent'` only after the send resolves/fails/times out; unknown email same, no send | P2 `user.service.spec` ordering case + existing unknown-email unit/e2e cases (automatic); P2 manual 3–4 |
| 2. Failed send (`{ error }`, throw, timeout) logged with fixed text + safe fields only, still 201 | P2 `mail.service.spec` error/throw cases + log-content assertions (automatic); P2 manual 3 (manual, real Resend failure through HTTP) |
| 3. `from = MAILER_MAIL`, `to`, subject, button → `${FRONTEND_URI}/reset-password/<raw token>` | P2 `mail.service.spec` success case (automatic); P1 template spec href (automatic); P2 manual 6 (optional, real delivery) |
| 4. Unit tests with mocked Resend (success, `{ error }`, throw) + HTML snapshot | P2 `mail.service.spec` + P1 `reset-password.spec` snapshot (automatic) |
| 5. Boots and lint/build/unit/e2e pass with no `RESEND_API_KEY` | P1 `config.spec` + P2 no-key unit case + e2e run with blank keys (automatic) |

## AC Coverage Summary

| AC | Phase | Check | Coverage |
|---|---|---|---|
| 1 | 2 | automatic + manual | full |
| 2 | 2 | automatic + manual | full (timeout covered as the `{ error }` path it returns; no real 5 s timeout is induced) |
| 3 | 1, 2 | automatic (+ optional manual) | full for the payload; **partial** for real delivery to an inbox until the owner verifies a sender |
| 4 | 1, 2 | automatic | full |
| 5 | 1, 2 | automatic | full |

## Decisions (beyond the research)

- The no-op lives inside `MailService` (null client → the S2 warn), bound with `useExisting`, instead of a factory
  choosing between two providers. Same behaviour, one class, and the e2e spy keeps working.
- `user.module.spec.ts` is deleted; its assertion moves to `mail.service.spec.ts`.
- A success log line with the Resend id (`forgot-password mail sent (<id>)`), from the story's "log the send".
- Failure containment lives only in the adapter; `UserService.forgotPassword` is unchanged.
- Exact-pinned deps; `react-dom` added only if needed; `format` globs extended to `.tsx`.
- `MailModule` stays in `AppModule` imports as the CLI writes it (redundant with `UserModule`'s import, harmless).

## Assumptions

- `resend@6` `emails.send(payload, { signal })` returns aborted/HTTP failures as `{ error }` (research, from the
  tarball); a timeout is therefore tested as the `{ error }` path.
- `render` from `@react-email/components` resolves its nested `@react-email/render` under pnpm (we import it from
  `components`, whose own deps are visible to it).
- `react/jsx-runtime` named imports work from the built ESM output (checked by manual step 1).
- The legacy `.env` keeps `NODE_ENV=development`, so the manual run does not require the keys and shows the SDK's
  console line.

## Implementation checklist

**Phase 1**
- [x] 1. `resend` 6.34.1, `@react-email/components` 1.0.12, `react` 19.3.1, `@types/react` 19.3.0 (dev), exact. `react-dom` not added: pnpm auto-installs it as the peer of `@react-email/render` (19.3.1 in the lockfile) and the render works from `dist/` under plain Node.
- [x] 2. `tsconfig.json` `jsx: react-jsx`.
- [x] 3. `format` globs `src/**/*.{ts,tsx}`.
- [x] 4. `envSchema` `RESEND_API_KEY` / `MAILER_MAIL` (blank allowed, required + non-empty in production); `registerAs` `mailer`. Joi's `then:` needed an `oxlint-disable-next-line unicorn/no-thenable` (false positive on Joi's API).
- [x] 5. `config.spec.ts` mail-key cases.
- [x] 6. `.env.example`.
- [x] 7. `test/setup-env.ts` blanks both keys.
- [x] 8. `src/mail/templates/reset-password.tsx` (+ `renderResetPassword`). Confirmed: legacy order (`<Head>` outside `<Tailwind>`) throws `…classes that cannot be inlined: hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 focus:outline-none`; `<Head>` inside renders, hover CSS lands in `<head>`.
- [x] 9. `reset-password.spec.ts` + committed snapshot.
- [x] Success criteria: `pnpm test config reset-password`, lint, build.

**Phase 2**
- [x] 1. `nest g mo mail` (in `AppModule`), `nest g s mail/services/mail --flat`; imports end in `.js`.
- [x] 2. `mail.constants.ts`.
- [x] 3. `MailService`.
- [x] 4. `MailModule` (`useExisting`).
- [x] 5. `UserModule`: no-op removed, imports `MailModule`.
- [x] 6. `user.module.spec.ts` deleted.
- [x] 7. `user.service.spec.ts` ordering case (fails if the send isn't awaited — checked by mutation).
- [x] 8. `test/auth-users.e2e-spec.ts` unchanged, passes.
- [x] 9. `REPO_CONTEXT.md`.
- [x] Automatic: lint, build, unit, e2e. Plus `node dist/main.js` with blank mail keys on an in-memory replica set: boots, forgot-password 201 + fixed warn.
- [ ] Manual 1–5 (real legacy env / prod DB): left to the orchestrator.
- [ ] Manual 6 (optional, verified sender): skipped by the owner.
