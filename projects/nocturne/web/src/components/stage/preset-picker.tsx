'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { PRESET_DIRECTORY } from '@/data/presets';

/**
 * The preset picker (ADR-004 §5) — a keyboard-operable radio-group driving the
 * engine cross-fade. `store.selectPreset(id)` begins the morph; the engine
 * settles via `completePresetTransition`. The group reflects the active preset
 * AND the one being transitioned TOWARD (the picker leads the field).
 *
 * Roving-tabindex radiogroup: Tab moves INTO the group (one stop), arrow keys
 * move BETWEEN options and select, matching the WAI-ARIA radio-group pattern.
 * Real radios in look, real keyboard semantics.
 */
export interface PresetPickerProps {
  /** The currently active preset id. */
  activeId: string;
  /** The id being transitioned TOWARD (null when settled) — the picker leads. */
  targetId: string | null;
  onSelect: (id: string) => void;
}

export function PresetPicker({
  activeId,
  targetId,
  onSelect,
}: PresetPickerProps): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedId = targetId ?? activeId;
  const selectedIndex = Math.max(
    0,
    PRESET_DIRECTORY.findIndex((p) => p.id === selectedId),
  );

  const focusAt = (index: number): void => {
    const len = PRESET_DIRECTORY.length;
    const next = ((index % len) + len) % len;
    const entry = PRESET_DIRECTORY[next];
    if (entry) {
      onSelect(entry.id);
      refs.current[next]?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusAt(selectedIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusAt(selectedIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(PRESET_DIRECTORY.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Preset"
      // The roving-tabindex pattern keeps focus on the checked radio (one of the
      // child buttons holds tabIndex=0); the group itself is not a tab stop, but
      // the radiogroup role must be focusable, so it carries tabIndex=-1.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-1 focus:outline-none"
    >
      {PRESET_DIRECTORY.map((preset, i) => {
        const checked = preset.id === selectedId;
        return (
          <button
            key={preset.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              onSelect(preset.id);
            }}
            // `.nocturne-preset-label` eases the Sora `wght` axis up on the
            // checked label as the cross-fade settles (D-07) — chrome weight and
            // the eased field morph agree on timing. Motion-safe by the global
            // reduced-motion transition reset (lands on the final weight).
            className="nocturne-preset-label rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs tracking-[0.02em] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 aria-checked:bg-[var(--stage-scrim-strong)] aria-checked:text-[var(--hud-ink)]"
            style={{
              // Over-stage ink: theme-INVARIANT (ADR-004 §4) so the inactive
              // labels stay legible on the dark scrim in light chrome too.
              color: checked ? 'var(--hud-ink)' : 'var(--hud-ink-muted)',
              outlineColor: 'var(--color-accent)',
            }}
          >
            {preset.name}
          </button>
        );
      })}
    </div>
  );
}
