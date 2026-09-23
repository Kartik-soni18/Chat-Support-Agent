<script lang="ts">
  import ChatWidget from "$lib/components/ChatWidget.svelte";
</script>

<svelte:head>
  <title>Chat Support Agent</title>
  <meta name="description" content="Chat with our AI-powered support agent for help with orders, shipping, returns, and more." />
</svelte:head>

<main class="flex-1 flex flex-col items-center justify-center p-0 sm:p-4">
  <ChatWidget />
</main>
