import { writable } from "svelte/store";
import type { ChatMessage } from "../types";
import * as api from "../api";

const STORAGE_KEY = "chat_session_id";

interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: ChatState = {
  messages: [],
  sessionId: null,
  isLoading: false,
  error: null,
};

function createChatStore() {
  const { subscribe, update, set } = writable<ChatState>(initialState);

  let lastUserMessage: { text: string; clientMessageId: string } | null = null;

  return {
    subscribe,

    async sendMessage(text: string, clientMessageId: string = crypto.randomUUID()) {
      lastUserMessage = { text, clientMessageId };

      update((state) => {
        const optimisticMessage: ChatMessage = {
          id: -Date.now(),
          sender: "user",
          text,
          timestamp: new Date().toISOString(),
        };
        return {
          ...state,
          messages: [...state.messages, optimisticMessage],
          isLoading: true,
          error: null,
        };
      });

      try {
        const currentState = getCurrentState();
        const response = await api.sendMessage(text, currentState.sessionId, clientMessageId);

        update((state) => {
          const withoutOptimistic = state.messages.filter((m) => m.id > 0);
          const persistedUserMessage: ChatMessage = {
            id: Date.now(),
            sender: "user",
            text,
            timestamp: new Date().toISOString(),
          };
          const aiMessage: ChatMessage = {
            id: Date.now() + 1,
            sender: "ai",
            text: response.reply,
            timestamp: new Date().toISOString(),
          };
          return {
            ...state,
            messages: [...withoutOptimistic, persistedUserMessage, aiMessage],
            sessionId: response.sessionId,
            isLoading: false,
          };
        });

        localStorage.setItem(STORAGE_KEY, response.sessionId);
      } catch (err) {
        update((state) => {
          const withoutOptimistic = state.messages.filter((m) => m.id > 0);
          const errorMessage =
            err instanceof Error
              ? err.message
              : "Something went wrong. Please try again.";
          return {
            ...state,
            messages: withoutOptimistic,
            isLoading: false,
            error: errorMessage,
          };
        });
      }
    },

    async loadHistory(sessionId: string) {
      update((state) => ({ ...state, isLoading: true, error: null }));

      try {
        const response = await api.fetchHistory(sessionId);
        update((state) => ({
          ...state,
          messages: response.messages,
          sessionId: response.sessionId,
          isLoading: false,
        }));
      } catch (err) {
        update((state) => ({
          ...state,
          isLoading: false,
          error:
            err instanceof Error
              ? err.message
              : "Failed to load chat history.",
        }));
      }
    },

    clearChat() {
      set(initialState);
      localStorage.removeItem(STORAGE_KEY);
    },

    async retryLastMessage() {
      if (lastUserMessage) {
        await this.sendMessage(lastUserMessage.text, lastUserMessage.clientMessageId);
      }
    },
  };
}

function getCurrentState(): ChatState {
  let current: ChatState = initialState;
  const unsubscribe = chatStore.subscribe((s) => {
    current = s;
  });
  unsubscribe();
  return current;
}

export const chatStore = createChatStore();
export const sendMessage = (text: string) => chatStore.sendMessage(text);
export const loadHistory = (sessionId: string) => chatStore.loadHistory(sessionId);
export const clearChat = () => chatStore.clearChat();
export const retryLastMessage = () => chatStore.retryLastMessage();
