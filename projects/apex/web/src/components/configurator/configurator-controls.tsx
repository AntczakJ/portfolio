'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { RESERVE_HREF } from '@/lib/site-nav';
import { useConfiguratorStore } from '@/lib/store/configurator-store';
import { useReservationStore } from '@/lib/store/reservation-store';
import { CONFIGURATOR_OPTIONS, HERO_VEHICLE } from '@/mocks';

/**
 * Accessible configurator controls (ADR-004 a11y model) — identical DOM across
 * ALL four tiers (the only thing that differs is the display surface: live
 * canvas vs pre-baked still). So the same store writes, the same a11y, and the
 * same spine thread (carry-over to the wizard) work everywhere.
 *
 *   - Colour + wheel are REAL DOM radio groups (`role="radiogroup"` with native
 *     `<input type="radio">`), keyboard-operable (arrow keys within a group, Tab
 *     between groups), with brand-styled visible focus — never canvas-only.
 *   - An `aria-live="polite"`, DEBOUNCED text alternative announces the current
 *     configuration so a screen-reader user gets the same information without
 *     touching the 3D scene (ADR-004 / the architect's debounce follow-up).
 *   - "Reserve this configuration" writes `{ vehicleId, config }` into the
 *     reservation store and routes to `/reserve` (ADR-003 C-A carry-over).
 */
export function ConfiguratorControls(): ReactNode {
  const router = useRouter();
  const colorId = useConfiguratorStore((s) => s.colorId);
  const wheelId = useConfiguratorStore((s) => s.wheelId);
  const setColor = useConfiguratorStore((s) => s.setColor);
  const setWheel = useConfiguratorStore((s) => s.setWheel);
  const configureAndReserve = useReservationStore((s) => s.configureAndReserve);

  const color = CONFIGURATOR_OPTIONS.colors.find((c) => c.id === colorId);
  const wheel = CONFIGURATOR_OPTIONS.wheels.find((w) => w.id === wheelId);
  const configText = `${HERO_VEHICLE.name}, ${color?.name ?? 'default finish'}, ${
    wheel?.name ?? 'standard wheels'
  }`;

  // Debounced aria-live announcement so rapid swatch changes do not spam a
  // screen reader (ADR-004). The visible "Current configuration" line updates
  // immediately; only the polite announcement is debounced.
  const [announcement, setAnnouncement] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAnnouncement(`Configured: ${configText}.`);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [configText]);

  function handleReserve(): void {
    configureAndReserve(HERO_VEHICLE.id, { colorId, wheelId });
    router.push(
      `${RESERVE_HREF}?vehicle=${HERO_VEHICLE.slug}&color=${colorId}&wheels=${wheelId}`,
    );
  }

  return (
    <div className="mt-6 grid gap-6 sm:mt-8 sm:grid-cols-2 sm:gap-8">
      {/* ---- Colour radio-group ------------------------------------------- */}
      <fieldset>
        <legend className="text-fg-muted text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
          Paint
        </legend>
        <div
          role="radiogroup"
          aria-label="Paint colour"
          className="mt-3 flex flex-wrap gap-3"
        >
          {CONFIGURATOR_OPTIONS.colors.map((c) => {
            const checked = c.id === colorId;
            return (
              <label
                key={c.id}
                className={cn(
                  'group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1',
                )}
              >
                <input
                  type="radio"
                  name="apex-color"
                  value={c.id}
                  checked={checked}
                  onChange={() => { setColor(c.id); }}
                  className="peer sr-only"
                  aria-label={`${c.name} — ${c.materialName}`}
                />
                {/* Three DISTINCT states (D-10): SELECTED = the accent ring;
                    HOVER = a stronger border; KEYBOARD FOCUS = a thick foreground
                    outline offset OUTSIDE the accent ring, so focus reads on top
                    of selection rather than colliding with it. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-9 rounded-full border outline-none transition-[box-shadow,transform]',
                    'peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[5px] peer-focus-visible:outline-[var(--color-foreground)]',
                    checked
                      ? 'border-accent ring-accent ring-2 ring-offset-2 ring-offset-[var(--color-surface)]'
                      : 'border-border group-hover:border-border-strong',
                  )}
                  style={{ backgroundColor: c.hex }}
                />
                <span
                  className={cn(
                    'text-[length:var(--text-2xs)]',
                    checked ? 'text-foreground font-medium' : 'text-fg-subtle',
                  )}
                >
                  {c.name}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ---- Wheel radio-group -------------------------------------------- */}
      <fieldset>
        <legend className="text-fg-muted text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
          Wheels
        </legend>
        <div
          role="radiogroup"
          aria-label="Wheel set"
          className="mt-3 flex flex-wrap gap-3"
        >
          {CONFIGURATOR_OPTIONS.wheels.map((w) => {
            const checked = w.id === wheelId;
            return (
              <label
                key={w.id}
                className={cn(
                  'group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1',
                )}
              >
                <input
                  type="radio"
                  name="apex-wheel"
                  value={w.id}
                  checked={checked}
                  onChange={() => { setWheel(w.id); }}
                  className="peer sr-only"
                  aria-label={w.name}
                />
                {/* Distinct focus vs selected vs hover (D-10) — see the paint
                    swatch comment above. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'bg-surface-2 relative size-12 overflow-hidden rounded-full border outline-none transition-[box-shadow]',
                    'peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[5px] peer-focus-visible:outline-[var(--color-foreground)]',
                    checked
                      ? 'border-accent ring-accent ring-2 ring-offset-2 ring-offset-[var(--color-surface)]'
                      : 'border-border group-hover:border-border-strong',
                  )}
                >
                  <Image
                    src={w.previewSrc}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </span>
                <span
                  className={cn(
                    'text-[length:var(--text-2xs)]',
                    checked ? 'text-foreground font-medium' : 'text-fg-subtle',
                  )}
                >
                  {w.name}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ---- The configuration text alternative + the carry-over CTA ------- */}
      <div className="sm:col-span-2">
        <p className="text-fg-subtle text-sm" data-configuration-text>
          Current configuration: {configText}.
        </p>
        {/* The debounced, polite screen-reader announcement (visually hidden). */}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleReserve}
            className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-12 items-center rounded-md px-7 text-base font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Reserve this configuration
          </button>
        </div>
      </div>
    </div>
  );
}
