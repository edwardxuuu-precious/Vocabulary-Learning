import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParentGateStatus } from '../shared/contracts.ts';
import { AppError } from './store.ts';

interface PinRecord { version: 1; salt: string; hash: string }

// This protects the local web UI entry. It is separate from learning data/backups.
export class ParentGate {
  private readonly file: string;
  private failures = 0;
  private lockedUntil = 0;

  constructor(dataDir: string, private readonly now = Date.now) {
    this.file = path.join(dataDir, 'parent-pin.json');
  }

  private read(): PinRecord | undefined {
    if (!existsSync(this.file)) return;
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as PinRecord;
      if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{64}$/.test(value.hash)) throw Error();
      return value;
    } catch { throw new AppError('家长 PIN 文件无法读取，请家长在本机重设。', 'PARENT_PIN_INVALID', 503); }
  }

  status(): ParentGateStatus {
    return { configured: Boolean(this.read()), retryAfterSeconds: Math.max(0, Math.ceil((this.lockedUntil - this.now()) / 1000)) };
  }

  private validate(pin: unknown): asserts pin is string {
    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) throw new AppError('请输入 6 位数字 PIN。', 'PARENT_PIN_FORMAT', 400);
  }

  private save(pin: string) {
    const salt = randomBytes(16).toString('hex');
    const record: PinRecord = { version: 1, salt, hash: scryptSync(pin, salt, 32).toString('hex') };
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    renameSync(temporary, this.file);
    this.failures = 0; this.lockedUntil = 0;
  }

  setup(pin: unknown): ParentGateStatus {
    if (this.read()) throw new AppError('已经设置过 PIN，请输入现有 PIN。', 'PARENT_PIN_EXISTS', 409);
    this.validate(pin); this.save(pin);
    return this.status();
  }

  unlock(pin: unknown): ParentGateStatus {
    const record = this.read();
    if (!record) throw new AppError('请先由家长设置 PIN。', 'PARENT_PIN_REQUIRED', 409);
    const retry = this.status().retryAfterSeconds;
    if (retry) throw new AppError(`尝试次数过多，请 ${retry} 秒后再试。`, 'PARENT_PIN_RATE_LIMIT', 429);
    const matches = typeof pin === 'string' && /^\d{6}$/.test(pin)
      && timingSafeEqual(scryptSync(pin, record.salt, 32), Buffer.from(record.hash, 'hex'));
    if (!matches) {
      this.failures += 1;
      if (this.failures >= 5) {
        this.failures = 0; this.lockedUntil = this.now() + 30_000;
        throw new AppError('尝试次数过多，请 30 秒后再试。', 'PARENT_PIN_RATE_LIMIT', 429);
      }
      throw new AppError('PIN 不正确，请让家长输入。', 'PARENT_PIN_INCORRECT', 403);
    }
    this.failures = 0;
    return this.status();
  }

  change(currentPin: unknown, pin: unknown): ParentGateStatus {
    this.validate(pin); this.unlock(currentPin); this.save(pin);
    return this.status();
  }
}
