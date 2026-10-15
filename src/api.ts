import type { ApiError } from '../shared/contracts';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `请求没有完成（${response.status}）`;
    try { message = ((await response.json()) as ApiError).error || message; } catch { /* Keep the HTTP status. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '刚才没能完成，请再试一次。';
