/**
 * ElevenLabs text-to-speech. Receives only the scrubbed spoken explanation; never the letter, its image,
 * the user's identity or any id. The API key stays server-side and should be restricted to text-to-speech.
 */

export type TtsFn = (text: string) => Promise<Buffer>;

export class VoiceError extends Error {
  constructor(message = "Voice unavailable") {
    super(message);
    this.name = "VoiceError";
  }
}

export const MAX_SPEECH_CHARS = 1200;

export function elevenLabsTts(config: {
  apiKey: string;
  voiceId: string;
  modelId: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): TtsFn {
  const doFetch = config.fetchFn ?? fetch;
  return async (text) => {
    if (!text.trim()) throw new VoiceError("Nothing to say");
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "xi-api-key": config.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: text.slice(0, MAX_SPEECH_CHARS), model_id: config.modelId }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      });
    } catch {
      throw new VoiceError();
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("audio")) throw new VoiceError(`Voice service returned ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length < 100) throw new VoiceError("Empty audio");
    return audio;
  };
}
