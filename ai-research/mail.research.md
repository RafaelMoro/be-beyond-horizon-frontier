# Research: S3 — mail (real forgot-password email)

**Branch:** `feat/mail` (stacked on `feat/auth-users`, PR #4) · **Date:** 2026-10-25 · **Type:** single story, full research

Sources: `~/projects/notes/budget-master/be-refactor.md` (S3, ground rules, D12, D18, E2.A4/A5, Security findings),
`be-refactor-survey.md` §3.1/§3.3/§5.5, `be-refactor-survey-develop.md` (#66). Legacy contract = `be-budgt-master`
**`origin/develop`** (`emails/ResetPassword.tsx`, `src/mail/*`, `src/users/services/users.service.ts:166-206`,
`src/constants.ts`, `src/config.ts`, `package.json`). Package facts from the npm registry and the published
tarballs of `resend@6.34.1`, `@react-email/render@2.0.6`, `@react-email/tailwind@2.0.7`.

## Story

Replace S2's no-op `FORGOT_PASSWORD_MAILER` with a real send: one Resend client behind the existing port,
the legacy react-email `ResetPassword` template (same subject, Spanish copy), link
`${FRONTEND_URI}/reset-password/<token>` (D12, no hardcoded domain per D18). The send is awaited; a failure is
logged without the token, the URL or the email, and the route still answers 201 `'Email Sent'`. Drop
nodemailer/handlebars (they were never ported, so nothing to remove here).

## Acceptance criteria

1. `POST /users/forgot-password` for a known user answers 201 `'Email Sent'` (`data: null`) only after the send
   has resolved (or failed / timed out); an unknown email answers the same without sending.
2. A failed send (Resend `{ error }`, a thrown error, or a timeout) is logged with a fixed message plus
   non-identifying fields only (no token, no reset URL, no recipient, no names, no Resend `message` text), and the
   response is still 201 `'Email Sent'`.
3. The mail sent has `from = MAILER_MAIL`, `to = user.email`, subject `'Recupera tu contraseña en Budget Master'`,
   and HTML whose button links to `${FRONTEND_URI}/reset-password/<raw token>`.
4. Unit tests of the mail implementation with a mocked Resend client (success, `{ error }`, throw), plus a snapshot
   of the rendered HTML for fixed props.
5. App boots, and lint/build/unit/e2e pass, with no `RESEND_API_KEY` (CI, tests).

## Legacy behaviour (origin/develop)

- `MailService.sendUserForgotPasswordEmail` (`src/mail/mail.service.ts:17-34`): `new Resend(RESEND_API_KEY)` **per
  call**; `await resend.emails.send({ from: MAILER_MAIL, to: email, subject: 'Recupera tu contraseña en Budget Master',
  react: React.createElement(ResetPassword, { url, firstName, lastName }) })`; `console.log('res', res)`; any throw →
  `BadRequestException(error.message)`. URL = hardcoded `PROD_URI` (`https://next.budget-master.space`) +
  `/reset-password/<token>`; `hostname`/`FRONTEND_URI`/`FRONTEND_PORT` are computed and ignored.
- Template `emails/ResetPassword.tsx` (outside `src`, `jsx: "react"` in tsconfig): default export
  `EmailForgotPassword({ url, firstName, lastName })`. `Html > Head(title 'Reestablecer contraseña para su cuenta en
  Budget Master') + Tailwind > Body > Container`: h1 `Hola {firstName} {lastName}`, h2 `¿Olvidaste tu contraseña? Te
  ayudamos a recuperarla`, text, `Row/Column` with `Link href={url}` "Recuperar contraseña" (Tailwind button classes
  incl. `hover:` / `focus:`), footer text. Spanish copy and the "Reestablecer" typo are verbatim legacy.
- Config: `mailer: { email: MAILER_MAIL, resendApiKey: RESEND_API_KEY }`, neither validated; `RESEND_API_KEY` is
  missing from legacy `.env-example`.
- Versions: `resend ^4.5.2`, `@react-email/components 0.0.41`, `react`/`react-dom 19.1.0`, `react-email 4.0.16`
  (dev server, `email dev` script).

## Current code (S2, in the tree)

- Port: `src/user/user.interface.ts` — `ForgotPasswordMail { email, firstName, lastName, oneTimeToken }`,
  `ForgotPasswordMailer { sendForgotPasswordEmail(mail): Promise<void> }`. Token `FORGOT_PASSWORD_MAILER` (Symbol) in
  `src/user/user.constants.ts`.
- `src/user/user.module.ts`: provides `{ provide: FORGOT_PASSWORD_MAILER, useValue: noopMailer }` (logs a fixed
  `warn` `'forgot-password mail not configured'`). `src/user/user.module.spec.ts` tests that no-op by reading the
  module's `providers` metadata — it breaks if the provider moves or changes shape.
- `UserService.forgotPassword` (`src/user/services/user.service.ts:142-167`): unknown email → return; known → sign
  token, store `hashToken(token)`, `await this.mailer.sendForgotPasswordEmail({...raw token})`, return the envelope.
  **No try/catch**: a mailer that throws today becomes a 500 via `CatchAllExceptionFilter` (500 only for registered
  emails = enumeration). AC2 needs the throw contained, in the adapter or the service.
- `user.service.spec.ts` mocks the port (`{ sendForgotPasswordEmail: vi.fn() }`). `test/auth-users.e2e-spec.ts:348-353`
  gets the provider with `app.get(FORGOT_PASSWORD_MAILER, { strict: false })` and `vi.spyOn(…, 'sendForgotPasswordEmail')`
  — the real provider must be an object with that method resolvable by that token.
- Config (`src/config.ts`): `FRONTEND_URI` is already required and Joi-validated as an `http(s)` URI **without a
  trailing slash** → `${FRONTEND_URI}/reset-password/<token>` is safe. No mail keys yet. `test/setup-env.ts` sets
  `FRONTEND_URI=http://localhost:4100` and no mail keys.
- Build: `nest build` = tsc with `tsconfig.build.json` (`rootDir ./src`, `include ["src"]`), so a template must live
  under `src/`. `tsconfig.json` has no `jsx`; a `.tsx` under `src` fails the build (TS17004) until it is set.
  `format` script only globs `*.ts` (a `.tsx` would not be prettier-formatted). oxlint lints `.tsx`.
  Installed: TypeScript 6.0.3, @nestjs/cli 12.0.10, Vite 8.3.5, Vitest 4.1.12 (Vite transforms `.tsx` and reads the
  tsconfig `jsx` setting).

## Dependencies (registry, 2026-10-25)

| Package | Latest | Notes |
|---|---|---|
| `resend` | 6.34.1 | Node ≥ 20, ESM + CJS. Peer `@react-email/render: *` |
| `@react-email/components` | 1.0.12 | Peer `react ^18 \|\| ^19`. Pins `@react-email/render 2.0.6`, `@react-email/tailwind 2.0.7` (pulls `tailwindcss ^4`), also `code-block` (prismjs) and `markdown` (marked), all loaded by its barrel import |
| `@react-email/render` | 2.1.1 (2.0.6 via components) | Peers `react`, `react-dom ^18 \|\| ^19`. Statically imports `prettier/standalone` + html plugin and `html-to-text`; lazy-imports `react-dom/server` |
| `react` / `react-dom` | 19.3.1 | `@types/react` 19.3.0 for TS |

All are ESM-compatible under `nodenext`; nothing Nest-specific, so no Nest 12 conflict. Unpacked sizes (Lambda, S9):
react-dom ~8 MB, prettier ~10 MB (only `standalone` + html plugin are loaded), tailwind component ~0.7 MB single
file, resend ~0.4 MB — far below Lambda's 250 MB, but they add cold-start import time.

### Resend SDK v6 behaviour (from the tarball)

- `new Resend(key)`: with no key it falls back to `process.env.RESEND_API_KEY` and **throws** `Missing API key` if
  absent → the client can't be constructed in CI/tests without a key.
- `emails.send(payload, { signal?, idempotencyKey?, headers? })`. HTTP errors and network failures (including an
  aborted `fetch`) are **returned** as `{ data: null, error: { name, statusCode, message } }`, not thrown. It throws
  only on render failure (`react:` given and `@react-email/render` not importable or throwing) and in a narrow abort
  race while reading the body. **No default timeout** (undici defaults, minutes); `signal: AbortSignal.timeout(ms)`
  is the only knob. API Gateway caps the request at 29 s.
- With `react:`, the SDK dynamic-imports `@react-email/render` **from its own location**. Under pnpm's strict layout
  that resolves only if `@react-email/render` is a direct dependency (the nested copy inside `components` is not
  visible). Passing `html:` (rendered in our code) avoids this and makes the snapshot test the exact HTML sent.
- `logError` does `console.error('[Resend API Error]:', { status, error, path })` whenever
  `NODE_ENV !== 'production'`. Resend error `message`s can contain addresses (e.g. the testing-mode "you can only
  send testing emails to your own email address (…)" error). Our logger rule can't stop this: in dev/test it bypasses
  it; in prod (`NODE_ENV=production`) it is silent.

### react-email Tailwind 2.0.7 constraint (affects "verbatim")

`<Tailwind>` throws `You are trying to use the following Tailwind classes that cannot be inlined: …` when the tree
uses non-inlinable classes (`hover:bg-blue-800`, `focus:ring-4`, `focus:ring-blue-300`, `focus:outline-none`) and
there is **no `<head>` inside `<Tailwind>`**. The legacy template puts `<Head>` **outside** `<Tailwind>`, so ported
byte-for-byte it would throw on every render (likely legacy prod failed the same way with a 400 — not verified). A
working port needs either `<Head>` moved inside `<Tailwind>` or the hover/focus classes dropped (they do nothing in
most mail clients). Copy, subject, structure and visible styling can stay identical either way. Tailwind also
compiles CSS at render time (per send) — a cost on Lambda, not a correctness issue.

## Options for JSX in this repo (facts for planning)

| Option | Build | Tests | Runtime deps | Fidelity |
|---|---|---|---|---|
| A. `.tsx` template under `src/`, `jsx: "react-jsx"` in `tsconfig.json` | tsc emits `react/jsx-runtime` imports (ESM-fine); one tsconfig key, project-wide | Vite handles `.tsx` natively | react, react-dom, @react-email/* | closest to legacy file |
| B. `.ts` with `React.createElement` | no tsconfig change | same | same | same output, unreadable template, not a "port" |
| C. Precompiled/static HTML + string interpolation | extra build/codegen step or a committed artefact | snapshot trivial | none of react | must hand-escape `firstName`/`lastName` (user-controlled, set at signup) — React escapes them today |

A and B cost the same at runtime; C is the only one that cuts the Lambda bundle, at the cost of escaping and a
second source of truth. `react-email` (dev server) is not needed to build or send.

## Env

| Key | Legacy | Use | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | read, not validated, not in `.env-example` | Resend client | CI/tests have none; the SDK throws on construct without it |
| `MAILER_MAIL` | read, not validated | `from` | Resend accepts `x@domain` or `Name <x@domain>`; Joi `.email()` would reject the second form. Owner's value format unknown |
| `FRONTEND_URI` | read, ignored for the link | link base (D12) | already required + validated (S1) |

`@nestjs/config` only copies `.env` keys **not already in `process.env`** (`key in process.env`). `test/setup-env.ts`
overwrites a fixed list that has no mail keys, so a developer whose `.env` has `RESEND_API_KEY` would run the e2e
suite with a live client (the current e2e spies stub the method, but any un-spied path would send real mail).

## Integration points and constraints

- Module: legacy had `MailModule` (`src/mail`) exported to `UsersModule`. Binding the real implementation to
  `FORGOT_PASSWORD_MAILER` from a mail module means `UserModule` imports it and the mail side imports the port types
  from `src/user/user.interface.ts` (direction fixed by S2/A4). `user.module.spec.ts` must follow the no-op wherever it
  lands.
- Logging rule (`IMPLEMENTATION_GUIDELINES.md` → Logging rule): no emails, tokens, URLs. Safe fields from a failure:
  Resend `error.name`, `error.statusCode`, a thrown error's `name`. `message` is not safe (see above).
- Lambda freezes after the response: background (fire-and-forget) sends can be lost — this is legacy bug §5.5 that
  #66 fixed by awaiting. AC1 keeps it awaited, so latency = Resend round trip; a timeout bounds the worst case.
- **Timing oracle:** awaiting the send makes known-email responses measurably slower than unknown-email ones
  (unknown returns after one `findOne`). This partly reopens the "forgot-password reveals registered emails" finding
  that S2 closed for the body/status. Mitigations (rate limit) are S8; the audit row says "S8 (S3 for mail)".
- Failed send leaves a stored token hash the user never received — harmless, the next request overwrites it.
- Ops (D18, not code): `budget-master.space` expired, so a `MAILER_MAIL` on it will be rejected by Resend (unverified
  domain, 403). The owner must verify the new `beyond-horizon-frontier` domain (SPF/DKIM DNS) in Resend, set
  `MAILER_MAIL` to an address on it, and set `FRONTEND_URI` to the client that serves `/reset-password/<token>`
  (old-next on Vercel). The leaked-secrets rotation (audit Critical) does not cover `RESEND_API_KEY`, but it lived in
  the same `.env` deploy flow (D5) — worth rotating too.

## Open questions (with recommendation)

1. **Template "verbatim" vs Tailwind's head rule.** Recommend: move `<Head>` inside `<Tailwind>`, keep every class
   and all copy. Alternative: drop the four hover/focus classes.
2. **Env when the key is missing.** Recommend: `RESEND_API_KEY` and `MAILER_MAIL` optional strings in `envSchema`,
   required when `NODE_ENV=production`; when either is missing, bind the existing no-op (fixed warn) instead of the
   Resend client. `test/setup-env.ts` blanks both so a local `.env` key never reaches tests.
3. **JSX approach.** Recommend option A (`.tsx` under `src/`, `jsx: "react-jsx"`), render to HTML in our code and send
   `html:` (no `react:`), so pnpm resolution and the snapshot are simple. Option C only if the S9 bundle/cold start
   turns out to matter.
4. **Timeout value.** Recommend `AbortSignal.timeout(5000)` on the send — well under API Gateway's 29 s.
5. **Timing oracle.** Recommend accepting it in S3 (AC1 requires awaiting) and covering it with S8's rate limit;
   record it in the security table.
6. **Module name.** Recommend `mail` (legacy name, `src/mail/`), providing `FORGOT_PASSWORD_MAILER` and exported
   to `UserModule`.

## Assumptions

- The owner's `MAILER_MAIL` may be `Name <addr>`; validate it as a non-empty string, not as an email.
- No plain-text part: legacy sent HTML only (`react:`), so parity doesn't need `text:`.
- The live client (old-next) serves `/reset-password/<token>` on whatever `FRONTEND_URI` is in prod (D12 decided it).
- The snapshot will change on `@react-email/*` / tailwind upgrades; that is expected (pin exact versions as legacy did).
- No e2e send against real Resend; e2e keeps stubbing the port.
