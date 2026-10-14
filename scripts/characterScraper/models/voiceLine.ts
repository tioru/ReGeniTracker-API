export type VoiceLanguage = "CN" | "JP" | "EN" | "KR";

export interface VoiceLine {
    title: string
    transcription?: string,
    files: Partial<Record<VoiceLanguage, string>>
}