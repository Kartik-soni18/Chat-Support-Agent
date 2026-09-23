import type { SendMessageResponse, ChatHistoryResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function sendMessage(
  message: string, 
  sessionId: string | null | undefined,
  clientMessageId: string
): Promise<SendMessageResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const res = await fetch(`${API_BASE}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId, clientMessageId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  }
}

export async function fetchHistory(sessionId: string): Promise<ChatHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/chat/history/${sessionId}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
