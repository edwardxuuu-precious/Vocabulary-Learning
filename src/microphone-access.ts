export class MicrophoneAccessError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'MicrophoneAccessError';
  }
}

/** Permission state describes the website grant, not the operating system's app grant. */
export function microphoneFailureMessage(error: unknown, permission: PermissionState | 'unknown' = 'unknown'): string {
  const failure = error && typeof error === 'object' ? error as { name?: string; message?: string } : {};
  if (failure.name === 'NotAllowedError' || failure.name === 'PermissionDeniedError') {
    if (/denied by system/i.test(failure.message ?? ''))
      return `${permission === 'granted' ? '网页已允许麦克风，但' : ''}系统仍在拦截当前浏览器。请家长打开系统的麦克风授权（Codex 可能显示为 ChatGPT），再试一次；也可以先跳过。`;
    if (permission === 'granted')
      return '网页已允许麦克风，但当前浏览器仍无法访问设备。请家长检查系统对当前浏览器的麦克风授权，再试一次；也可以先跳过。';
    if (permission === 'denied')
      return '当前网页的麦克风访问被阻止。请家长检查此网页的麦克风授权和系统麦克风设置，再试一次；也可以先跳过。';
    return '麦克风访问未获准。请家长检查网页与系统两处的麦克风权限，再试一次；也可以先跳过。';
  }
  if (failure.name === 'NotFoundError' || failure.name === 'DevicesNotFoundError')
    return '没有找到可用的麦克风。请家长连接或选择录音设备，再试一次；也可以先跳过。';
  if (failure.name === 'NotReadableError' || failure.name === 'TrackStartError')
    return '麦克风暂时无法使用，可能被其他应用占用或设备尚未就绪。请家长检查设备后再试；也可以先跳过。';
  if (failure.name === 'OverconstrainedError')
    return '当前麦克风不支持所需的录音设置。请家长检查或更换设备后再试；也可以先跳过。';
  return '这次没能打开麦克风。可以再试一次，或先跳过。';
}

async function readPermission(): Promise<PermissionState | 'unknown'> {
  if (!navigator.permissions?.query) return 'unknown';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then(status => status.state),
      new Promise<'unknown'>(resolve => { timer = setTimeout(() => resolve('unknown'), 600); }),
    ]);
  } catch { return 'unknown'; }
  finally { clearTimeout(timer); }
}

/** Uses the browser's normal consent flow; never changes or overrides permissions. */
export async function requestMicrophoneStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  try { return await navigator.mediaDevices.getUserMedia(constraints); }
  catch (error) {
    const name = error && typeof error === 'object' ? (error as { name?: string }).name : undefined;
    const permission = name === 'NotAllowedError' || name === 'PermissionDeniedError' ? await readPermission() : 'unknown';
    throw new MicrophoneAccessError(microphoneFailureMessage(error, permission), error);
  }
}
