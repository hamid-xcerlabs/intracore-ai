"use client";

import Link from "next/link";

const ADMIN_NAV_ITEMS = [
  { label: "Overview", detail: "Dashboard", active: true },
  { label: "Chats", detail: "Coming next", active: false },
  { label: "Memories", detail: "Coming next", active: false },
  { label: "Runtime", detail: "Coming next", active: false },
  { label: "Activity", detail: "Coming next", active: false },
] as const;

export function AdminShell() {
  return (
    <main className="ic-admin-shell">
      <aside className="ic-admin-sidebar" aria-label="Admin navigation">
        <Link className="ic-admin-brand" href="/">
          <span className="ic-admin-brand-mark">I</span>
          <span>
            <strong>IntraCore</strong>
            <small>Admin Lite</small>
          </span>
        </Link>

        <div className="ic-admin-mode-badge">
          <span className="ic-admin-status-dot" />
          Local admin mode
        </div>

        <nav className="ic-admin-nav">
          {ADMIN_NAV_ITEMS.map((item) =>
            item.active ? (
              <Link
                key={item.label}
                className="ic-admin-nav-item is-active"
                href="/admin"
                aria-current="page"
              >
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </Link>
            ) : (
              <span key={item.label} className="ic-admin-nav-item is-disabled" aria-disabled="true">
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </span>
            ),
          )}
        </nav>

        <Link className="ic-admin-back-link" href="/">
          ← Back to workspace
        </Link>
      </aside>

      <section className="ic-admin-content" aria-labelledby="admin-page-title">
        <header className="ic-admin-header">
          <div>
            <span className="ic-admin-eyebrow">Workspace control center</span>
            <h1 id="admin-page-title">Admin overview</h1>
            <p>Manage your local IntraCore workspace from one place.</p>
          </div>
          <div className="ic-admin-header-chip">Private local workspace</div>
        </header>

        <div className="ic-admin-notice" role="note">
          <strong>Admin Lite is ready.</strong>
          <span>
            This local-only foundation is intentionally read-only. Management tools will be added one section at a time.
          </span>
        </div>

        <div className="ic-admin-card-grid">
          <article className="ic-admin-card">
            <span className="ic-admin-card-kicker">Next up</span>
            <h2>Chat management</h2>
            <p>Search, inspect, export, and safely manage conversations.</p>
            <span className="ic-admin-card-status">Planned for step 3</span>
          </article>
          <article className="ic-admin-card">
            <span className="ic-admin-card-kicker">Next up</span>
            <h2>Memory controls</h2>
            <p>Review saved memories and control durable assistant context.</p>
            <span className="ic-admin-card-status">Planned for step 4</span>
          </article>
          <article className="ic-admin-card">
            <span className="ic-admin-card-kicker">Boundary</span>
            <h2>Local by design</h2>
            <p>No cloud account or external admin service is introduced in this step.</p>
            <span className="ic-admin-card-status is-safe">SQLite + local runtime</span>
          </article>
        </div>
      </section>
    </main>
  );
}
