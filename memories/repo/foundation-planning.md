# foundation planning notes (2026-10-25, approved)

- CI replica set: `docker run mongo:8 --replSet rs0` + `rs.initiate` with member host `localhost:27017`. The port is mapped, so that host resolves on the runner too, and no `directConnection=true` is needed.
- Prod-DB guard (`assertTestMongoUri`, host allow-list) lives in `src/mongoose-options.ts`. It runs in the Mongoose factory whenever `VITEST` is set or `NODE_ENV=test`, and also in `test/create-test-app.ts` before `compile()`. It's keyed on the host, not `NODE_ENV`, because the owner's prod `.env` doesn't set `NODE_ENV=production`.
- `closeTestApp` drops the DB only if its name is `budget-master-e2e`.
- `autoIndex` is on only when `NODE_ENV=test`, because `start:dev` hits prod. Prod indexes come from the S8 script.
- The catch-all maps CastError/BSONError/ValidationError → 400 and E11000 → 409, with sanitized bodies. E11000 messages contain emails, so never log them.
- Services never `throw new BadRequestException(e.message)`. Route-specific legacy texts (signup `'Try with other email.'`, reset-password jsonwebtoken → 400 + message) belong in that route's story.
- Filters log the route pattern (`req.route?.path`), never the URL: reset-password URLs carry a token.
- pnpm 10 skips `mongodb-memory-server`'s postinstall, so the binary downloads on first use (CI never uses it).
