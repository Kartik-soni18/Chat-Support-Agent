import { db } from "./db.js";
import {
  createConversation,
  addMessage,
  getMessages,
} from "./services/conversation.js";

function seed(): void {
  console.log("Seeding database with sample conversation...");

  const conversationId = createConversation();
  console.log(`Created conversation: ${conversationId}`);

  addMessage(
    conversationId,
    "user",
    "What's your return policy?"
  );

  addMessage(
    conversationId,
    "ai",
    "You can return any item within 30 days of purchase for a full refund. Items must be unused and in original packaging. Contact the store's support team to initiate a return."
  );

  addMessage(
    conversationId,
    "user",
    "How long does shipping usually take?"
  );

  addMessage(
    conversationId,
    "ai",
    "Standard delivery takes 3-5 business days domestically and 7-14 days internationally. We also offer express shipping for $15, which delivers in 1-2 business days."
  );

  const messages = getMessages(conversationId);
  console.log(`Conversation now has ${messages.length} messages:`);
  for (const msg of messages) {
    console.log(`  [${msg.sender}] ${msg.text.substring(0, 60)}...`);
  }

  console.log("\nSeed complete! Use this sessionId to test history fetching:");
  console.log(`  ${conversationId}`);

  db.close();
}

seed();
