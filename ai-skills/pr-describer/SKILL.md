---
name: pr-describer
description: 'Use when the user asks for a PR description, PR title, or a summary of the current branch changes. Triggers on pr description, describe pr, pr title, pr summary.'
model: haiku
effort: medium
---

# PR describer

> Source of truth: `ai-skills/pr-describer/`. Edit only `SKILL.md` and `COMMAND.md` there; the entries under `.claude/skills/`, `.opencode/skill/`, and `.opencode/command/` are symlinks into it.

Write a PR description from the changes on the current branch.

1. Resolve the base branch: `git merge-base HEAD origin/main` (this repo has no `develop`; PRs target `main`). If the user names a base, use it — e.g. a branch stacked on an unmerged feature branch.
2. Read the changes: `git log --oneline <base>..HEAD` and `git diff <base>...HEAD --stat`, then `git diff <base>...HEAD` for the files that matter. Skip lockfiles and generated output.
3. Describe what the branch does and why, not the diff line by line. Group related edits into one bullet; drop noise (formatting, renames with no behaviour change) unless that is the whole PR.
4. Output exactly the template below and nothing else — no preamble, no commentary.

## Output format

```
## Title options
1. <title>
2. <title>
3. <title>

# PR Description
<1 to 4 lines explaining the changes in a concise way>

## Changes
- Change 1
- Change 2
```

Titles: imperative mood, under 72 characters, no trailing period. Match the repo's existing commit style (Conventional Commits prefix, e.g. `ci: add label check, CI and release-on-merge workflows`). Remind the user the PR needs a `major`, `minor` or `patch` label — `check-label.yml` fails without one, and it decides the version bump on merge.
