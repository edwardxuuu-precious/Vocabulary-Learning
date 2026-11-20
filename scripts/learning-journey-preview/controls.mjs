const legacyLabel = '学习流程体验 · 原词图，独立进度';
const originalBanner = [...document.body.children].find(element =>
  element.getAttribute('data-learning-journey-preview') === 'true' ||
  (element.tagName === 'ASIDE' && element.textContent.trim() === legacyLabel)
);

async function readJson(path, body) {
  const options = { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) };
  const response = body === undefined ? await fetch(path, options) : await fetch(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '连接未完成，请再试一次。');
  return result;
}

async function isolatedArchive() {
  const audit = await readJson('/__preview/audit');
  if (audit.isolated !== true || new URL(audit.url).origin !== location.origin ||
      !Number.isInteger(audit.words) || audit.words < 1 || audit.words > 40) {
    throw new Error('请从独立体验入口重新打开。');
  }
  return audit;
}

function replayScope(state, wordCount) {
  const completed = state.lastCompletedSession;
  const ids = completed?.wordIds;
  if (!completed?.completedAt || !completed.rewardGranted || completed.entrySource?.entry !== 'learn' || completed.packGame ||
      !Array.isArray(ids) || ids.length !== wordCount || new Set(ids).size !== ids.length || state.words.length !== ids.length ||
      ids.some(id => !state.words.some(word => word.id === id) || !completed.completedWordIds.includes(id))) {
    throw new Error('上次的学习范围有更新。请在下方继续已保存的进度。');
  }
  return { completed, ids };
}

async function enterWordPractice() {
  const audit = await isolatedArchive();
  const state = await readJson('/api/state');
  if (state.activeSession && !state.activeSession.completedAt && !state.activeSession.suspendedAt) {
    // Never replace a task that another tab might have just started.
    window.location.reload();
    return;
  }
  const { completed, ids } = replayScope(state, audit.words);
  if (ids.some(id => !state.learningReadyWordIds?.includes(id))) {
    throw new Error('本轮有图片或发音暂时没准备好。');
  }
  const session = await readJson('/api/session/start', {
    entry: 'learn', mode: 'relearn', strategy: 'memory-loop',
    wordIds: ids, requestId: `journey-replay-${completed.id}`,
  });
  const next = await readJson('/api/state');
  if (next.activeSession?.id === session.id && !session.completedAt) {
    window.history.replaceState(null, '', '#play');
  }
  window.location.reload();
}

function showControls(audit) {
  const banner = originalBanner;
  banner.removeAttribute('style');
  banner.className = 'test-mode-banner journey-preview-banner';
  banner.setAttribute('aria-label', '学习流程测试版');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = '测试版';
  const status = document.createElement('span');
  status.textContent = '试用进度单独保存';
  copy.append(title, status);

  const replay = document.createElement('button');
  replay.className = 'journey-preview-replay';
  replay.type = 'button';
  replay.textContent = '从单词开始';
  replay.setAttribute('aria-label', `从单词开始，体验上次的 ${audit.words} 个词`);

  const message = document.createElement('p');
  message.className = 'journey-preview-error';
  message.setAttribute('role', 'status');
  banner.replaceChildren(copy, replay, message);
  replay.addEventListener('click', async () => {
    replay.disabled = true;
    replay.textContent = '正在准备…';
    message.textContent = '';
    try {
      await enterWordPractice();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : '刚才没能开始，请再试一次。';
    } finally {
      replay.disabled = false;
      replay.textContent = '从单词开始';
    }
  });
}

if (originalBanner) {
  isolatedArchive().then(showControls).catch(() => {
    originalBanner.textContent = '独立体验暂未连接';
  });
}
