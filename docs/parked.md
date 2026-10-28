# Parked Ideas

Features and improvements set aside for later — not rejected, just not the right time yet.

---

## CLAUDE.md additions

Things to add to CLAUDE.md when there is time:

- **Code style** — naming conventions (camelCase hooks, PascalCase components, snake_case Python), no inline styles, CSS class names prefixed with `ic-`.
- **Testing** — how to run backend tests, what to test vs skip, no mocking the database.
- **Known gotchas** — editing source files with PowerShell corrupts encoding; always use Edit/Write tools. Force push requires terminal tool, not Bash tool.
- **Definition of done** — verify in browser before marking complete; type-check passes; no console errors.
- **API conventions** — REST routes follow `/api/v1/<resource>`, request/response shapes defined in schemas, errors return `{ detail: string }`.

