/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Suit audio, synthesised with Web Audio (no audio files): what you would hear inside a helmet on Mars.
 * Mars' 6–7 hPa CO₂ air carries very little sound, so outside wind is faint; suit fans and your own breathing dominate.
 * Breathing rate follows the metabolic rate from the game's NASA-based model (ASSUMPTION: 12 breaths/min at rest,
 * +1 per 30 W above rest). */
(function (root) {
  'use strict';
  let ctx = null, master = null, on = true, breathT = 0, fans = null, wind = null, noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return (noiseBuf = b);
  }
  function src(loop = true) { const s = ctx.createBufferSource(); s.buffer = noise(); s.loop = loop; return s; }
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ctx.destination);
    // suit fans: low hum + filtered noise
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 118;
    const hg = ctx.createGain(); hg.gain.value = 0.012; hum.connect(hg).connect(master); hum.start();
    const fn = src(), ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 520; ff.Q.value = 0.7;
    const fg = ctx.createGain(); fg.gain.value = 0.035; fn.connect(ff).connect(fg).connect(master); fn.start(); fans = fg;
    // faint wind outside the helmet
    const wn = src(), wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 260;
    const wg = ctx.createGain(); wg.gain.value = 0.02; wn.connect(wf).connect(wg).connect(master); wn.start(); wind = { g: wg, f: wf };
  }
  function env(node, t0, a, peak, d) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + a); node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  function burst(freq, q, peak, a, d, type = 'bandpass', sweepTo = null) {
    if (!ctx || !on) return; const t = ctx.currentTime, s = src(false), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + a + d); f.Q.value = q;
    env(g, t, a, peak, d); s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }
  const api = {
    start,
    setOn(v) { on = v; if (master) master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.05); },
    isOn: () => on,
    step(hard) { burst(hard ? 160 : 220, 0.9, hard ? 0.35 : 0.16, 0.005, 0.09, 'lowpass'); },
    whoosh() { burst(180, 1.2, 0.5, 0.18, 0.55, 'bandpass', 2400); },
    thud() { burst(90, 0.8, 0.6, 0.004, 0.3, 'lowpass'); },
    click() { burst(1800, 4, 0.08, 0.002, 0.04); },
    beep() { if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = 880; env(g, t, 0.01, 0.05, 0.16); o.connect(g).connect(master); o.start(t); o.stop(t + 0.2); },
    /** per frame: metabolic W (sets breathing), wind 0..1, paused */
    update(dt, W, windK, paused) {
      if (!ctx || !on) return;
      if (wind) { wind.g.gain.setTargetAtTime(paused ? 0.004 : 0.012 + 0.03 * windK, ctx.currentTime, 0.5); }
      if (fans) fans.gain.setTargetAtTime(paused ? 0.01 : 0.03, ctx.currentTime, 0.3);
      if (paused) return;
      const bpm = Math.min(40, 12 + Math.max(0, W - 116) / 30); breathT += dt;
      if (breathT > 60 / bpm) { breathT = 0; const k = Math.min(1, (W - 100) / 500);
        burst(900, 0.8, 0.05 + 0.08 * k, 0.35, 0.6);                        // inhale
        setTimeout(() => burst(650, 0.8, 0.04 + 0.07 * k, 0.25, 0.7), 900 * 30 / Math.max(12, bpm)); }   // exhale
    },
  };
  root.SuitAudio = api;
})(window);
