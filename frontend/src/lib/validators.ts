/** Runtime validation (zod) for critical user inputs — mirrors backend schemas. */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  password: z.string().min(1).max(128),
});

export const registerSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  // backend bcrypt cap is 72 bytes: surface it client-side instead of a 400.
  password: z.string().min(6).max(72),
  full_name: z.string().max(255),
  role: z.enum(['public', 'athlete', 'coach', 'referee']),
});

export const orgRequestSchema = z.object({
  org_name: z.string().trim().min(2).max(255),
  message: z.string().max(512),
});

export const weighInSchema = z.object({
  weigh_in_kg: z.number().finite().min(20).max(250),
});

export const newsSchema = z.object({
  title: z.string().trim().min(3).max(255),
  // unicode letters like the backend \w (JS \w is ASCII-only): no slashes/dots/spaces.
  slug: z.string().min(2).max(128).regex(/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u, 'bad slug'),
  excerpt: z.string().max(2000),
  body: z.string().max(20000),
  category: z.string().min(1).max(64),
});

/** First human-readable issue, or null when valid. */
export function firstIssue<T>(schema: z.ZodType<T>, value: unknown): string | null {
  const r = schema.safeParse(value);
  if (r.success) return null;
  const flat = r.error.flatten();
  const form = flat.formErrors[0];
  if (form) return form;
  const field = Object.entries(flat.fieldErrors).find(([, v]): boolean => Array.isArray(v) && v.length > 0);
  if (!field) return 'Invalid input';
  return `${field[0]}: ${(field[1] as string[])[0]}`;
}
