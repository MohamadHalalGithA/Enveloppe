/**
 * Languages offered for "Listen in my language": common first languages of newcomers to Canada that the
 * ElevenLabs multilingual model speaks. Codes are ISO 639-1; `locale` formats dates and numbers.
 */
export const SPEECH_LANGUAGES = [
  { code: "en", name: "English", english: "English", locale: "en-CA", dir: "ltr" },
  { code: "fr", name: "Français", english: "French", locale: "fr-CA", dir: "ltr" },
  { code: "ar", name: "العربية", english: "Arabic", locale: "ar", dir: "rtl" },
  { code: "zh", name: "中文", english: "Simplified Chinese (Mandarin)", locale: "zh-CN", dir: "ltr" },
  { code: "es", name: "Español", english: "Spanish", locale: "es", dir: "ltr" },
  { code: "tl", name: "Tagalog", english: "Tagalog (Filipino)", locale: "fil", dir: "ltr" },
  { code: "uk", name: "Українська", english: "Ukrainian", locale: "uk", dir: "ltr" },
  { code: "hi", name: "हिन्दी", english: "Hindi", locale: "hi", dir: "ltr" },
] as const;

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];
export type SpeechLanguageCode = SpeechLanguage["code"];
export const SPEECH_LANGUAGE_CODES = SPEECH_LANGUAGES.map((l) => l.code) as [SpeechLanguageCode, ...SpeechLanguageCode[]];

export function speechLanguage(code: string): SpeechLanguage | undefined {
  return SPEECH_LANGUAGES.find((l) => l.code === code);
}
