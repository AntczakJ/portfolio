import { mulberry32 } from '@/lib/engine/particle-seed';
import type { AudioSourceKind } from '@/lib/schemas';

/**
 * The imperative Web Audio runtime (ADR-003 — the field BREATHES).
 *
 * One `AudioContext`, one master `GainNode`, one shared `AnalyserNode`, created
 * lazily on the first user gesture (the autoplay gate). Every source feeds the
 * SAME master gain, and the master gain is the ONLY node downstream of the
 * sources — so muting (gain → 0) silences BOTH the audible output AND the
 * analyser feed (the field falls to idle drift, ADR-003 §1):
 *
 *   sources ─▶ masterGain ─▶ analyser            (the reactivity tap)
 *                         └─▶ ctx.destination      (the audible path)
 *
 * Three sources route into the master gain:
 *   (a) a PROCEDURALLY SYNTHESIZED default pad (oscillators + LFO + a gentle
 *       rhythmic pulse) — reactivity works out of the box, no shipped audio file,
 *       no licensing (the autonomous-friendly v1 default);
 *   (b) the live microphone (`getUserMedia` → `MediaStreamAudioSourceNode`). The
 *       mic must NEVER reach the speakers (no feedback / echo of the room), so it
 *       is the ONE source that taps the analyser DIRECTLY, bypassing the master
 *       gain (which is wired to destination). The mic has no audible output to
 *       mute, so this does not weaken the mute contract;
 *   (c) a user file upload (`<audio>` element + object URL → MediaElementSource).
 *
 * The render loop reads `getFrequencyData()` once per frame. Teardown is
 * leak-free (ADR-003 §7): one context closed on dispose, mic tracks stopped on
 * switch-away + dispose, object URLs revoked. NOT a React hook — a plain class so
 * the lifecycle is explicit and auditable (the reviewer item).
 */

export interface AudioEngineState {
  source: AudioSourceKind;
  muted: boolean;
  /** Whether the mic option is offered (secure context + API present). */
  micAvailable: boolean;
}

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;
/** Deterministic seed for the procedural pad's micro-detune (house rule). */
const SYNTH_SEED = 0x6e0c;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  // Allocated to the analyser's real `frequencyBinCount` in arm(); a 0-length
  // placeholder until then (getFrequencyData is a no-op without an analyser).
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  // procedural synth nodes (source 'builtin')
  private synthNodes: AudioNode[] = [];

  // upload (<audio> element + object URL)
  private uploadEl: HTMLAudioElement | null = null;
  private uploadSource: MediaElementAudioSourceNode | null = null;
  private uploadUrl: string | null = null;

  // mic
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  private source: AudioSourceKind = 'builtin';
  private muted = false;
  private armed = false;

  /** Whether the mic source can be offered in this context. */
  get micAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    // `navigator.mediaDevices` is typed as always-present by lib.dom, but it is
    // genuinely absent in insecure (non-HTTPS) contexts and on some embedded
    // browsers; model that optionality explicitly. We test for the METHOD's
    // presence without extracting it (no unbound-method reference).
    const nav = navigator as Omit<Navigator, 'mediaDevices'> & {
      mediaDevices?: MediaDevices;
    };
    return Boolean(
      window.isSecureContext &&
        nav.mediaDevices &&
        'getUserMedia' in nav.mediaDevices,
    );
  }

  get isArmed(): boolean {
    return this.armed;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  get fftSize(): number {
    return FFT_SIZE;
  }

  /**
   * Arm the engine on a user gesture (ADR-003 §2): create the context, resume it,
   * build the shared gain→analyser chain, start the default procedural source.
   * Idempotent — a second call only resumes a suspended context.
   */
  async arm(): Promise<void> {
    if (this.armed && this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    // lib.dom types `window.AudioContext` as always-present, but it is genuinely
    // absent on older Safari (which only exposes the prefixed constructor) and in
    // environments without the Web Audio API. Model both as optional so the
    // fallback chain and the guard below are real runtime checks, not dead code.
    const win = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = win.AudioContext ?? win.webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -30;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);

    // The master gain is the single node between the sources and BOTH outputs:
    // it feeds the analyser (reactivity) AND ctx.destination (audible). So
    // setMuted(gain → 0) silences sound AND drops the analyser feed → the field
    // falls to idle drift (ADR-003 §1). The mic is the lone exception (it taps
    // the analyser directly, never destination — see connectMic).
    const gain = ctx.createGain();
    gain.gain.value = this.muted ? 0 : 1;
    gain.connect(analyser);
    gain.connect(ctx.destination);
    this.gain = gain;

    await ctx.resume();
    this.armed = true;

    // start the default source
    await this.setSource('builtin');
  }

  /** Read the FFT once per frame (the render loop's only audio call). */
  getFrequencyData(): Uint8Array {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain && this.ctx) {
      // a short ramp avoids clicks
      this.gain.gain.setTargetAtTime(
        muted ? 0 : 1,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  getSource(): AudioSourceKind {
    return this.source;
  }

  /**
   * Switch the active source. Disconnects the outgoing source from the gain,
   * stops mic tracks / revokes URLs when switching away (ADR-003 §7), and
   * connects the new source into the SAME gain→analyser chain.
   */
  async setSource(next: AudioSourceKind, file?: File): Promise<boolean> {
    if (!this.ctx || !this.gain) return false;

    // tear down the outgoing source's upstream connection
    this.disconnectCurrentSource();

    if (next === 'mic') {
      const ok = await this.connectMic();
      if (!ok) {
        // graceful denial — fall back to the procedural source
        this.connectSynth();
        this.source = 'builtin';
        return false;
      }
      this.source = 'mic';
      return true;
    }

    if (next === 'upload') {
      if (!file) return false;
      this.connectUpload(file);
      this.source = 'upload';
      return true;
    }

    // builtin (procedural)
    this.connectSynth();
    this.source = 'builtin';
    return true;
  }

  // --- source builders -----------------------------------------------------

  /**
   * The procedural default source (ADR-003 §6 — no shipped file, no licensing).
   * An evolving pad: two detuned saw/triangle oscillators through a slow LFO on a
   * lowpass, plus a gentle rhythmic amplitude pulse (a "kick" the bass band sees).
   * Routed through its own `out` gain into the master gain ONLY — the master gain
   * carries it to both the analyser (reactivity) and destination (audible), so
   * mute (master gain → 0) silences it and switching away disconnects it cleanly.
   */
  private connectSynth(): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain) return;

    // Deterministic per-pad detune (house rule — no Math.random in the runtime):
    // a small seeded PRNG so the pad's micro-detune is reproducible across reloads.
    const detuneRnd = mulberry32(SYNTH_SEED);

    const out = ctx.createGain();
    out.gain.value = 0.6;
    out.connect(gain); // -> master gain -> analyser + destination

    // --- evolving pad: two detuned oscillators through a moving lowpass ------
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 6;
    filter.connect(out);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 420;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const padFreqs = [55, 82.41, 110, 164.81]; // A1, E2, A2, E3 — a calm drone
    const oscs: OscillatorNode[] = [];
    for (const f of padFreqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (detuneRnd() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      oscs.push(osc);
    }

    // a shimmer layer (mid/high content so the high band moves)
    const shimmer = ctx.createOscillator();
    shimmer.type = 'triangle';
    shimmer.frequency.value = 880;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.0;
    const shimmerLfo = ctx.createOscillator();
    shimmerLfo.frequency.value = 0.21;
    const shimmerLfoGain = ctx.createGain();
    shimmerLfoGain.gain.value = 0.05;
    shimmerLfo.connect(shimmerLfoGain);
    shimmerLfoGain.connect(shimmerGain.gain);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(out);
    shimmer.start();
    shimmerLfo.start();

    // --- gentle rhythmic pulse: a sine "kick" the bass band reacts to -------
    const kickOsc = ctx.createOscillator();
    kickOsc.type = 'sine';
    kickOsc.frequency.value = 64;
    const kickGain = ctx.createGain();
    kickGain.gain.value = 0;
    kickOsc.connect(kickGain);
    kickGain.connect(out);
    kickOsc.start();

    // schedule a soft pulse every ~0.6s for ~24s, then it loops via re-arm of
    // the envelope through a repeating LFO-style ramp. We use an automation that
    // re-triggers with a second slow oscillator gating the kick gain.
    const pulseLfo = ctx.createOscillator();
    pulseLfo.type = 'square';
    pulseLfo.frequency.value = 1.6; // ~96 bpm feel
    const pulseShaper = ctx.createGain();
    pulseShaper.gain.value = 0.5;
    // map square [-1,1] -> [0,1]-ish kick envelope via a waveshaper-like gain
    const pulseOffset = ctx.createConstantSource();
    pulseOffset.offset.value = 0.5;
    pulseOffset.start();
    pulseLfo.connect(pulseShaper);
    pulseShaper.connect(kickGain.gain);
    pulseOffset.connect(kickGain.gain);
    pulseLfo.start();

    this.synthNodes = [
      filter,
      lfo,
      lfoGain,
      ...oscs,
      shimmer,
      shimmerGain,
      shimmerLfo,
      shimmerLfoGain,
      kickOsc,
      kickGain,
      pulseLfo,
      pulseShaper,
      pulseOffset,
      out,
    ];
  }

  private connectUpload(file: File): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain) return;

    // one MediaElementAudioSourceNode per element (ADR-003 §1) — build a fresh
    // element each upload, revoke the previous URL.
    if (this.uploadUrl) URL.revokeObjectURL(this.uploadUrl);
    const el = document.createElement('audio');
    el.loop = true;
    el.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(file);
    el.src = url;
    this.uploadUrl = url;
    this.uploadEl = el;

    const src = ctx.createMediaElementSource(el);
    src.connect(gain); // -> master gain -> analyser + destination
    this.uploadSource = src;
    void el.play().catch(() => {
      /* play may reject if not within a gesture; the next gesture retries */
    });
  }

  private async connectMic(): Promise<boolean> {
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser || !this.micAvailable) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micStream = stream;
      const src = ctx.createMediaStreamSource(stream);
      // The mic is the LONE source that taps the analyser DIRECTLY, bypassing the
      // master gain (which is wired to ctx.destination) — so the room is NEVER
      // echoed to the speakers (no feedback, ADR-003 §1). It therefore is not
      // affected by mute, which is correct: there is no audible mic output to mute.
      src.connect(analyser);
      this.micSource = src;
      return true;
    } catch {
      return false;
    }
  }

  // --- teardown ------------------------------------------------------------

  /** Disconnect + stop the CURRENTLY active source (switch-away cleanup). */
  private disconnectCurrentSource(): void {
    // synth
    for (const node of this.synthNodes) {
      try {
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
        node.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.synthNodes = [];

    // upload
    if (this.uploadSource) {
      try {
        this.uploadSource.disconnect();
      } catch {
        /* noop */
      }
      this.uploadSource = null;
    }
    if (this.uploadEl) {
      this.uploadEl.pause();
      this.uploadEl.src = '';
      this.uploadEl = null;
    }
    if (this.uploadUrl) {
      URL.revokeObjectURL(this.uploadUrl);
      this.uploadUrl = null;
    }

    // mic
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        /* noop */
      }
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => {
        t.stop();
      });
      this.micStream = null;
    }
  }

  /** Full teardown on unmount (ADR-003 §7) — no leaked context / mic / URL. */
  dispose(): void {
    this.disconnectCurrentSource();
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* noop */
      }
      this.analyser = null;
    }
    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch {
        /* noop */
      }
      this.gain = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.armed = false;
  }
}
