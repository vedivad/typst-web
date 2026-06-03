/**
 * Project file paths. `/main.typ` form, leading slash, forward slashes only.
 * `@preview/...` package paths bypass this (they are pushed to the VFS verbatim).
 */

/** `/path/to/file.typ`, leading-slash, forward slashes only. */
export type Path = string;

/** Ensure a path starts with a leading slash. Idempotent. */
export function normalizePath(path: string): Path {
  return path.startsWith("/") ? path : `/${path}`;
}
