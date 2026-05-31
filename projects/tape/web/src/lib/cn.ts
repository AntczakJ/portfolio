import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose conditional class names with Tailwind-aware conflict resolution.
 * `cn('px-2 px-4', cond && 'text-fg-muted')` -> `px-4 text-fg-muted`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
