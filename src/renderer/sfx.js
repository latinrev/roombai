// Chiptune-ish sound effects synthesized on the fly — no audio files needed.
const Sfx = (() => {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, { at = 0, dur = 0.08, type = 'square', vol = 0.05, slide = 0 } = {}) {
    if (muted) return;
    const a = ac();
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    setMuted(m) { muted = m; },
    pickup() { tone(520, { slide: 400, dur: 0.07 }); },
    drop() { tone(160, { type: 'triangle', slide: -90, dur: 0.1, vol: 0.08 }); },
    bonk() { tone(110, { type: 'square', dur: 0.05, vol: 0.04 }); },
    stickCeiling() { tone(300, { slide: 900, dur: 0.12, type: 'triangle' }); tone(900, { at: 0.1, dur: 0.05 }); },
    plop() { tone(240, { type: 'sine', slide: -140, dur: 0.1, vol: 0.06 }); },
    slurp() { tone(700, { type: 'sawtooth', slide: -500, dur: 0.18, vol: 0.025 }); },
    burp() { tone(90, { type: 'sawtooth', slide: -30, dur: 0.25, vol: 0.06 }); },
    tidy() { tone(880, { dur: 0.06, vol: 0.03 }); tone(1320, { at: 0.06, dur: 0.08, vol: 0.03 }); },
    done() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.1, vol: 0.04 })); },
    stuck() { tone(220, { type: 'sawtooth', dur: 0.14, vol: 0.05 }); tone(185, { at: 0.16, type: 'sawtooth', dur: 0.2, vol: 0.05 }); },
    waiting() { tone(784, { dur: 0.1, vol: 0.04, type: 'triangle' }); tone(587, { at: 0.13, dur: 0.14, vol: 0.04, type: 'triangle' }); },
    splat() { tone(140, { type: 'sawtooth', slide: -80, dur: 0.08, vol: 0.03 }); },
    crash() { [180, 120, 90].forEach((f, i) => tone(f, { at: i * 0.05, type: 'square', slide: -60, dur: 0.09, vol: 0.05 })); },
    scrub() { tone(1800 + Math.random() * 600, { type: 'triangle', dur: 0.025, vol: 0.008 }); },
    shine() { [988, 1319, 1976].forEach((f, i) => tone(f, { at: i * 0.06, dur: 0.12, vol: 0.03, type: 'triangle' })); },
    beam() { tone(300, { type: 'sine', slide: 1400, dur: 0.5, vol: 0.03 }); tone(600, { at: 0.1, type: 'triangle', slide: 1200, dur: 0.4, vol: 0.02 }); },
    whoosh() { tone(900, { type: 'triangle', slide: -700, dur: 0.14, vol: 0.02 }); },
    spin() { for (let i = 0; i < 5; i++) tone(500 + i * 60, { at: i * 0.05, type: 'square', dur: 0.03, vol: 0.02 }); },
    pop() { tone(420 + Math.random() * 200, { type: 'sine', slide: -200, dur: 0.06, vol: 0.02 }); },
    squeak() { tone(1200, { slide: 600, dur: 0.05, vol: 0.02, type: 'triangle' }); },
  };
})();
