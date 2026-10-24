"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "./admin-shell";
import {
  apiDeleteMemory,
  apiFetchMemories,
  apiUpdateMemory,
  type MemoryKind,
  type MemoryRecord,
} from "../lib/api";

type MemoryFilter = "all" | MemoryKind | "disabled";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export function AdminMemoriesShell() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMemories(await apiFetchMemories());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load memories.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const filteredMemories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return memories.filter((memory) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "disabled" && !memory.is_enabled) ||
        memory.kind === filter;
      const matchesSearch = !query || memory.content.toLocaleLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, memories, search]);

  async function toggleMemory(memory: MemoryRecord) {
    if (busyId !== null) return;
    setBusyId(memory.id);
    setError(null);
    try {
      const updated = await apiUpdateMemory(memory.id, {
        is_enabled: !memory.is_enabled,
      });
      setMemories((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update memory.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteMemory(memory: MemoryRecord) {
    if (busyId !== null) return;
    if (!window.confirm("Delete this saved memory? This cannot be undone.")) return;
    setBusyId(memory.id);
    setError(null);
    try {
      await apiDeleteMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not delete memory.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function clearAllMemories() {
    if (isClearing || memories.length === 0) return;
    if (!window.confirm(`Delete all ${memories.length} saved memories? This cannot be undone.`)) return;
    setIsClearing(true);
    setError(null);
    const results = await Promise.allSettled(memories.map((memory) => apiDeleteMemory(memory.id)));
    if (results.some((result) => result.status === "rejected")) {
      setError("Some memories could not be deleted. Refresh and review the remaining items.");
      await loadMemories();
    } else {
      setMemories([]);
    }
    setIsClearing(false);
  }

  return (
    <AdminShell activeSection="memories">
      <header className="ic-admin-header">
        <div>
          <span className="ic-admin-eyebrow">Workspace control center</span>
          <h1 id="admin-page-title">Memory management</h1>
          <p>Review and control the durable context used by the local assistant.</p>
        </div>
        <div className="ic-admin-header-chip">{memories.length} memories</div>
      </header>

      {error ? <div className="ic-admin-stats-error" role="status">{error}</div> : null}

      <section className="ic-admin-memory-panel" aria-label="Saved memories">
        <div className="ic-admin-panel-header">
          <div>
            <span className="ic-admin-card-kicker">Saved context</span>
            <strong>{memories.filter((memory) => memory.is_enabled).length} enabled</strong>
          </div>
          <div className="ic-admin-detail-actions">
            <button type="button" className="ic-admin-refresh-button" onClick={() => void loadMemories()} disabled={isLoading || isClearing}>
              {isLoading ? "Loading…" : "Refresh"}
            </button>
            <button type="button" className="ic-admin-danger-button" onClick={() => void clearAllMemories()} disabled={isClearing || memories.length === 0}>
              {isClearing ? "Clearing…" : "Clear all"}
            </button>
          </div>
        </div>

        <div className="ic-admin-memory-toolbar">
          <input
            className="ic-admin-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search memory text"
            aria-label="Search memory text"
          />
          <div className="ic-admin-filter-group" aria-label="Memory filters">
            {(["all", "fact", "preference", "instruction", "disabled"] as MemoryFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`ic-admin-filter-button${filter === option ? " is-active" : ""}`}
                onClick={() => setFilter(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="ic-admin-memory-list">
          {isLoading ? <p className="ic-admin-list-state">Loading memories…</p> : null}
          {!isLoading && filteredMemories.length === 0 ? <p className="ic-admin-list-state">No memories match this filter.</p> : null}
          {filteredMemories.map((memory) => (
            <article key={memory.id} className={`ic-admin-memory-row${memory.is_enabled ? "" : " is-disabled"}`}>
              <div className="ic-admin-memory-content">
                <div className="ic-admin-memory-meta">
                  <span className="ic-admin-memory-kind">{memory.kind}</span>
                  <span>#{memory.id}</span>
                  <span>Updated {formatDate(memory.updated_at)}</span>
                </div>
                <p>{memory.content}</p>
              </div>
              <div className="ic-admin-memory-actions">
                <button type="button" className="ic-admin-refresh-button" onClick={() => void toggleMemory(memory)} disabled={busyId !== null || isClearing}>
                  {busyId === memory.id ? "Saving…" : memory.is_enabled ? "Disable" : "Enable"}
                </button>
                <button type="button" className="ic-admin-danger-button" onClick={() => void deleteMemory(memory)} disabled={busyId !== null || isClearing}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
