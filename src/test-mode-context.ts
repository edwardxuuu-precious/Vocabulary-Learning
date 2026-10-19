// Mode belongs to this document/tab, never to a browser-wide cookie or localStorage.
export const testModeActive = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'test';
const tokenKey = 'playroom-parent-test-token';
const token = (() => { try { return testModeActive ? window.sessionStorage.getItem(tokenKey) ?? '' : ''; } catch { return ''; } })();

export function modeFetch(input: RequestInfo | URL, options: RequestInit = {}) {
  if (!testModeActive) return fetch(input, options);
  if (typeof input !== 'string' || !input.startsWith('/api/')) return Promise.reject(new Error('测试请求地址无效。'));
  if (!token) return Promise.reject(new Error('测试入口已过期，请退出测试，再从家长空间进入。'));
  const headers = new Headers(options.headers);
  headers.set('X-Playroom-Test', token);
  return fetch('/api/test/' + input.slice('/api/'.length), { ...options, headers });
}

export function enterTestMode(token: string) {
  window.sessionStorage.setItem(tokenKey, token);
  window.location.assign('/?mode=test');
}
export async function exitTestMode() {
  try { await modeFetch('/api/exit', { method: 'POST', signal: AbortSignal.timeout(3000) }); } catch { /* Expired or offline still exits locally, never falls back to child writes. */ }
  try { window.sessionStorage.removeItem(tokenKey); } catch { /* URL still returns to the child profile. */ }
  window.location.assign('/');
}
