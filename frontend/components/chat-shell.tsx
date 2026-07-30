"use client";


// React hooks manage component state, lifecycle, and memoised actions.
import {
  useCallback,
  useEffect,
  useState,
} from "react";


// This type mirrors the backend ChatResponse Pydantic schema.
// Keeping the contract explicit prevents the UI from guessing response fields.
type Chat = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};


// The browser-accessible FastAPI address.
// This remains centralised instead of being repeated across requests.
// It will later move into a frontend environment variable.
const API_BASE_URL = "http://127.0.0.1:8000";


// ChatShell renders the interactive IntraCore workspace.
export function ChatShell() {
  // Store durable chats returned by GET /chats.
  const [chats, setChats] = useState<Chat[]>([]);

  // Track the conversation currently selected in the sidebar.
  const [activeChatId, setActiveChatId] = useState<number | null>(null);

  // Track initial sidebar loading state.
  const [isLoadingChats, setIsLoadingChats] = useState(true);

  // Prevent duplicate chat creation while POST /chats is running.
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // Store a readable frontend error rather than failing silently.
  const [error, setError] = useState<string | null>(null);


  // Load all persistent chats from the FastAPI backend.
  const loadChats = useCallback(async () => {
    // Show loading state and clear stale failures before retrying.
    setIsLoadingChats(true);
    setError(null);

    try {
      // Request the durable conversation list.
      const response = await fetch(`${API_BASE_URL}/chats`, {
        method: "GET",
        cache: "no-store",
      });

      // Convert non-success HTTP responses into controlled frontend errors.
      if (!response.ok) {
        throw new Error(`Could not load chats (${response.status}).`);
      }

      // Parse the JSON response using the local Chat contract.
      const loadedChats = (await response.json()) as Chat[];

      // Replace temporary UI data with authoritative backend data.
      setChats(loadedChats);

      // Select the newest available chat when nothing is selected.
      setActiveChatId((currentId) => {
        if (
          currentId !== null &&
          loadedChats.some((chat) => chat.id === currentId)
        ) {
          return currentId;
        }

        return loadedChats[0]?.id ?? null;
      });
    } catch (requestError) {
      // Convert unknown JavaScript exceptions into readable UI text.
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Could not connect to the IntraCore backend.";

      setError(message);
    } finally {
      // End loading regardless of success or failure.
      setIsLoadingChats(false);
    }
  }, []);


  // Load persistent conversations when the interface first opens.
  useEffect(() => {
    void loadChats();
  }, [loadChats]);


  // Create one durable conversation through POST /chats.
  async function createChat() {
    // Prevent repeated clicks from creating duplicate conversations.
    if (isCreatingChat) {
      return;
    }

    setIsCreatingChat(true);
    setError(null);

    try {
      // Send a validated chat-creation request to FastAPI.
      const response = await fetch(`${API_BASE_URL}/chats`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "New chat",
        }),
      });

      // Surface backend validation or availability failures.
      if (!response.ok) {
        throw new Error(`Could not create chat (${response.status}).`);
      }

      // Parse the newly persisted chat returned by the backend.
      const createdChat = (await response.json()) as Chat;

      // Put the newest conversation at the top of the sidebar immediately.
      setChats((currentChats) => [
        createdChat,
        ...currentChats,
      ]);

      // Open the newly created conversation.
      setActiveChatId(createdChat.id);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Could not create a new chat.";

      setError(message);
    } finally {
      setIsCreatingChat(false);
    }
  }


  // Delete one durable conversation through DELETE /chats/{id}.
  async function deleteChat(chatId: number) {
    setError(null);

    try {
      // Request permanent deletion from SQLite through FastAPI.
      const response = await fetch(
        `${API_BASE_URL}/chats/${chatId}`,
        {
          method: "DELETE",
        },
      );

      // A successful deletion returns HTTP 204.
      if (!response.ok) {
        throw new Error(`Could not delete chat (${response.status}).`);
      }

      // Remove the deleted record from frontend state.
      setChats((currentChats) => {
        const remainingChats = currentChats.filter(
          (chat) => chat.id !== chatId,
        );

        // Select the next available chat when the active chat was deleted.
        if (activeChatId === chatId) {
          setActiveChatId(remainingChats[0]?.id ?? null);
        }

        return remainingChats;
      });
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Could not delete the chat.";

      setError(message);
    }
  }


  // Resolve the selected chat object for the workspace header.
  const activeChat =
    chats.find((chat) => chat.id === activeChatId) ?? null;


  return (
    <main className="flex h-screen overflow-hidden bg-[#101010] text-[#f4f4f4]">
      {/* Sidebar now renders real SQLite-backed conversations. */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-white/10 bg-[#171717] md:flex">
        <div className="border-b border-white/10 p-4">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-black">
              IC
            </div>

            <div>
              <p className="text-sm font-semibold">IntraCore AI</p>
              <p className="text-xs text-white/45">
                Local workspace
              </p>
            </div>
          </div>

          {/* This button now creates a durable SQLite chat. */}
          <button
            type="button"
            onClick={() => void createChat()}
            disabled={isCreatingChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="text-lg leading-none">+</span>
            {isCreatingChat ? "Creating..." : "New chat"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <p className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
            Recent
          </p>

          {/* Display backend connectivity errors inside the relevant area. */}
          {error ? (
            <div className="mx-2 mb-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs leading-5 text-red-200">
              {error}
            </div>
          ) : null}

          {/* Initial API loading state. */}
          {isLoadingChats ? (
            <p className="px-2 py-3 text-sm text-white/35">
              Loading chats...
            </p>
          ) : null}

          {/* Empty state appears before the first persistent chat is created. */}
          {!isLoadingChats && chats.length === 0 ? (
            <p className="px-2 py-3 text-sm leading-6 text-white/35">
              No conversations yet. Create your first local chat.
            </p>
          ) : null}

          {/* Render one durable conversation row. */}
          <div className="space-y-1">
            {chats.map((chat) => {
              const isActive = chat.id === activeChatId;

              return (
                <div
                  key={chat.id}
                  className={`group flex items-center rounded-lg transition ${
                    isActive
                      ? "bg-white/10"
                      : "hover:bg-white/5"
                  }`}
                >
                  {/* Selecting a row updates the active local conversation. */}
                  <button
                    type="button"
                    onClick={() => setActiveChatId(chat.id)}
                    className={`min-w-0 flex-1 px-3 py-2.5 text-left text-sm ${
                      isActive
                        ? "text-white"
                        : "text-white/60 group-hover:text-white"
                    }`}
                  >
                    <span className="block truncate">
                      {chat.title}
                    </span>
                  </button>

                  {/* Temporary visible delete control.
                      A polished menu can replace this later. */}
                  <button
                    type="button"
                    onClick={() => void deleteChat(chat.id)}
                    aria-label={`Delete ${chat.title}`}
                    className="mr-2 flex h-7 w-7 items-center justify-center rounded-md text-xs text-white/25 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium">
                Local mode
              </span>
            </div>

            <p className="text-xs leading-5 text-white/40">
              Your current runtime is configured to stay on this device.
            </p>
          </div>
        </div>
      </aside>

      {/* Main workspace remains visually ready for message persistence. */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 md:px-6">
          <div>
            <p className="text-sm font-medium">
              {activeChat?.title ?? "New chat"}
            </p>

            <p className="text-xs text-white/35">
              {activeChat
                ? `Persistent local conversation #${activeChat.id}`
                : "Create a conversation to begin"}
            </p>
          </div>

          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>deepseek-r1:1.5b</span>
            <span className="text-white/35">⌄</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
            <div className="w-full max-w-2xl text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-xl font-semibold">
                IC
              </div>

              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                {activeChat
                  ? activeChat.title
                  : "What are you working on?"}
              </h1>

              <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-white/45 md:text-base">
                {activeChat
                  ? "This conversation is now stored locally in SQLite. Message persistence is the next milestone."
                  : "Create a durable local conversation from the sidebar to begin."}
              </p>
            </div>
          </div>

          <div className="shrink-0 px-4 pb-5 md:px-6">
            <div className="mx-auto max-w-3xl">
              <div className="rounded-2xl border border-white/10 bg-[#1c1c1c] p-3 shadow-2xl shadow-black/20">
                <textarea
                  rows={2}
                  disabled={!activeChat}
                  placeholder={
                    activeChat
                      ? "Message IntraCore AI"
                      : "Create a chat first"
                  }
                  className="max-h-48 min-h-14 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
                />

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    disabled
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-white/30"
                  >
                    +
                  </button>

                  <button
                    type="button"
                    disabled
                    className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg bg-white text-black opacity-40"
                  >
                    ↑
                  </button>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-white/30">
                IntraCore can make mistakes. Verify important information.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}