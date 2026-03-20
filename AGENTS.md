# AGENTS.md

## Project Overview

### Architecture Decision Records

Location: `docs/adr/`

**Naming:** `##-topic-name.md` (e.g., `01-cross-platform.md`)

**Rules:**

- Before implementing architectural features, check if a relevant ADR exists
- Follow decisions documented in ADRs
- When making new architectural decisions, create an ADR

### Core Principle: Exact RabbitMQ Behavioral Parity

**RabbitBox is an exact behavioral replica of the real RabbitMQ. This is the #1 project priority.**

**Rules:**

- Every behavioral difference between RabbitBox and the real RabbitMQ is a **bug** — not a "cosmetic issue", not a "minor difference", not "low priority"
- NEVER classify any behavioral divergence as acceptable, cosmetic, informational, or low-priority
- NEVER skip fixing a known behavioral difference — if you discover one during implementation, fix it immediately or create a defect item
- NEVER use phrases like "minor issue", "known limitation", "good enough", or "purely informational" for behavioral differences
- When implementing a feature, the definition of "done" is: **behaves identically to the real RabbitMQ**
- When in doubt about RabbitMQ behavior, research the real RabbitMQ behavior first — don't guess or simplify

**Verification standard:**

- Every implementation MUST be verified against real RabbitMQ behavior
- Error codes, error messages, state transitions, return values, side effects — ALL must match
- If the real RabbitMQ returns a specific error, RabbitBox returns the same error

**When you discover a behavioral difference:**

1. It is a bug — treat it as one
2. Fix it now if within current scope, or create a defect (D##) if out of scope
3. NEVER leave it as a "known minor issue" in documentation

## Before Starting Any Task

**MANDATORY: Before writing any code, read the project documentation.**

This ensures consistency with existing patterns. Skipping this step leads to code that doesn't match project conventions.

## Voice Input Recognition

The user often uses voice recognition. Text may contain transcription errors.

- Auto-correct obvious errors from context
- If unclear or ambiguous - ask for clarification
- Try to fix independently when confident, but verify when uncertain

## When to Apply These Guidelines

**CRITICAL: File operation rules apply ONLY when working with repository files.**

✅ **Apply rules when:** Creating, editing, or deleting files; organizing directory structure; writing documentation to disk

❌ **DO NOT apply when:** Having regular conversation in chat; providing analysis or advice without creating files

**Default behavior:** If user asks for analysis/discussion without mentioning "create", "write", "document" - respond in chat only.

## Development Guidelines

### Documentation Standards

**Note:** These rules do NOT apply to AGENTS.md and CLAUDE.md config files.

**Language:**

- All documentation files (\*.md) MUST be written in English, regardless of conversation language
- Translate content to English before writing to disk

**README consistency (docs/, work/, and rnd/):**

- Every directory in `docs/`, `work/`, and `rnd/` MUST have a README.md with links to all files and subdirectories
- When adding/removing files, update the parent README.md
- Source code directories (`src/`) do NOT require README.md files

**README is navigation only:**

- Any README.md file is for **navigation only** — never put actual content in README files
- Actual content goes in separate named files (e.g., `summary.md`, `research.md`, `overview.md`)

**Linking rules:**

- ALL links to directories MUST point to README.md explicitly
  - ✅ Good: `[base/](base/README.md)`
  - ❌ Bad: `[base/](base/)`
- Link text should be readable, not technical filenames
  - ✅ Good: `[base environment](base/README.md)`
  - ❌ Bad: `[README.md](base/README.md)`

**No absolute or external local paths:**

- NEVER write absolute filesystem paths in documentation files (e.g., `/Users/...`, `/home/...`, `/tmp/...`)
- NEVER write local paths that point outside this repository (e.g., `~/other-project/...`, `../other-repo/...`)
- This includes paths from tool output — always convert them before writing to files
- For files within the repository, use repository-relative paths (e.g., `src/engine/parser.ts`, `docs/adr/01-wasm.md`)
- For external projects, use GitHub URLs instead (e.g., `https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/pglite.ts`)
- **Verify all external URLs** before writing them to files — fetch the page to confirm it exists and contains expected content. LLM-generated URLs are frequently hallucinated

**Navigation:**

- Every .md file MUST have a back link to parent README
- Place navigation at the bottom after `---` separator
  - Example: `[← Back to Main](README.md)` or `[← Back](../README.md)`

### Work Structure

Location: `work/`

All work items (epics, stories, tasks, research, defects) live under `work/epics/`.

**Hierarchy:**

```
work/
├── README.md
├── board.md              ← current work status
└── epics/
    ├── README.md
    └── E01-auth/
        ├── README.md
        ├── description.md
        ├── stories/
        │   ├── README.md
        │   └── S01-login/
        │       ├── README.md
        │       ├── description.md
        │       └── tasks/
        │           ├── README.md
        │           └── T01-ui/
        │               ├── README.md
        │               └── description.md
        ├── tasks/            ← direct epic tasks
        ├── research/
        └── defects/
```

**Entity types (by prefix):**

- `E##` — Epic
- `S##` — Story
- `T##` — Task (can be nested: T01/tasks/T01)
- `R##` — Research
- `D##` — Defect

**Numbering:**

- Epic number — global (E01, E02, E03...)
- Story/Research/Defect/Task number — within parent (S01, T01, R01, D01)
- Nested tasks continue the pattern: E01S01T01T01

**ID to path mapping:**

```
E01         → work/epics/E01-*/
E01S01      → work/epics/E01-*/stories/S01-*/
E01S01T01   → work/epics/E01-*/stories/S01-*/tasks/T01-*/
E01T01      → work/epics/E01-*/tasks/T01-*/
E01R01      → work/epics/E01-*/research/R01-*/
E01D01      → work/epics/E01-*/defects/D01-*/
```

**Files:**

- `README.md` — navigation only (links to children)
- `description.md` — content (what this entity is about)

### Board

Location: `work/board.md`

Workflow:

- Start task → add to "In Progress"
- Finish task → remove from board

### Work Item Status

Track completion status in `description.md` files using a status line after the title:

```markdown
# T01: Task Title

**Status:** done

Task summary...
```

**Rules:**

- **Only `done` is tracked** — absence of a status line means the item is pending
- **Place after the title** — on the line immediately after the `# Title` line (before the summary)
- **Cascading updates** — when completing a task:
  1. Mark the task `**Status:** done`
  2. Check if all sibling tasks in the parent story are done → if yes, mark the story done
  3. Check if all stories in the parent epic are done → if yes, mark the epic done

### Localized File Synchronization

Translations (`.<lang>.md`, e.g., `.de.md`, `.fr.md`) are optional and created only on explicit user request. When a localized version exists, it MUST be kept in sync with the primary English file.

Before completing ANY file edit task:

- Check if localized versions exist (e.g., `overview.md` → check for `overview.*.md`)
- If localized versions exist: Apply identical changes to ALL versions
- If only the primary version exists: Edit that version only

**Link consistency in localized files:** Internal links must point to the same locale:

- ✅ Correct: `[components](components/README.de.md)` (in a `.de.md` file)
- ❌ Wrong: `[components](components/README.md)` (mixing locales)

### File and Directory Reorganization

When moving or renaming files/folders:

1. Use `Grep` to search for all mentions of the file/folder path in `.md` files
2. Document all files that reference the path
3. Update all found references to point to the new location
4. Verify navigation links in moved files point to correct parent directories

### File Organization Principle

Code must be modular. File structure must reflect that modularity. The goal is grouping rules that naturally produce small, focused files — not size limits or reactive splitting.

A large file is not a problem in itself — it is a symptom of wrong grouping rules. The fix is never "split this file" — the fix is "find the right decomposition principle so this file wouldn't have existed in the first place." There is no line count threshold. A 300-line file with one cohesive responsibility is fine. A 150-line file with two unrelated responsibilities is not.

Code that evolves together should live close together (same module, same directory); code that evolves independently should be separated. This is an important grouping criterion.

### Test Placement

Tests must be co-located with the code they test (e.g., `foo.ts` → `foo.test.ts` in the same directory). Do not separate tests into a dedicated test tree.

### File Naming Conventions

- Use lowercase, hyphens for spaces (e.g., `canvas-renderer.ts`)

### Commit Message Format

First line: imperative mood, lowercase start, no trailing period:

- `add canvas rendering component`
- `fix websocket reconnection bug`
- `update content type system`

For larger commits, add brief description after a blank line (standard git convention):

```
add websocket reconnection logic

handle network interruptions with exponential backoff
```

### Git Push Policy

- NEVER run `git push` without explicit user request
- Only push when user explicitly says "push" or "git push"
- After commit, wait for user instruction before pushing
- NEVER push to main directly — all changes to main go through PRs
- NEVER run `git merge <branch> main` or `git merge <branch>` while on main

### Rolling Back Changes

When discarding or reverting local changes:

- **ALWAYS stash first** before any destructive git operations (`git checkout .`, `git restore .`, `git reset --hard`, etc.)
- Use `git stash -u` to include untracked files
- This ensures work is never permanently lost — it can always be recovered via `git stash pop`

### Pre-Commit Self-Analysis

Before each commit, briefly consider:

1. **Friction points** — Were there misunderstandings, repeated corrections, or user frustration?
2. **Pattern recognition** — Did the same issue occur multiple times in this session?
3. **Process gaps** — Is there a missing guideline that would have prevented the problem?

If improvements are identified:

- Suggest specific AGENTS.md changes to the user
- Keep suggestions actionable and concise
- Don't suggest changes for one-off issues — only recurring patterns

**Anti-loop safeguard:** Don't suggest meta-rules about suggesting rules. Focus on concrete workflow improvements.

### Branching Strategy

- Feature branches: `feature/<name>` (e.g., `feature/schema`)
- Small fixes and refactoring can go directly to main
- Large features and breaking changes go through feature branches
- **Feature branches are NEVER merged into main directly** — always through a PR (see Merge & Pull Request Policy)

### Merge & Pull Request Policy

**CRITICAL: NEVER merge a feature branch into main without explicit user instruction.**

- NEVER run `git merge` into main — this is FORBIDDEN
- NEVER run `git rebase` onto main and push — this is FORBIDDEN
- Feature branches are merged into main **only** through Pull Requests with **squash commits**
- NEVER auto-merge or fast-forward merge feature branches

**Squash commit message rules:**

- The squash commit message MUST be written manually by composing a clear summary
- NEVER use auto-generated commit messages (concatenation of individual commits)
- NEVER use the default squash message provided by git/gh
- The message must summarize **what the PR achieves as a whole**, not list individual commits
- Follow the project's commit message format (imperative mood, lowercase start, no trailing period)

**Before creating/merging a PR:**

- Run ALL quality checks: linting, type checking, formatting (prettier), and tests
- ALL checks MUST pass before the PR is created
- If any check fails — fix it first, do not create the PR with failing checks

**PR workflow:**

1. Ensure all changes are committed and pushed to the feature branch
2. Run `npm run lint`, `npm run typecheck`, `npm run test` (or equivalent project scripts) — ALL must pass
3. Create PR via `gh pr create` with a clear title and description
4. Wait for user to review and approve
5. Merge ONLY when user explicitly says "merge" — use squash merge with a manually written message

### After Switching Branches or Pulling

After `git checkout`, `git switch`, or `git pull` that includes changes to dependency files:

1. Run dependency install to sync
2. Clear caches if needed

### Code Quality

After making changes to source files, always run linting, type checking, formatting, and tests.

**Formatting is mandatory before every commit.** Run `npm run format` before committing — unformatted code will fail CI.

### Dependency Versions

LLM training data is outdated. When adding dependencies:

- **Always check current version** before installing
- Use `@latest` tag or explicit current version, never rely on memory

### No Deferring Cheap Work

- NEVER defer work because it seems "not important right now"
- If something can be done in the current context (a hook, a test, a small fix) — do it
- The cost of doing small things now ≈ 0; the cost of forgetting them later > 0
- Don't optimize for "focus" by skipping cheap tasks — that's a human-team heuristic, not applicable to LLM agents

### Incremental Refactoring

After adding new code, check for:

- Duplicated logic that appeared (3+ similar lines → extract)
- Dead code from previous iterations (delete it)
- Obvious naming improvements in touched code

This is NOT over-engineering — it's maintaining code health. But limit scope to code you're actively working on.

### Research

Location: `rnd/`

**Naming:** `topic-name` (e.g., `boxing`, `schema`, `cross-platform`) — no numeric prefixes.

Conduct all research and exploration in the `rnd/` folder. Create a new subfolder for each research topic. Related sub-topics go as subdirectories within the main research folder.

### Debugging Protocol

When asked to investigate or fix a problem:

1. **Ask first** — what error or symptom does the user see? Do NOT assume
2. **No speculative long commands** — do NOT run full test suites or slow commands to "see what happens"
3. **Targeted investigation** — run only specific commands after understanding the problem
4. **Correct environment** — verify fixes where they matter

### Test Output Handling

**ALWAYS redirect test output to a unique temp file** — Bash tool truncates after ~30000 chars.

```bash
npm run test 2>&1 > /tmp/unique-name.log; echo "Exit: $?"
```

**After running:**

- Exit `0` → tests passed, no need to read the file unless strictly necessary (save tokens)
- Exit `!= 0` → check failures with `tail -n 100` on the log file
- If more context needed → use Read tool or grep for specific test name

### Running Project Scripts

Prefer project scripts over running files directly.

Before running commands:

1. Check `package.json` for available scripts
2. Use `npm run <script>`

Scripts handle working directory, arguments, and pre/post steps. Direct file execution may skip important setup.
