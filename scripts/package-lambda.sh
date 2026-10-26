#!/usr/bin/env bash
# Builds .lambda/api.zip (serverless.yml's package.artifact) and checks it. No AWS. Run from the repo root.
# Staging dir gets only dist/ + package.json + lockfile (never `cp .`: keeps .env, src, test out), then a hoisted
# production install of the same lockfile: flat node_modules, no symlinks into .pnpm.
set -euo pipefail

for cmd in pnpm node python3; do
  command -v "$cmd" >/dev/null || { echo "package-lambda: '$cmd' is required" >&2; exit 1; }
done

fail() { echo "package-lambda: $*" >&2; exit 1; }

pnpm run build

rm -rf .lambda
mkdir -p .lambda/app
cp -R dist package.json pnpm-lock.yaml .lambda/app/
rm -rf .lambda/app/dist/scripts
find .lambda/app/dist \( -name '*.map' -o -name '*.d.ts' -o -name '*.tsbuildinfo' \) -delete

(
  cd .lambda/app
  pnpm install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted
  rm -rf pnpm-lock.yaml node_modules/.bin node_modules/.modules.yaml node_modules/.pnpm
  # Inert inside third-party packages, but the package must contain no .env* at all.
  find . -name '.env*' -exec rm -rf {} +
)

(
  cd .lambda/app
  python3 -I -m zipfile -c ../api.zip dist node_modules package.json
)

listing=$(python3 -I -c 'import sys, zipfile; print("\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))' .lambda/api.zip)
grep -Eq '(^|/)\.env' <<<"$listing" && fail 'zip contains a .env* entry'
grep -Eq '^(src|test|dist/scripts)/' <<<"$listing" && fail 'zip contains src/, test/ or dist/scripts/'
grep -qx 'package.json' <<<"$listing" || fail 'zip has no package.json'
grep -qx 'dist/lambda.js' <<<"$listing" || fail 'zip has no dist/lambda.js'

# Node-ESM load of the unzipped package with its own node_modules, a dummy env (CI's) and no .env. Import only.
mkdir -p .lambda/check
python3 -I -m zipfile -e .lambda/api.zip .lambda/check
(
  cd .lambda/check
  env -i PATH="$PATH" \
    MONGO_URI=mongodb://127.0.0.1:1 MONGO_DB_NAME=boot-check NODE_ENV=test \
    JWT_KEY=boot-check-jwt ONE_TIME_JWT_KEY=boot-check-one-time \
    FRONTEND_URI=http://localhost:4100 TEST_FRONTEND_URI=http://localhost:4101 DOMAIN_URI=http://localhost:4102 \
    node --input-type=module -e "const m = await import('./dist/lambda.js'); if (typeof m.handler !== 'function') process.exit(1)"
) || fail 'unzipped package does not load under Node ESM'

echo "zip: $(du -h .lambda/api.zip | cut -f1), unzipped: $(du -sh .lambda/check | cut -f1)"
rm -rf .lambda/check
echo ok
