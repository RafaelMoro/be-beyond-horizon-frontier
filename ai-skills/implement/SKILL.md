---
name: implement
description: 'Use when the user wants to implement, build, code, or execute an approved plan. Triggers on implement, build, code, execute plan.'
---

# Implementation workflow

> Source of truth: `ai-skills/implement/SKILL.md`. Edit only that file — the copies under `.claude/skills/`, `.opencode/skill/`, and `.opencode/command/` are symlinks to it.

You are running the **implementation phase** for a story or task. Input is an approved planning document; output is completed code and a concise report.

## Inputs

- A planning doc path, e.g. `ai-planning/{story-name}.planning.md`
- If none is provided, list available `ai-planning/*.planning.md` files and ask which one to implement

## Steps

1. Read in order:
   - The specified planning document
   - `ai-skills/REPO_CONTEXT.md`
   - `ai-skills/IMPLEMENTATION_GUIDELINES.md`
   - `CLAUDE.md`
   - Relevant `memories/repo/*-planning.md`
2. Confirm the plan is ready:
   - Plan exists
   - Open questions are resolved or explicitly deferred
   - User approved implementation, or invoked `/implement`
   - Branch is correct, or ask whether to create one
3. Execute phase by phase:
   - Make only the file changes specified in the plan
   - Run the phase's automated success criteria
   - Fix failures before moving on
   - Update the implementation checklist in the planning doc
   - Stop after each phase and present the phase result for user sign-off
   - Do not start the next phase unless the user explicitly says to continue
   - If the user explicitly said run-all or continue through all phases, continue without stopping between phases
4. Apply repo conventions while implementing.
5. Before declaring done:
   - Update `ai-skills/REPO_CONTEXT.md` if code structure changed
   - Run `pnpm run lint`, `pnpm run build` and `pnpm test` — the same three checks `ci.yml` gates every PR on
   - Run `pnpm run test:e2e` when routes or module wiring changed
   - Ensure the planning checklist is complete

## Required Discipline

- Do not remove existing `console.log`, `console.warn`, or `console.error` statements unless the plan explicitly says so.
- If the plan conflicts with repo conventions, stop and ask.
- Silence console output in tests with spies when needed; do not remove source logging.
- User sign-off is required between phases by default. Treat silence or ambiguity as "stop and wait".

## Optional Memory

If implementation surfaces a follow-up that should not block the task, write `memories/repo/{story-name}-followup.md` and mention it in the final summary.

## Final Response

End with:

1. Files created, modified, or deleted
2. Test/build status
3. Whether `REPO_CONTEXT.md` was updated
4. Deferred follow-ups

Do **not** create a PR, push, or force-push unless explicitly asked.

## Don'ts

- Don't start without an approved planning doc.
- Don't skip required tests.
- Don't bypass safety checks.
- Don't push or open PRs without explicit approval.
- Don't add features beyond the plan.
