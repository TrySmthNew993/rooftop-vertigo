// Ultra-lightweight Web Audio alert synthesizer (muted by default for zero overhead)
export class AlertAudio {
  constructor() {
    this.muted = true;
    this.ctx = null;
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (!this.muted) {
      this._ensureContext();
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  _tone(freq, duration, type = 'sine', gainPeak = 0.08, delay = 0, freqEnd = null) {
    if (this.muted) return;
    this._ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playGustWarning() {
    this._tone(520, 0.14, 'triangle', 0.09, 0, 680);
    this._tone(680, 0.16, 'triangle', 0.09, 0.16, 840);
  }

  playCarabinerClick(locked = true) {
    if (locked) {
      this._tone(980, 0.05, 'square', 0.06, 0, 1420);
      this._tone(1620, 0.07, 'triangle', 0.07, 0.045, 1180);
    } else {
      this._tone(900, 0.05, 'triangle', 0.05, 0, 560);
    }
  }

  playLoot() {
    this._tone(587, 0.09, 'sine', 0.07, 0);
    this._tone(880, 0.14, 'sine', 0.08, 0.08);
  }

  playTrade() {
    this._tone(523, 0.08, 'triangle', 0.07, 0);
    this._tone(659, 0.08, 'triangle', 0.07, 0.07);
    this._tone(1046, 0.16, 'triangle', 0.08, 0.14);
  }

  playInject() {
    this._tone(420, 0.18, 'sawtooth', 0.04, 0, 1150);
  }

  playDanger() {
    this._tone(190, 0.22, 'sawtooth', 0.08, 0, 95);
  }
}
