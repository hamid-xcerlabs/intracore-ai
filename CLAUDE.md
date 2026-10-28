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

## Project rules

- Inspect the existing code before making any changes.
- Do not assume functionality is already implemented — verify first.
- Make only the change asked for. No extra cleanup, refactors, or features.
- Preserve the existing backend and frontend architecture.
- Do not install packages or run migrations without approval.

## Architecture

- Backend: FastAPI, entry point `backend/app/main.py`, start with `uvicorn app.main:app --reload --port 8000` from inside `backend/`.
- Frontend: Next.js (Turbopack), start with `npm run dev -- --port 3001` from inside `frontend/`.
- Database: SQLite (authoritative). Vector stores are indexes only.
- AI: Ollama local models via LangGraph.
