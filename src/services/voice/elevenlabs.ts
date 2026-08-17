import "server-only";

export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const key = process.env.ELEVENLABS_API_KEY; const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voiceId) throw new Error("ElevenLabs is not configured");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
  if (!response.ok) throw new Error(`ElevenLabs failed with ${response.status}`); return response.arrayBuffer();
}
