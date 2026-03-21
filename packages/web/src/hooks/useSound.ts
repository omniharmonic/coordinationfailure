import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Module-level shared sound-enabled state so all useSound() instances
 * stay in sync (e.g. SoundToggle toggles, Boot/Spectator pages read).
 */
let _soundEnabled = false;
const _listeners = new Set<(v: boolean) => void>();
function _setSoundEnabled(v: boolean) {
  _soundEnabled = v;
  _listeners.forEach(fn => fn(v));
}

/**
 * CRT-appropriate sound effects via Web Audio API.
 * All sounds are generated procedurally — no external audio files.
 */
export function useSound() {
  const [enabled, setEnabledLocal] = useState(_soundEnabled);
  const ctxRef = useRef<AudioContext | null>(null);

  // Subscribe to shared state changes
  useEffect(() => {
    const handler = (v: boolean) => setEnabledLocal(v);
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    _setSoundEnabled(v);
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (!enabled) return null;
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, [enabled]);

  /** Short high-pitched beep for notifications (800Hz, 100ms) */
  const playBeep = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  }, [getCtx]);

  /** Medium urgency alert — two-tone (600Hz + 900Hz) */
  const playAlert = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    // First tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'square';
    osc1.frequency.value = 600;
    gain1.gain.setValueAtTime(0.07, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.12);

    // Second tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.value = 900;
    gain2.gain.setValueAtTime(0.07, t + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.27);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.15);
    osc2.stop(t + 0.27);
  }, [getCtx]);

  /** Urgent alarm — sawtooth wave with descending pitch */
  const playKlaxon = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.6);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.setValueAtTime(0.1, t + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  }, [getCtx]);

  /** Tiny click for UI interactions — white noise burst, ~5ms */
  const playKeyClick = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const bufferSize = Math.ceil(ctx.sampleRate * 0.005);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }, [getCtx]);

  /** Modem-like connection sound — frequency sweep */
  const playModem = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Carrier sweep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(2400, t + 0.3);
    osc.frequency.linearRampToValueAtTime(1200, t + 0.5);
    osc.frequency.setValueAtTime(1200, t + 0.6);
    osc.frequency.linearRampToValueAtTime(2000, t + 0.8);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.setValueAtTime(0.06, t + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.85);

    // Noise overlay for that modem texture
    const noiseLen = Math.ceil(ctx.sampleRate * 0.85);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      noiseData[i] = (Math.random() * 2 - 1);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.015, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    noiseSrc.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSrc.start(t);
    noiseSrc.stop(t + 0.85);
  }, [getCtx]);

  return { playBeep, playAlert, playKlaxon, playKeyClick, playModem, setEnabled, enabled };
}
