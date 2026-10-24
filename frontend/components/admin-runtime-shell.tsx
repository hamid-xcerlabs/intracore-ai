"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "./admin-shell";
import {
  apiFetchModels,
  apiFetchReadiness,
  type ChatModelListResponse,
  type ReadinessResponse,
} from "../lib/api";

function statusLabel(value: string | undefined, fallback = "Unknown"): string {
  if (!value) return fallback;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function AdminRuntimeShell() {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [models, setModels] = useState<ChatModelListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadRuntime = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const [readinessResult, modelsResult] = await Promise.allSettled([
      apiFetchReadiness(),
      apiFetchModels(),
    ]);

    setReadiness(readinessResult.status === "fulfilled" ? readinessResult.value : null);
    setModels(modelsResult.status === "fulfilled" ? modelsResult.value : null);
    setLastUpdated(new Date());

    if (readinessResult.status === "rejected" || modelsResult.status === "rejected") {
      setError("Some runtime diagnostics could not be loaded. Check the local backend and retry.");
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadRuntime();
  }, [loadRuntime]);

  const ollamaStatus = readiness?.checks.ollama?.status;
  const databaseConnected = readiness?.checks.database?.connected;
  const selectableModels = models?.models.filter((model) => model.selectable) ?? [];
  const installedModels = models?.models.filter((model) => model.installed) ?? [];

  return (
    <AdminShell activeSection="runtime">
      <header className="ic-admin-header">
        <div>
          <span className="ic-admin-eyebrow">Workspace control center</span>
          <h1 id="admin-page-title">Runtime status</h1>
          <p>Inspect the local backend, database, Ollama connection, and model availability.</p>
        </div>
        <div className="ic-admin-header-chip">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Checking…"}</div>
      </header>

      {error ? <div className="ic-admin-stats-error" role="status">{error}</div> : null}

      <div className="ic-admin-runtime-actions">
        <span className="ic-admin-runtime-note">Diagnostics are read-only.</span>
        <button type="button" className="ic-admin-refresh-button" onClick={() => void loadRuntime()} disabled={isLoading}>
          {isLoading ? "Checking…" : "Refresh diagnostics"}
        </button>
      </div>

      <div className="ic-admin-runtime-grid">
        <article className="ic-admin-runtime-card">
          <span className="ic-admin-card-kicker">Overall readiness</span>
          <strong className={readiness?.status === "ready" ? "is-ready" : "is-warning"}>
            {isLoading ? "Checking…" : statusLabel(readiness?.status, "Unavailable")}
          </strong>
          <span>Backend readiness probe</span>
        </article>
        <article className="ic-admin-runtime-card">
          <span className="ic-admin-card-kicker">Ollama</span>
          <strong className={ollamaStatus === "ready" ? "is-ready" : "is-warning"}>
            {isLoading ? "Checking…" : statusLabel(ollamaStatus, "Unavailable")}
          </strong>
          <span>{selectableModels.length} selectable chat models</span>
        </article>
        <article className="ic-admin-runtime-card">
          <span className="ic-admin-card-kicker">Database</span>
          <strong className={databaseConnected ? "is-ready" : "is-warning"}>
            {isLoading ? "Checking…" : databaseConnected ? "Connected" : "Unavailable"}
          </strong>
          <span>SQLite authoritative storage</span>
        </article>
      </div>

      <section className="ic-admin-model-panel" aria-labelledby="admin-models-title">
        <div className="ic-admin-panel-header">
          <div>
            <span className="ic-admin-card-kicker">Model inventory</span>
            <strong id="admin-models-title">{installedModels.length} installed · {selectableModels.length} selectable</strong>
          </div>
          <span className="ic-admin-detail-meta">Default: {models?.default_model ?? "None reported"}</span>
        </div>
        <div className="ic-admin-model-list">
          {isLoading ? <p className="ic-admin-list-state">Loading model inventory…</p> : null}
          {!isLoading && installedModels.length === 0 ? <p className="ic-admin-list-state">No installed chat models reported.</p> : null}
          {installedModels.map((model) => (
            <div key={model.name} className="ic-admin-model-row">
              <div>
                <strong>{model.name}</strong>
                <span>{model.family ?? "Unknown family"}{model.parameter_size ? ` · ${model.parameter_size}` : ""}</span>
              </div>
              <span className={`ic-admin-model-badge${model.selectable ? " is-selectable" : ""}`}>
                {model.selectable ? "Selectable" : "Installed"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
