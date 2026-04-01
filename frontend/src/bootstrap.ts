// Captured once at startup — survives client-side navigations that change the URL.
export const initialSearch = window.location.search;

const params = new URLSearchParams(initialSearch);
export const teamParam = params.get('team');
export const isTeamsContext = params.has('team');
export const authConfigured = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || isTeamsContext;

/** Append initial query string to a path so ?team= is never lost. */
export function withSearch(path: string): string {
  return initialSearch ? `${path}${initialSearch}` : path;
}
