// The whole transport: one scripts.run call per function, as the signed-in user.
// https://developers.google.com/apps-script/api/reference/rest/v1/scripts/run
// Response: {done:true, response:{result}} | {error:{code, message, details:[{errorMessage,…}]}}.
import { RUN_URL, DEV_MODE } from './config';
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

interface RunResponse {
  done?: boolean;
  response?: { result?: unknown };
  error?: { code?: number; message?: string; details?: { errorMessage?: string; errorType?: string }[] };
}

export async function call<T = unknown>(fn: string, args: unknown[] = []): Promise<T> {
  const token = Auth.token();
  if (!token) throw new ApiError('Not signed in.', 'auth');

  let res: Response;
  try {
    res = await fetch(RUN_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ function: fn, parameters: args, devMode: DEV_MODE })
    });
  } catch {
    throw new ApiError('Could not reach the Apps Script API (network).', 'network');
  }

  let json: RunResponse | null = null;
  try { json = (await res.json()) as RunResponse; } catch { /* handled below */ }

  if (res.status === 401) { Auth.clear(); throw new ApiError('Sign-in expired. Sign in again.', 'auth'); }
  if (res.status === 403) {
    Auth.clear();
    throw new ApiError((json?.error?.message ?? 'Permission denied.') +
      ' — check: the script is deployed as "API executable", it is linked to the same Cloud project as the OAuth client, and the Apps Script API is enabled there.', 'auth');
  }
  if (res.status === 404) throw new ApiError('Script not found — is VITE_SCRIPT_ID the EXP script id, and is it deployed as "API executable"?', 'server');
  if (!json) throw new ApiError(`The Apps Script API answered with something that is not JSON (HTTP ${res.status}).`, 'network');

  if (json.error) {
    const d = json.error.details?.[0];
    const msg = d?.errorMessage || json.error.message || 'Unknown error';
    throw new ApiError(msg, 'server');
  }
  return json.response?.result as T;
}
