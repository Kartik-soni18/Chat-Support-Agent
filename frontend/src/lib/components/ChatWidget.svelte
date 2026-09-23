<script lang="ts">
  import { onMount } from "svelte";
  import { chatStore, sendMessage, loadHistory, clearChat, retryLastMessage } from "../stores/chat";
  import MessageList from "./MessageList.svelte";
  import ChatInput from "./ChatInput.svelte";

  const STORAGE_KEY = "chat_session_id";

  onMount(() => {
    const savedSessionId = localStorage.getItem(STORAGE_KEY);
    if (savedSessionId) {
      loadHistory(savedSessionId);
    }
  });

  function handleSend(text: string) {
    sendMessage(text);
  }

  function handleClear() {
    clearChat();
  }

  function handleRetry() {
    retryLastMessage();
  }
</script>

<div class="w-full sm:max-w-[480px] h-[100dvh] sm:h-[85vh] flex flex-col bg-white sm:rounded-2xl sm:shadow-lg sm:border sm:border-gray-200 overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between bg-emerald-600 text-white px-4 py-3 sm:rounded-t-2xl flex-shrink-0">
    <div class="flex items-center gap-3">
      <div class="relative">
        <div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </div>
        <span class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-emerald-600 rounded-full"></span>
      </div>
      <div>
        <h2 class="text-base font-semibold leading-tight">Chat Support Agent</h2>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse"></span>
          <span class="text-xs text-emerald-100">Online</span>
        </div>
      </div>
    </div>
    <button
      onclick={handleClear}
      aria-label="Clear chat"
      title="Clear chat"
      class="p-2 rounded-lg text-emerald-100 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  </div>

  <!-- Message List -->
  <MessageList messages={$chatStore.messages} isLoading={$chatStore.isLoading} />

  <!-- Error Banner -->
  {#if $chatStore.error}
    <div class="flex-shrink-0 mx-4 mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 flex items-center gap-3">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
      <p class="flex-1 text-sm text-red-700">{$chatStore.error}</p>
      <button
        onclick={handleRetry}
        class="flex-shrink-0 text-sm font-medium text-red-700 hover:text-red-800 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-1"
      >
        Retry
      </button>
    </div>
  {/if}

  <!-- Chat Input -->
  <ChatInput disabled={$chatStore.isLoading} onSend={handleSend} />
</div>
