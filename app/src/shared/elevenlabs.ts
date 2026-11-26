// A voz do Kiwi pelo ElevenLabs (spec #31616): o provedor escolhido, os modelos aceitos e a voz. A UI e o main leem
// daqui. A chave da API não passa por aqui: ela só existe no Keychain (`src/bun/keychain.ts`), e a UI só sabe se há uma.

/** Quem fala com a voz do Kiwi: a voz local (o padrão) ou o ElevenLabs, com a conta e a chave da pessoa. */
export const CAT_VOICE_PROVIDERS = ["local", "elevenlabs"] as const;
export type CatVoiceProvider = (typeof CAT_VOICE_PROVIDERS)[number];
export const DEFAULT_CAT_VOICE_PROVIDER: CatVoiceProvider = "local";
export const isCatVoiceProvider = (v: unknown): v is CatVoiceProvider => (CAT_VOICE_PROVIDERS as readonly unknown[]).includes(v);

/** Os modelos que a pessoa escolhe (harry #31625), o padrão primeiro. Todos falam português e inglês com a mesma voz. */
export const ELEVENLABS_MODELS = ["eleven_v4_turbo", "eleven_v4", "eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"] as const;
export type ElevenLabsModel = (typeof ELEVENLABS_MODELS)[number];
export const DEFAULT_ELEVENLABS_MODEL: ElevenLabsModel = "eleven_v4_turbo";
export const isElevenLabsModel = (v: unknown): v is ElevenLabsModel => (ELEVENLABS_MODELS as readonly unknown[]).includes(v);

/** A Matilda, uma voz pronta (premade) do ElevenLabs: a padrão nas duas línguas (harry #31616). */
export const DEFAULT_ELEVENLABS_VOICE = "XrExE9yKIg1WjnnlVkGX";
/** O ID de uma voz, como o ElevenLabs o mostra para copiar: letras, números, `_` e `-`. Ele vai no caminho da URL. */
export const isElevenLabsVoiceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/**
 * Por que o ElevenLabs não falou (spec #31616): o `.reason` do `ElevenLabsError` do provedor, o motivo do "Testar" e o
 * da linha discreta dos Ajustes quando o Kiwi cai na voz local. `no_key`: ligado sem chave no Keychain.
 */
export const ELEVENLABS_REASONS = ["no_key", "invalid_api_key", "missing_permissions", "quota_exceeded", "voice_not_found", "network", "unknown"] as const;
export type ElevenLabsReason = (typeof ELEVENLABS_REASONS)[number];
export const isElevenLabsReason = (v: unknown): v is ElevenLabsReason => (ELEVENLABS_REASONS as readonly unknown[]).includes(v);

/**
 * A chave colada nos Ajustes: a mesma regra do Keychain (`KEY` em `src/bun/keychain.ts`), letras, números, `_`, `-` e
 * `.`, de 8 a 256. Não confere com o ElevenLabs: isso é o "Testar".
 */
export const isElevenLabsKeyShape = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.-]{8,256}$/.test(v);
