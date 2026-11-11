// Collects 512-sample mono frames (16 kHz context) for the Silero VAD and posts them with the
// audio-clock time at which each frame ends.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(512);
    this.n = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const len = channels[0].length;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (const ch of channels) v += ch[i];
      this.buf[this.n++] = v / channels.length;
      if (this.n === 512) {
        this.port.postMessage({ pcm: this.buf, end: currentTime + (i + 1) / sampleRate }, [this.buf.buffer]);
        this.buf = new Float32Array(512);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
