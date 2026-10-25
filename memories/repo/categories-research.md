# categories research notes (2026-10-25)

- Legacy `@Prop({ type: Types.ObjectId, ref: ... })` on a class through `@nestjs/mongoose` `SchemaFactory` becomes a **`Mixed`** path (checked in legacy node_modules; a plain `new Schema` gives `ObjectId`). That is why prod stores `categories.sub`, `accounts.sub` and records' `account` as strings and records' `category` mixed: legacy never cast them. db-checks' "string query returns 0" used a plain-schema ObjectId, not legacy runtime.
- `categories.sub` is a string in all 133 prod docs: declare `String`, query with `req.user.sub`.
- create-local: store the found user's `_id.toString()`, not the raw body `sub` (upper-case hex passes `findById` but never matches GET).
- Two concurrent "no categories → insertMany" seeds don't write-conflict inside transactions; they can both commit.
