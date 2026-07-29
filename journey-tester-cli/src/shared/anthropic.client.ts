import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config/env.config';

let cached: Anthropic | undefined;

/**
 * Cliente compartilhado entre judge e persona. Só é construído quando algum
 * cenário realmente precisa de LLM — cenário 100% determinístico não exige
 * ANTHROPIC_API_KEY.
 */
export function getAnthropicClient(): Anthropic {
  if (cached) return cached;

  const { ANTHROPIC_API_KEY } = getConfig();
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY é obrigatória para asserções `judge` e cenários com `persona`',
    );
  }

  cached = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return cached;
}

export function resetAnthropicClient(): void {
  cached = undefined;
}
