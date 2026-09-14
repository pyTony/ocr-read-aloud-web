/**
 * Utility functions for reading and writing user's personal Gemini API token to browser cookie
 * with localStorage fallback synchronization.
 */

const COOKIE_NAME = 'gemini_custom_token';
const STORAGE_KEY = 'gemini_custom_token';

/**
 * Reads the Gemini API token from document.cookie, falling back to localStorage.
 */
export function getGeminiToken(): string {
  if (typeof document === 'undefined') return '';

  // 1. Read from cookie
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.trim().split('=');
      if (name === COOKIE_NAME) {
        const val = decodeURIComponent(rest.join('=')).trim();
        if (val) return val;
      }
    }
  } catch (e) {
    console.warn('Could not read cookie:', e);
  }

  // 2. Fallback to localStorage
  try {
    const localVal = localStorage.getItem(STORAGE_KEY);
    if (localVal && localVal.trim()) {
      return localVal.trim();
    }
  } catch (e) {
    console.warn('Could not read localStorage:', e);
  }

  return '';
}

/**
 * Saves or deletes the user's personal Gemini API token in document.cookie (1-year lifetime)
 * and syncs with localStorage.
 */
export function saveGeminiToken(token: string): void {
  if (typeof document === 'undefined') return;

  const cleanToken = token.trim();

  if (cleanToken) {
    // 1-year expiration cookie (SameSite=Lax)
    const maxAge = 365 * 24 * 60 * 60;
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(cleanToken)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    try {
      localStorage.setItem(STORAGE_KEY, cleanToken);
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
  } else {
    // Remove cookie
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Could not remove from localStorage:', e);
    }
  }
}

/**
 * Helper to mask a token for UI display (e.g. AIzaSy...4x8F)
 */
export function maskToken(token: string): string {
  if (!token) return '';
  const trimmed = token.trim();
  if (trimmed.length <= 10) return '••••••••';
  return `${trimmed.slice(0, 6)}••••••••${trimmed.slice(-4)}`;
}
