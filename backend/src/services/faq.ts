import type { ChatMessage } from "../types.js";

export const FAQ_KNOWLEDGE = `
Store name: Demo Store

SHIPPING:
- Free shipping on orders over $50
- Standard delivery: 3-5 business days (domestic), 7-14 days (international)
- Express shipping available for $15 (1-2 business days)

RETURNS & REFUNDS:
- 30-day return window from delivery date
- Items must be unused and in original packaging
- To initiate a return, contact the store's support team with your order number
- Refunds processed within 5-7 business days after we receive the return

SUPPORT HOURS:
- Monday to Friday, 9:00 AM - 6:00 PM EST
- Live chat available on our website during business hours
- Contact the store's support team through its support channel (we reply within 24 hours)

PAYMENT:
- We accept Visa, MasterCard, American Express, PayPal, and Apple Pay
- All transactions are encrypted and secure
`;

export function buildSystemPrompt(): string {
  return `You are a helpful, friendly customer support agent for Demo Store, a sample e-commerce store.
Answer customer questions clearly and concisely. Use the following knowledge about our store:

SHIPPING:
- Free shipping on orders over $50
- Standard delivery: 3-5 business days (domestic), 7-14 days (international)
- Express shipping available for $15 (1-2 business days)

RETURNS & REFUNDS:
- 30-day return window from delivery date
- Items must be unused and in original packaging
- To initiate a return, contact the store's support team with your order number
- Refunds processed within 5-7 business days after we receive the return

SUPPORT HOURS:
- Monday to Friday, 9:00 AM - 6:00 PM EST
- Live chat available on our website during business hours
- Contact the store's support team through its support channel (we reply within 24 hours)

PAYMENT:
- We accept Visa, MasterCard, American Express, PayPal, and Apple Pay
- All transactions are encrypted and secure

If you don't know the answer to a question, be honest and suggest contacting the store's support team.
Never make up policies or information not listed above. Keep responses under 150 words when possible.`;
}

export function buildUserPrompt(history: ChatMessage[], newMessage: string): string {
  const recentHistory = history.slice(-10);
  let prompt = "";

  if (recentHistory.length > 0) {
    prompt += "Previous conversation:\n";
    for (const msg of recentHistory) {
      const role = msg.sender === "user" ? "Customer" : "Agent";
      prompt += `${role}: ${msg.text}\n`;
    }
    prompt += "\n";
  }

  prompt += `Customer: ${newMessage}`;

  return prompt;
}
