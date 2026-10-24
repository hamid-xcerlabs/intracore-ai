"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "./admin-shell";
import { apiFetchChats, apiFetchMessages, type Chat, type Message } from "../lib/api";

type RangeDays = 7 | 30 | 90;

type ActivityDay = {
  key: string;
  label: string;
  chats: number;
  messages: number;
};

function dayKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildActivityDays(range: RangeDays, chats: Chat[], messages: Message[]): ActivityDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const counts = new Map<string, { chats: number; messages: number }>();
  for (const chat of chats) {
    const key = dayKey(chat.created_at);
    if (key) counts.set(key, { ...(counts.get(key) ?? { chats: 0, messages: 0 }), chats: (counts.get(key)?.chats ?? 0) + 1 });
  }
  for (const message of messages) {
    const key = dayKey(message.created_at);
    if (key) counts.set(key, { ...(counts.get(key) ?? { chats: 0, messages: 0 }), messages: (counts.get(key)?.messages ?? 0) + 1 });
  }

  return Array.from({ length: range }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (range - index - 1));
    const key = dayKey(date);
    return {
      key,
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      chats: counts.get(key)?.chats ?? 0,
      messages: counts.get(key)?.messages ?? 0,
    };
  });
}

export function AdminAnalyticsShell() {
  const [range, setRange] = useState<RangeDays>(7);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failedMessageLoads, setFailedMessageLoads] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedChats = await apiFetchChats();
      const messageResults = await Promise.allSettled(
        loadedChats.map((chat) => apiFetchMessages(chat.id)),
      );
      const loadedMessages = messageResults
        .filter((result): result is PromiseFulfilledResult<Message[]> => result.status === "fulfilled")
        .flatMap((result) => result.value);
      setChats(loadedChats);
      setMessages(loadedMessages);
      const failed = messageResults.filter((result) => result.status === "rejected").length;
      setFailedMessageLoads(failed);
      if (failed > 0) {
        setError(`${failed} conversation${failed === 1 ? "" : "s"} could not be read; message totals may be incomplete.`);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load usage analytics.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const activityDays = useMemo(() => buildActivityDays(range, chats, messages), [chats, messages, range]);
  const rangeChats = activityDays.reduce((total, day) => total + day.chats, 0);
  const rangeMessages = activityDays.reduce((total, day) => total + day.messages, 0);
  const activeDays = activityDays.filter((day) => day.chats > 0 || day.messages > 0).length;
  const peakMessages = Math.max(...activityDays.map((day) => day.messages), 1);

  return (
    <AdminShell activeSection="activity">
      <header className="ic-admin-header">
        <div>
          <span className="ic-admin-eyebrow">Workspace control center</span>
          <h1 id="admin-page-title">Usage analytics</h1>
          <p>Understand local conversation activity without sending telemetry anywhere.</p>
        </div>
        <div className="ic-admin-header-chip">Local data only</div>
      </header>

      {error ? <div className="ic-admin-stats-error" role="status">{error}</div> : null}

      <div className="ic-admin-analytics-toolbar">
        <div className="ic-admin-filter-group" aria-label="Analytics date range">
          {([7, 30, 90] as RangeDays[]).map((option) => (
            <button key={option} type="button" className={`ic-admin-filter-button${range === option ? " is-active" : ""}`} onClick={() => setRange(option)}>
              Last {option} days
            </button>
          ))}
        </div>
        <button type="button" className="ic-admin-refresh-button" onClick={() => void loadAnalytics()} disabled={isLoading}>
          {isLoading ? "Loading…" : "Refresh data"}
        </button>
      </div>

      <div className="ic-admin-runtime-grid">
        <article className="ic-admin-runtime-card">
          <span className="ic-admin-card-kicker">Chats in range</span>
          <strong>{isLoading ? "—" : rangeChats}</strong>
          <span>Conversation starts</span>
        </article>
        <article className="ic-admin-runtime-card">
          <span className="ic-admin-card-kicker">Messages in range</span>
          <strong>{isLoading ? "—" : rangeMessages}</strong>
          <span>Loaded durable messages</span>
        </article>
        <article className="ic-admin-runtime-card">
          <span className="ic-admin-card-kicker">Active days</span>
          <strong>{isLoading ? "—" : `${activeDays}/${range}`}</strong>
          <span>Days with chat activity</span>
        </article>
      </div>

      <section className="ic-admin-analytics-panel" aria-labelledby="activity-chart-title">
        <div className="ic-admin-panel-header">
          <div>
            <span className="ic-admin-card-kicker">Daily activity</span>
            <strong id="activity-chart-title">Messages by day</strong>
          </div>
          {failedMessageLoads > 0 ? <span className="ic-admin-detail-meta">Partial data</span> : <span className="ic-admin-detail-meta">Complete read</span>}
        </div>
        <div className="ic-admin-activity-chart">
          {activityDays.map((day) => (
            <div key={day.key} className="ic-admin-activity-day" title={`${day.label}: ${day.messages} messages, ${day.chats} chats`}>
              <div className="ic-admin-activity-bar-wrap">
                <div className="ic-admin-activity-bar" style={{ height: `${Math.max((day.messages / peakMessages) * 100, day.messages > 0 ? 8 : 2)}%` }} />
              </div>
              <strong>{day.messages}</strong>
              <span>{day.label}</span>
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
