import type * as Ort from 'onnxruntime-web';

/** Silero VAD (MIT, github.com/snakers4/silero-vad) expects 16 kHz mono in 512-sample frames. */
export const VAD_RATE = 16000;
export const VAD_FRAME = 512;
const CONTEXT = 64; // samples carried over from the previous frame, as in the official wrapper
const STATE_SIZE = 2 * 1 * 128;

/** Probability that each 32 ms frame contains a human voice, ignoring music and effects. */
export class SileroVad {
  private state = new Float32Array(STATE_SIZE);
  private context = new Float32Array(CONTEXT);
  private readonly sr: Ort.Tensor;

  private constructor(
    private readonly ort: typeof Ort,
    private readonly session: Ort.InferenceSession,
  ) {
    this.sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_RATE)]), []);
  }

  static async create(ort: typeof Ort, model: string | Uint8Array): Promise<SileroVad> {
    const session =
      typeof model === 'string' ? await ort.InferenceSession.create(model) : await ort.InferenceSession.create(model);
    return new SileroVad(ort, session);
  }

  async process(frame: Float32Array): Promise<number> {
    if (frame.length !== VAD_FRAME) throw new Error(`VAD frame must be ${VAD_FRAME} samples`);
    const x = new Float32Array(CONTEXT + VAD_FRAME);
    x.set(this.context);
    x.set(frame, CONTEXT);
    const out = await this.session.run({
      input: new this.ort.Tensor('float32', x, [1, x.length]),
      state: new this.ort.Tensor('float32', this.state, [2, 1, 128]),
      sr: this.sr,
    });
    this.state = Float32Array.from(out.stateN!.data as Float32Array);
    this.context = x.slice(-CONTEXT);
    return (out.output!.data as Float32Array)[0]!;
  }
}

/** Runs the VAD over a whole 16 kHz buffer; one probability per 512-sample frame. */
export async function voiceProbabilities(vad: SileroVad, pcm: Float32Array): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i + VAD_FRAME <= pcm.length; i += VAD_FRAME) out.push(await vad.process(pcm.subarray(i, i + VAD_FRAME)));
  return out;
}
