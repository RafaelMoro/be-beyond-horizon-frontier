# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Budget Master backend, NestJS 12 + TypeScript 6, ESM (`"type": "module"` — relative imports end in `.js`). It has the S1 foundation (`@nestjs/config` + Joi, MongoDB via mongoose, response envelope, global error filters, ValidationPipe, CORS, cookie-parser, e2e harness) and S2 auth + users (`src/user`, `src/auth`: global JWT guard, `@Public()` opt-out); no budget feature modules or OpenAPI docs yet. `.env` points at the prod DB, see `.env.example`. Package manager is **pnpm**.

_(planned)_ This is the rewrite of the legacy backend `be-budgt-master` (sibling checkout `../be-budgt-master`) (MongoDB/mongoose, JWT cookie auth, AWS Lambda). The existing frontend's HTTP contract must keep working, so no breaking API changes. The plan and progress live outside the repo, in `~/projects/notes/budget-master/be-refactor.md` (local notes, not in this repo).

## Shared AI context

`ai-skills/` is the single source of truth for agent tooling, shared by every tool:

- `ai-skills/REPO_CONTEXT.md` — architecture, modules, routes. Read it before non-trivial work; update it when modules land.
- `ai-skills/IMPLEMENTATION_GUIDELINES.md` — module/service/controller conventions, naming, testing, error handling. Read it before writing code.
- `ai-skills/<skill>/SKILL.md` — skills. `.claude/skills/` (and `.opencode/skill/`, `.opencode/command/`) are symlinks into this folder. Edit only the `ai-skills/` copy.

## Commands

```bash
pnpm run start:dev              # watch mode
pnpm run build                  # nest build → dist/
pnpm run lint                   # oxlint src/ test/ (no --fix)
pnpm run format                 # prettier --write src/ test/
pnpm test                       # vitest run (unit specs)
pnpm test app.controller        # single test file by path filter
pnpm test -t "should return"    # single test by name
pnpm run test:e2e               # vitest run --config ./vitest.config.e2e.ts
pnpm run test:cov               # coverage → coverage/
pnpm run package:lambda         # build + .lambda/api.zip + its self-checks (no AWS)
pnpm run offline:lambda         # serverless-offline, --stage local (needs a local Mongo replica set on 127.0.0.1:27017)
```

Deploys (`pnpm run deploy:lambda --stage <beta|production>`) are the owner's only; see the Owner runbook in `ai-skills/REPO_CONTEXT.md`.

Unit tests use `vitest.config.ts` (`**/*.spec.ts`, co-located in `src/`); e2e uses `vitest.config.e2e.ts` (`**/*.e2e-spec.ts`, in `test/`). Both set `globals: true`. Lint rules live in `oxlint.json`, formatting in `.prettierrc`.

## Branching & release

- PRs target `main`. Every PR needs a `major`, `minor` or `patch` label (`check-label.yml` fails without one).
- `ci.yml` runs `pnpm run lint`, `pnpm run build`, `pnpm run package:lambda`, `pnpm test` and `pnpm run test:e2e` (against a docker Mongo replica set) on PRs to and pushes to `main`, plus a gitleaks secret scan over the full history.
- On merge to `main`, `update-changelog.yml` bumps `package.json` per the label, prepends the PR to `CHANGELOG.md`, commits, tags `vX.Y.Z` and pushes. Don't bump the version or edit the changelog by hand.
