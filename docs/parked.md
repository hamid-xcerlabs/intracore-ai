# Parked Ideas

Small improvements and documentation work intentionally set aside for later. These items are not rejected; they should be picked up when they fit the current IntraCore milestone without distracting from core product work.

---

## CLAUDE.md improvements

The following guidance can be added to `CLAUDE.md` when the project rules need to become more complete and easier to follow.

### Code style

- Keep React components named in `PascalCase` and hooks/functions in `camelCase`.
- Keep Python classes in `PascalCase`, with functions and variables in `snake_case`.
- Use `ic-` prefixes for IntraCore CSS class names.
- Keep styling in the shared CSS system and avoid inline styles in JSX.
- Preserve the existing FastAPI, Next.js, SQLite, repository, service, and provider boundaries.

### Testing and verification

- Document the exact commands for backend tests, frontend type-checking, and the project verification script.
- Use the real local SQLite database in integration tests; do not replace database behaviour with mocks.
- Test the important local-first flows: chat creation, streaming, history loading, regeneration, memory CRUD, export, and deletion confirmation.
- Verify UI changes in the browser and check for hydration warnings, console errors, broken loading states, and visual regressions.

### Known project gotchas

- Do not read, print, modify, or commit `.env` files, local databases, uploaded data, generated build folders, or virtual environments.
- Editing source files with PowerShell text-replacement commands can corrupt encoding; use the repository editing tools instead.
- Check `git status` before and after a task so local environments and generated files are not accidentally included.
- Do not install packages, run migrations, create branches, commit, or push unless the user explicitly approves it.

### Definition of done

A change is complete only when:

- The requested behaviour works in the browser or through focused tests.
- The existing backend and frontend architecture remains intact.
- Relevant tests and checks have been run, or the reason they could not run is documented.
- TypeScript, API, loading, error, and empty states have been considered.
- There are no new browser console errors or hydration warnings.
- Only the files required for the approved change are modified.
- The changed files, verification result, and remaining risks are clearly reported.

### API conventions

- Keep resource routes under `/api/v1/<resource>` where applicable.
- Define request and response contracts in `backend/app/schemas/`.
- Keep business logic in services and persistence logic in repositories.
- Return structured errors using `{ "detail": "..." }` with an appropriate HTTP status code.
- Treat SQLite as the authoritative durable store; vector indexes must not become the source of truth.
- Keep local-provider failures, unavailable models, validation errors, and missing resources distinguishable to the frontend.

