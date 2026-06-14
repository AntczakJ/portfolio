'use client';

import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Vignette,
} from '@react-three/postprocessing';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BlendFunction } from 'postprocessing';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  NormalBlending,
  Points,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
} from 'three';

import {
  applyEnvelope,
  DEFAULT_ATTACK_S,
  DEFAULT_RELEASE_S,
  reduceBands,
} from '@/lib/audio/reduce-bands';
import type { AudioEngine } from '@/lib/audio/audio-engine';
import { easeOutExpo } from '@/lib/engine/easing';
import { GpgpuSim } from '@/lib/engine/gpgpu-sim';
import {
  buildPaletteData,
  PALETTE_TEXTURE_WIDTH,
  writePaletteData,
} from '@/lib/engine/palette-data';
import {
  crossfadePresets,
  presetToUniforms,
  type PresetUniforms,
  type Rgb,
} from '@/lib/engine/preset-uniforms';
import {
  RENDER_FRAGMENT_GLSL,
  RENDER_VERTEX_GLSL,
} from '@/lib/glsl/render.glsl';
import { getPresetOrDefault } from '@/data/presets';
import {
  SILENT_BANDS,
  type AudioBands,
  type Preset,
  type PostQuality,
  type TierConfig,
} from '@/lib/schemas';

/**
 * The live GPGPU particle field (ADR-002 §2 / §5, replacing the Pass-1
 * SmokeScene). One `useFrame` owns the whole loop in the fixed order: read audio
 * → bands → envelope → write uniforms → sim step → feed render textures → render
 * through the EffectComposer (post). `frameloop="always"`, paused when hidden /
 * unarmed via the `paused` prop (ADR-002 §5).
 *
 * Audio modulates AROUND the cross-faded preset base (`uniform = base + gain*band`,
 * ADR-003 §4). Idle/silence → a small floor so the field drifts, never dead.
 */

export interface NocturneFieldProps {
  config: TierConfig;
  presetId: string;
  transitioningToId: string | null;
  audioEngine: AudioEngine | null;
  /** Audio drives the uniforms only when true (false under calm/reduced-motion). */
  audioReactive: boolean;
  pointerWake: boolean;
  /** Paused = no render loop (unarmed / tab hidden). */
  paused: boolean;
  /** Called once the first frame has rendered (the poster→live reveal seam). */
  onReady?: () => void;
  /** The store's settle callback when a cross-fade completes. */
  onTransitionComplete?: () => void;
}

/** The signature preset morph duration. Eased (not linear) — see resolveLook.
 * ~1.1s on an ease-out reads decisive without snapping (D-03). */
const CROSSFADE_SECONDS = 1.1;

/**
 * The pointer attractor's reach as a FRACTION of the active preset's domainScale
 * (N3) — so the wake stays proportional to the field's spatial extent across
 * presets (domainScale 2.4–5.0) instead of a fixed world constant. ~0.78 of the
 * domain keeps the attractor inside the visible field at the camera's framing
 * (z=9, fov 50). */
const POINTER_DOMAIN_REACH = 0.78;

/** A small idle floor so the field always breathes (ADR-003 §5). */
const IDLE_BANDS: AudioBands = {
  subBass: 0.06,
  bass: 0.08,
  mid: 0.06,
  high: 0.04,
  rms: 0.07,
};

/** The audio-driven post intensities the composer effects read each frame. */
interface PostDrive {
  bloom: number;
  vignette: number;
  aberration: number;
}

/** Opt-in dev diagnostics surface (set on `window.__nocturne` when ?debug). */
interface NocturneDebug {
  tier: string;
  count: number;
  turbulence: number;
  spread: number;
  bloom: number;
  bands: AudioBands;
  frames: number;
  reactive: boolean;
}

interface FieldRenderProps extends NocturneFieldProps {
  pixelRatio: number;
  postDrive: RefObject<PostDrive>;
}

interface TransitionState {
  from: string;
  to: string;
  t: number;
}

/** The typed render-material uniform set (the frame loop mutates `.value`). */
interface RenderUniforms {
  texturePosition: { value: Texture | null };
  textureVelocity: { value: Texture | null };
  uPalette: { value: DataTexture };
  uParticleSize: { value: number };
  uOpacity: { value: number };
  uSparkle: { value: number };
  uColorShift: { value: number };
  uEnergy: { value: number };
  uPixelRatio: { value: number };
}

function FieldRender(props: FieldRenderProps): ReactNode {
  const {
    config,
    presetId,
    transitioningToId,
    audioEngine,
    audioReactive,
    pointerWake,
    paused,
    onReady,
    onTransitionComplete,
    pixelRatio,
    postDrive,
  } = props;

  const { gl, scene } = useThree();

  const simRef = useRef<GpgpuSim | null>(null);
  const renderUniformsRef = useRef<RenderUniforms | null>(null);
  const paletteRef = useRef<DataTexture | null>(null);

  const bandsRef = useRef<AudioBands>({ ...SILENT_BANDS });
  const transitionRef = useRef<TransitionState | null>(null);
  const readyRef = useRef(false);
  const pointerRef = useRef(new Vector3(0, 0, 0));
  const pointerActiveRef = useRef(false);
  const timeRef = useRef(0);

  // Per-frame scratch hoisted to refs so the 60fps loop allocates NOTHING (N1):
  // the raw-band object and the two sim pointer tuples are reused + mutated in
  // place each frame instead of being freshly allocated.
  const rawBandsRef = useRef<AudioBands>({ ...IDLE_BANDS });
  const pointerOnRef = useRef<[number, number, number, number]>([0, 0, 0, 1]);
  const pointerOffRef = useRef<[number, number, number, number]>([0, 0, 0, 0]);

  const initialPreset = useMemo(
    () => getPresetOrDefault(presetId),
    [presetId],
  );

  // The one-time allocation effect re-runs ONLY on a sim-resolution / context
  // change (a tier change), reading the CURRENT preset + DPR at that moment.
  // Holding them in refs (kept current each render) keeps the effect's dep array
  // genuinely exhaustive — no `react-hooks/exhaustive-deps` suppression, which
  // the repo-root ESLint config (no react-hooks plugin) cannot resolve.
  const initialPresetRef = useRef(initialPreset);
  initialPresetRef.current = initialPreset;
  const pixelRatioRef = useRef(pixelRatio);
  pixelRatioRef.current = pixelRatio;

  // --- one-time GPGPU + Points allocation ---------------------------------
  useEffect(() => {
    const allocPreset = initialPresetRef.current;
    const allocPixelRatio = pixelRatioRef.current;
    const sim = new GpgpuSim(config.simResolution);
    const error = sim.init(gl, allocPreset);
    if (error !== null) {
      // float targets unsupported at runtime — surface as not-ready; the Stage
      // keeps the poster (ADR-002 §1 hard gate). We do not crash.
      console.warn('[nocturne] GPGPU init failed, poster stays:', error);
      sim.dispose();
      return;
    }
    simRef.current = sim;

    const count = config.simResolution * config.simResolution;
    const geometry = new BufferGeometry();
    // a dummy `position` attribute (three needs it for the draw count; the real
    // position is sampled from the texture in the vertex shader).
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(count * 3), 3),
    );
    geometry.setAttribute(
      'reference',
      new BufferAttribute(sim.reference, 2),
    );

    const palette = buildInitialPalette(allocPreset);
    paletteRef.current = palette;

    const u = presetToUniforms(allocPreset);
    const renderUniforms: RenderUniforms = {
      texturePosition: { value: sim.positionTexture },
      textureVelocity: { value: sim.velocityTexture },
      uPalette: { value: palette },
      uParticleSize: { value: u.particleSize },
      uOpacity: { value: u.particleOpacity },
      uSparkle: { value: 0 },
      uColorShift: { value: 0 },
      uEnergy: { value: 0 },
      uPixelRatio: { value: allocPixelRatio },
    };
    const material = new ShaderMaterial({
      uniforms: renderUniforms as unknown as Record<
        string,
        { value: unknown }
      >,
      vertexShader: RENDER_VERTEX_GLSL,
      fragmentShader: RENDER_FRAGMENT_GLSL,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending:
        allocPreset.particle.blend === 'additive'
          ? AdditiveBlending
          : NormalBlending,
    });
    renderUniformsRef.current = renderUniforms;

    const pts = new Points(geometry, material);
    pts.frustumCulled = false;
    // Mount the Points imperatively into the R3F scene (no React state — the
    // object is built imperatively from the GPGPU sim; declarative <primitive>
    // would force a re-render just to attach it).
    scene.add(pts);

    return () => {
      scene.remove(pts);
      geometry.dispose();
      material.dispose();
      palette.dispose();
      sim.dispose();
      simRef.current = null;
      renderUniformsRef.current = null;
      paletteRef.current = null;
      readyRef.current = false;
    };
    // Re-allocate only on a sim-resolution / context change (a tier change);
    // the current preset + DPR are read from refs above, so the dep array is
    // exhaustive without a suppression.
  }, [config.simResolution, gl, scene]);

  // --- preset cross-fade trigger ------------------------------------------
  useEffect(() => {
    if (transitioningToId && transitioningToId !== presetId) {
      transitionRef.current = { from: presetId, to: transitioningToId, t: 0 };
    }
  }, [transitioningToId, presetId]);

  // --- pointer wake --------------------------------------------------------
  useEffect(() => {
    if (!pointerWake) {
      pointerActiveRef.current = false;
      return;
    }
    const el = gl.domElement;
    const onMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      // Store the raw NDC [-1,1]; the world scale is applied per-frame against
      // the active preset's domainScale (N3) so the attractor reach is preset-
      // relative, not a fixed world constant decoupled from the field extent.
      pointerRef.current.set(nx, ny, 0);
      pointerActiveRef.current = true;
    };
    const onLeave = (): void => {
      pointerActiveRef.current = false;
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [pointerWake, gl]);

  // --- the single useFrame owning sim → render-uniforms → ready -----------
  useFrame((_state, delta) => {
    if (paused) return;
    const sim = simRef.current;
    const ru = renderUniformsRef.current;
    if (!sim || !ru) return;

    const dt = Math.min(delta, 0.05);
    timeRef.current += dt;

    // 1. audio → bands → envelope (ADR-003 §3). Mutate the hoisted scratch in
    // place (N1) — no per-frame allocation.
    const raw = rawBandsRef.current;
    if (audioReactive && audioEngine?.isArmed) {
      const freq = audioEngine.getFrequencyData();
      const reduced = reduceBands(
        freq,
        audioEngine.sampleRate,
        audioEngine.fftSize,
      );
      raw.subBass = Math.max(reduced.subBass, IDLE_BANDS.subBass);
      raw.bass = Math.max(reduced.bass, IDLE_BANDS.bass);
      raw.mid = Math.max(reduced.mid, IDLE_BANDS.mid);
      raw.high = Math.max(reduced.high, IDLE_BANDS.high);
      raw.rms = Math.max(reduced.rms, IDLE_BANDS.rms);
    } else {
      raw.subBass = IDLE_BANDS.subBass;
      raw.bass = IDLE_BANDS.bass;
      raw.mid = IDLE_BANDS.mid;
      raw.high = IDLE_BANDS.high;
      raw.rms = IDLE_BANDS.rms;
    }
    const bands = applyEnvelope(
      bandsRef.current,
      raw,
      DEFAULT_ATTACK_S,
      DEFAULT_RELEASE_S,
      dt,
    );
    bandsRef.current = bands;

    // 2. resolve the cross-faded base uniforms + ramp. `ramp` is non-null ONLY
    // while a cross-fade is active (resolveLook returns null on an idle frame).
    const { base, ramp } = resolveLook(presetId, transitionRef, dt);

    // FIX 3: rebuild + re-upload the palette texture ONLY when the ramp actually
    // changed this frame (a transition is active) — NOT every idle frame. The
    // ramp is written IN PLACE into the texture's existing buffer (no per-frame
    // allocation), and `needsUpdate = true` (the GPU upload) is set only then.
    // On an idle frame the texture already holds the correct ramp (the last
    // transition frame landed on the target exactly, easeOutExpo(1)===1, or the
    // init palette), so we skip both the write and the upload.
    const palette = paletteRef.current;
    if (palette && ramp) {
      writePaletteData(ramp, palette.image.data as Uint8Array);
      palette.needsUpdate = true;
    }

    if (transitionRef.current && transitionRef.current.t >= 1) {
      transitionRef.current = null;
      onTransitionComplete?.();
    }

    // 3. write the sim uniforms (base + audio modulation). The pointer tuple is
    // a hoisted, mutated-in-place scratch (N1) — no per-frame array allocation.
    let pointer: [number, number, number, number];
    if (pointerActiveRef.current) {
      // Scale the raw NDC pointer into world space by the preset's domainScale
      // (N3) so the attractor reach is preset-relative.
      const reach = base.domainScale * POINTER_DOMAIN_REACH;
      pointer = pointerOnRef.current;
      pointer[0] = pointerRef.current.x * reach;
      pointer[1] = pointerRef.current.y * reach;
      pointer[2] = pointerRef.current.z;
      pointer[3] = 1;
    } else {
      pointer = pointerOffRef.current;
    }
    sim.step({
      time: timeRef.current,
      delta: dt,
      flowScale: base.flowScale,
      flowSpeed: base.flowSpeed,
      turbulence: base.turbulence + base.bassToTurbulence * bands.bass,
      damping: base.damping,
      spread: base.midToSpread * bands.mid,
      lifetime: base.lifetime,
      domainScale: base.domainScale,
      pointer,
    });

    // 4. feed the fresh textures + render uniforms into the Points material
    ru.texturePosition.value = sim.positionTexture;
    ru.textureVelocity.value = sim.velocityTexture;
    ru.uParticleSize.value = base.particleSize;
    ru.uOpacity.value = base.particleOpacity;
    ru.uColorShift.value = base.highToColor * bands.high * 0.4;
    ru.uSparkle.value = base.highToColor * bands.high;
    ru.uEnergy.value = base.rmsToBloom * bands.rms * 0.5;
    ru.uPixelRatio.value = pixelRatio;

    // expose the audio-driven post intensities
    const drive = postDrive.current;
    drive.bloom = base.bloomStrength + base.rmsToBloom * bands.rms;
    drive.vignette = base.vignette + bands.rms * 0.12;
    drive.aberration = base.aberration + bands.rms * 0.002;

    // 5. signal ready on the first rendered frame (the reveal seam)
    if (!readyRef.current) {
      readyRef.current = true;
      onReady?.();
    }

    // dev diagnostics (opt-in via ?debug — used by the engine verifier to
    // confirm the band uniforms move frame-to-frame; no-op in normal use).
    // Typed Partial: the producer (NocturneField) seeds `{ frames: 0 }`, so the
    // other fields are genuinely absent until the first frame writes them —
    // `dbg.frames ?? 0` is a real guard, not dead code.
    const dbg = (window as unknown as { __nocturne?: Partial<NocturneDebug> })
      .__nocturne;
    if (dbg) {
      dbg.tier = config.tier;
      dbg.count = config.simResolution * config.simResolution;
      dbg.turbulence =
        base.turbulence + base.bassToTurbulence * bands.bass;
      dbg.spread = base.midToSpread * bands.mid;
      dbg.bloom = drive.bloom;
      dbg.bands = bands;
      dbg.frames = (dbg.frames ?? 0) + 1;
      dbg.reactive = audioReactive && Boolean(audioEngine?.isArmed);
    }
  });

  // the Points object is attached to the scene imperatively (above); this
  // component renders nothing declaratively.
  return null;
}

/** Build the palette DataTexture for a preset (initial allocation). */
function buildInitialPalette(preset: Preset): DataTexture {
  const { ramp } = crossfadePresets(preset, preset, 0);
  const tex = new DataTexture(
    buildPaletteData(ramp),
    PALETTE_TEXTURE_WIDTH,
    1,
    RGBAFormat,
  );
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Advance the cross-fade and return the interpolated base uniforms + ramp. */
function resolveLook(
  presetId: string,
  transitionRef: RefObject<TransitionState | null>,
  dt: number,
): { base: PresetUniforms; ramp: Rgb[] | null } {
  const tr = transitionRef.current;
  if (!tr) {
    return { base: presetToUniforms(getPresetOrDefault(presetId)), ramp: null };
  }
  // `tr.t` is the LINEAR time progress (0→1 over CROSSFADE_SECONDS). The field
  // is sampled at the EASED progress so the signature morph runs on the project's
  // --ease-out-expo curve (D-03), not a constant-velocity ramp — fast departure,
  // hard deceleration into the target. `easeOutExpo` lands exactly on 1 at t=1,
  // so the settle (tr.t >= 1, in the loop above) reaches the target preset
  // bit-exactly. Throw-free: pure arithmetic in useFrame.
  tr.t = Math.min(1, tr.t + dt / CROSSFADE_SECONDS);
  const eased = easeOutExpo(tr.t);
  const { uniforms, ramp } = crossfadePresets(
    getPresetOrDefault(tr.from),
    getPresetOrDefault(tr.to),
    eased,
  );
  return { base: uniforms, ramp };
}

/**
 * Locate an effect instance inside the composer's passes by its setter shape,
 * so we can mutate intensity/darkness/offset each frame WITHOUT putting a `ref`
 * on the wrapped effect components. (React 19 passes `ref` as a regular prop;
 * `@react-three/postprocessing`'s effect wrapper `JSON.stringify`s its props for
 * a memo key, and a settled effect `ref` references the Object3D scene graph —
 * which throws "circular structure" the moment the wrapper re-keys. Reffing the
 * composer instead sidesteps that entirely.)
 */
interface ComposerLike {
  passes?: { effects?: PostEffect[] }[];
}
interface PostEffect {
  intensity?: unknown;
  darkness?: unknown;
  offset?: unknown;
}

function isVec2(v: unknown): v is { set: (x: number, y: number) => void } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'set' in v &&
    typeof (v as { set?: unknown }).set === 'function'
  );
}

/** The post stack — bloom (audio-pulsed), vignette (breathing), aberration. */
function FieldPost({
  postQuality,
  postDrive,
}: {
  postQuality: PostQuality;
  postDrive: RefObject<PostDrive>;
}): ReactNode {
  const composerRef = useRef<ComposerLike | null>(null);

  useFrame(() => {
    const drive = postDrive.current;
    const composer = composerRef.current;
    if (!composer?.passes) return;
    // Detect each effect by its mutable property SHAPE (minification-safe — we
    // cannot rely on constructor.name in a production build). Bloom exposes a
    // numeric `intensity`; Vignette a numeric `darkness`; ChromaticAberration a
    // Vec2 `offset`.
    for (const pass of composer.passes) {
      if (!pass.effects) continue;
      for (const effect of pass.effects) {
        if (typeof effect.intensity === 'number') {
          (effect as { intensity: number }).intensity = drive.bloom;
        }
        if (typeof effect.darkness === 'number') {
          (effect as { darkness: number }).darkness = drive.vignette;
        }
        if (isVec2(effect.offset)) {
          effect.offset.set(drive.aberration, drive.aberration);
        }
      }
    }
  });

  const showVignette = postQuality !== 'bloom-only';
  const showAberration = postQuality === 'full';

  const effects: ReactElement[] = [
    <Bloom
      key="bloom"
      intensity={1.2}
      luminanceThreshold={0.35}
      luminanceSmoothing={0.9}
      mipmapBlur
    />,
  ];
  if (showVignette) {
    effects.push(
      <Vignette key="vignette" eskil={false} offset={0.28} darkness={0.5} />,
    );
  }
  if (showAberration) {
    effects.push(
      <ChromaticAberration
        key="aberration"
        blendFunction={BlendFunction.NORMAL}
        offset={new Vector2(0.002, 0.002)}
        radialModulation={false}
        modulationOffset={0}
      />,
    );
  }

  return <EffectComposer ref={composerRef as never}>{effects}</EffectComposer>;
}

export function NocturneField(props: NocturneFieldProps): ReactNode {
  const { config } = props;
  const postDrive = useRef<PostDrive>({
    bloom: 1,
    vignette: 0.4,
    aberration: 0.002,
  });
  // The field mounts only client-side (`ssr: false`), so reading
  // `devicePixelRatio` in the initializer is safe and avoids an effect+state
  // cascade. The clamp follows the tier's DPR range (ADR-002 §4).
  const [pixelRatio] = useState(() =>
    Math.max(
      config.dprClamp[0],
      Math.min(window.devicePixelRatio, config.dprClamp[1]),
    ),
  );

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('debug')
    ) {
      (window as unknown as { __nocturne?: Partial<NocturneDebug> }).__nocturne =
        { frames: 0 };
    }
  }, []);

  // `?capture` preserves the drawing buffer so a headless verifier can read the
  // last frame via `canvas.toDataURL()` without racing the continuous loop
  // (software-GL can't yield a Playwright-stable paint). Never set in normal use.
  const preserveDrawingBuffer =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('capture');

  return (
    <Canvas
      aria-hidden
      dpr={config.dprClamp}
      frameloop="always"
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
        stencil: false,
        depth: false,
        preserveDrawingBuffer,
      }}
      camera={{ position: [0, 0, 9], fov: 50, near: 0.1, far: 100 }}
      onCreated={({ scene, gl }) => {
        scene.background = null;
        if (preserveDrawingBuffer) {
          // capture mode: give the buffer the dark stage ground so toDataURL
          // shows the field as it composites in-app (the live canvas is
          // transparent over the CSS `.stage-ground`; a headless toDataURL
          // would otherwise show the field over the page's white default).
          gl.setClearColor(0x0a0a14, 1);
        }
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <FieldRender {...props} pixelRatio={pixelRatio} postDrive={postDrive} />
      <FieldPost postQuality={config.postQuality} postDrive={postDrive} />
    </Canvas>
  );
}

export const FIELD_CROSSFADE_SECONDS = CROSSFADE_SECONDS;
