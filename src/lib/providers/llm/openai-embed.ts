import { serverConfig } from '@/lib/config';

/**
 * OpenAI embeddings — used regardless of which LLM provider is set,
 * because Anthropic doesn't ship an embeddings API yet. Cheapest option.
 * text-embedding-3-small: $0.02/M tokens (~$0.0001 per JD).
 */
export async function embedWithOpenAI(texts: string[]): Promise<number[][]> {
  const cfg = serverConfig();
  if (!cfg.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required for embeddings even when LLM_PROVIDER=anthropic');
  }
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
  const data: { data: { embedding: number[] }[] } = await res.json();
  return data.data.map((d) => d.embedding);
}
