// Turns any input (mic or demo audio) into 16 kHz mono Int16 PCM, posted in 100 ms chunks (1600 samples).
class Pcm16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; // sampleRate is the AudioContext rate (e.g. 48000)
    this.acc = 0;
    this.cnt = 0;
    this.pos = 0;
    this.next = this.ratio;
    this.buf = new Int16Array(1600);
    this.n = 0;
  }

  emit(v) {
    v = Math.max(-1, Math.min(1, v));
    this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    if (this.n === this.buf.length) {
      this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
      this.buf = new Int16Array(1600);
      this.n = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Box-filter downsampling: average the input samples that fall in each output slot.
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.cnt++;
      this.pos++;
      if (this.pos >= this.next) {
        this.emit(this.acc / this.cnt);
        this.acc = 0;
        this.cnt = 0;
        this.next += this.ratio;
      }
    }
    if (this.pos > 1e7) { this.pos -= 1e7; this.next -= 1e7; }
    return true;
  }
}

registerProcessor("pcm-16k", Pcm16k);
