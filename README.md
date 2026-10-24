# IntraCore AI

### Your AI. Your data. Your machine. Your rules.

IntraCore AI is an open-source, local-first AI workspace being built to give individuals and businesses direct control over their models, conversations, memory, documents, tools, and data.

Most AI products today are rented intelligence.

Your work leaves your device.  
Your memory lives on someone else’s infrastructure.  
Your access depends on subscriptions, limits, policies, and providers you cannot control.

IntraCore is being built for the world that comes next.

A world where AI becomes deeply connected to company knowledge, private documents, daily operations, personal decisions, internal tools, and long-term memory—and where sending all of that intelligence through external systems is no longer an acceptable default.

> IntraCore is not another chat interface placed in front of a local model.  
> It is the system layer being built around local intelligence.

## The Vision

IntraCore is designed to evolve into a complete private AI environment with:

- replaceable local open-weight models
- persistent conversations and context
- inspectable, editable, user-controlled memory
- private document intelligence and local RAG
- tools, integrations, and automated workflows
- model discovery and capability management
- message editing, regeneration, and branching
- local data export and deletion
- optional internet access with explicit permission
- desktop installation for non-technical users
- business deployments where sensitive data remains under organisational control

The model should be replaceable.

The user’s data, workflows, memory, and intelligence infrastructure should remain theirs.

## Why Now

AI has only begun moving from simple chat into the operating layer of personal and business work.

As that happens, privacy, data ownership, model independence, infrastructure control, and AI sovereignty will stop being optional features. They will become core product requirements.

IntraCore is being built at that intersection:

**Local AI × Private Data × Persistent Intelligence × User Control**

## Current Stage

**Early architectural development — built in public.**

The working foundation currently includes:

- FastAPI and Next.js
- Ollama-based local model execution
- LangChain and LangGraph orchestration
- SQLite, SQLAlchemy, and Alembic persistence
- chat and message data models
- manual cross-conversation memories stored in local SQLite
- user-controlled memory create, edit, enable/disable, and hard delete
- an initial local AI interface
- modular backend boundaries for future providers, memory, RAG, tools, and integrations

The foundation works.

Memory is currently explicit and user-controlled: IntraCore does not
automatically extract or save memories from conversations. Enabled global
memories are bounded before they are supplied to the local model, while chat
messages remain isolated to their own conversation.

The larger product is still being shaped.

## Local startup

From the repository root, start the backend and frontend in separate PowerShell terminals.

Backend terminal:

```powershell
Set-Location .\backend
..\venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend terminal:

```powershell
Set-Location .\frontend
npm run dev
```

Open `http://localhost:3000` in the browser. The frontend uses `http://127.0.0.1:8000` as its default backend URL; override it with `NEXT_PUBLIC_API_URL` when using a different local port.

## Local verification

Run the repeatable verification script from the repository root:

```powershell
.\scripts\verify.ps1
```

The backend exposes these local readiness checks:

- `GET /health` confirms the API process is running.
- `GET /health/database` checks SQLite connectivity.
- `GET /health/ollama` checks the local Ollama runtime.
- `GET /health/ready` aggregates SQLite and Ollama and returns HTTP 503 when the chat runtime is unavailable.

## Release readiness checklist

Before sharing a build, verify the complete local path:

1. Recreate the local root `venv` if its Python interpreter cannot start.
2. Run `.\scripts\verify.ps1` from the repository root.
3. Start the backend and frontend using the existing project configuration.
4. Confirm `/health`, `/health/database`, `/health/ollama`, and `/health/ready`.
5. Exercise create chat, stream response, refresh history, regenerate, memory CRUD, export, and delete confirmation.
6. Review `git status` and ensure local environments, data, uploads, and `.env` files are not staged.

Current release limitations:

- The product is local-first and currently single-user; authentication is not included.
- Ollama must be installed locally with at least one completion-capable model.
- Documents, RAG, tools, integrations, and model downloading are not part of this release.
- The automated test suite is present, but it requires a working local Python environment before it can run.

## What Comes Next

IntraCore is being built as a long-term systems project, not a temporary local-model wrapper.

The next phases will move beyond chat into:

- durable memory and context
- private document intelligence
- model discovery and switching
- tools and workflow integrations
- permission-controlled external access
- business-grade local deployments
- desktop packaging
- a broader local AI ecosystem

The architecture is being shaped now so these capabilities can be added without rebuilding the product from the ground up.

This is still an early stage.

That is exactly why the decisions being made now matter.

**IntraCore is being built to become that infrastructure.**

---

**IntraCore AI is being developed by Hamid under XCER Labs as a long-term open-source AI infrastructure project.**
