<script lang="ts">
  import type { ChatMessage } from "../types";
  import MessageBubble from "./MessageBubble.svelte";
  import TypingIndicator from "./TypingIndicator.svelte";

  interface Props {
    messages: ChatMessage[];
    isLoading: boolean;
  }

  let { messages, isLoading }: Props = $props();

  let messageContainer: HTMLDivElement;

  $effect(() => {
    const _ = messages;
    if (messageContainer) {
      messageContainer.scrollTop = messageContainer.scrollHeight;
    }
  });

  const showTypingIndicator = $derived(
    isLoading && messages.length > 0 && messages[messages.length - 1].sender === "user"
  );
</script>

<div
  bind:this={messageContainer}
  class="flex-1 overflow-y-auto px-4 py-4 space-y-3 scroll-smooth"
>
  {#if messages.length === 0}
    <div class="flex flex-col items-center justify-center h-full text-center text-gray-500 py-12">
      <div class="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      </div>
      <h3 class="text-lg font-semibold text-gray-700 mb-1">Welcome to Chat Support Agent!</h3>
      <p class="text-sm text-gray-500 max-w-xs">
        Our AI agent is here to help you with orders, shipping, returns, and more. Send a message to get started.
      </p>
    </div>
  {:else}
    {#each messages as message (message.id)}
      <MessageBubble {message} />
    {/each}
    {#if showTypingIndicator}
      <TypingIndicator />
    {/if}
  {/if}
</div>
