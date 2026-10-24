"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  apiFetchChats,
  apiFetchMemories,
  apiFetchModels,
  apiFetchReadiness,
  type Chat,
  type MemoryRecord,
  type ReadinessResponse,
} from "../lib/api";

const ADMIN_NAV_ITEMS = [
  { key: "overview", label: "Overview", detail: "Dashboard", href: "/admin" },
  { key: "chats", label: "Chats", detail: "Management", href: "/admin/chats" },
  { key: "memories", label: "Memories", detail: "Management", href: "/admin/memories" },
  { key: "runtime", label: "Runtime", detail: "Diagnostics", href: "/admin/runtime" },
  { key: "activity", label: "Activity", detail: "Analytics", href: "/admin/analytics" },
] as const;

type AdminStats = {
  chatCount: number;
  messageCount: number;
  memoryCount: number;
  enabledMemoryCount: number;
  modelName: string | null;
  readiness: ReadinessResponse | null;
};

const EMPTY_STATS: AdminStats = {
  chatCount: 0,
  messageCount: 0,
  memoryCount: 0,
  enabledMemoryCount: 0,
  modelName: null,
  readiness: null,
};

function buildAdminStats(
  chats: Chat[],
  memories: MemoryRecord[],
  readiness: ReadinessResponse | null,
  modelName: string | null,
): AdminStats {
  return {
    chatCount: chats.length,
    messageCount: chats.reduce((total, chat) => total + chat.message_count, 0),
    memoryCount: memories.length,
    enabledMemoryCount: memories.filter((memory) => memory.is_enabled).length,
    modelName,
    readiness,
  };
}

export function AdminShell({
  activeSection = "overview",
  children,
}: {
  activeSection?: (typeof ADMIN_NAV_ITEMS)[number]["key"];
  children?: ReactNode;
}) {
  const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadStats = useCallback(async () => {
    setIsLoadingStats(true);
    setStatsError(null);

    const [chatsResult, memoriesResult, readinessResult, modelsResult] =
      await Promise.allSettled([
        apiFetchChats(),
        apiFetchMemories(),
        apiFetchReadiness(),
        apiFetchModels(),
      ]);

    const chats = chatsResult.status === "fulfilled" ? chatsResult.value : [];
    const memories =
      memoriesResult.status === "fulfilled" ? memoriesResult.value : [];
    const readiness =
      readinessResult.status === "fulfilled" ? readinessResult.value : null;
    const modelName =
      modelsResult.status === "fulfilled"
        ? modelsResult.value.default_model
        : null;

    setStats(buildAdminStats(chats, memories, readiness, modelName));
    setLastUpdated(new Date());

    const failures = [
      chatsResult,
      memoriesResult,
      readinessResult,
      modelsResult,
    ].filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      setStatsError(
        "Some dashboard data could not be loaded. Check the local backend and retry.",
      );
    }
    setIsLoadingStats(false);
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const runtimeStatus = stats.readiness?.status ?? "unavailable";
  const runtimeLabel = isLoadingStats
    ? "Checking…"
    : runtimeStatus === "ready"
      ? "Ready"
      : "Unavailable";

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
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              className={`ic-admin-nav-item${activeSection === item.key ? " is-active" : ""}`}
              href={item.href}
              aria-current={activeSection === item.key ? "page" : undefined}
            >
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </Link>
          ))}
        </nav>

        <Link className="ic-admin-back-link" href="/">
          ← Back to workspace
        </Link>
      </aside>

      <section className="ic-admin-content" aria-labelledby="admin-page-title">
        {children ?? (
          <>
        <header className="ic-admin-header">
          <div>
            <span className="ic-admin-eyebrow">Workspace control center</span>
            <h1 id="admin-page-title">Admin overview</h1>
            <p>Manage your local IntraCore workspace from one place.</p>
          </div>
          <div className="ic-admin-header-chip">Private local workspace</div>
        </header>

        <div className="ic-admin-notice" role="note">
          <div>
            <strong>Workspace snapshot</strong>
            <span>
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString()}`
                : "Loading local workspace data…"}
            </span>
          </div>
          <button
            type="button"
            className="ic-admin-refresh-button"
            onClick={() => void loadStats()}
            disabled={isLoadingStats}
          >
            {isLoadingStats ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {statsError ? (
          <div className="ic-admin-stats-error" role="status">
            {statsError}
          </div>
        ) : null}

        <div className="ic-admin-metrics-grid">
          <article className="ic-admin-metric-card">
            <span className="ic-admin-card-kicker">Conversations</span>
            <strong>{isLoadingStats ? "—" : stats.chatCount}</strong>
            <span>Saved chats</span>
          </article>
          <article className="ic-admin-metric-card">
            <span className="ic-admin-card-kicker">Messages</span>
            <strong>{isLoadingStats ? "—" : stats.messageCount}</strong>
            <span>Durable messages</span>
          </article>
          <article className="ic-admin-metric-card">
            <span className="ic-admin-card-kicker">Memories</span>
            <strong>{isLoadingStats ? "—" : stats.memoryCount}</strong>
            <span>{stats.enabledMemoryCount} enabled</span>
          </article>
          <article className="ic-admin-metric-card">
            <span className="ic-admin-card-kicker">Runtime</span>
            <strong className={runtimeStatus === "ready" ? "is-ready" : "is-warning"}>
              {runtimeLabel}
            </strong>
            <span>{stats.modelName ?? "No model reported"}</span>
          </article>
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
          </>
        )}
      </section>
    </main>
  );
}
