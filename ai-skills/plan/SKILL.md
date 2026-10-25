---
name: plan
description: 'Use when the user asks to plan an implementation, create a plan, or convert research into an implementation plan. Triggers on plan, planning, implementation plan, story plan.'
---

# Planning workflow

> Source of truth: `ai-skills/plan/SKILL.md`. Edit only that file — the copies under `.claude/skills/`, `.opencode/skill/`, and `.opencode/command/` are symlinks to it.

You are running the **planning phase** for a story or task. Input is a completed research document; output is an actionable implementation plan.

## Inputs

- A research doc path, e.g. `ai-research/{story-name}.research.md`
- If none is provided, list available `ai-research/*.research.md` files and ask which one to plan

## Steps

1. Read in order:
   - The specified research document
   - `ai-skills/REPO_CONTEXT.md`
   - `ai-skills/IMPLEMENTATION_GUIDELINES.md`
   - `CLAUDE.md`
   - Relevant `memories/repo/*-research.md`
2. Confirm the research is plan-ready:
   - Open questions are resolved or explicitly deferred with assumptions
   - Acceptance criteria are unambiguous and actionable
3. If anything is unresolved, ask the user before proceeding. Do not guess.
4. Keep scope strict. Every planned item must trace to:
   - A specific acceptance criterion
   - A direct technical prerequisite of an AC
   - A repo convention
   - A research finding the user accepted
5. Define independently testable phases.
6. For each phase, specify changes without writing full implementations:
   - Exact file path
   - Action: create, modify, delete
   - Line range or placement guidance for modifications
   - Function signatures, key logic, and critical conditionals
   - Non-obvious edge cases
   - Short rationale only when useful
   - **Respect the scaffolding convention in `ai-skills/IMPLEMENTATION_GUIDELINES.md`:** when a phase introduces a new NestJS module, service, or controller, plan it as a Nest CLI generation step (`nest g mo <name>`, `nest g s <name>/services/<name>`, `nest g co <name>/controllers/<name>`) rather than a manual file "create". Note that `nest g mo` also registers the module in `AppModule`, so downstream root-registration steps become a **verify**, not a hand edit. Mark the remaining files the CLI does not scaffold (entities, DTOs, constants, interfaces, utils) as hand-authored "create"/"populate" actions.
7. Specify success criteria per phase:
   - Exact automated commands using `pnpm` — only scripts that exist in `package.json` (`pnpm run lint`, `pnpm run build`, `pnpm test`, `pnpm run test:e2e`)
   - Manual verification steps when applicable
   - Only prescribe credentials, environment files, scripts, routes and guards that exist in the repo (or that an earlier phase of this plan creates). Don't invent a `.env`, a seed user or an auth header.
8. Map every acceptance criterion to the phase(s) that validate it, and say whether each check is **automatic** (a spec or command) or **manual** (a request, an inspection). Mark an AC covered only in part as **partial** and name what is missing.
9. If a phase validates an endpoint by creating records, the same phase deletes them. If the delete path doesn't exist yet, add a final clean-up phase that removes them.
10. Specify test coverage areas, not test code.
11. End the plan with an **AC Coverage Summary** table (AC → phase → automatic/manual → full/partial). No AC may be left without a validating phase.
12. Write `ai-planning/{story-name}.planning.md`.

## Optional Memory

If planning reveals a non-obvious technical decision or constraint useful later, write `memories/repo/{story-name}-planning.md`.

## Final Response

End with:

1. Path to the planning doc
2. One-line phase summary per phase
3. Assumptions made
4. Unresolved questions before implementation
5. Decisions made beyond the research doc

Do **not** start implementing. Wait for human sign-off.

## Don'ts

- Don't write source files or tests.
- Don't run implementation commands.
- Don't include full code implementations.
- Don't repeat the research doc; link to it.
- Don't add phases for linting, formatting, or review.
- Don't invent answers to unresolved research questions.
