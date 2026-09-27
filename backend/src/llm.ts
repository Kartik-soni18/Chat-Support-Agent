import { z } from 'zod';
import { step } from './activity.ts';

const { OPENROUTER_API_KEY } = z.object({ OPENROUTER_API_KEY: z.string().min(1) }).parse(process.env);
const MODEL = 'z-ai/glm-5.3-flash';
const STT_MODEL = 'openai/gpt-4o-mini-transcribe';

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Message =
  | { role: 'system' | 'user'; content: string | Part[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type Tool = { type: 'function'; function: { name: string; description: string; parameters: object } };

export const imageParts = (images: string[]): Part[] => images.map((url) => ({ type: 'image_url', image_url: { url } }));

export async function callModel(messages: Message[], tools?: Tool[]): Promise<Extract<Message, { role: 'assistant' }>> {
  const images = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').length;
  const title = tools ? 'LLM turn · tools available' : images ? 'Vision call' : 'LLM call';
  const data = await step('llm', title, { model: MODEL, messages: messages.length, images, tools: tools?.length ?? 0 }, async () => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, tools }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.choices) throw new Error(`OpenRouter: ${JSON.stringify(data.error ?? data)}`);
    return data;
  }, (data) => {
    const msg = data.choices[0].message;
    const out = msg.tool_calls?.length
      ? `→ ${msg.tool_calls.map((c: ToolCall) => c.function.name).join(', ')}`
      : `reply · ${msg.content?.length ?? 0} chars`;
    return data.usage ? `${out} · ${data.usage.total_tokens} tokens` : out;
  });
  return data.choices[0].message;
}

export async function complete(messages: Message[]): Promise<string> {
  return (await callModel(messages)).content ?? '';
}

export function transcribe(audio: Buffer, format: string): Promise<string> {
  return step('llm', 'Transcribe audio', { model: STT_MODEL, format, kb: Math.round(audio.length / 1024) }, async () => {
    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: STT_MODEL, input_audio: { data: audio.toString('base64'), format } }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { text: string }).text.trim();
  }, (text) => `"${text.slice(0, 60)}"`);
}
