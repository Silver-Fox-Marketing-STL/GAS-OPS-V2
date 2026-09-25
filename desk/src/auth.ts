// Google Identity Services sign-in. The credential is a Google ID token (JWT);
// the desk API verifies it server-side (issuer, aud, email_verified, expiry,
// allowlist). Here we only decode the payload for display + expiry bookkeeping.
import { CLIENT_ID } from './config';

declare global {
  interface Window { google?: any }
}

const KEY = 'desk.idToken';
let memoryToken: string | null = null;   // fallback when sessionStorage is blocked

export interface Claims { email: string; exp: number; name: string; picture: string }

function decode(jwt: string): Claims | null {
  try {
    const part = jwt.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const c = JSON.parse(json);
    return { email: String(c.email ?? ''), exp: Number(c.exp ?? 0), name: String(c.name ?? ''), picture: String(c.picture ?? '') };
  } catch {
    return null;
  }
}

function read(): string | null {
  try { return sessionStorage.getItem(KEY) ?? memoryToken; } catch { return memoryToken; }
}

export const Auth = {
  /** Current token, or null when missing / within 30 s of expiry. */
  token(): string | null {
    const t = read();
    if (!t) return null;
    const c = decode(t);
    if (!c || c.exp * 1000 < Date.now() + 30_000) { Auth.clear(); return null; }
    return t;
  },
  claims(): Claims | null {
    const t = Auth.token();
    return t ? decode(t) : null;
  },
  set(t: string): void {
    memoryToken = t;
    try { sessionStorage.setItem(KEY, t); } catch { /* private window: memory only */ }
  },
  clear(): void {
    memoryToken = null;
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  },
  signOut(): void {
    Auth.clear();
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
  },
  /** Resolves google.accounts.id once the GSI script has loaded (≤ 10 s). */
  async gis(): Promise<any> {
    for (let i = 0; i < 100; i++) {
      const g = window.google?.accounts?.id;
      if (g) return g;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Google sign-in did not load. Check the network and reload.');
  },
  /** Renders the official button into `host`; `onToken` fires with each new credential. */
  async renderButton(host: HTMLElement, onToken: (token: string) => void): Promise<void> {
    const gis = await Auth.gis();
    gis.initialize({
      client_id: CLIENT_ID,
      callback: (r: { credential: string }) => { Auth.set(r.credential); onToken(r.credential); },
      auto_select: true,
      use_fedcm_for_prompt: true
    });
    gis.renderButton(host, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280 });
  }
};
