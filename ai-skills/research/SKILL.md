---
name: research
description: 'Use when the user starts a research, investigation, exploration, or discovery phase for a story or task. Triggers on research, investigate, explore, discover, feasibility.'
---

# Research workflow

> Source of truth: `ai-skills/research/SKILL.md`. Edit only that file — the copies under `.claude/skills/`, `.opencode/skill/`, and `.opencode/command/` are symlinks to it.

You are running the **research phase** of a project. Gather information, ask clarifying questions, and write a research document in `ai-research/`.

## Inputs

- A free-form description of the work
- If no input is provided, ask for at least one before proceeding

## Steps

1. Load shared context first:
   - `ai-skills/REPO_CONTEXT.md`
   - `CLAUDE.md`
2. Check story quality before exploration:
   - Missing or vague requirements
   - Unclear success criteria or acceptance criteria
   - Ambiguous user needs
   - Missing constraints or assumptions
   - Undefined terms
3. If anything is unclear, ask the user before continuing. Do not invent answers.
4. Assess scope:
   - **Single story**: 1-3 phases with clear ACs
   - **Multiple stories**: separate deliverables
   - **Epic**: multiple stories with dependencies
5. If too broad, break it into an epic, give each story 2-5 acceptance criteria, and ask which story to research first.
6. Explore only what the story explicitly requests. Do not chase tangential refactors or feature ideas.
7. Ask only necessary scope questions in one batch:
   - Quick or full research?
   - Single feature or cross-feature?
   - Any specific areas to focus on?
   - Any task-specific ambiguity?
8. Write `ai-research/{story-name}.research.md`.

## Research Doc Contents

Include:

- Story title and description
- Acceptance criteria: 2-5 clear, testable criteria
- Task breakdown only when needed to describe scope
- Epic structure only when the request is too large for one story
- Affected files and modules
- Existing patterns to follow
- Dependencies and integration points
- Edge cases and constraints
- Open questions
- Assumptions

## Implementation Detail Boundary

Research should include implementation-relevant facts, not implementation instructions.

Allowed because planning needs them:

- Affected files, modules, APIs, DTOs, services, guards, commands, and config
- Existing code patterns that constrain the solution
- Data shapes, contracts, side effects, external integrations, and failure modes
- Risks that would change the plan if ignored
- Small code references or signatures only when needed to identify the existing pattern

Not allowed because these belong in planning or implementation:

- Exact file edits to make
- Full code snippets for the future solution
- Phase-by-phase build steps
- Test code
- Refactors not required by the story
- Tool runs for tests, builds, package installs, or formatting

Research answers "what exists and what matters"; planning answers "what to change"; implementation changes it.

## Optional Memory

If research surfaces a non-obvious constraint, conflict, or domain fact useful later, write a short note to `memories/repo/{story-name}-research.md`. Skip obvious facts or anything already documented.

## Final Response

End with:

1. Path to the research doc
2. Story or epic structure if split
3. Unresolved open questions
4. Assumptions made

Do **not** start planning or writing code. Wait for human sign-off.

## Don'ts

- Don't propose implementation. That's the planning phase.
- Don't write or modify source files except the research doc and optional memory/context notes.
- Don't run tests, builds, package installs, or formatting.
- Don't write a huge research doc. Cut aggressively.
