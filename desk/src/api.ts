// The whole transport: one POST per call to the Apps Script /exec URL.
// text/plain body → no CORS preflight (Apps Script cannot answer OPTIONS);
// redirect:'follow' → Apps Script bounces /exec to googleusercontent.
// Response contract (Code.gs Section 36): {ok:true,result,email} | {ok:false,error}.
import { EXEC_URL } from './config';
import { Auth } from './auth';

export type ApiErrorKind = 'auth' | 'server' | 'network';

export class ApiError extends Error {
  kind: ApiErrorKind;
  constructor(message: string, kind: ApiErrorKind = 'server') {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

const AUTH_PATTERN = /sign in again|not signed in|not allowed to use|token was rejected|different app|unexpected issuer|not verified/i;

export async function call<T = unknown>(fn: string, args: unknown[] = []): Promise<T> {
  const idToken = Auth.token();
  if (!idToken) throw new ApiError('Not signed in.', 'auth');

  let res: Response;
  try {
    res = await fetch(EXEC_URL, {
      method: 'POST',
      body: JSON.stringify({ fn, args, idToken }),
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
  } catch {
    throw new ApiError('Could not reach the desk API (network).', 'network');
  }

  let json: { ok?: boolean; result?: unknown; error?: string } | null = null;
  try { json = await res.json(); } catch { /* handled below */ }
  if (!json) throw new ApiError(`The desk API answered with something that is not JSON (HTTP ${res.status}).`, 'network');

  if (json.ok !== true) {
    const msg = String(json.error ?? 'Unknown error');
    if (AUTH_PATTERN.test(msg)) {
      Auth.clear();                     // back to the sign-in screen, which shows this message
      throw new ApiError(msg, 'auth');
    }
    throw new ApiError(msg, 'server');
  }
  return json.result as T;
}
