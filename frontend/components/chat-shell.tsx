"use client";

import Image from "next/image";
import {
  Children,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
  MotionConfig,
} from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Chat = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  sequence_number: number;
  model_name: string | null;
  created_at: string;
};

type ChatModelOption = {
  name: string;
  installed: boolean;
  selectable: boolean;
  family: string | null;
  parameter_size: string | null;
  quantization_level: string | null;
};

type ChatModelListResponse = {
  default_model: string | null;
  models: ChatModelOption[];
};

type StreamLifecycle =
  | "starting"
  | "thinking"
  | "streaming"
  | "stopped"
  | "interrupted";

type StreamingAssistant = {
  requestId: number;
  chatId: number;
  optimisticMessageId: number;
  content: string;
  status: StreamLifecycle;
  startedAt: number;
};

type StreamingEvent =
  | { type: "response_started"; chat_id: number }
  | { type: "user_message"; message: Message }
  | { type: "assistant_delta"; delta: string }
  | { type: "assistant_message"; message: Message }
  | { type: "chat_title_updated"; chat: Chat }
  | { type: "response_stopped"; message: string }
  | {
      type: "error";
      code: string;
      message: string;
      user_message_saved: boolean;
    };

const API_BASE_URL = "http://127.0.0.1:8000";
const MODEL_PREFERENCE_KEY = "intracore.chatModel";

const PRE_RESPONSE_STATUS_LABELS = [
  "Reading your request",
  "Reviewing conversation",
  "Working through context",
  "Building a response",
] as const;

const PRE_RESPONSE_STATUS_DURATION_MS = 10000;

const ANIMATED_EMOJI_PATTERN =
  /((?:\p{Regional_Indicator}{2})|(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*))/gu;

const EMOJI_ONLY_PATTERN =
  /^(?:\p{Regional_Indicator}{2})$|^(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)$/u;

function animatedEmojiText(content: string) {
  return content
    .split(ANIMATED_EMOJI_PATTERN)
    .filter(Boolean)
    .map((part, index) =>
      EMOJI_ONLY_PATTERN.test(part) ? (
        <span
          key={`emoji-${index}-${part}`}
          className="ic-animated-emoji"
          aria-label={part}
          role="img"
        >
          {part}
        </span>
      ) : (
        part
      ),
    );
}

function animatedEmojiChildren(children: ReactNode) {
  return Children.map(children, (child) =>
    typeof child === "string"
      ? animatedEmojiText(child)
      : child,
  );
}

function AnimatedMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p>{animatedEmojiChildren(children)}</p>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function markdownForStreaming(content: string): string {
  const fenceCount = (content.match(/(^|\n)```/g) ?? []).length;

  return fenceCount % 2 === 0
    ? content
    : `${content}\n\n\`\`\``;
}

function parseApiDate(value: string): Date {
  const hasExplicitTimezone =
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);

  // SQLite CURRENT_TIMESTAMP is UTC, but its serialized value can omit the
  // timezone suffix. Mark such values as UTC before converting them locally.
  return new Date(
    hasExplicitTimezone ? value : `${value}Z`,
  );
}

function formatMessageTime(value: string): string {
  const date = parseApiDate(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatChatDate(value: string): string {
  const date = parseApiDate(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return formatMessageTime(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function updateChatActivity(
  chats: Chat[],
  chatId: number,
  updatedAt: string,
): Chat[] {
  return chats
    .map((chat) =>
      chat.id === chatId
        ? { ...chat, updated_at: updatedAt }
        : chat,
    )
    .sort((first, second) => {
      const timeDifference =
        parseApiDate(second.updated_at).getTime() -
        parseApiDate(first.updated_at).getTime();

      return timeDifference || second.id - first.id;
    });
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (first, second) =>
      first.sequence_number - second.sequence_number,
  );
}

function uniqueMessages(messages: Message[]): Message[] {
  return sortMessages(
    Array.from(
      new Map(
        messages.map((message) => [message.id, message]),
      ).values(),
    ),
  );
}

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 19V5m0 0-5.25 5.25M12 5l5.25 5.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <span
      className="ic-stop-square"
      aria-hidden="true"
    />
  );
}
function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8.5 9.5v7m3.5-7v7m3.5-7v7M5.5 6.5h13m-8.5-3h4l1 3h-6l1-3Zm-3 3 .7 13h9.6l.7-13"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.5 18.5 4 21l4-1.5c1.2.65 2.55 1 4 1 4.7 0 8.5-3.47 8.5-7.75S16.7 5 12 5s-8.5 3.47-8.5 7.75c0 2.25.77 4.25 2 5.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m6.5 8 3.5 3.5L13.5 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3.5v8m0 0 3-3m-3 3-3-3M4.5 15.5h11"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StreamingAssistantView({
  stream,
}: {
  stream: StreamingAssistant;
}) {
  const isActive =
    stream.status === "starting" ||
    stream.status === "thinking" ||
    stream.status === "streaming";

  const hasAnswer = stream.content.length > 0;

  const [statusClock, setStatusClock] = useState(() =>
    Date.now(),
  );

  useEffect(() => {
    if (hasAnswer || !isActive) {
      return;
    }

    const statusInterval = window.setInterval(() => {
      setStatusClock(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(statusInterval);
    };
  }, [hasAnswer, isActive]);

  const preResponseStatus =
    PRE_RESPONSE_STATUS_LABELS[
      Math.floor(
        Math.max(0, statusClock - stream.startedAt) /
          PRE_RESPONSE_STATUS_DURATION_MS,
      ) % PRE_RESPONSE_STATUS_LABELS.length
    ];

  const statusLabel =
    stream.status === "stopped"
      ? "Stopped"
      : stream.status === "interrupted"
        ? "Response interrupted"
        : hasAnswer
          ? "Responding"
          : "Thinking";

  return (
    <motion.article
      layout
      initial={{
        opacity: 0,
        y: 14,
        scale: 0.992,
      }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
      }}
      exit={{
        opacity: 0,
        y: -5,
        scale: 0.996,
      }}
      transition={{
        duration: 0.34,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="ic-message ic-message-assistant ic-stream-message"
    >
      <div className="ic-assistant-avatar ic-avatar-live">
        <Image
          className="ic-assistant-logo"
          src="/intracore-mark.png"
          alt=""
          width={32}
          height={32}
          aria-hidden="true"
        />
      </div>

      <div className="ic-assistant-column">
        <div className="ic-message-identity">
          <span>IntraCore</span>
          <span className="ic-message-time">
            {stream.status === "stopped"
              ? "Stopped"
              : stream.status === "interrupted"
                ? "Interrupted"
                : hasAnswer
                  ? "Streaming"
                  : preResponseStatus}
          </span>
        </div>

        <motion.section
          layout
          transition={{
            layout: {
              duration: 0.28,
              ease: [0.22, 1, 0.36, 1],
            },
          }}
          className={`ic-stream-card ${
            hasAnswer ? "has-answer" : "is-thinking"
          }`}
        >
          {isActive ? (
            <div
              className="ic-stream-light-beam"
              aria-hidden="true"
            />
          ) : null}

          <header
            className={`ic-stream-header ${
              hasAnswer ? "is-compact" : ""
            }`}
          >
            <div className="ic-stream-title">
              <AnimatePresence
                mode="wait"
                initial={false}
              >
                <motion.span
                  key={statusLabel}
                  initial={{
                    opacity: 0,
                    y: 4,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  exit={{
                    opacity: 0,
                    y: -4,
                  }}
                  transition={{
                    duration: 0.18,
                  }}
                  className="ic-stream-status"
                >
                  {statusLabel}
                </motion.span>
              </AnimatePresence>
            </div>

            <div className="ic-stream-meta">
              {isActive ? (
                <span
                  className="ic-activity-dots"
                  aria-hidden="true"
                >
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
            </div>
          </header>

          <AnimatePresence
            mode="wait"
            initial={false}
          >
            {!hasAnswer && isActive ? (
              <motion.div
                key="thinking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{
                  opacity: 0,
                  height: 0,
                  filter: "blur(4px)",
                }}
                transition={{
                  duration: 0.24,
                }}
                className="ic-thinking-stage"
              >
                Preparing a response
              </motion.div>
            ) : hasAnswer ? (
              <motion.div
                key="answer"
                layout
                initial={{
                  opacity: 0,
                  y: 7,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                transition={{
                  duration: 0.28,
                }}
                className="ic-stream-answer"
              >
                <div className="assistant-markdown">
                  <AnimatedMarkdown
                    content={markdownForStreaming(
                      stream.content,
                    )}
                  />
                </div>

                <AnimatePresence initial={false}>
                  {stream.status === "streaming" ? (
                    <motion.span
                      key="caret"
                      aria-hidden="true"
                      className="ic-stream-caret"
                      initial={{
                        opacity: 0,
                      }}
                      animate={{
                        opacity: 1,
                      }}
                      exit={{
                        opacity: 0,
                        scaleY: 0.55,
                      }}
                    />
                  ) : null}
                </AnimatePresence>

                {stream.status === "stopped" ? (
                  <p className="ic-stream-note ic-stream-note-stopped">
                    Stopped — this partial response is
                    not saved.
                  </p>
                ) : null}

                {stream.status === "interrupted" ? (
                  <p className="ic-stream-note ic-stream-note-error">
                    Response interrupted — this partial
                    response is not saved.
                  </p>
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="empty-status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="ic-stream-empty-status"
              >
                {stream.status === "stopped"
                  ? "Generation stopped before a visible response arrived."
                  : "The response was interrupted before text arrived."}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        <span
          className="ic-sr-only"
          aria-live="polite"
        >
          {stream.status === "starting" ||
          stream.status === "thinking"
            ? "Thinking"
            : stream.status === "streaming"
              ? "Response streaming"
              : stream.status === "stopped"
                ? "Stopped"
                : "Response interrupted"}
        </span>
      </div>
    </motion.article>
  );
}

export function ChatShell() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] =
    useState<number | null>(null);
  const [isLoadingChats, setIsLoadingChats] =
    useState(true);
  const [isCreatingChat, setIsCreatingChat] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const [modelOptions, setModelOptions] =
    useState<ChatModelOption[]>([]);
  const [selectedModelName, setSelectedModelName] =
    useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] =
    useState(true);
  const [modelError, setModelError] =
    useState<string | null>(null);
  const [modelNotice, setModelNotice] =
    useState<string | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] =
    useState(false);
  const [modelSearch, setModelSearch] = useState("");

  const [messages, setMessages] =
    useState<Message[]>([]);
  const [messagesChatId, setMessagesChatId] =
    useState<number | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] =
    useState(false);
  const [messageError, setMessageError] = useState<{
    chatId: number;
    message: string;
  } | null>(null);

  const [draftMessage, setDraftMessage] =
    useState("");
  const [isSendingMessage, setIsSendingMessage] =
    useState(false);
  const [
    streamingAssistant,
    setStreamingAssistant,
  ] = useState<StreamingAssistant | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] =
    useState(false);
  const [sendError, setSendError] = useState<{
    chatId: number;
    message: string;
  } | null>(null);

  const activeChatIdRef = useRef(activeChatId);
  const nextOptimisticMessageIdRef = useRef(-1);
  const nextStreamRequestIdRef = useRef(1);
  const activeStreamRequestIdRef =
    useRef<number | null>(null);
  const streamAbortControllerRef =
    useRef<AbortController | null>(null);
  const pendingAssistantDeltaRef = useRef("");
  const deltaFlushTimerRef =
    useRef<number | null>(null);
  const conversationScrollRef =
    useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  function clearDeltaFlushTimer() {
    if (deltaFlushTimerRef.current !== null) {
      window.clearTimeout(
        deltaFlushTimerRef.current,
      );
      deltaFlushTimerRef.current = null;
    }
  }

  function flushAssistantDeltas(
    requestId: number,
  ) {
    clearDeltaFlushTimer();

    const pendingDelta =
      pendingAssistantDeltaRef.current;

    pendingAssistantDeltaRef.current = "";

    if (!pendingDelta) {
      return;
    }

    setStreamingAssistant((current) => {
      if (current?.requestId !== requestId) {
        return current;
      }

      return {
        ...current,
        content: current.content + pendingDelta,
        status: "streaming",
      };
    });
  }

  function scheduleAssistantDeltaFlush(
    requestId: number,
  ) {
    if (deltaFlushTimerRef.current !== null) {
      return;
    }

    deltaFlushTimerRef.current =
      window.setTimeout(() => {
        flushAssistantDeltas(requestId);
      }, 40);
  }

  async function reloadDurableHistory(
    chatId: number,
  ) {
    try {
      const response = await fetch(
        `${API_BASE_URL}/chats/${chatId}/messages`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return;
      }

      const durableMessages =
        (await response.json()) as Message[];

      if (
        activeChatIdRef.current === chatId
      ) {
        setMessages(
          sortMessages(durableMessages),
        );
        setMessagesChatId(chatId);
      }
    } catch {
      // Keep the controlled stream state.
    }
  }

  const loadChats = useCallback(async () => {
    await Promise.resolve();

    setIsLoadingChats(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/chats`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(
          `Could not load chats (${response.status}).`,
        );
      }

      const loadedChats =
        (await response.json()) as Chat[];

      setChats(loadedChats);

      setActiveChatId((currentId) => {
        if (
          currentId !== null &&
          loadedChats.some(
            (chat) => chat.id === currentId,
          )
        ) {
          return currentId;
        }

        return loadedChats[0]?.id ?? null;
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not connect to the IntraCore backend.",
      );
    } finally {
      setIsLoadingChats(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    setModelError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/models`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          response.status === 503
            ? "Ollama is unavailable."
            : `Could not load models (${response.status}).`,
        );
      }

      const result =
        (await response.json()) as ChatModelListResponse;
      const selectableNames = new Set(
        result.models
          .filter((model) => model.selectable)
          .map((model) => model.name),
      );
      const storedModel = window.localStorage.getItem(
        MODEL_PREFERENCE_KEY,
      );
      const selectedModel =
        storedModel && selectableNames.has(storedModel)
          ? storedModel
          : result.default_model;

      setModelOptions(result.models);
      setSelectedModelName(selectedModel);

      if (selectedModel) {
        window.localStorage.setItem(
          MODEL_PREFERENCE_KEY,
          selectedModel,
        );
      } else {
        window.localStorage.removeItem(
          MODEL_PREFERENCE_KEY,
        );
      }
    } catch (requestError) {
      setModelOptions([]);
      setSelectedModelName(null);
      setModelError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load local models.",
      );
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadChats();
    }, 0);

    return () =>
      window.clearTimeout(timeoutId);
  }, [loadChats]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadModels();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadModels]);

  useEffect(() => {
    if (!isModelMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(event.target as Node)
      ) {
        setIsModelMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModelMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    isNearBottomRef.current = true;

    const timeoutId = window.setTimeout(() => {
      setShowJumpToLatest(false);
    }, 0);

    return () =>
      window.clearTimeout(timeoutId);
  }, [activeChatId]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();

      if (
        deltaFlushTimerRef.current !== null
      ) {
        window.clearTimeout(
          deltaFlushTimerRef.current,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (activeChatId === null) {
      setMessages([]);
      setMessagesChatId(null);
      return;
    }

    const controller = new AbortController();
    const requestedChatId = activeChatId;

    async function loadMessages() {
      await Promise.resolve();

      if (controller.signal.aborted) {
        return;
      }

      setMessages([]);
      setMessagesChatId(null);
      setMessageError(null);
      setDraftMessage("");
      setSendError(null);
      setIsLoadingMessages(true);

      try {
        const response = await fetch(
          `${API_BASE_URL}/chats/${requestedChatId}/messages`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(
            `Could not load messages (${response.status}).`,
          );
        }

        const loadedMessages =
          (await response.json()) as Message[];

        if (controller.signal.aborted) {
          return;
        }

        setMessages(
          sortMessages(loadedMessages),
        );
        setMessagesChatId(requestedChatId);
      } catch (requestError) {
        if (
          controller.signal.aborted ||
          (requestError instanceof DOMException &&
            requestError.name === "AbortError")
        ) {
          return;
        }

        setMessageError({
          chatId: requestedChatId,
          message:
            requestError instanceof Error
              ? requestError.message
              : "Could not load this conversation.",
        });
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingMessages(false);
        }
      }
    }

    void loadMessages();

    return () => controller.abort();
  }, [activeChatId]);

  useEffect(() => {
    const container =
      conversationScrollRef.current;

    if (!container) {
      return;
    }

    if (!isNearBottomRef.current) {
      const frameId =
        window.requestAnimationFrame(() => {
          setShowJumpToLatest(true);
        });

      return () =>
        window.cancelAnimationFrame(frameId);
    }

    const frameId =
      window.requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "auto",
        });

        setShowJumpToLatest(false);
      });

    return () =>
      window.cancelAnimationFrame(frameId);
  }, [
    activeChatId,
    messages,
    streamingAssistant,
  ]);

  async function sendMessage() {
    if (
      activeChatId === null ||
      isMessageViewLoading ||
      isSendingMessage
    ) {
      return;
    }

    const cleanContent = draftMessage.trim();
    const targetChatId = activeChatId;
    const targetModelName = selectedModelName;

    if (!cleanContent) {
      setSendError({
        chatId: targetChatId,
        message: "Message cannot be empty.",
      });
      return;
    }

    if (!targetModelName) {
      setSendError({
        chatId: targetChatId,
        message: "Select an installed chat model first.",
      });
      return;
    }

    const optimisticMessageId =
      nextOptimisticMessageIdRef.current;

    nextOptimisticMessageIdRef.current -= 1;

    const optimisticSequenceNumber =
      messages.reduce(
        (highest, message) =>
          Math.max(
            highest,
            message.sequence_number,
          ),
        0,
      ) + 1;

    const optimisticMessage: Message = {
      id: optimisticMessageId,
      chat_id: targetChatId,
      role: "user",
      content: cleanContent,
      sequence_number:
        optimisticSequenceNumber,
      model_name: null,
      created_at: new Date().toISOString(),
    };

    setIsSendingMessage(true);
    setSendError(null);
    setMessages((current) =>
      sortMessages([
        ...current,
        optimisticMessage,
      ]),
    );
    setMessagesChatId(targetChatId);
    setDraftMessage("");

    const requestId =
      nextStreamRequestIdRef.current;

    nextStreamRequestIdRef.current += 1;
    activeStreamRequestIdRef.current =
      requestId;
    pendingAssistantDeltaRef.current = "";
    clearDeltaFlushTimer();

    const abortController =
      new AbortController();

    streamAbortControllerRef.current =
      abortController;

    setStreamingAssistant({
      requestId,
      chatId: targetChatId,
      optimisticMessageId,
      content: "",
      status: "starting",
      startedAt: Date.now(),
    });

    let receivedTerminalEvent = false;

    try {
      const response = await fetch(
        `${API_BASE_URL}/chats/${targetChatId}/messages/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: cleanContent,
            model_name: targetModelName,
          }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        let errorMessage =
          `Could not generate response (${response.status}).`;

        try {
          const body =
            (await response.json()) as {
              detail?: unknown;
            };

          if (
            typeof body.detail === "string"
          ) {
            errorMessage = body.detail;
          }
        } catch {
          // Keep status-based fallback.
        }

        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error(
          "Streaming response body was unavailable.",
        );
      }

      const reader =
        response.body.getReader();
      const decoder = new TextDecoder();
      let eventBuffer = "";

      async function handleEvent(
        event: StreamingEvent,
      ) {
        if (
          activeStreamRequestIdRef.current !==
          requestId
        ) {
          return;
        }

        if (
          event.type === "response_started"
        ) {
          setStreamingAssistant((current) =>
            current?.requestId === requestId
              ? {
                  ...current,
                  status: "thinking",
                }
              : current,
          );

          return;
        }

        if (
          event.type === "user_message"
        ) {
          setChats((current) =>
            updateChatActivity(
              current,
              targetChatId,
              event.message.created_at,
            ),
          );

          if (
            activeChatIdRef.current ===
            targetChatId
          ) {
            setMessages((current) =>
              uniqueMessages([
                ...current.filter(
                  (message) =>
                    message.id !==
                    optimisticMessageId,
                ),
                event.message,
              ]),
            );

            setMessagesChatId(targetChatId);
          }

          return;
        }

        if (
          event.type === "assistant_delta"
        ) {
          pendingAssistantDeltaRef.current +=
            event.delta;

          scheduleAssistantDeltaFlush(
            requestId,
          );

          return;
        }

        if (
          event.type === "assistant_message"
        ) {
          receivedTerminalEvent = true;
          pendingAssistantDeltaRef.current = "";
          clearDeltaFlushTimer();

          setChats((current) =>
            updateChatActivity(
              current,
              targetChatId,
              event.message.created_at,
            ),
          );

          if (
            activeChatIdRef.current ===
            targetChatId
          ) {
            setMessages((current) =>
              uniqueMessages([
                ...current.filter(
                  (message) =>
                    message.id !==
                    optimisticMessageId,
                ),
                event.message,
              ]),
            );

            setMessagesChatId(targetChatId);
          }

          setStreamingAssistant((current) =>
            current?.requestId === requestId
              ? null
              : current,
          );

          setSendError(null);
          return;
        }

        if (event.type === "chat_title_updated") {
          setChats((current) => [
            event.chat,
            ...current.filter(
              (chat) => chat.id !== event.chat.id,
            ),
          ]);

          return;
        }

        if (
          event.type === "response_stopped"
        ) {
          receivedTerminalEvent = true;
          flushAssistantDeltas(requestId);

          setStreamingAssistant((current) =>
            current?.requestId === requestId
              ? {
                  ...current,
                  status: "stopped",
                }
              : current,
          );

          await reloadDurableHistory(
            targetChatId,
          );

          return;
        }

        receivedTerminalEvent = true;
        flushAssistantDeltas(requestId);

        setStreamingAssistant((current) =>
          current?.requestId === requestId
            ? {
                ...current,
                status: "interrupted",
              }
            : current,
        );

        setSendError({
          chatId: targetChatId,
          message: event.message,
        });

        await reloadDurableHistory(
          targetChatId,
        );
      }

      async function consumeLine(
        line: string,
      ) {
        const cleanLine = line.trim();

        if (!cleanLine) {
          return;
        }

        const event =
          JSON.parse(
            cleanLine,
          ) as StreamingEvent;

        await handleEvent(event);
      }

      while (true) {
        const { done, value } =
          await reader.read();

        if (done) {
          eventBuffer += decoder.decode();
          break;
        }

        eventBuffer += decoder.decode(value, {
          stream: true,
        });

        let newlineIndex =
          eventBuffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = eventBuffer.slice(
            0,
            newlineIndex,
          );

          eventBuffer = eventBuffer.slice(
            newlineIndex + 1,
          );

          await consumeLine(line);

          newlineIndex =
            eventBuffer.indexOf("\n");
        }
      }

      await consumeLine(eventBuffer);

      if (!receivedTerminalEvent) {
        throw new Error(
          "Response stream ended before completion.",
        );
      }
    } catch (requestError) {
      if (
        activeStreamRequestIdRef.current !==
        requestId
      ) {
        return;
      }

      const wasStopped =
        requestError instanceof DOMException &&
        requestError.name === "AbortError";

      flushAssistantDeltas(requestId);

      setMessages((current) =>
        current.filter(
          (message) =>
            message.id !==
            optimisticMessageId,
        ),
      );

      setStreamingAssistant((current) =>
        current?.requestId === requestId
          ? {
              ...current,
              status: wasStopped
                ? "stopped"
                : "interrupted",
            }
          : current,
      );

      if (!wasStopped) {
        setSendError({
          chatId: targetChatId,
          message:
            requestError instanceof Error
              ? requestError.message
              : "Response interrupted.",
        });
      }

      await reloadDurableHistory(
        targetChatId,
      );
    } finally {
      if (
        activeStreamRequestIdRef.current ===
        requestId
      ) {
        activeStreamRequestIdRef.current =
          null;
        streamAbortControllerRef.current =
          null;
        setIsSendingMessage(false);
      }
    }
  }

  function stopGenerating() {
    streamAbortControllerRef.current?.abort();
  }

  function jumpToLatest() {
    const container =
      conversationScrollRef.current;

    if (!container) {
      return;
    }

    isNearBottomRef.current = true;
    setShowJumpToLatest(false);

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }

  async function createChat() {
    if (isCreatingChat) {
      return;
    }

    setIsCreatingChat(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/chats`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "New chat",
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Could not create chat (${response.status}).`,
        );
      }

      const createdChat =
        (await response.json()) as Chat;

      setChats((current) => [
        createdChat,
        ...current,
      ]);

      activeChatIdRef.current =
        createdChat.id;

      setActiveChatId(createdChat.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create a new chat.",
      );
    } finally {
      setIsCreatingChat(false);
    }
  }

  async function deleteChat(chatId: number) {
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/chats/${chatId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(
          `Could not delete chat (${response.status}).`,
        );
      }

      setChats((current) => {
        const remaining = current.filter(
          (chat) => chat.id !== chatId,
        );

        if (activeChatId === chatId) {
          const nextChatId =
            remaining[0]?.id ?? null;

          activeChatIdRef.current =
            nextChatId;

          setActiveChatId(nextChatId);
        }

        return remaining;
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not delete the chat.",
      );
    }
  }

  const activeChat =
    chats.find(
      (chat) => chat.id === activeChatId,
    ) ?? null;

  const activeMessages =
    messagesChatId === activeChatId
      ? messages
      : [];

  const activeMessageError =
    messageError?.chatId === activeChatId
      ? messageError.message
      : null;

  const activeSendError =
    sendError?.chatId === activeChatId
      ? sendError.message
      : null;

  const isMessageViewLoading =
    activeChatId !== null &&
    activeMessageError === null &&
    (isLoadingMessages ||
      messagesChatId !== activeChatId);

  const activeStreamingAssistant =
    streamingAssistant?.chatId ===
    activeChatId
      ? streamingAssistant
      : null;

  const hasConversationContent =
    activeMessages.length > 0 ||
    activeStreamingAssistant !== null;

  const filteredModelOptions = modelOptions.filter(
    (model) =>
      model.name
        .toLocaleLowerCase()
        .includes(modelSearch.trim().toLocaleLowerCase()),
  );

  return (
    <MotionConfig reducedMotion="user">
      <main className="ic-app">
        <div
          className="ic-app-aurora ic-app-aurora-one"
          aria-hidden="true"
        />
        <div
          className="ic-app-aurora ic-app-aurora-two"
          aria-hidden="true"
        />

        <div className="ic-workspace">
          <aside className="ic-sidebar">
            <div className="ic-sidebar-top">
              <div className="ic-brand">
                <div className="ic-brand-mark">
                  <Image
                    className="ic-brand-logo"
                    src="/intracore-mark.png"
                    alt="IntraCore AI"
                    width={40}
                    height={40}
                    priority
                  />
                </div>

                <div className="ic-brand-copy">
                  <strong>IntraCore AI</strong>
                  <span>Local intelligence</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  void createChat()
                }
                disabled={isCreatingChat}
                className="ic-new-chat"
              >
                <span className="ic-plus">
                  +
                </span>

                <span>
                  {isCreatingChat
                    ? "Creating..."
                    : "New conversation"}
                </span>
              </button>
            </div>

            <div className="ic-sidebar-content">
              <div className="ic-section-heading">
                <span>Conversations</span>
                <span>{chats.length}</span>
              </div>

              {error ? (
                <div className="ic-sidebar-error">
                  {error}
                </div>
              ) : null}

              {isLoadingChats ? (
                <div className="ic-sidebar-loading">
                  <span />
                  Loading conversations
                </div>
              ) : null}

              {!isLoadingChats &&
              chats.length === 0 ? (
                <div className="ic-sidebar-empty">
                  <MessageIcon />
                  <p>No conversations yet.</p>
                  <span>
                    Start a private local chat.
                  </span>
                </div>
              ) : null}

              <div className="ic-chat-list">
                {chats.map((chat) => {
                  const isActive =
                    chat.id === activeChatId;

                  return (
                    <motion.div
                      layout
                      key={chat.id}
                      className={`ic-chat-row ${
                        isActive
                          ? "is-active"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          activeChatIdRef.current =
                            chat.id;

                          setActiveChatId(
                            chat.id,
                          );
                        }}
                        className="ic-chat-select"
                      >
                        <span className="ic-chat-icon">
                          <MessageIcon />
                        </span>

                        <span className="ic-chat-copy">
                          <strong>
                            {chat.title}
                          </strong>

                          <small>
                            {formatChatDate(
                              chat.updated_at,
                            )}
                          </small>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void deleteChat(chat.id)
                        }
                        aria-label={`Delete ${chat.title}`}
                        className="ic-delete-chat"
                      >
                        <DeleteIcon />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <div className="ic-sidebar-footer">
              <div className="ic-local-card">
                <span className="ic-local-status">
                  <span />
                </span>

                <div>
                  <strong>Local mode</strong>
                  <p>
                    Conversations stay on this
                    device.
                  </p>
                </div>
              </div>
            </div>
          </aside>

          <section className="ic-main">
            <header className="ic-header">
              <div className="ic-header-title">
                <div
                  className="ic-header-mark"
                  aria-hidden="true"
                >
                  <Image
                    src="/intracore-mark.png"
                    alt=""
                    width={38}
                    height={38}
                  />
                </div>

                <div className="ic-header-copy">
                  <span className="ic-header-eyebrow">
                    Workspace
                    <span aria-hidden="true" />
                  </span>

                  <h1>
                    {activeChat?.title ??
                      "IntraCore AI"}
                  </h1>

                  <p>
                    {activeChat
                      ? `Local conversation · Updated ${formatChatDate(activeChat.updated_at)}`
                      : "Private local AI workspace"}
                  </p>
                </div>
              </div>

              <div className="ic-header-actions">
                <div
                  className="ic-model-selector"
                  ref={modelMenuRef}
                >
                  <button
                    type="button"
                    className="ic-model-chip"
                    aria-label="Choose local model"
                    aria-haspopup="listbox"
                    aria-expanded={isModelMenuOpen}
                    disabled={isSendingMessage}
                    onClick={() => {
                      setIsModelMenuOpen((current) => !current);
                      setModelNotice(null);
                    }}
                  >
                    <span
                      className={`ic-model-live-dot ${
                        selectedModelName ? "" : "is-unavailable"
                      }`}
                    />
                    <span className="ic-model-chip-label">
                      {isLoadingModels
                        ? "Finding models…"
                        : selectedModelName ?? "No model"}
                    </span>
                    <span
                      className={`ic-model-chevron ${
                        isModelMenuOpen ? "is-open" : ""
                      }`}
                    >
                      <ChevronIcon />
                    </span>
                  </button>

                  <AnimatePresence>
                    {isModelMenuOpen ? (
                      <motion.div
                        className="ic-model-menu"
                        initial={{ opacity: 0, y: -6, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.99 }}
                        transition={{ duration: 0.16 }}
                      >
                        <div className="ic-model-menu-search">
                          <input
                            value={modelSearch}
                            onChange={(event) => {
                              setModelSearch(event.target.value);
                              setModelNotice(null);
                            }}
                            placeholder="Find model…"
                            aria-label="Find model"
                            autoFocus
                          />
                        </div>

                        <div
                          className="ic-model-options"
                          role="listbox"
                          aria-label="Available local models"
                        >
                          {filteredModelOptions.map((model) => {
                            const isSelected =
                              model.name === selectedModelName;

                            return (
                              <button
                                type="button"
                                key={model.name}
                                role="option"
                                aria-selected={isSelected}
                                className={`ic-model-option ${
                                  isSelected ? "is-selected" : ""
                                } ${
                                  model.installed
                                    ? "is-installed"
                                    : "is-missing"
                                }`}
                                title={
                                  model.installed
                                    ? `Use ${model.name}`
                                    : "Model download support coming soon."
                                }
                                onClick={() => {
                                  if (!model.selectable) {
                                    setModelNotice(
                                      "Model download support coming soon.",
                                    );
                                    return;
                                  }

                                  setSelectedModelName(model.name);
                                  window.localStorage.setItem(
                                    MODEL_PREFERENCE_KEY,
                                    model.name,
                                  );
                                  setModelNotice(null);
                                  setModelSearch("");
                                  setIsModelMenuOpen(false);
                                }}
                              >
                                <span className="ic-model-option-main">
                                  <strong>{model.name}</strong>
                                  {model.parameter_size ||
                                  model.quantization_level ? (
                                    <small>
                                      {[
                                        model.parameter_size,
                                        model.quantization_level,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </small>
                                  ) : null}
                                </span>

                                {model.installed ? (
                                  <span
                                    className="ic-model-installed-dot"
                                    aria-label="Installed"
                                  />
                                ) : (
                                  <span
                                    className="ic-model-download-icon"
                                    aria-label="Download support coming soon"
                                  >
                                    <DownloadIcon />
                                  </span>
                                )}
                              </button>
                            );
                          })}

                          {!isLoadingModels &&
                          filteredModelOptions.length === 0 ? (
                            <p className="ic-model-empty">
                              No matching models.
                            </p>
                          ) : null}
                        </div>

                        {modelNotice || modelError ? (
                          <p
                            className={`ic-model-menu-status ${
                              modelError ? "is-error" : ""
                            }`}
                            role="status"
                          >
                            {modelNotice ?? modelError}
                          </p>
                        ) : null}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void createChat()
                  }
                  disabled={isCreatingChat}
                  className="ic-mobile-new-chat"
                  aria-label="Create new chat"
                >
                  +
                </button>
              </div>
            </header>

            <div className="ic-conversation">
              <div
                ref={conversationScrollRef}
                onScroll={(event) => {
                  const container =
                    event.currentTarget;

                  const distanceFromBottom =
                    container.scrollHeight -
                    container.scrollTop -
                    container.clientHeight;

                  const isNearBottom =
                    distanceFromBottom <= 120;

                  isNearBottomRef.current =
                    isNearBottom;

                  if (isNearBottom) {
                    setShowJumpToLatest(
                      false,
                    );
                  }
                }}
                className="ic-thread"
              >
                <div
                  className={`ic-thread-inner ${
                    !hasConversationContent
                      ? "is-empty"
                      : ""
                  }`}
                >
                  {!activeChat ? (
                    <div className="ic-empty-state">
                      <div className="ic-empty-orb">
                        <span className="ic-orb-light" />
                        <Image
                          className="ic-empty-orb-logo"
                          src="/intracore-mark.png"
                          alt=""
                          width={72}
                          height={72}
                          aria-hidden="true"
                        />
                      </div>

                      <span className="ic-empty-kicker">
                        Private local intelligence
                      </span>

                      <h2>
                        What would you like to
                        explore?
                      </h2>

                      <p>
                        Create a durable conversation
                        to start working with your
                        local assistant.
                      </p>
                    </div>
                  ) : null}

                  {activeChat &&
                  isMessageViewLoading ? (
                    <div className="ic-page-loading">
                      <span />
                      <p>Loading conversation</p>
                    </div>
                  ) : null}

                  {activeChat &&
                  activeMessageError ? (
                    <div className="ic-page-error">
                      {activeMessageError}
                    </div>
                  ) : null}

                  {activeChat &&
                  !isMessageViewLoading &&
                  !activeMessageError &&
                  !hasConversationContent ? (
                    <div className="ic-empty-state">
                      <div className="ic-empty-orb">
                        <span className="ic-orb-light" />
                        <Image
                          className="ic-empty-orb-logo"
                          src="/intracore-mark.png"
                          alt=""
                          width={72}
                          height={72}
                          aria-hidden="true"
                        />
                      </div>

                      <span className="ic-empty-kicker">
                        New local conversation
                      </span>

                      <h2>
                        How can I assist you today?
                      </h2>

                      <p>
                        Ask a question, develop an
                        idea, or work through a
                        problem privately.
                      </p>
                    </div>
                  ) : null}

                  {activeChat &&
                  !isMessageViewLoading &&
                  !activeMessageError &&
                  hasConversationContent ? (
                    <div className="ic-message-list">
                      <AnimatePresence
                        initial={false}
                        mode="popLayout"
                      >
                        {activeMessages.map(
                          (message) => {
                            const isUser =
                              message.role ===
                              "user";

                            return (
                              <motion.article
                                layout
                                key={`message-${message.chat_id}-${message.sequence_number}-${message.role}`}
                                initial={{
                                  opacity: 0,
                                  y: 8,
                                }}
                                animate={{
                                  opacity: 1,
                                  y: 0,
                                }}
                                exit={{
                                  opacity: 0,
                                  y: -4,
                                }}
                                transition={{
                                  duration: 0.2,
                                }}
                                className={`ic-message ${
                                  isUser
                                    ? "ic-message-user"
                                    : "ic-message-assistant"
                                }`}
                              >
                                {!isUser ? (
                                  <div className="ic-assistant-avatar">
                                    <Image
                                      className="ic-assistant-logo"
                                      src="/intracore-mark.png"
                                      alt=""
                                      width={32}
                                      height={32}
                                      aria-hidden="true"
                                    />
                                  </div>
                                ) : null}

                                <div
                                  className={
                                    isUser
                                      ? "ic-saved-user-message"
                                      : "ic-assistant-column"
                                  }
                                >
                                  {!isUser ? (
                                    <div className="ic-message-identity">
                                      <span>
                                        IntraCore
                                      </span>
                                      <span className="ic-message-time">
                                        {formatMessageTime(
                                          message.created_at,
                                        )}
                                      </span>
                                    </div>
                                  ) : null}

{isUser ? (
  <>
    <div className="ic-saved-user-bubble">
      <p>{animatedEmojiText(message.content)}</p>
    </div>

    <time
      className="ic-saved-user-time"
      dateTime={message.created_at}
    >
      {formatMessageTime(message.created_at)}
    </time>
  </>
                                  ) : (
                                    <div className="ic-assistant-content assistant-markdown">
                                      <AnimatedMarkdown
                                        content={
                                          message.content
                                        }
                                      />
                                    </div>
                                  )}
                                </div>
                              </motion.article>
                            );
                          },
                        )}

                        {activeStreamingAssistant ? (
                          <StreamingAssistantView
                            key={`stream-${activeStreamingAssistant.requestId}`}
                            stream={
                              activeStreamingAssistant
                            }
                          />
                        ) : null}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </div>
              </div>

              <AnimatePresence>
                {showJumpToLatest &&
                activeChat ? (
                  <motion.button
                    type="button"
                    onClick={jumpToLatest}
                    initial={{
                      opacity: 0,
                      y: 8,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    exit={{
                      opacity: 0,
                      y: 5,
                    }}
                    className="ic-jump-button"
                  >
                    <SendIcon />
                    Jump to latest
                  </motion.button>
                ) : null}
              </AnimatePresence>

              <div className="ic-composer-zone">
                <div className="ic-composer-wrap">
                  <div
                    className={`ic-composer ${
                      isSendingMessage
                        ? "is-generating"
                        : ""
                    }`}
                  >
                    <textarea
                      rows={2}
                      value={draftMessage}
                      onChange={(event) => {
                        setDraftMessage(
                          event.target.value,
                        );

                        if (activeSendError) {
                          setSendError(null);
                        }
                      }}
                      disabled={
                        !activeChat ||
                        isMessageViewLoading ||
                        isSendingMessage ||
                        !selectedModelName
                      }
                      placeholder={
                        !activeChat
                          ? "Create a conversation first"
                          : !selectedModelName
                            ? "Select an installed model first"
                          : "Message IntraCore AI..."
                      }
                    />

                    <div className="ic-composer-footer">
                      <div className="ic-composer-context">
                        <span className="ic-private-dot" />
                        <span>
                          Local and durable
                        </span>
                      </div>

                      <motion.button
                        type="button"
                        onClick={() => {
                          if (
                            isSendingMessage
                          ) {
                            stopGenerating();
                          } else {
                            void sendMessage();
                          }
                        }}
                        disabled={
                          !isSendingMessage &&
                          (!activeChat ||
                            isMessageViewLoading ||
                            !selectedModelName ||
                            draftMessage.trim()
                              .length === 0)
                        }
                        aria-label={
                          isSendingMessage
                            ? "Stop generating"
                            : "Send message"
                        }
                        whileHover={{
                          scale: 1.04,
                        }}
                        whileTap={{
                          scale: 0.94,
                        }}
                        className={`ic-primary-action ${
                          isSendingMessage
                            ? "is-stop"
                            : "is-send"
                        }`}
                      >
                        {isSendingMessage ? (
                          <>
                            <StopIcon />
                            <span>Stop</span>
                          </>
                        ) : (
                          <SendIcon />
                        )}
                      </motion.button>
                    </div>
                  </div>

                  {!isSendingMessage &&
                  activeSendError ? (
                    <p
                      className="ic-send-error"
                      role="alert"
                    >
                      {activeSendError}
                    </p>
                  ) : null}

                  <p className="ic-disclaimer">
                    IntraCore may make mistakes.
                    Verify important information.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </MotionConfig>
  );
}
