import '@/lib/zod-config';

import { z } from 'zod';

/**
 * Auth FORM schemas (Task 6.4) — sign-in and sign-up, validated client-side
 * with the web's Zod v4 (conventions § 5). better-auth re-validates server-side
 * (email format + the 8-char minimum password is its default), so these mirror
 * its rules to give immediate, accessible field feedback before the request.
 *
 * Password floor is 8 (better-auth's default `minPasswordLength`). We do NOT
 * mirror a strength meter — the showcase is the live board, not a password UX.
 */

export const signInFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required'),
});

export type SignInFormValues = z.infer<typeof signInFormSchema>;

export const signUpFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .pipe(z.email('Enter a valid email')),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128, 'Password is too long'),
});

export type SignUpFormValues = z.infer<typeof signUpFormSchema>;

export const AUTH_SIGN_IN_DEFAULTS: SignInFormValues = {
  email: '',
  password: '',
};

export const AUTH_SIGN_UP_DEFAULTS: SignUpFormValues = {
  name: '',
  email: '',
  password: '',
};
