import { serverConfig } from '@/lib/config';
import type { LLMProvider } from './types';
import { AnthropicProvider } from './anthropic';

let _llm: LLMProvider | undefined;

/**
 * Factory: pick the LLM provider once per process based on env.
 * Add a new provider by:
 *   1. implementing LLMProvider in a new file
 *   2. importing + branching here
 *   3. setting LLM_PROVIDER=<name> in env
 */
export function llm(): LLMProvider {
  if (_llm) return _llm;
  const provider = serverConfig().LLM_PROVIDER;
  switch (provider) {
    case 'anthropic':
      _llm = new AnthropicProvider();
      return _llm;
    case 'openai':
      // TODO: implement OpenAIProvider in ./openai.ts when needed
      throw new Error('OpenAI provider not yet implemented — set LLM_PROVIDER=anthropic');
    default:
      throw new Error(`Unknown LLM provider: ${provider as string}`);
  }
}

export type { LLMProvider } from './types';
