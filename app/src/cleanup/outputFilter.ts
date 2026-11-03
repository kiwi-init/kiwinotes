// Portado de VoiceInk/VoiceInk/Core/Enhancement/AIEnhancementOutputFilter.swift @ 19546d2.

const REASONING_BLOCKS = [
  /<thinking>([\s\S]*?)<\/thinking>/g,
  /<think>([\s\S]*?)<\/think>/g,
  /<reasoning>([\s\S]*?)<\/reasoning>/g,
];

/** `AIEnhancementOutputFilter.filter`: tira os blocos de raciocínio e as pontas em branco. */
export function filterOutput(text: string): string {
  let processed = text;
  for (const pattern of REASONING_BLOCKS) processed = processed.replace(pattern, "");
  return processed.trim();
}
