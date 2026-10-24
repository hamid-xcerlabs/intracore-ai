// Central API configuration and typed fetch helpers for IntraCore AI.
// All backend communication is routed through this module so the URL
// and error-handling conventions never scatter across components.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

// ─── Shared Types ─────────────────────────────────────────────────────────────

export type Chat = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type Message = {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  sequence_number: number;
  model_name: string | null;
  created_at: string;
};

export type ChatModelOption = {
  name: string;
  installed: boolean;
  selectable: boolean;
  family: string | null;
  parameter_size: string | null;
  quantization_level: string | null;
};

export type ChatModelListResponse = {
  default_model: string | null;
  models: ChatModelOption[];
};

export type ReadinessResponse = {
  status: "ready" | "unavailable";
  checks: {
    ollama?: { status?: string; model?: string | null };
    database?: { connected?: boolean };
  };
};

export type MemoryKind = "fact" | "preference" | "instruction";

export type MemoryRecord = {
  id: number;
  content: string;
  kind: MemoryKind;
  is_enabled: boolean;
  source_chat_id: number | null;
  source_message_id: number | null;
  created_at: string;
  updated_at: string;
};

export type StreamingEvent =
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

// ─── Utilities ────────────────────────────────────────────────────────────────

export async function readApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

// ─── Chat API ─────────────────────────────────────────────────────────────────

export async function apiFetchChats(): Promise<Chat[]> {
  const response = await fetch(`${API_BASE_URL}/chats`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Could not load chats (${response.status}).`);
  }
  return response.json() as Promise<Chat[]>;
}

export async function apiCreateChat(title: string): Promise<Chat> {
  const response = await fetch(`${API_BASE_URL}/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`Could not create chat (${response.status}).`);
  }
  return response.json() as Promise<Chat>;
}

export async function apiDeleteChat(chatId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Could not delete chat (${response.status}).`);
  }
}

export async function apiRenameChat(
  chatId: number,
  title: string,
): Promise<Chat> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(
      await readApiError(response, `Could not rename chat (${response.status}).`),
    );
  }
  return response.json() as Promise<Chat>;
}

export async function apiFetchMessages(
  chatId: number,
  signal?: AbortSignal,
): Promise<Message[]> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Could not load messages (${response.status}).`);
  }
  return response.json() as Promise<Message[]>;
}

// ─── Models API ───────────────────────────────────────────────────────────────

export async function apiFetchModels(): Promise<ChatModelListResponse> {
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
  return response.json() as Promise<ChatModelListResponse>;
}

export async function apiFetchReadiness(): Promise<ReadinessResponse> {
  const response = await fetch(`${API_BASE_URL}/health/ready`, {
    method: "GET",
    cache: "no-store",
  });
  const body = (await response.json()) as ReadinessResponse;
  return body;
}

// ─── Memory API ───────────────────────────────────────────────────────────────

export async function apiFetchMemories(): Promise<MemoryRecord[]> {
  const response = await fetch(`${API_BASE_URL}/memories`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load memories."));
  }
  return response.json() as Promise<MemoryRecord[]>;
}

export async function apiCreateMemory(
  content: string,
  kind: MemoryKind,
): Promise<MemoryRecord> {
  const response = await fetch(`${API_BASE_URL}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, kind, is_enabled: true }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not save memory."));
  }
  return response.json() as Promise<MemoryRecord>;
}

export async function apiUpdateMemory(
  memoryId: number,
  patch: Partial<Pick<MemoryRecord, "content" | "kind" | "is_enabled">>,
): Promise<MemoryRecord> {
  const response = await fetch(`${API_BASE_URL}/memories/${memoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not update memory."));
  }
  return response.json() as Promise<MemoryRecord>;
}

export async function apiDeleteMemory(memoryId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/memories/${memoryId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not delete memory."));
  }
}
