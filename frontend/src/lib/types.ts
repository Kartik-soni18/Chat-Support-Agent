export interface ChatMessage {
  id: number;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
}

export interface SendMessageRequest {
  message: string;
  sessionId?: string | null;
  clientMessageId: string;
}

export interface SendMessageResponse {
  reply: string;
  sessionId: string;
}

export interface ChatHistoryResponse {
  sessionId: string;
  messages: ChatMessage[];
}
