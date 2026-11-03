// Tipos do motor de limpeza (T52). Decisão e motivos: docs/adr/0002-limpeza.md.

/**
 * Como o texto sai, pelo app em foco:
 * - `casual`: Slack, Teams, mensagens. Pontua, mas uma frase só fica sem ponto final.
 * - `formal`: Mail, Outlook. Pontuação completa; é onde o LLM entra no modo `auto`.
 * - `literal`: terminal e IDE. Nunca reescreve: comando fica como foi dito (sem maiúscula nem ponto).
 * - `default`: o resto (Notas, navegador…).
 */
export type Tone = "casual" | "formal" | "literal" | "default";

/** Termo do dicionário pessoal. A grafia de `term` nunca muda; `aliases` são outras formas de dizer. */
export type DictionaryEntry = string | { term: string; aliases?: string[] };

export interface CleanupInput {
  /** A transcrição crua do STT. */
  raw: string;
  /** Bundle id do app em foco (evento `app.active`). Sem ele, o tom é `default`. */
  bundleId?: string;
  dictionary?: DictionaryEntry[];
  /** Força um tom, por cima do que o bundle id diria. */
  tone?: Tone;
}

export interface LlmRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

/** Um LLM local: o Apple Foundation Models pelo sidecar (`llm.complete`) ou um modelo MLX. Nada na nuvem. */
export interface LlmBackend {
  readonly name: string;
  /** `false` quando o modelo não está disponível (Apple Intelligence desligado, modelo baixando…). */
  available(): boolean;
  complete(request: LlmRequest, signal: AbortSignal): Promise<string>;
}

/**
 * Quando usar o LLM por cima das regras:
 * - `off`: nunca (o padrão).
 * - `auto`: só onde o tempo sobra, no tom `formal` ou em ditado longo; nunca no `literal`.
 * - `always`: sempre que houver backend, menos no `literal`.
 */
export type LlmMode = "off" | "auto" | "always";

export interface CleanupOptions {
  llm?: LlmBackend;
  llmMode?: LlmMode;
  /** Quanto esperar pelo LLM antes de ficar com o texto das regras. */
  llmTimeoutMs?: number;
  /** No modo `auto`, a partir de quantas palavras o ditado conta como longo. */
  longDictationWords?: number;
}

export type LlmOutcome =
  | { used: true; backend: string; ms: number }
  | { used: false; backend: string; ms: number; reason: "timeout" | "error" | "rejected"; detail?: string };

export interface CleanupResult {
  text: string;
  tone: Tone;
  /** O texto só das regras, guardado para o histórico (T57) e para comparar. */
  rulesText: string;
  /** Presente quando o LLM foi chamado. */
  llm?: LlmOutcome;
  ms: number;
}
