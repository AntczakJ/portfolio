'use client';

import { useCallback, type KeyboardEvent } from 'react';

/**
 * The WAI-ARIA radiogroup keyboard pattern (D-A11Y-1 fix).
 *
 * Our service / barber / date / time-slot widgets are `role="radiogroup"`
 * containing `role="radio"` `<button>`s. Giving a `<button>` `role="radio"`
 * REMOVES the native Enter/Space → click behaviour, so the full ARIA
 * radiogroup keyboard contract must be implemented by hand:
 *
 *  - Roving tabindex: exactly one radio in the group is tabbable
 *    (`tabIndex={0}`) — the selected one, or, if none is selected, the first
 *    selectable (non-disabled) radio. All others are `tabIndex={-1}`. This is
 *    computed by the caller via {@link rovingTabIndex} so the group is a
 *    single Tab stop and arrow keys move WITHIN it.
 *  - Arrow keys (Left/Up = previous, Right/Down = next) move focus AND select
 *    the moved-to radio, skipping disabled/unavailable options. Movement
 *    wraps around the ends.
 *  - Home / End jump to the first / last selectable radio (and select it).
 *  - Space / Enter select the focused radio (restoring what the native
 *    button gave us before the role override).
 *
 * The hook is DOM-driven: it reads the actual focusable radios out of the
 * group container at keydown time (so it works regardless of how the caller
 * renders them — grouped fieldsets, a flat grid, a scroll strip) and calls
 * the caller's `onSelectIndex` with the data index carried on each radio's
 * `data-rg-index` attribute. Disabled radios carry `aria-disabled="true"`
 * and are skipped by navigation but remain in the tab/AT tree (ADR-003:
 * disabled slots stay discoverable).
 */

const SELECTABLE = '[role="radio"]:not([aria-disabled="true"])';

function selectableRadios(group: HTMLElement): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>(SELECTABLE));
}

export interface RadiogroupKeyOptions {
  /**
   * Whether arrow/Home/End MOVE selection along with focus ("selection
   * follows focus", the default radiogroup behaviour). Set `false` for groups
   * where selecting a radio has a side effect that would be hostile on every
   * arrow press — specifically the service + barber steps, where selecting
   * AUTO-ADVANCES the wizard, so arrow keys must only move focus and
   * Space/Enter commits. The date + time groups keep the default `true`
   * (selecting a date/slot has no navigation side effect, so "selection
   * follows focus" is the nicer behaviour).
   */
  selectOnMove?: boolean;
}

/**
 * Returns an `onKeyDown` handler to put on the radiogroup container. The
 * caller supplies `onSelect(index)`, where `index` is the value read from the
 * focused radio's `data-rg-index` attribute. Space/Enter always commit the
 * focused radio; arrow/Home/End move focus and (when `selectOnMove`, the
 * default) also select.
 */
export function useRadiogroupKeys(
  onSelect: (index: number) => void,
  options: RadiogroupKeyOptions = {},
): (event: KeyboardEvent<HTMLElement>) => void {
  const { selectOnMove = true } = options;
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const group = event.currentTarget;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const key = event.key;
      const isArrow =
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'ArrowRight' ||
        key === 'ArrowLeft';
      const isSelect = key === ' ' || key === 'Enter' || key === 'Spacebar';
      const isEdge = key === 'Home' || key === 'End';

      if (!isArrow && !isSelect && !isEdge) return;

      // Space/Enter select the currently focused radio (if it is selectable).
      if (isSelect) {
        const raw = target.closest<HTMLElement>('[role="radio"]');
        if (!raw || raw.getAttribute('aria-disabled') === 'true') return;
        const idxAttr = raw.dataset.rgIndex;
        if (idxAttr === undefined) return;
        event.preventDefault();
        onSelect(Number(idxAttr));
        return;
      }

      const radios = selectableRadios(group);
      if (radios.length === 0) return;

      const focused = target.closest<HTMLElement>(SELECTABLE);
      const currentPos = focused ? radios.indexOf(focused) : -1;

      let nextPos: number;
      if (key === 'Home') {
        nextPos = 0;
      } else if (key === 'End') {
        nextPos = radios.length - 1;
      } else {
        const forward = key === 'ArrowDown' || key === 'ArrowRight';
        if (currentPos === -1) {
          nextPos = forward ? 0 : radios.length - 1;
        } else {
          nextPos =
            (currentPos + (forward ? 1 : -1) + radios.length) % radios.length;
        }
      }

      const nextRadio = radios[nextPos];
      if (!nextRadio) return;
      event.preventDefault();
      nextRadio.focus();
      if (selectOnMove) {
        const idxAttr = nextRadio.dataset.rgIndex;
        if (idxAttr !== undefined) onSelect(Number(idxAttr));
      }
    },
    [onSelect, selectOnMove],
  );

  return onKeyDown;
}

/**
 * Compute the roving `tabIndex` for one radio. The selected radio is the Tab
 * stop; if NONE is selected, the FIRST selectable radio is the Tab stop, so
 * the group is always reachable by Tab and arrow keys take over inside it.
 *
 * @param isSelected   whether this radio is the chosen one
 * @param anySelected  whether ANY radio in the group is selected
 * @param isFirstSelectable whether this is the first non-disabled radio
 * @param disabled     whether this radio is unavailable (never tabbable)
 */
export function rovingTabIndex({
  isSelected,
  anySelected,
  isFirstSelectable,
  disabled = false,
}: {
  isSelected: boolean;
  anySelected: boolean;
  isFirstSelectable: boolean;
  disabled?: boolean;
}): 0 | -1 {
  if (disabled) return -1;
  if (anySelected) return isSelected ? 0 : -1;
  return isFirstSelectable ? 0 : -1;
}
