// Game sounds, generated in code so there are no audio files to load.
(function () {
  const FB = (window.FB = window.FB || {});

  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.crowdGain = null;
    }

    // Browsers only allow audio after a key press or click.
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.startCrowd();
    }

    makeNoise() {
      const c = this.ctx;
      const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    }

    startCrowd() {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const low = c.createBiquadFilter();
      low.type = 'bandpass';
      low.frequency.value = 650;
      low.Q.value = 0.5;
      this.crowdGain = c.createGain();
      this.crowdGain.gain.value = 0;
      src.connect(low).connect(this.crowdGain).connect(this.master);
      src.start();
    }

    crowd(level, fade) {
      if (!this.crowdGain) return;
      const t = this.ctx.currentTime;
      this.crowdGain.gain.cancelScheduledValues(t);
      this.crowdGain.gain.setTargetAtTime(level, t, fade || 0.5);
    }

    tone(freq, start, length, type, volume) {
      const c = this.ctx;
      const t = c.currentTime + start;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(volume || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + length);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + length);
    }

    thud(volume, freq) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq || 420;
      const g = c.createGain();
      g.gain.setValueAtTime(volume, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
      src.connect(f).connect(g).connect(this.master);
      src.start();
      src.stop(c.currentTime + 0.22);
    }

    whistle() {
      const c = this.ctx;
      const t = c.currentTime;
      const o = c.createOscillator();
      const wobble = c.createOscillator();
      const depth = c.createGain();
      const g = c.createGain();
      o.frequency.value = 2300;
      wobble.frequency.value = 42;
      depth.gain.value = 130;
      wobble.connect(depth).connect(o.frequency);
      g.gain.setValueAtTime(0.1, t);
      g.gain.setValueAtTime(0.1, t + 0.28);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(g).connect(this.master);
      o.start(t);
      wobble.start(t);
      o.stop(t + 0.4);
      wobble.stop(t + 0.4);
    }

    fanfare() {
      [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.3, 'square', 0.13));
    }

    onEvent(e) {
      if (!this.ctx || this.muted) return;
      switch (e.type) {
        case 'snap':
          this.thud(0.3, 900);
          this.crowd(0.05, 0.3);
          break;
        case 'throw':
        case 'dive':
          this.thud(0.16, 1500);
          break;
        case 'kick':
          this.thud(0.7, 300);
          break;
        case 'catch':
          this.tone(880, 0, 0.09, 'triangle', 0.16);
          break;
        case 'tackle':
          this.thud(e.impact > 9 ? 0.85 : 0.5);
          break;
        case 'broken':
        case 'stiffhit':
          this.thud(0.4, 700);
          break;
        case 'stiff':
          this.tone(300, 0, 0.1, 'sawtooth', 0.1);
          break;
        case 'whistle':
          this.whistle();
          this.crowd(0.02, 1);
          break;
        case 'td':
          this.fanfare();
          this.crowd(0.17, 0.2);
          break;
        case 'int':
        case 'fumble':
          this.crowd(0.13, 0.15);
          break;
        case 'final':
          this.crowd(0.1, 0.3);
          this.fanfare();
          break;
      }
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    }
  }

  FB.Sound = Sound;
})();
