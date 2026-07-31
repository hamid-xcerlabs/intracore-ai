"use client";


// React hooks manage component state, lifecycle, and memoised actions.
import {
  useCallback,
  useEffect,
  useRef,
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


// This type mirrors the backend durable MessageResponse schema.
type Message = {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  sequence_number: number;
  model_name: string | null;
  created_at: string;
};


// This type mirrors the backend DurableGenerationResponse schema.
type DurableGenerationResponse = {
  user_message: Message;
  assistant_message: Message;
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

  // Store the selected conversation's durable ordered messages.
  const [messages, setMessages] = useState<Message[]>([]);

  // Identify which chat owns the currently loaded message result.
  const [messagesChatId, setMessagesChatId] = useState<number | null>(null);

  // Track message-history loading independently from sidebar loading.
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Associate message errors with a chat so stale errors are not displayed.
  const [messageError, setMessageError] = useState<{
    chatId: number;
    message: string;
  } | null>(null);

  // Store the controlled composer text for the active conversation.
  const [draftMessage, setDraftMessage] = useState("");

  // Prevent duplicate submissions while one save request is running.
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Identify which conversation owns the pending generation placeholder.
  const [sendingChatId, setSendingChatId] = useState<number | null>(null);

  // Associate submission failures with the chat that produced them.
  const [sendError, setSendError] = useState<{
    chatId: number;
    message: string;
  } | null>(null);

  // Keep slow send responses aware of the latest selected conversation.
  const activeChatIdRef = useRef(activeChatId);

  // Generate local negative IDs that cannot collide with SQLite message IDs.
  const nextOptimisticMessageIdRef = useRef(-1);


  // Load all persistent chats from the FastAPI backend.
  const loadChats = useCallback(async () => {
    // Begin state updates after the effect's synchronous execution finishes.
    await Promise.resolve();

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
    // Defer the async state transition until after the effect has subscribed.
    const timeoutId = window.setTimeout(() => {
      void loadChats();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadChats]);


  // Keep asynchronous send completion aligned with the latest selection.
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);


  // Load durable history whenever the existing active-chat selection changes.
  useEffect(() => {
    // No message request is needed when no conversation is selected.
    if (activeChatId === null) {
      return;
    }

    // Cancel obsolete requests when users switch conversations quickly.
    const controller = new AbortController();
    const requestedChatId = activeChatId;

    async function loadMessages() {
      // Begin state updates after the effect's synchronous execution finishes.
      await Promise.resolve();

      // Stop before changing state if this selection is already obsolete.
      if (controller.signal.aborted) {
        return;
      }

      // Invalidate the previous chat's stored result before fetching this one.
      setMessages([]);
      setMessagesChatId(null);
      setMessageError(null);
      setDraftMessage("");
      setSendError(null);
      setIsLoadingMessages(true);

      try {
        // Request the selected conversation's durable ordered history.
        const response = await fetch(
          `${API_BASE_URL}/chats/${requestedChatId}/messages`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        // Convert backend failures into a controlled message-area error.
        if (!response.ok) {
          throw new Error(
            `Could not load messages (${response.status}).`,
          );
        }

        // Parse the response using the durable frontend message contract.
        const loadedMessages = (await response.json()) as Message[];

        // Ignore a response if its request was cancelled during chat switching.
        if (controller.signal.aborted) {
          return;
        }

        setMessages(loadedMessages);
        setMessagesChatId(requestedChatId);
      } catch (requestError) {
        // Aborted requests are expected when the selected chat changes.
        if (
          controller.signal.aborted ||
          (
            requestError instanceof DOMException &&
            requestError.name === "AbortError"
          )
        ) {
          return;
        }

        const message =
          requestError instanceof Error
            ? requestError.message
            : "Could not load this conversation.";

        setMessageError({
          chatId: requestedChatId,
          message,
        });
      } finally {
        // An obsolete request must not change the current loading state.
        if (!controller.signal.aborted) {
          setIsLoadingMessages(false);
        }
      }
    }

    void loadMessages();

    // Abort the current request before loading another selected chat.
    return () => controller.abort();
  }, [activeChatId]);


  // Save one durable user/assistant turn through POST /chats/{id}/messages.
  async function sendMessage() {
    // Submission requires a loaded active chat and no pending save.
    if (
      activeChatId === null ||
      isMessageViewLoading ||
      isSendingMessage
    ) {
      return;
    }

    const cleanContent = draftMessage.trim();
    const targetChatId = activeChatId;

    if (!cleanContent) {
      setSendError({
        chatId: targetChatId,
        message: "Message cannot be empty.",
      });
      return;
    }

    // Build a temporary user message for immediate optimistic rendering.
    const optimisticMessageId = nextOptimisticMessageIdRef.current;
    nextOptimisticMessageIdRef.current -= 1;

    const optimisticSequenceNumber =
      messages.reduce(
        (highestSequence, message) =>
          Math.max(highestSequence, message.sequence_number),
        0,
      ) + 1;

    const optimisticMessage: Message = {
      id: optimisticMessageId,
      chat_id: targetChatId,
      role: "user",
      content: cleanContent,
      sequence_number: optimisticSequenceNumber,
      model_name: null,
      created_at: new Date().toISOString(),
    };

    setIsSendingMessage(true);
    setSendingChatId(targetChatId);
    setSendError(null);
    setMessages((currentMessages) =>
      [
        ...currentMessages,
        optimisticMessage,
      ].sort(
        (firstMessage, secondMessage) =>
          firstMessage.sequence_number -
          secondMessage.sequence_number,
      ),
    );
    setMessagesChatId(targetChatId);
    setDraftMessage("");

    // Retain the HTTP status so 503 can trigger authoritative history reload.
    let responseStatus: number | null = null;

    try {
      // The backend controls role, sequence number, and model attribution.
      const response = await fetch(
        `${API_BASE_URL}/chats/${targetChatId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: cleanContent,
          }),
        },
      );

      if (!response.ok) {
        responseStatus = response.status;

        // Prefer the backend's controlled public error detail when available.
        let errorMessage = `Could not generate response (${response.status}).`;

        try {
          const errorBody = (await response.json()) as {
            detail?: unknown;
          };

          if (typeof errorBody.detail === "string") {
            errorMessage = errorBody.detail;
          }
        } catch {
          // Keep the status-based fallback for non-JSON failures.
        }

        throw new Error(
          errorMessage,
        );
      }

      // Parse both authoritative durable records returned by FastAPI.
      const generatedTurn =
        (await response.json()) as DurableGenerationResponse;

      // Ignore an old chat's response after the user changes selection.
      if (activeChatIdRef.current !== targetChatId) {
        return;
      }

      // Replace the optimistic record and deduplicate authoritative messages.
      setMessages((currentMessages) => {
        const authoritativeMessages = [
          ...currentMessages.filter(
            (message) => message.id !== optimisticMessageId,
          ),
          generatedTurn.user_message,
          generatedTurn.assistant_message,
        ];

        return Array.from(
          new Map(
            authoritativeMessages.map((message) => [
              message.id,
              message,
            ]),
          ).values(),
        ).sort(
          (firstMessage, secondMessage) =>
            firstMessage.sequence_number -
            secondMessage.sequence_number,
        );
      });
      setMessagesChatId(targetChatId);
      setSendError(null);
    } catch (requestError) {
      // Never retain a failed request's temporary local message.
      setMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.id !== optimisticMessageId,
        ),
      );

      const message =
        requestError instanceof Error
          ? requestError.message
          : "Could not save this message.";

      setSendError({
        chatId: targetChatId,
        message,
      });

      // A 503 may still have a committed durable user message.
      if (responseStatus === 503) {
        try {
          const historyResponse = await fetch(
            `${API_BASE_URL}/chats/${targetChatId}/messages`,
            {
              method: "GET",
              cache: "no-store",
            },
          );

          if (historyResponse.ok) {
            const durableMessages =
              (await historyResponse.json()) as Message[];

            // Do not replace another chat's visible message history.
            if (activeChatIdRef.current === targetChatId) {
              setMessages(
                [...durableMessages].sort(
                  (firstMessage, secondMessage) =>
                    firstMessage.sequence_number -
                    secondMessage.sequence_number,
                ),
              );
              setMessagesChatId(targetChatId);
            }
          }
        } catch {
          // Preserve the controlled generation error if history reload fails.
        }
      }
    } finally {
      setIsSendingMessage(false);
      setSendingChatId(null);
    }
  }


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

  // Render messages only when they belong to the current active chat.
  const activeMessages =
    messagesChatId === activeChatId ? messages : [];

  // Render errors only for the chat that produced them.
  const activeMessageError =
    messageError?.chatId === activeChatId
      ? messageError.message
      : null;

  // Render submission failures only inside their originating conversation.
  const activeSendError =
    sendError?.chatId === activeChatId
      ? sendError.message
      : null;

  // A changed chat remains loading until its own result has arrived.
  const isMessageViewLoading =
    activeChatId !== null &&
    activeMessageError === null &&
    (
      isLoadingMessages ||
      messagesChatId !== activeChatId
    );

  // Show generation feedback only in the conversation that owns the request.
  const isActiveChatGenerating =
    isSendingMessage &&
    sendingChatId === activeChatId;


  return (
    <main className="flex h-dvh overflow-hidden bg-[#f5f2ee] text-[#2c2831]">
      {/* Sidebar now renders real SQLite-backed conversations. */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-[#e6e0e8] bg-[#f8f6f3] md:flex">
        <div className="border-b border-[#e8e3e9] p-4">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#dcd2e8] bg-gradient-to-br from-[#f6f1ff] to-[#e7dcf8] text-sm font-bold text-[#6e5597] shadow-sm shadow-[#8e72b8]/10">
              IC
            </div>

            <div>
              <p className="text-sm font-semibold tracking-[-0.01em]">
                IntraCore AI
              </p>
              <p className="text-xs text-[#807886]">
                Local workspace
              </p>
            </div>
          </div>

          {/* This button now creates a durable SQLite chat. */}
          <button
            type="button"
            onClick={() => void createChat()}
            disabled={isCreatingChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d8cce7] bg-[#eee7f8] px-4 py-2.5 text-sm font-medium text-[#5d477d] shadow-sm shadow-[#8f76ad]/10 transition hover:border-[#cdbce1] hover:bg-[#e8def5] disabled:cursor-wait disabled:opacity-60"
          >
            <span className="text-lg leading-none">+</span>
            {isCreatingChat ? "Creating..." : "New chat"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9a919e]">
            Recent
          </p>

          {/* Display backend connectivity errors inside the relevant area. */}
          {error ? (
            <div className="mx-2 mb-3 rounded-xl border border-[#edc9c9] bg-[#fff4f3] p-3 text-xs leading-5 text-[#9f4545]">
              {error}
            </div>
          ) : null}

          {/* Initial API loading state. */}
          {isLoadingChats ? (
            <p className="px-2 py-3 text-sm text-[#918994]">
              Loading chats...
            </p>
          ) : null}

          {/* Empty state appears before the first persistent chat is created. */}
          {!isLoadingChats && chats.length === 0 ? (
            <p className="px-2 py-3 text-sm leading-6 text-[#918994]">
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
                  className={`group flex items-center rounded-xl border transition ${
                    isActive
                      ? "border-[#ded2ea] bg-[#eee8f6] shadow-sm shadow-[#8f76ad]/5"
                      : "border-transparent hover:border-[#e9e3e9] hover:bg-white/70"
                  }`}
                >
                  {/* Selecting a row updates the active local conversation. */}
                  <button
                    type="button"
                    onClick={() => setActiveChatId(chat.id)}
                    className={`min-w-0 flex-1 px-3 py-2.5 text-left text-sm ${
                      isActive
                        ? "font-medium text-[#5e497b]"
                        : "text-[#6f6873] group-hover:text-[#343039]"
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
                    className="mr-2 flex h-7 w-7 items-center justify-center rounded-lg text-sm text-[#aaa1ad] opacity-0 transition hover:bg-[#e4d9ee] hover:text-[#684f86] group-hover:opacity-100 focus:opacity-100"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[#e8e3e9] p-4">
          <div className="rounded-2xl border border-[#e6e0e7] bg-white/70 p-3 shadow-sm shadow-[#75627f]/5">
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-[#4e4852]">
                Local mode
              </span>
            </div>

            <p className="text-xs leading-5 text-[#867e89]">
              Your current runtime is configured to stay on this device.
            </p>
          </div>
        </div>
      </aside>

      {/* Main workspace renders the active durable conversation. */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#fcfbf9]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#ebe6eb] bg-white/70 px-4 backdrop-blur md:px-7">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-[-0.01em] text-[#332e38]">
              {activeChat?.title ?? "New chat"}
            </p>

            <p className="truncate text-xs text-[#918895]">
              {activeChat
                ? `Persistent local conversation #${activeChat.id}`
                : "Create a conversation to begin"}
            </p>
          </div>

          <div
            aria-label="Active local model"
            className="ml-4 flex shrink-0 items-center gap-2 rounded-xl border border-[#e2dce4] bg-white px-3 py-2 text-xs text-[#655e69] shadow-sm shadow-[#75627f]/5"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>deepseek-r1:1.5b</span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 md:py-12">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center">
              {!activeChat ? (
                <div className="text-center">
                  <div className="intracore-orb mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full text-base font-semibold text-[#6b528e]">
                    IC
                  </div>

                  <p className="mb-2 text-sm font-medium text-[#8d73b2]">
                    Private by design
                  </p>

                  <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#29252e] md:text-4xl">
                    What are you working on?
                  </h1>

                  <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#7e7681] md:text-base">
                    Create a durable local conversation from the sidebar to begin.
                  </p>
                </div>
              ) : null}

              {activeChat && isMessageViewLoading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-[#827987]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#ad93cf]" />
                  Loading messages...
                </div>
              ) : null}

              {activeChat && activeMessageError ? (
                <div className="mx-auto w-full max-w-xl rounded-2xl border border-[#edc9c9] bg-[#fff4f3] p-4 text-sm leading-6 text-[#9f4545] shadow-sm">
                  {activeMessageError}
                </div>
              ) : null}

              {activeChat &&
              !isMessageViewLoading &&
              !activeMessageError &&
              !isActiveChatGenerating &&
              activeMessages.length === 0 ? (
                <div className="text-center">
                  <div className="intracore-orb mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full text-base font-semibold text-[#6b528e]">
                    IC
                  </div>

                  <p className="mb-2 text-sm font-medium text-[#8d73b2]">
                    A fresh local conversation
                  </p>

                  <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#29252e] md:text-4xl">
                    {activeChat.title}
                  </h1>

                  <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#7e7681] md:text-base">
                    This conversation has no messages yet.
                  </p>
                </div>
              ) : null}

              {activeChat &&
              !isMessageViewLoading &&
              !activeMessageError &&
              (activeMessages.length > 0 || isActiveChatGenerating) ? (
                <div className="space-y-7 py-2">
                  {activeMessages.map((message) => {
                    const isUser = message.role === "user";

                    return (
                      <div
                        key={message.id}
                        className={`flex items-start gap-3 ${
                          isUser ? "justify-end" : "justify-start"
                        }`}
                      >
                        {!isUser ? (
                          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#ded4e8] bg-[#f1ebf8] text-[10px] font-bold text-[#725793]">
                            IC
                          </div>
                        ) : null}

                        <div
                          className={`text-sm leading-7 ${
                            isUser
                              ? "max-w-[85%] rounded-2xl rounded-br-md border border-[#ddd1e8] bg-[#eee8f7] px-4 py-3 text-[#3e3449] shadow-sm shadow-[#80649e]/10 sm:max-w-[75%]"
                              : "min-w-0 max-w-[calc(100%_-_2.75rem)] flex-1 py-1 text-[#403a44]"
                          }`}
                        >
                          {!isUser ? (
                            <p className="mb-1 text-xs font-semibold text-[#6c567f]">
                              IntraCore
                            </p>
                          ) : null}

                          <p className="whitespace-pre-wrap break-words">
                            {message.content}
                          </p>
                        </div>
                      </div>
                    );
                  })}

                  {isActiveChatGenerating ? (
                    <div className="flex items-start gap-3" aria-live="polite">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#ded4e8] bg-[#f1ebf8] text-[10px] font-bold text-[#725793]">
                        IC
                      </div>

                      <div className="min-w-0 flex-1 py-1">
                        <p className="mb-2 text-xs font-semibold text-[#6c567f]">
                          IntraCore
                        </p>

                        <div
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#e2d9ea] bg-white px-3.5 py-2.5 shadow-sm shadow-[#80649e]/5"
                          aria-label="Generating response"
                        >
                          <span className="intracore-thinking-dot" />
                          <span className="intracore-thinking-dot" />
                          <span className="intracore-thinking-dot" />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 bg-gradient-to-t from-[#fcfbf9] via-[#fcfbf9] to-transparent px-4 pb-5 pt-3 md:px-6">
            <div className="mx-auto max-w-3xl">
              <div
                className={`rounded-[1.4rem] border bg-white/95 p-3 shadow-[0_18px_50px_-26px_rgba(74,58,90,0.38)] transition ${
                  isSendingMessage
                    ? "border-[#ded5e7] opacity-90"
                    : "border-[#ddd7df] focus-within:border-[#bca9d3] focus-within:shadow-[0_20px_55px_-26px_rgba(105,77,139,0.45)]"
                }`}
              >
                <textarea
                  rows={2}
                  value={draftMessage}
                  onChange={(event) => {
                    setDraftMessage(event.target.value);

                    if (activeSendError) {
                      setSendError(null);
                    }
                  }}
                  disabled={
                    !activeChat ||
                    isMessageViewLoading ||
                    isSendingMessage
                  }
                  placeholder={
                    !activeChat
                      ? "Create a chat first"
                      : "Message IntraCore AI"
                  }
                  className="max-h-48 min-h-14 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-[#332e38] outline-none placeholder:text-[#a39ba6] disabled:cursor-not-allowed disabled:text-[#8e8791]"
                />

                <div className="flex items-center justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={
                      !activeChat ||
                      isMessageViewLoading ||
                      isSendingMessage ||
                      draftMessage.trim().length === 0
                    }
                    aria-label="Send message"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#79609a] text-white shadow-sm shadow-[#72558f]/25 transition hover:bg-[#6f558f] disabled:cursor-not-allowed disabled:bg-[#ded8e2] disabled:text-[#9d95a1] disabled:shadow-none"
                  >
                    &uarr;
                  </button>
                </div>
              </div>

              {!isSendingMessage && activeSendError ? (
                <p
                  className="mt-3 text-center text-xs text-[#a34848]"
                  role="alert"
                >
                  {activeSendError}
                </p>
              ) : null}

              <p className="mt-3 text-center text-[11px] text-[#9a929d]">
                IntraCore can make mistakes. Verify important information.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
