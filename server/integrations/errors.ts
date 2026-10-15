export class IntegrationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new IntegrationError('CANCELLED', '操作已取消。');
}
