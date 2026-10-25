# accounts research notes (2026-10-25)

- Legacy `/account-actions` PUT on a foreign account → 400, DELETE → 401, same text `'Account does not belong to the user'`. Kept: no client reads HTTP status (old-next BFF maps every error to 400).
- Records-side legacy lookup (`findAccountByIdForRecords`) is 404 `'Account not found'` / 401; the transfer route wraps both in 400.
- S7's record module imports the account module for balance helpers, so the account-delete cascade can't live behind `AccountModule → RecordModule`: it's a port token S7 provides another way.
- old-next sends account mutations to `/account-actions/` (trailing slash) and always sends `accountProvider` + `terminationFourDigits` (random 4 digits if blank). FE_Budget_Master echoes every GET field into PUT: don't add response fields.
