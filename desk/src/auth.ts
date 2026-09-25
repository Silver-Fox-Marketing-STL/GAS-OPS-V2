// Google sign-in via the GIS token client: an OAuth ACCESS token carrying the
// script's own scopes (read from appsscript.json — one source of truth), so the
// Execution API runs every function as this user. The token lives ~1 h in
// sessionStorage (memory fallback); expiry sends the user back to sign-in.
import { CLIENT_ID, USERINFO_URL } from './config';
import manifest from '../../appsscript.json';

declare global {
  interface Window { google?: any }
}

export const SCOPES: string[] = (manifest as { oauthScopes?: string[] }).oauthScopes ?? [];

const KEY = 'desk.session';
interface Session { accessToken: string; exp: number; email: string }
let memory: Session | null = null;

function read(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Session;
  } catch { /* fall through */ }
  return memory;
}
function write(s: Session | null): void {
  memory = s;
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* memory only */ }
}

async function gis(): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const g = window.google?.accounts?.oauth2;
    if (g) return g;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Google sign-in did not load. Check the network and reload.');
}

export const Auth = {
  /** Current access token, or null when missing / within 60 s of expiry. */
  token(): string | null {
    const s = read();
    if (!s) return null;
    if (s.exp < Date.now() + 60_000) { Auth.clear(); return null; }
    return s.accessToken;
  },
  email(): string { return read()?.email ?? ''; },
  clear(): void { write(null); },
  /** Opens Google's consent popup (scopes = the script's), then resolves with the signed-in email. */
  async signIn(): Promise<string> {
    const g = await gis();
    const token: { access_token: string; expires_in: number } = await new Promise((resolve, reject) => {
      const client = g.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES.join(' '),
        callback: (r: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => {
          if (r.error || !r.access_token) reject(new Error(r.error_description || r.error || 'Sign-in was cancelled.'));
          else resolve({ access_token: r.access_token, expires_in: Number(r.expires_in) || 3600 });
        },
        error_callback: (e: { type?: string; message?: string }) => reject(new Error(e.message || e.type || 'Sign-in popup failed.'))
      });
      client.requestAccessToken();
    });
    let email = '';
    try {
      const res = await fetch(USERINFO_URL, { headers: { Authorization: 'Bearer ' + token.access_token } });
      if (res.ok) email = String(((await res.json()) as { email?: string }).email ?? '');
    } catch { /* email is display-only */ }
    write({ accessToken: token.access_token, exp: Date.now() + token.expires_in * 1000, email });
    return email;
  },
  signOut(): void {
    const s = read();
    write(null);
    try { if (s) window.google?.accounts?.oauth2?.revoke(s.accessToken, () => undefined); } catch { /* ignore */ }
  }
};
