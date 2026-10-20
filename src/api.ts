import { modeFetch } from './test-mode-context';
import type { ApiError } from '../shared/contracts';
export class ApiRequestError extends Error { constructor(message:string, readonly code?:string, readonly status?:number) { super(message); } }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await modeFetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `请求没有完成（${response.status}）`;
    let code:string|undefined;
    try { const body=(await response.json()) as ApiError; message=body.error||message;code=body.code; } catch { /* Keep the HTTP status. */ }
    if(code==='SESSION_PLAN_CHANGED'&&typeof window!=='undefined')window.dispatchEvent(new Event('learning-plan-changed'));
    throw new ApiRequestError(message,code,response.status);
  }
  return response.json() as Promise<T>;
}

export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '刚才没能完成，请再试一次。';
