import { randomBytes } from 'node:crypto';
import { AppError } from './store.ts';
import type { AssessmentGrant } from '../shared/contracts.ts';

/** A PIN unlock grants assessment operations and private practice-audio history, never unrelated parent writes. */
export class AssessmentGrants {
  private grants = new Map<string, number>();
  constructor(private now = Date.now) {}
  issue(): AssessmentGrant {
    for (const [token, expiry] of this.grants) if (expiry <= this.now()) this.grants.delete(token);
    while (this.grants.size >= 64) this.grants.delete(this.grants.keys().next().value!);
    const token = randomBytes(32).toString('hex'), expiry = this.now() + 30 * 60_000;
    this.grants.set(token, expiry);
    return { token, expiresAt: new Date(expiry).toISOString() };
  }
  require(header: string | undefined) {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || (this.grants.get(token) ?? 0) <= this.now()) {
      if (token) this.grants.delete(token);
      throw new AppError('家长验证已失效，请重新输入 PIN 后继续测试。', 'ASSESSMENT_AUTH_REQUIRED', 403);
    }
  }
  revoke(header: string | undefined) { if (header?.startsWith('Bearer ')) this.grants.delete(header.slice(7)); }
  clear() { this.grants.clear(); }
}
