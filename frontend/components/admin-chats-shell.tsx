"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "./admin-shell";
import {
  apiDeleteChat,
  apiExportChat,
  apiFetchChats,
  apiFetchMessages,
  type Chat,
  type Message,
} from "../lib/api";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export function AdminChatsShell() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    setIsLoadingChats(true);
    setError(null);
    try {
      const loadedChats = await apiFetchChats();
      setChats(loadedChats);
      setSelectedChatId((current) =>
        current !== null && loadedChats.some((chat) => chat.id === current)
          ? current
          : loadedChats[0]?.id ?? null,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load chats.",
      );
    } finally {
      setIsLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null;
  const filteredChats = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return chats;
    return chats.filter((chat) =>
      `${chat.title} ${chat.id}`.toLocaleLowerCase().includes(query),
    );
  }, [chats, search]);

  const loadSelectedMessages = useCallback(async () => {
    if (selectedChatId === null) return;
    setIsLoadingMessages(true);
    setMessageError(null);
    try {
      setMessages(await apiFetchMessages(selectedChatId));
    } catch (requestError) {
      setMessages([]);
      setMessageError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load this conversation.",
      );
    } finally {
      setIsLoadingMessages(false);
    }
  }, [selectedChatId]);

  useEffect(() => {
    void loadSelectedMessages();
  }, [loadSelectedMessages]);

  async function exportSelectedChat() {
    if (!selectedChat || isExporting) return;
    setIsExporting(true);
    try {
      const blob = await apiExportChat(selectedChat.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not export this chat.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function deleteSelectedChat() {
    if (!selectedChat || deletingChatId !== null) return;
    if (!window.confirm(`Delete “${selectedChat.title}”? This cannot be undone.`)) {
      return;
    }
    setDeletingChatId(selectedChat.id);
    setError(null);
    try {
      await apiDeleteChat(selectedChat.id);
      setChats((current) => current.filter((chat) => chat.id !== selectedChat.id));
      setSelectedChatId(null);
      setMessages([]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not delete this chat.",
      );
    } finally {
      setDeletingChatId(null);
    }
  }

  return (
    <AdminShell activeSection="chats">
      <header className="ic-admin-header">
        <div>
          <span className="ic-admin-eyebrow">Workspace control center</span>
          <h1 id="admin-page-title">Chat management</h1>
          <p>Inspect, export, and safely remove local conversations.</p>
        </div>
        <div className="ic-admin-header-chip">{chats.length} conversations</div>
      </header>

      {error ? <div className="ic-admin-stats-error" role="status">{error}</div> : null}

      <div className="ic-admin-chat-layout">
        <section className="ic-admin-chat-list-panel" aria-label="Conversation list">
          <div className="ic-admin-panel-header">
            <div>
              <span className="ic-admin-card-kicker">Conversations</span>
              <strong>{filteredChats.length} shown</strong>
            </div>
            <button type="button" className="ic-admin-refresh-button" onClick={() => void loadChats()} disabled={isLoadingChats}>
              {isLoadingChats ? "Loading…" : "Refresh"}
            </button>
          </div>
          <label className="ic-admin-search-label" htmlFor="admin-chat-search">Search chats</label>
          <input
            id="admin-chat-search"
            className="ic-admin-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or ID"
          />
          <div className="ic-admin-chat-list">
            {isLoadingChats ? <p className="ic-admin-list-state">Loading conversations…</p> : null}
            {!isLoadingChats && filteredChats.length === 0 ? (
              <p className="ic-admin-list-state">No conversations found.</p>
            ) : null}
            {filteredChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`ic-admin-chat-row${selectedChatId === chat.id ? " is-selected" : ""}`}
                onClick={() => setSelectedChatId(chat.id)}
              >
                <span className="ic-admin-chat-row-title">{chat.title || "Untitled"}</span>
                <span className="ic-admin-chat-row-meta">#{chat.id} · {chat.message_count} messages</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ic-admin-chat-detail" aria-label="Conversation details">
          {selectedChat ? (
            <>
              <div className="ic-admin-panel-header">
                <div>
                  <span className="ic-admin-card-kicker">Chat #{selectedChat.id}</span>
                  <h2>{selectedChat.title || "Untitled"}</h2>
                  <span className="ic-admin-detail-meta">Updated {formatDate(selectedChat.updated_at)}</span>
                </div>
                <div className="ic-admin-detail-actions">
                  <button type="button" className="ic-admin-refresh-button" onClick={() => void exportSelectedChat()} disabled={isExporting}>
                    {isExporting ? "Exporting…" : "Export Markdown"}
                  </button>
                  <button type="button" className="ic-admin-danger-button" onClick={() => void deleteSelectedChat()} disabled={deletingChatId !== null}>
                    {deletingChatId !== null ? "Deleting…" : "Delete chat"}
                  </button>
                </div>
              </div>
              <div className="ic-admin-message-preview">
                {isLoadingMessages ? <p className="ic-admin-list-state">Loading messages…</p> : null}
                {messageError ? (
                  <div className="ic-admin-detail-error" role="status">
                    <span>{messageError}</span>
                    <button type="button" className="ic-admin-refresh-button" onClick={() => void loadSelectedMessages()} disabled={isLoadingMessages}>Retry</button>
                  </div>
                ) : null}
                {!isLoadingMessages && !messageError && messages.length === 0 ? <p className="ic-admin-list-state">This chat has no messages.</p> : null}
                {!isLoadingMessages && !messageError ? messages.map((message) => (
                  <article key={message.id} className="ic-admin-message-item">
                    <strong>{message.role}</strong>
                    <p>{message.content}</p>
                  </article>
                )) : null}
              </div>
            </>
          ) : (
            <div className="ic-admin-detail-empty">Select a conversation to inspect it.</div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
