/**
 * Web Audio utilities for Gemini Live real-time bidirectional streaming.
 * Handles 16kHz PCM microphone capture and 24kHz PCM progressive playback with instant interruption.
 */

// Helper to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper to convert Uint8Array / ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Downsample Float32 audio to 16kHz Int16 PCM
function downsampleToInt16PCM(
  inputData: Float32Array,
  inputSampleRate: number,
  outputSampleRate = 16000
): Int16Array {
  if (inputSampleRate === outputSampleRate) {
    const output = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(inputData.length / ratio);
  const output = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originalIndex = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, inputData[originalIndex]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  return output;
}

export class AudioCaptureStream {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private onChunk: (base64Pcm: string) => void;

  constructor(onChunk: (base64Pcm: string) => void) {
    this.onChunk = onChunk;
  }

  async start(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextClass();

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    // 4096 sample buffer size (~90ms at 44.1kHz/48kHz)
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (e) => {
      if (!this.audioContext) return;
      const inputBuffer = e.inputBuffer.getChannelData(0);
      const int16PCM = downsampleToInt16PCM(inputBuffer, this.audioContext.sampleRate, 16000);
      if (int16PCM.length > 0) {
        const base64Chunk = arrayBufferToBase64(int16PCM.buffer);
        this.onChunk(base64Chunk);
      }
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  stop(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }
}

export class AudioStreamPlayer {
  private audioContext: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private onPlaybackStateChange?: (isPlaying: boolean) => void;
  private isFirstChunkOfTurn = true;

  constructor(onPlaybackStateChange?: (isPlaying: boolean) => void) {
    this.onPlaybackStateChange = onPlaybackStateChange;
  }

  /**
   * Pre-warms and resumes the AudioContext in advance during user gesture.
   * Ensures AudioContext.state === "running" before the first audio chunk arrives.
   */
  async prepare(): Promise<void> {
    const ctx = this.initContext();
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }
    console.log(`[AudioPlayer] Prepared audio context: state=${ctx.state}, sampleRate=${ctx.sampleRate}, currentTime=${ctx.currentTime.toFixed(3)}s`);
  }

  private initContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = 0;
      this.isFirstChunkOfTurn = true;
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  playChunk(base64Pcm: string): void {
    try {
      const ctx = this.initContext();
      const rawBytes = base64ToUint8Array(base64Pcm);
      const int16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, Math.floor(rawBytes.byteLength / 2));

      if (int16.length === 0) return;

      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      const isFirst = this.isFirstChunkOfTurn || this.nextPlayTime <= currentTime || this.activeSources.size === 0;

      // Small lookahead margin (40ms) ONLY for the first chunk of a turn to ensure sample 0 is played from the very start
      // without being clipped by the hardware scheduling slice.
      const FIRST_CHUNK_LOOKAHEAD = 0.04;
      const startTime = isFirst ? currentTime + FIRST_CHUNK_LOOKAHEAD : Math.max(currentTime, this.nextPlayTime);

      if (isFirst) {
        console.log(
          `[AudioPlayer] First chunk scheduled: currentTime=${currentTime.toFixed(3)}s, startTime=${startTime.toFixed(3)}s, duration=${audioBuffer.duration.toFixed(3)}s, state=${ctx.state}, activeSources=${this.activeSources.size}`
        );
        this.isFirstChunkOfTurn = false;
      }

      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      this.activeSources.add(source);
      this.onPlaybackStateChange?.(true);

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          this.isFirstChunkOfTurn = true;
          this.onPlaybackStateChange?.(false);
        }
      };
    } catch (err) {
      console.error("[AudioPlayer] Error decoding and playing PCM chunk:", err);
    }
  }

  /**
   * Instantly stops and clears all currently scheduled or playing audio chunks.
   * Essential for seamless barge-in/interruption.
   */
  interrupt(): void {
    console.log(`[AudioPlayer] Interruption: stopping ${this.activeSources.size} active audio sources`);
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source may already have completed
      }
    }
    this.activeSources.clear();
    this.isFirstChunkOfTurn = true;

    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime;
    } else {
      this.nextPlayTime = 0;
    }

    this.onPlaybackStateChange?.(false);
  }

  close(): void {
    this.interrupt();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
