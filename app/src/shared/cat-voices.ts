// As vozes do Kiwi-cat (spec #27531, T27778): o id estável de cada uma, o idioma, e o nome e a descrição mostrados nos
// Ajustes. Os nomes e as descrições ficam só aqui (harry #27827, #27841). O arquivo de referência de cada voz, o texto
// dele e o da prévia ficam no lado Bun (`src/bun/cat-voice-model.ts`): a UI não precisa deles.

export const CAT_VOICE_LANGUAGES = ["english", "portuguese"] as const;
export type CatVoiceLanguage = (typeof CAT_VOICE_LANGUAGES)[number];
export const CAT_VOICE_LANGUAGE_LABELS: Record<CatVoiceLanguage, string> = { english: "Inglês", portuguese: "Português" };

export const CAT_VOICE_IDS = ["en-a", "en-b", "pt-a"] as const;
export type CatVoiceId = (typeof CAT_VOICE_IDS)[number];
export const isCatVoiceId = (v: unknown): v is CatVoiceId => (CAT_VOICE_IDS as readonly unknown[]).includes(v);

/** O que a pessoa vê de cada voz: o código e o jeito dela, para saber antes de ouvir. */
export const CAT_VOICES: Record<CatVoiceId, { code: string; description: string; language: CatVoiceLanguage }> = {
  "en-a": { code: "Kiwi EN-1", description: "Animada e divertida", language: "english" },
  "en-b": { code: "Kiwi EN-2", description: "Suave e fofa", language: "english" },
  "pt-a": { code: "Kiwi PT-1", description: "Leve, com sotaque brasileiro", language: "portuguese" },
};

/** A voz de quem ainda não escolheu: a em português (harry #28142). Os Ajustes abrem no idioma dela. */
export const DEFAULT_CAT_VOICE: CatVoiceId = "pt-a";
