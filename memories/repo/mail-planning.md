# mail planning notes (2026-10-25, draft)

- The S2 no-op moves into `MailService` (null Resend client when `RESEND_API_KEY` or `MAILER_MAIL` is blank); `MailModule` binds `FORGOT_PASSWORD_MAILER` with `useExisting: MailService`, so the e2e `app.get(FORGOT_PASSWORD_MAILER, { strict: false })` spy still works.
- Joi `string()` rejects `''`: the mail keys need `.allow('')` because `test/setup-env.ts` blanks them (deleting them would let `.env` fill them in).
- The adapter never rejects; `UserService.forgotPassword` has no try/catch, so a throwing mailer would be an enumerating 500.
- `renderResetPassword` lives in the `.tsx` template so services and specs stay `.ts`.
