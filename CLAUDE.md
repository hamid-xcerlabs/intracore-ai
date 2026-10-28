# IntraCore AI — Claude Instructions

## Git commits

- Never add `Co-Authored-By:` lines to commit messages.
- Never use em-dashes (—) in commit messages.
- Never mention "ChatGPT" in commit messages.
- Never commit or push without user approval.
- Never create branches without approval.

## File editing

- Never use PowerShell `-replace` or `Out-File` to edit source files — always use the Edit or Write tools to avoid encoding corruption.
- Never open, read, print, or modify `backend/.env`.
- Never inspect or modify anything inside `backend/data/`, `backend/venv/`, `frontend/node_modules/`, `frontend/.next/`.
- Never expose tokens, passwords, credentials, or user data.

## Security boundaries

- Treat local secrets, environment files, databases, uploaded files, logs, and user content as private by default.
- Never print, quote, copy, summarize, or include sensitive values in chat responses, commits, screenshots, test output, or debug logs.
- Do not enable external APIs, cloud services, telemetry, or network access unless the user explicitly approves it.
- Before any destructive action, verify the exact target and scope; preserve recoverable data whenever practical.
- Keep admin and diagnostic features limited to the local product context and do not expose private conversation or memory content unnecessarily.
- If a command or code path could expose an environment variable, credential, token, or user record, stop immediately and report the issue.

## Project rules

- Inspect the existing code before making any changes.
- Do not assume functionality is already implemented — verify first.
- Make only the change asked for. No extra cleanup, refactors, or features.
- Preserve the existing backend and frontend architecture.
- Do not install packages or run migrations without approval.

## Git workflow

- Inspect `git status` and the relevant diff before staging anything.
- Stage only files required for the approved milestone; never include local environments, data, generated files, or unrelated work.
- Run `git diff --check` before committing.
- Keep commits focused and use a clear message that describes the approved change.
- Run focused verification before committing and report any known failures honestly.
- Commit and push only after explicit user approval.
- After pushing, report the branch, commit hash, changed files, and any remaining untracked files.

## Documentation rules

- Update the relevant README or documentation file when a feature changes setup, behaviour, API usage, or verification steps.
- Keep backend and frontend startup commands accurate and runnable from the documented working directory.
- Document important local health checks, test commands, and known release limitations.
- Keep parked ideas separate from approved implementation plans and current product requirements.
- Prefer concise, product-specific documentation that matches the actual code instead of planned functionality.
- Never include secrets, credentials, private user content, local database records, or environment values in documentation.

## Architecture

- Backend: FastAPI, entry point `backend/app/main.py`, start with `uvicorn app.main:app --reload --port 8000` from inside `backend/`.
- Frontend: Next.js (Turbopack), start with `npm run dev -- --port 3001` from inside `frontend/`.
- Database: SQLite (authoritative). Vector stores are indexes only.
- AI: Ollama local models via LangGraph.

## Code style

- Python: snake_case for functions/variables, PascalCase for classes. No inline styles in JSX.
- TypeScript/React: PascalCase components, camelCase hooks (`useXxx`), CSS class names prefixed with `ic-`.
- CSS: define colors as CSS variables on `:root`, override under `:root[data-theme="dark"]`. No hardcoded color values in components.

## Testing

- Run backend tests from inside `backend/`: `pytest`.
- Do not mock the database in integration tests — use the real SQLite instance.
- Verify UI changes in the browser before marking done; type-check with `npx tsc --noEmit` from `frontend/`.
- Use focused tests for the changed route, service, repository, component, or user flow before running the broader suite.
- Cover the core local-first flows when they are affected: chat creation, streaming, history loading, regeneration, memory CRUD, export, and deletion confirmation.
- Check loading, empty, error, retry, and cancellation behaviour for asynchronous UI and API states.
- Review browser console output for new errors, hydration warnings, failed requests, and accessibility issues.
- If a check cannot run because the local environment is unavailable, report the exact limitation instead of claiming it passed.

## Frontend UX rules

- Every async view must handle loading, empty, success, and error states clearly.
- Failed chat loads and network requests should provide a visible retry action where recovery is possible.
- Prevent duplicate submissions for send, save, delete, export, and other mutating actions.
- Require clear confirmation before destructive actions such as deleting chats or all memories.
- Keep server-rendered and client-rendered output deterministic to avoid hydration warnings.
- Preserve keyboard navigation, visible focus states, accessible labels, and readable contrast.
- Keep responsive layouts usable across the main desktop and mobile breakpoints.

## Definition of done

- Change works in the browser (no console errors, no visual regressions).
- TypeScript compiles clean.
- Only the files required for the task are changed — no extra cleanup or refactors.

## API conventions

- Routes follow `/api/v1/<resource>` (e.g. `/api/v1/chats`, `/api/v1/messages`).
- Request/response shapes are defined in `backend/app/schemas/`.
- Errors return `{ "detail": "..." }` with an appropriate HTTP status code.

## Known gotchas

- Editing source files with PowerShell (`-replace`, `Out-File`, `Set-Content`) corrupts encoding — always use the Edit or Write tools.
- `git push --force` is blocked by the Bash tool in auto-mode; use `mcp__terminal__run_in_terminal` instead.
- `git filter-branch` leaves a backup ref at `refs/original/refs/heads/main`; delete it with `git update-ref -d refs/original/refs/heads/main` before rerunning.
- The frontend uses `motion/react` (Framer Motion v11), not the older `framer-motion` import path.
- CSS dark mode is controlled by `data-theme="dark"` on `<html>`, not `prefers-color-scheme` media query.

## Key files

- `frontend/components/chat-shell.tsx` — main UI shell: sidebar, chat list, message thread, dialogs.
- `frontend/app/globals.css` — all custom CSS; uses `data-theme` attribute for dark/light mode via CSS variables.
- `backend/app/main.py` — FastAPI app init, router registration.
- `backend/app/api/` — HTTP route handlers (one file per domain).
- `backend/app/services/` — business logic called by routes.
- `backend/app/repositories/` — SQLite persistence layer.
- `backend/app/providers/` — Ollama / LLM communication.
- `backend/app/prompts/` — system prompt strings.
