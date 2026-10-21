"use client";

import Image from "next/image";
import {
  Children,
  type FormEvent,
  type KeyboardEvent,
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
import {
  type Chat,
  type Message,
  type ChatModelOption,
  type ChatModelListResponse,
  type MemoryKind,
  type MemoryRecord,
  type StreamingEvent,
  API_BASE_URL,
  readApiError,
  apiFetchChats,
  apiCreateChat,
  apiDeleteChat,
  apiRenameChat,
  apiFetchMessages,
  apiFetchModels,
  apiFetchMemories,
  apiUpdateMemory,
  apiDeleteMemory,
} from "../lib/api";

const MODEL_PREFERENCE_KEY = "intracore.chatModel";

const STARTER_PROMPTS = [
  "Explain this concept simply:",
  "Help me write a clear email about:",
  "What are the pros and cons of:",
  "Summarise what you know about:",
] as const;

const PRE_RESPONSE_STATUS_LABELS = [
  "Reading your request",
  "Reviewing conversation",
  "Working through context",
  "Building a response",
] as const;

const PRE_RESPONSE_STATUS_DURATION_MS = 10000;

const ANIMATED_EMOJI_PATTERN =
  /((?:\p{Regional_Indicator}{2})|(?:\p{Extended_Pictographic}(?:️|︎)?(?:\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|︎)?(?:\p{Emoji_Modifier})?)*))/gu;

const EMOJI_ONLY_PATTERN =
  /^(?:\p{Regional_Indicator}{2})$|^(?:\p{Extended_Pictographic}(?:️|︎)?(?:\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|︎)?(?:\p{Emoji_Modifier})?)*)$/u;

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
  modelName: string | null;
};

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

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);

  let lang = "";
  let codeText = "";
  Children.forEach(children, (child) => {
    if (child && typeof child === "object" && "props" in child) {
      const props = (child as { props: Record<string, unknown> }).props;
      const className = typeof props.className === "string" ? props.className : "";
      lang = className.replace("language-", "");
      codeText = typeof props.children === "string" ? props.children.replace(/\n$/, "") : "";
    }
  });

  const handleCopy = () => {
    void navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    });
  };

  return (
    <div className="ic-code-block">
      <div className="ic-code-header">
        <span className="ic-code-lang">{lang || "code"}</span>
        <button
          type="button"
          className={`ic-code-copy-btn${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? "Copied" : "Copy code"}</span>
        </button>
      </div>
      <pre>{children}</pre>
    </div>
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
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
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

// ─── Icons ────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  return <span className="ic-stop-square" aria-hidden="true" />;
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4l10.5-10.5a2.83 2.83 0 0 0-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function MemoryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M6.5 4.25h7A2.25 2.25 0 0 1 15.75 6.5v7a2.25 2.25 0 0 1-2.25 2.25h-7a2.25 2.25 0 0 1-2.25-2.25v-7A2.25 2.25 0 0 1 6.5 4.25Z"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M7.25 8h5.5M7.25 11h5.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m4.5 10.5 4 4 7-8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 4v12M4 10h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="7" y="3" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.35" />
      <path d="M4.75 9.5a5.25 5.25 0 0 0 10.5 0M10 14.75V17M7.5 17h5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

// ─── Streaming assistant view ─────────────────────────────────────────────────

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

  const [statusClock, setStatusClock] = useState(() => Date.now());

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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22 }}
      className="ic-message ic-message-assistant ic-stream-message"
    >
      <div className="ic-assistant-column">
        <div className="ic-message-identity">
          <span>IntraCore</span>
          {!hasAnswer && isActive ? null : (
            <span className="ic-message-time">
              {stream.status === "stopped"
                ? "Stopped"
                : stream.status === "interrupted"
                  ? "Interrupted"
                  : null}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {!hasAnswer && isActive ? (
            <motion.div
              key="thinking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="ic-activity-dots"
              aria-label="Thinking"
            >
              <span /><span /><span />
            </motion.div>
          ) : hasAnswer ? (
            <motion.div
              key="answer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
              className="ic-assistant-content assistant-markdown"
            >
              <AnimatedMarkdown content={markdownForStreaming(stream.content)} />
              {stream.status === "streaming" ? (
                <span aria-hidden="true" className="ic-stream-caret" />
              ) : null}
              {stream.status === "stopped" || stream.status === "interrupted" ? (
                <p className="ic-stream-note">
                  {stream.status === "stopped"
                    ? "Stopped — this partial response is not saved."
                    : "Response interrupted — this partial response is not saved."}
                </p>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="ic-activity-dots"
            >
              <span /><span /><span />
            </motion.div>
          )}
        </AnimatePresence>

        <span className="ic-sr-only" aria-live="polite">
          {!hasAnswer ? "Thinking" : stream.status === "streaming" ? "Responding" : "Done"}
        </span>
      </div>
    </motion.article>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChatShell() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toastIdRef = useRef(1);

  // Inline rename state
  const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // 3-dot context menu state
  const [menuOpenChatId, setMenuOpenChatId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isChatOptionsOpen, setIsChatOptionsOpen] = useState(false);

  // Mobile sidebar drawer + desktop collapse
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([]);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  const [isMemoryPanelOpen, setIsMemoryPanelOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryKind, setMemoryKind] = useState<MemoryKind>("fact");
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [busyMemoryId, setBusyMemoryId] = useState<number | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesChatId, setMessagesChatId] = useState<number | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState<{
    chatId: number;
    message: string;
  } | null>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [streamingAssistant, setStreamingAssistant] =
    useState<StreamingAssistant | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [sendError, setSendError] = useState<{
    chatId: number;
    message: string;
  } | null>(null);

  // Copy-to-clipboard state: tracks which message was just copied
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);

  const activeChatIdRef = useRef(activeChatId);
  const nextOptimisticMessageIdRef = useRef(-1);
  const nextStreamRequestIdRef = useRef(1);
  const activeStreamRequestIdRef = useRef<number | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const pendingAssistantDeltaRef = useRef("");
  const deltaFlushTimerRef = useRef<number | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const chatOptionsRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  function clearDeltaFlushTimer() {
    if (deltaFlushTimerRef.current !== null) {
      window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
    }
  }

  function flushAssistantDeltas(requestId: number) {
    clearDeltaFlushTimer();

    const pendingDelta = pendingAssistantDeltaRef.current;
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

  function scheduleAssistantDeltaFlush(requestId: number) {
    if (deltaFlushTimerRef.current !== null) {
      return;
    }

    deltaFlushTimerRef.current = window.setTimeout(() => {
      flushAssistantDeltas(requestId);
    }, 40);
  }

  async function reloadDurableHistory(chatId: number) {
    try {
      const durableMessages = await apiFetchMessages(chatId);

      if (activeChatIdRef.current === chatId) {
        setMessages(sortMessages(durableMessages));
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
      const loadedChats = await apiFetchChats();

      setChats(loadedChats);

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
      const result = await apiFetchModels();
      const selectableNames = new Set(
        result.models
          .filter((model) => model.selectable)
          .map((model) => model.name),
      );
      const storedModel = window.localStorage.getItem(MODEL_PREFERENCE_KEY);
      const selectedModel =
        storedModel && selectableNames.has(storedModel)
          ? storedModel
          : result.default_model;

      setModelOptions(result.models);
      setSelectedModelName(selectedModel);

      if (selectedModel) {
        window.localStorage.setItem(MODEL_PREFERENCE_KEY, selectedModel);
      } else {
        window.localStorage.removeItem(MODEL_PREFERENCE_KEY);
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

  const loadMemories = useCallback(async () => {
    setIsLoadingMemories(true);
    setMemoryError(null);

    try {
      setMemories(await apiFetchMemories());
    } catch (requestError) {
      setMemoryError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load memories.",
      );
    } finally {
      setIsLoadingMemories(false);
    }
  }, []);

  function resetMemoryForm() {
    setMemoryContent("");
    setMemoryKind("fact");
    setEditingMemoryId(null);
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = memoryContent.trim();
    if (!content || isSavingMemory) {
      if (!content) {
        setMemoryError("Memory content cannot be empty.");
      }
      return;
    }

    setIsSavingMemory(true);
    setMemoryError(null);
    const isEditing = editingMemoryId !== null;

    try {
      let savedMemory: MemoryRecord;

      if (isEditing) {
        savedMemory = await apiUpdateMemory(editingMemoryId, {
          content,
          kind: memoryKind,
        });
      } else {
        // Create via direct fetch so we can pass is_enabled: true
        const response = await fetch(`${API_BASE_URL}/memories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, kind: memoryKind, is_enabled: true }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response, "Could not save memory."));
        }
        savedMemory = (await response.json()) as MemoryRecord;
      }

      setMemories((current) =>
        isEditing
          ? current.map((memory) =>
              memory.id === savedMemory.id ? savedMemory : memory,
            )
          : [...current, savedMemory],
      );
      resetMemoryForm();
    } catch (requestError) {
      setMemoryError(
        requestError instanceof Error
          ? requestError.message
          : "Could not save memory.",
      );
    } finally {
      setIsSavingMemory(false);
    }
  }

  async function toggleMemory(memory: MemoryRecord) {
    if (busyMemoryId !== null) {
      return;
    }
    setBusyMemoryId(memory.id);
    setMemoryError(null);

    try {
      const updatedMemory = await apiUpdateMemory(memory.id, {
        is_enabled: !memory.is_enabled,
      });
      setMemories((current) =>
        current.map((item) =>
          item.id === updatedMemory.id ? updatedMemory : item,
        ),
      );
    } catch (requestError) {
      setMemoryError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update memory.",
      );
    } finally {
      setBusyMemoryId(null);
    }
  }

  async function deleteMemory(memory: MemoryRecord) {
    if (
      busyMemoryId !== null ||
      !window.confirm("Permanently delete this memory?")
    ) {
      return;
    }
    setBusyMemoryId(memory.id);
    setMemoryError(null);

    try {
      await apiDeleteMemory(memory.id);
      setMemories((current) =>
        current.filter((item) => item.id !== memory.id),
      );
      if (editingMemoryId === memory.id) {
        resetMemoryForm();
      }
    } catch (requestError) {
      setMemoryError(
        requestError instanceof Error
          ? requestError.message
          : "Could not delete memory.",
      );
    } finally {
      setBusyMemoryId(null);
    }
  }

  // ─── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadChats();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadChats]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadModels();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadModels]);

  // Close 3-dot dropdown when clicking outside
  useEffect(() => {
    if (menuOpenChatId === null) return;
    function handleClick() { setMenuOpenChatId(null); }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [menuOpenChatId]);

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
    if (!isChatOptionsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        chatOptionsRef.current &&
        !chatOptionsRef.current.contains(event.target as Node)
      ) {
        setIsChatOptionsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsChatOptionsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isChatOptionsOpen]);

  useEffect(() => {
    if (!isMemoryPanelOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMemoryPanelOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMemoryPanelOpen]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingChatId !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    isNearBottomRef.current = true;

    const timeoutId = window.setTimeout(() => {
      setShowJumpToLatest(false);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeChatId]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();

      if (deltaFlushTimerRef.current !== null) {
        window.clearTimeout(deltaFlushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeChatId === null) {
      const timeoutId = window.setTimeout(() => {
        setMessages([]);
        setMessagesChatId(null);
      }, 0);
      return () => window.clearTimeout(timeoutId);
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
        const loadedMessages = await apiFetchMessages(
          requestedChatId,
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        setMessages(sortMessages(loadedMessages));
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
    const container = conversationScrollRef.current;

    if (!container) {
      return;
    }

    if (!isNearBottomRef.current) {
      const frameId = window.requestAnimationFrame(() => {
        setShowJumpToLatest(true);
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    const frameId = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });

      setShowJumpToLatest(false);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeChatId, messages, streamingAssistant]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  function resizeComposer() {
    const el = composerTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function sendMessage(overrideContent?: string) {
    if (activeChatId === null || isMessageViewLoading || isSendingMessage) {
      return;
    }

    const cleanContent = (overrideContent ?? draftMessage).trim();
    const targetChatId = activeChatId;
    const targetModelName = selectedModelName;

    if (!cleanContent) {
      setSendError({ chatId: targetChatId, message: "Message cannot be empty." });
      return;
    }

    if (!targetModelName) {
      setSendError({
        chatId: targetChatId,
        message: "Select an installed chat model first.",
      });
      return;
    }

    const optimisticMessageId = nextOptimisticMessageIdRef.current;
    nextOptimisticMessageIdRef.current -= 1;

    const optimisticSequenceNumber =
      messages.reduce(
        (highest, message) => Math.max(highest, message.sequence_number),
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
    setSendError(null);
    setMessages((current) => sortMessages([...current, optimisticMessage]));
    setMessagesChatId(targetChatId);
    if (!overrideContent) {
      setDraftMessage("");
      if (composerTextareaRef.current) {
        composerTextareaRef.current.style.height = "auto";
      }
    }

    const requestId = nextStreamRequestIdRef.current;
    nextStreamRequestIdRef.current += 1;
    activeStreamRequestIdRef.current = requestId;
    pendingAssistantDeltaRef.current = "";
    clearDeltaFlushTimer();

    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;

    setStreamingAssistant({
      requestId,
      chatId: targetChatId,
      optimisticMessageId,
      content: "",
      status: "starting",
      startedAt: Date.now(),
      modelName: targetModelName,
    });

    let receivedTerminalEvent = false;

    try {
      const response = await fetch(
        `${API_BASE_URL}/chats/${targetChatId}/messages/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: cleanContent,
            model_name: targetModelName,
          }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        let errorMessage = `Could not generate response (${response.status}).`;

        try {
          const body = (await response.json()) as { detail?: unknown };
          if (typeof body.detail === "string") {
            errorMessage = body.detail;
          }
        } catch {
          // Keep status-based fallback.
        }

        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error("Streaming response body was unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let eventBuffer = "";

      async function handleEvent(event: StreamingEvent) {
        if (activeStreamRequestIdRef.current !== requestId) {
          return;
        }

        if (event.type === "response_started") {
          setStreamingAssistant((current) =>
            current?.requestId === requestId
              ? { ...current, status: "thinking" }
              : current,
          );
          return;
        }

        if (event.type === "user_message") {
          setChats((current) =>
            updateChatActivity(current, targetChatId, event.message.created_at),
          );

          if (activeChatIdRef.current === targetChatId) {
            setMessages((current) =>
              uniqueMessages([
                ...current.filter((message) => message.id !== optimisticMessageId),
                event.message,
              ]),
            );
            setMessagesChatId(targetChatId);
          }

          return;
        }

        if (event.type === "assistant_delta") {
          pendingAssistantDeltaRef.current += event.delta;
          scheduleAssistantDeltaFlush(requestId);
          return;
        }

        if (event.type === "assistant_message") {
          receivedTerminalEvent = true;
          pendingAssistantDeltaRef.current = "";
          clearDeltaFlushTimer();

          setChats((current) =>
            updateChatActivity(current, targetChatId, event.message.created_at),
          );

          if (activeChatIdRef.current === targetChatId) {
            setMessages((current) =>
              uniqueMessages([
                ...current.filter((message) => message.id !== optimisticMessageId),
                event.message,
              ]),
            );
            setMessagesChatId(targetChatId);
          }

          setStreamingAssistant((current) =>
            current?.requestId === requestId ? null : current,
          );

          setSendError(null);
          return;
        }

        if (event.type === "chat_title_updated") {
          setChats((current) => [
            event.chat,
            ...current.filter((chat) => chat.id !== event.chat.id),
          ]);
          return;
        }

        if (event.type === "response_stopped") {
          receivedTerminalEvent = true;
          flushAssistantDeltas(requestId);

          setStreamingAssistant((current) =>
            current?.requestId === requestId
              ? { ...current, status: "stopped" }
              : current,
          );

          await reloadDurableHistory(targetChatId);
          return;
        }

        receivedTerminalEvent = true;
        flushAssistantDeltas(requestId);

        setStreamingAssistant((current) =>
          current?.requestId === requestId
            ? { ...current, status: "interrupted" }
            : current,
        );

        setSendError({ chatId: targetChatId, message: event.message });

        await reloadDurableHistory(targetChatId);
      }

      async function consumeLine(line: string) {
        const cleanLine = line.trim();
        if (!cleanLine) {
          return;
        }

        const event = JSON.parse(cleanLine) as StreamingEvent;
        await handleEvent(event);
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          eventBuffer += decoder.decode();
          break;
        }

        eventBuffer += decoder.decode(value, { stream: true });

        let newlineIndex = eventBuffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = eventBuffer.slice(0, newlineIndex);
          eventBuffer = eventBuffer.slice(newlineIndex + 1);
          await consumeLine(line);
          newlineIndex = eventBuffer.indexOf("\n");
        }
      }

      await consumeLine(eventBuffer);

      if (!receivedTerminalEvent) {
        throw new Error("Response stream ended before completion.");
      }
    } catch (requestError) {
      if (activeStreamRequestIdRef.current !== requestId) {
        return;
      }

      const wasStopped =
        requestError instanceof DOMException &&
        requestError.name === "AbortError";

      flushAssistantDeltas(requestId);

      setMessages((current) =>
        current.filter((message) => message.id !== optimisticMessageId),
      );

      setStreamingAssistant((current) =>
        current?.requestId === requestId
          ? { ...current, status: wasStopped ? "stopped" : "interrupted" }
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

      await reloadDurableHistory(targetChatId);
    } finally {
      if (activeStreamRequestIdRef.current === requestId) {
        activeStreamRequestIdRef.current = null;
        streamAbortControllerRef.current = null;
        setIsSendingMessage(false);
      }
    }
  }

  function showToast(message: string) {
    const id = toastIdRef.current;
    toastIdRef.current += 1;
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4000);
  }

  function stopGenerating() {
    streamAbortControllerRef.current?.abort();
  }

  function exportChatAsMarkdown() {
    if (!activeChat || activeMessages.length === 0) return;

    const lines: string[] = [
      `# ${activeChat.title}`,
      ``,
      `*Exported from IntraCore AI — ${new Date().toLocaleString()}*`,
      ``,
    ];

    for (const message of activeMessages) {
      if (message.role === "user") {
        lines.push(`## You`, ``, message.content, ``);
      } else if (message.role === "assistant") {
        const badge = message.model_name ? ` *(${message.model_name})*` : "";
        lines.push(`## IntraCore${badge}`, ``, message.content, ``);
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeChat.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function jumpToLatest() {
    const container = conversationScrollRef.current;

    if (!container) {
      return;
    }

    isNearBottomRef.current = true;
    setShowJumpToLatest(false);

    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }

  async function createChat() {
    if (isCreatingChat) {
      return;
    }

    setIsCreatingChat(true);
    setError(null);

    try {
      const createdChat = await apiCreateChat("New chat");

      setChats((current) => [createdChat, ...current]);

      activeChatIdRef.current = createdChat.id;
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

  // Commit 1: confirmation before deleting
  async function deleteChat(chatId: number) {
    if (
      !window.confirm(
        "Delete this conversation? This cannot be undone.",
      )
    ) {
      return;
    }

    setError(null);

    try {
      await apiDeleteChat(chatId);

      setChats((current) => {
        const remaining = current.filter((chat) => chat.id !== chatId);

        if (activeChatId === chatId) {
          const nextChatId = remaining[0]?.id ?? null;
          activeChatIdRef.current = nextChatId;
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

  // Commit 2: inline rename
  function startRenaming(chat: Chat) {
    setRenamingChatId(chat.id);
    setRenameDraft(chat.title);
  }

  async function commitRename(chatId: number) {
    const clean = renameDraft.trim();
    setRenamingChatId(null);
    setRenameDraft("");

    if (!clean) {
      return;
    }

    const previous = chats.find((c) => c.id === chatId);
    if (previous && previous.title === clean) {
      return;
    }

    try {
      const updated = await apiRenameChat(chatId, clean);
      setChats((current) =>
        current.map((c) => (c.id === chatId ? updated : c)),
      );
    } catch {
      // Non-fatal: leave existing title in place.
    }
  }

  function handleRenameKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    chatId: number,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename(chatId);
    } else if (event.key === "Escape") {
      setRenamingChatId(null);
      setRenameDraft("");
    }
  }

  // Commit 6: copy message content to clipboard
  async function regenerateLastResponse() {
    if (isSendingMessage || !activeChat || !selectedModelName) return;

    const lastUserMessage = [...activeMessages]
      .reverse()
      .find((m) => m.role === "user");

    if (!lastUserMessage) return;

    void sendMessage(lastUserMessage.content);
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      showToast("Copied to clipboard");
      window.setTimeout(() => {
        setCopiedMessageId((current) =>
          current === message.id ? null : current,
        );
      }, 2000);
    } catch {
      showToast("Could not access clipboard.");
    }
  }

  // ─── Derived state ─────────────────────────────────────────────────────────

  const activeChat =
    chats.find((chat) => chat.id === activeChatId) ?? null;

  const activeMessages =
    messagesChatId === activeChatId ? messages : [];

  const activeMessageError =
    messageError?.chatId === activeChatId ? messageError.message : null;

  const activeSendError =
    sendError?.chatId === activeChatId ? sendError.message : null;

  const isMessageViewLoading =
    activeChatId !== null &&
    activeMessageError === null &&
    (isLoadingMessages || messagesChatId !== activeChatId);

  const activeStreamingAssistant =
    streamingAssistant?.chatId === activeChatId ? streamingAssistant : null;

  const hasConversationContent =
    activeMessages.length > 0 || activeStreamingAssistant !== null;

  const filteredModelOptions = modelOptions.filter((model) =>
    model.name
      .toLocaleLowerCase()
      .includes(modelSearch.trim().toLocaleLowerCase()),
  );

  const enabledMemoryCount = memories.filter((memory) => memory.is_enabled).length;
  const totalMemoryCount = memories.length;

  const filteredChats = chatSearch.trim()
    ? chats.filter((chat) =>
        chat.title.toLocaleLowerCase().includes(chatSearch.trim().toLocaleLowerCase()),
      )
    : chats;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <MotionConfig reducedMotion="user">
      <main className="ic-app">
        <div className="ic-app-aurora ic-app-aurora-one" aria-hidden="true" />
        <div className="ic-app-aurora ic-app-aurora-two" aria-hidden="true" />

        {isSearchOpen ? (
          <div
            className="ic-search-overlay"
            role="presentation"
            onMouseDown={() => {
              setIsSearchOpen(false);
              setChatSearch("");
            }}
          >
            <section
              className="ic-search-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Search conversations"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="ic-search-dialog-header">
                <input
                  ref={searchInputRef}
                  className="ic-search-dialog-input"
                  type="search"
                  placeholder="Search..."
                  value={chatSearch}
                  onChange={(event) => setChatSearch(event.target.value)}
                  aria-label="Search conversations"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setIsSearchOpen(false);
                      setChatSearch("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="ic-search-dialog-close"
                  aria-label="Close search"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setChatSearch("");
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </header>

              <div className="ic-search-dialog-section-title">Recent chats</div>

              <div className="ic-search-dialog-results">
                {filteredChats.length > 0 ? (
                  filteredChats.map((chat) => (
                    <button
                      type="button"
                      className="ic-search-result"
                      key={chat.id}
                      onClick={() => {
                        activeChatIdRef.current = chat.id;
                        setActiveChatId(chat.id);
                        setIsSidebarOpen(false);
                        setIsSearchOpen(false);
                        setChatSearch("");
                      }}
                    >
                      <span className="ic-search-result-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5 7.6 7.6 0 0 1-3.3-.75L5 20l1.75-3.65A7.5 7.5 0 1 1 20.5 11.5Z" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="ic-search-result-copy">
                        <strong>{chat.title}</strong>
                        <small>Updated {formatChatDate(chat.updated_at)}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="ic-search-dialog-empty">
                    No conversations found{chatSearch.trim() ? ` matching ${chatSearch.trim()}` : ""}.
                  </p>
                )}
              </div>
            </section>
          </div>
        ) : null}

        <div className={`ic-workspace${isSidebarCollapsed ? " sidebar-collapsed" : ""}`}>
          {/* ── Mobile sidebar backdrop ── */}
          {isSidebarOpen ? (
            <div
              className="ic-sidebar-backdrop"
              onClick={() => setIsSidebarOpen(false)}
              aria-hidden="true"
            />
          ) : null}

          {/* ── Sidebar ── */}
          <aside className={`ic-sidebar${isSidebarOpen ? " is-open" : ""}`}>
            <div className="ic-sidebar-top">
              {/* Row 1: brand + action icons */}
              <div className="ic-sidebar-header-row">
                <div className="ic-brand-inline">
                  <strong className="ic-brand-name">IntraCore</strong>
                  <svg
                    className="ic-brand-chevron"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    width="14"
                    height="14"
                  >
                    <path
                      d="m5 6.5 3 3 3-3"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <div className="ic-sidebar-actions">
                  <button
                    type="button"
                    className={`ic-sidebar-action-btn${isSearchOpen ? " is-active" : ""}`}
                    aria-label="Search conversations"
                    onClick={() => {
                      setIsSearchOpen((v) => !v);
                      if (!isSearchOpen) {
                        setTimeout(() => searchInputRef.current?.focus(), 50);
                      } else {
                        setChatSearch("");
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
                      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/>
                      <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="ic-sidebar-action-btn"
                    aria-label="Close sidebar"
                    onClick={() => {
                      setIsSidebarOpen(false);
                      setIsSidebarCollapsed(true);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
                      <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8"/>
                      <path d="M9 3.5v17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* New chat nav row */}
              <button
                type="button"
                className="ic-new-chat-row"
                disabled={isCreatingChat}
                onClick={() => void createChat()}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
                  <path d="M13.5 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16.7 3.8a2.12 2.12 0 0 1 3 3L11 15.5l-3.5.9.9-3.5 8.3-9.1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>{isCreatingChat ? "Creating…" : "New chat"}</span>
              </button>
            </div>

            <div className="ic-sidebar-content">
              <div className="ic-section-heading">
                <span>Conversations</span>
                <span>{chats.length}</span>
              </div>

              {error ? (
                <div className="ic-sidebar-error">{error}</div>
              ) : null}

              {isLoadingChats ? (
                <div className="ic-sidebar-loading">
                  <span />
                  Loading conversations
                </div>
              ) : null}

              {!isLoadingChats && chats.length === 0 ? (
                <div className="ic-sidebar-empty">
                  <MessageIcon />
                  <p>No conversations yet.</p>
                  <span>Start a private local chat.</span>
                </div>
              ) : null}

              <div className="ic-chat-list">
                {filteredChats.map((chat) => {
                  const isActive = chat.id === activeChatId;
                  const isRenaming = renamingChatId === chat.id;

                  return (
                    <motion.div
                      layout
                      key={chat.id}
                      className={`ic-chat-row ${isActive ? "is-active" : ""}`}
                    >
                      {isRenaming ? (
                        /* Commit 2: inline rename input */
                        <div className="ic-rename-wrap">
                          <input
                            ref={renameInputRef}
                            className="ic-rename-input"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => void commitRename(chat.id)}
                            onKeyDown={(e) => handleRenameKeyDown(e, chat.id)}
                            maxLength={120}
                            aria-label="Rename conversation"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            activeChatIdRef.current = chat.id;
                            setActiveChatId(chat.id);
                            setIsSidebarOpen(false);
                          }}
                          className="ic-chat-select"
                        >
                          <span className="ic-chat-copy">
                            <strong>{chat.title}</strong>
                          </span>
                        </button>
                      )}

                      {!isRenaming ? (
                        <div className="ic-chat-actions">
                          <button
                            type="button"
                            className="ic-chat-menu-btn"
                            aria-label="Chat options"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setMenuPos({ x: rect.right - 130, y: rect.bottom + 4 });
                              setMenuOpenChatId(
                                menuOpenChatId === chat.id ? null : chat.id,
                              );
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>

                          {menuOpenChatId === chat.id ? (
                            <div
                              className="ic-chat-menu-dropdown"
                              style={menuPos ? { position: "fixed", left: menuPos.x, top: menuPos.y } : undefined}
                              onPointerDown={(e) => e.nativeEvent.stopImmediatePropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenChatId(null);
                                  startRenaming(chat);
                                }}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => {
                                  setMenuOpenChatId(null);
                                  void deleteChat(chat.id);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
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
                  <p>Conversations stay on this device.</p>
                </div>
              </div>
            </div>
          </aside>

          {/* ── Main panel ── */}
          <section className="ic-main">
            <header className="ic-header">
              <button
                type="button"
                className={`ic-hamburger${isSidebarCollapsed ? " is-visible" : ""}`}
                aria-label="Open conversations"
                onClick={() => {
                  setIsSidebarOpen(true);
                  setIsSidebarCollapsed(false);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M9 3.5v17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>

              <div className="ic-header-title">
                <div className="ic-header-mark" aria-hidden="true">
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

                  <h1>{activeChat?.title ?? "IntraCore AI"}</h1>

                  <p>
                    {activeChat
                      ? `Local conversation · Updated ${formatChatDate(activeChat.updated_at)}`
                      : "Private local AI workspace"}
                  </p>
                </div>
              </div>

              <div className="ic-header-actions">
                <div className="ic-chat-options" ref={chatOptionsRef}>
                  <button
                    type="button"
                    className="ic-chat-options-trigger"
                    aria-label="Chat options"
                    aria-expanded={isChatOptionsOpen}
                    onClick={() => setIsChatOptionsOpen((current) => !current)}
                  >
                    <span aria-hidden="true">•••</span>
                  </button>

                  {isChatOptionsOpen ? (
                    <div className="ic-chat-options-menu" role="menu">
                      {activeChat && activeMessages.length > 0 ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsChatOptionsOpen(false);
                            exportChatAsMarkdown();
                          }}
                        >
                          <DownloadIcon />
                          Export conversation
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsChatOptionsOpen(false);
                          setIsModelMenuOpen(false);
                          setIsMemoryPanelOpen(true);
                          void loadMemories();
                        }}
                      >
                        <MemoryIcon />
                        Memories
                        {enabledMemoryCount > 0 ? (
                          <small>{enabledMemoryCount}</small>
                        ) : null}
                      </button>
                    </div>
                  ) : null}
                </div>

                {activeChat && activeMessages.length > 0 ? (
                  <button
                    type="button"
                    className="ic-export-btn"
                    aria-label="Export conversation as Markdown"
                    onClick={exportChatAsMarkdown}
                  >
                    <DownloadIcon />
                    <span>Export</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  className="ic-memory-trigger"
                  aria-label="Manage global memories"
                  onClick={() => {
                    setIsModelMenuOpen(false);
                    setIsMemoryPanelOpen(true);
                    void loadMemories();
                  }}
                >
                  <MemoryIcon />
                  <span>Memories</span>
                  {enabledMemoryCount > 0 ? (
                    <small>{enabledMemoryCount}</small>
                  ) : null}
                </button>


                <button
                  type="button"
                  onClick={() => void createChat()}
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
                  const container = event.currentTarget;
                  const distanceFromBottom =
                    container.scrollHeight -
                    container.scrollTop -
                    container.clientHeight;
                  const isNearBottom = distanceFromBottom <= 120;
                  isNearBottomRef.current = isNearBottom;

                  if (isNearBottom) {
                    setShowJumpToLatest(false);
                  }
                }}
                className="ic-thread"
              >
                <div
                  className={`ic-thread-inner ${
                    !hasConversationContent ? "is-empty" : ""
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

                      <h2>What would you like to explore?</h2>

                      <p>
                        Create a durable conversation to start working with
                        your local assistant.
                      </p>
                    </div>
                  ) : null}

                  {activeChat && isMessageViewLoading ? (
                    <div className="ic-page-loading">
                      <span />
                      <p>Loading conversation</p>
                    </div>
                  ) : null}

                  {activeChat && activeMessageError ? (
                    <div className="ic-page-error">{activeMessageError}</div>
                  ) : null}

                  {/* Commit 4: enhanced empty state for a new chat with prompt chips */}
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

                      <h2>How can I assist you today?</h2>

                      <p>
                        Ask a question, develop an idea, or work through a
                        problem privately.
                      </p>

                      {selectedModelName ? (
                        <div className="ic-starter-prompts">
                          {STARTER_PROMPTS.map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              className="ic-starter-chip"
                              onClick={() => setDraftMessage(prompt + " ")}
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeChat &&
                  !isMessageViewLoading &&
                  !activeMessageError &&
                  hasConversationContent ? (
                    <div className="ic-message-list">
                      <AnimatePresence initial={false} mode="popLayout">
                        {activeMessages.map((message) => {
                          const isUser = message.role === "user";
                          const isCopied = copiedMessageId === message.id;
                          const isLastAssistant =
                            !isUser &&
                            message.id ===
                              [...activeMessages]
                                .reverse()
                                .find((m) => m.role === "assistant")?.id;

                          return (
                            <motion.article
                              layout
                              key={`message-${message.chat_id}-${message.sequence_number}-${message.role}`}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.2 }}
                              className={`ic-message ${
                                isUser
                                  ? "ic-message-user"
                                  : "ic-message-assistant"
                              }`}
                            >

                              <div
                                className={
                                  isUser
                                    ? "ic-saved-user-message"
                                    : "ic-assistant-column"
                                }
                              >
                                {!isUser ? (
                                  <div className="ic-message-identity">
                                    <span>IntraCore</span>
                                    <span className="ic-message-time">
                                      {formatMessageTime(message.created_at)}
                                    </span>
                                  </div>
                                ) : null}

                                {isUser ? (
                                  <>
                                    <div className="ic-saved-user-bubble">
                                      <p>
                                        {animatedEmojiText(message.content)}
                                      </p>
                                    </div>

                                    <time
                                      className="ic-saved-user-time"
                                      dateTime={message.created_at}
                                    >
                                      {formatMessageTime(message.created_at)}
                                    </time>
                                  </>
                                ) : (
                                  <>
                                    <div className="ic-assistant-content assistant-markdown">
                                      <AnimatedMarkdown
                                        content={message.content}
                                      />
                                    </div>

                                    {/* Commit 3: model name badge */}
                                    {message.model_name ? (
                                      <span className="ic-model-badge">
                                        {message.model_name}
                                      </span>
                                    ) : null}

                                    {/* Commit 6: copy button */}
                                    <div className="ic-message-actions">
                                      <button
                                        type="button"
                                        className={`ic-copy-btn ${
                                          isCopied ? "is-copied" : ""
                                        }`}
                                        aria-label={
                                          isCopied
                                            ? "Copied"
                                            : "Copy response"
                                        }
                                        onClick={() => void copyMessage(message)}
                                      >
                                        {isCopied ? (
                                          <CheckIcon />
                                        ) : (
                                          <CopyIcon />
                                        )}
                                      </button>

                                      {isLastAssistant && !isSendingMessage ? (
                                        <button
                                          type="button"
                                          className="ic-regen-btn"
                                          aria-label="Regenerate response"
                                          onClick={() => void regenerateLastResponse()}
                                        >
                                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                            <path d="M3 3v5h5" />
                                          </svg>
                                        </button>
                                      ) : null}
                                    </div>
                                  </>
                                )}
                              </div>
                            </motion.article>
                          );
                        })}

                        {activeStreamingAssistant ? (
                          <StreamingAssistantView
                            key={`stream-${activeStreamingAssistant.requestId}`}
                            stream={activeStreamingAssistant}
                          />
                        ) : null}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </div>
              </div>

              <AnimatePresence>
                {showJumpToLatest && activeChat ? (
                  <motion.button
                    type="button"
                    onClick={jumpToLatest}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
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
                      isSendingMessage ? "is-generating" : ""
                    }`}
                  >
                    <textarea
                      ref={composerTextareaRef}
                      value={draftMessage}
                      onChange={(event) => {
                        setDraftMessage(event.target.value);
                        resizeComposer();

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
                            : "Work with Codex"
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey) &&
                          !isSendingMessage
                        ) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                    />

                    <div className="ic-composer-footer">
                      <div className="ic-composer-tools">
                        <button type="button" className="ic-composer-tool" aria-label="Add attachment">
                          <PlusIcon />
                        </button>
                      </div>

                      <div className="ic-composer-actions">
                        <div className="ic-composer-model-wrap" ref={modelMenuRef}>
                          <button
                            type="button"
                            className="ic-composer-model-trigger"
                            aria-label="Choose local model"
                            aria-haspopup="listbox"
                            aria-expanded={isModelMenuOpen}
                            disabled={isSendingMessage}
                            onClick={() => {
                              setIsModelMenuOpen((current) => !current);
                              setModelNotice(null);
                            }}
                          >
                            <span className="ic-composer-model-icon" aria-hidden="true">⚡</span>
                            <span className="ic-composer-model-name">
                              {isLoadingModels
                                ? "Finding models…"
                                : selectedModelName ?? "No model"}
                            </span>
                            <span className={`ic-model-chevron${isModelMenuOpen ? " is-open" : ""}`}>
                              <ChevronIcon />
                            </span>
                          </button>

                          <AnimatePresence>
                            {isModelMenuOpen ? (
                              <motion.div
                                className="ic-model-menu ic-model-menu-up"
                                initial={{ opacity: 0, y: 6, scale: 0.985 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 4, scale: 0.99 }}
                                transition={{ duration: 0.16 }}
                              >
                                <div className="ic-model-menu-header">Select model</div>

                                <div
                                  className="ic-model-options"
                                  role="listbox"
                                  aria-label="Available local models"
                                >
                                  {modelOptions.map((model) => {
                                    const isSelected = model.name === selectedModelName;
                                    return (
                                      <button
                                        type="button"
                                        key={model.name}
                                        role="option"
                                        aria-selected={isSelected}
                                        className={`ic-model-option ${isSelected ? "is-selected" : ""} ${model.installed ? "is-installed" : "is-missing"}`}
                                        title={model.installed ? `Use ${model.name}` : "Model download support coming soon."}
                                        onClick={() => {
                                          if (!model.selectable) {
                                            setModelNotice("Model download support coming soon.");
                                            return;
                                          }
                                          setSelectedModelName(model.name);
                                          window.localStorage.setItem(MODEL_PREFERENCE_KEY, model.name);
                                          setModelNotice(null);
                                          setIsModelMenuOpen(false);
                                        }}
                                      >
                                        <span className="ic-model-option-main">
                                          <strong>{model.name}</strong>
                                          {model.parameter_size || model.quantization_level ? (
                                            <small>{[model.parameter_size, model.quantization_level].filter(Boolean).join(" · ")}</small>
                                          ) : null}
                                        </span>
                                        {isSelected ? (
                                          <span className="ic-model-check" aria-label="Selected">✓</span>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                  {!isLoadingModels && modelOptions.length === 0 ? (
                                    <p className="ic-model-empty">No models found.</p>
                                  ) : null}
                                </div>

                                {modelNotice || modelError ? (
                                  <p className={`ic-model-menu-status${modelError ? " is-error" : ""}`} role="status">
                                    {modelNotice ?? modelError}
                                  </p>
                                ) : null}
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </div>
                        <button type="button" className="ic-composer-tool ic-microphone-tool" aria-label="Use voice input">
                          <MicrophoneIcon />
                        </button>
                        <motion.button
                          type="button"
                          onClick={() => {
                            if (isSendingMessage) {
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
                              draftMessage.trim().length === 0)
                          }
                          aria-label={
                            isSendingMessage ? "Stop generating" : "Send message"
                          }
                          whileTap={{ scale: 0.94 }}
                          className={`ic-primary-action ${
                            isSendingMessage ? "is-stop" : "is-send"
                          }`}
                        >
                          {isSendingMessage ? (
                            <StopIcon />
                          ) : (
                            <SendIcon />
                          )}
                        </motion.button>
                      </div>
                    </div>
                  </div>

                  {!isSendingMessage && activeSendError ? (
                    <p className="ic-send-error" role="alert">
                      {activeSendError}
                    </p>
                  ) : null}

                  <p className="ic-disclaimer">
                    IntraCore may make mistakes. Verify important information.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ── Memory panel ── */}
        <AnimatePresence>
          {isMemoryPanelOpen ? (
            <>
              <motion.button
                type="button"
                className="ic-memory-backdrop"
                aria-label="Close memories"
                onClick={() => setIsMemoryPanelOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />

              <motion.aside
                className="ic-memory-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="memory-panel-title"
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <header className="ic-memory-panel-header">
                  <div>
                    <span>Global context</span>
                    <h2 id="memory-panel-title">Memories</h2>
                    {/* Commit 9: active / total count */}
                    {totalMemoryCount > 0 ? (
                      <p className="ic-memory-count">
                        {enabledMemoryCount} active · {totalMemoryCount} total
                      </p>
                    ) : (
                      <p>
                        Explicit details IntraCore may use in every chat.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Close memories"
                    onClick={() => setIsMemoryPanelOpen(false)}
                  >
                    ×
                  </button>
                </header>

                <form className="ic-memory-form" onSubmit={saveMemory}>
                  <label htmlFor="memory-content">
                    {editingMemoryId === null ? "New memory" : "Edit memory"}
                  </label>
                  <textarea
                    id="memory-content"
                    rows={4}
                    value={memoryContent}
                    onChange={(event) => {
                      setMemoryContent(event.target.value);
                      setMemoryError(null);
                    }}
                    placeholder="Add a fact, preference, or instruction…"
                    disabled={isSavingMemory}
                  />

                  <div className="ic-memory-form-footer">
                    <select
                      value={memoryKind}
                      onChange={(event) =>
                        setMemoryKind(event.target.value as MemoryKind)
                      }
                      disabled={isSavingMemory}
                      aria-label="Memory kind"
                    >
                      <option value="fact">Fact</option>
                      <option value="preference">Preference</option>
                      <option value="instruction">Instruction</option>
                    </select>

                    <div>
                      {editingMemoryId !== null ? (
                        <button
                          type="button"
                          className="ic-memory-secondary"
                          onClick={resetMemoryForm}
                          disabled={isSavingMemory}
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button
                        type="submit"
                        className="ic-memory-save"
                        disabled={isSavingMemory || !memoryContent.trim()}
                      >
                        {isSavingMemory
                          ? "Saving…"
                          : editingMemoryId === null
                            ? "Add memory"
                            : "Save changes"}
                      </button>
                    </div>
                  </div>
                </form>

                {memoryError ? (
                  <p className="ic-memory-error" role="alert">
                    {memoryError}
                  </p>
                ) : null}

                <div className="ic-memory-list" aria-live="polite">
                  {isLoadingMemories ? (
                    <p className="ic-memory-list-state">Loading memories…</p>
                  ) : null}

                  {!isLoadingMemories && memories.length === 0 ? (
                    <div className="ic-memory-empty">
                      <MemoryIcon />
                      <strong>No memories yet</strong>
                      <p>
                        Only details you add manually will be remembered.
                      </p>
                    </div>
                  ) : null}

                  {!isLoadingMemories
                    ? memories.map((memory) => (
                        <article
                          key={memory.id}
                          className={`ic-memory-card ${
                            memory.is_enabled ? "" : "is-disabled"
                          }`}
                        >
                          <div className="ic-memory-card-top">
                            <span>{memory.kind}</span>
                            <button
                              type="button"
                              className="ic-memory-toggle"
                              role="switch"
                              aria-checked={memory.is_enabled}
                              aria-label={`${
                                memory.is_enabled ? "Disable" : "Enable"
                              } memory`}
                              disabled={busyMemoryId !== null}
                              onClick={() => void toggleMemory(memory)}
                            >
                              <span />
                            </button>
                          </div>

                          <p>{memory.content}</p>

                          {memory.source_chat_id ||
                          memory.source_message_id ? (
                            <small>
                              Source
                              {memory.source_chat_id
                                ? ` chat ${memory.source_chat_id}`
                                : ""}
                              {memory.source_message_id
                                ? ` · message ${memory.source_message_id}`
                                : ""}
                            </small>
                          ) : null}

                          <div className="ic-memory-card-actions">
                            <button
                              type="button"
                              disabled={busyMemoryId !== null}
                              onClick={() => {
                                setEditingMemoryId(memory.id);
                                setMemoryContent(memory.content);
                                setMemoryKind(memory.kind);
                                setMemoryError(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="is-danger"
                              disabled={busyMemoryId !== null}
                              onClick={() => void deleteMemory(memory)}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      ))
                    : null}
                </div>
              </motion.aside>
            </>
          ) : null}
        </AnimatePresence>
        {/* ── Toast notifications ── */}
        <div className="ic-toast-container" aria-live="polite">
          <AnimatePresence>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                className="ic-toast"
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.2 }}
              >
                {toast.message}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>
    </MotionConfig>
  );
}
