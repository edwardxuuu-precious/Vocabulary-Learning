const app = document.querySelector('#app');
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action, style = 'primary') => {
  const node = element('button', text, style);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};
const image = (word, alt = '') => {
  const node = element('img');
  node.src = word.picture;
  node.alt = alt;
  return node;
};
let plan;
try {
  const response = await fetch('/plan');
  if (!response.ok) throw Error();
  plan = await response.json();
} catch {
  app.replaceChildren(element('h1', '试用暂时没准备好'), button('重试', () => location.reload()));
}
if (plan) {
  const { day, selected, fillers, canResume } = plan;
  const key = 'recall-warmup:' + day + ':' + selected.map(word => word.term).join('/');
  const fresh = () => ({ step: 'first', index: 0, observations: [], gap: 0, retry: 0, shown: false });
  let state = fresh(), sound;
  try { state = JSON.parse(localStorage.getItem(key)) || fresh(); } catch {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} };
  const update = (change) => {
    sound?.pause();
    Object.assign(state, change);
    save();
    render();
  };
  const title = (text) => app.append(element('h1', text));
  const actions = (...buttons) => {
    const row = element('div', '', 'actions');
    row.append(...buttons);
    app.append(row);
  };
  const retryWords = () => selected.filter((_, i) => state.observations[i]?.first === 'help');
  let screen = 'home';
  const continueLearning = () => {
    sound?.pause();
    location.assign('/continue-learning');
  };
  const continueButton = () => button(canResume ? '继续上次学习' : '接着学习', continueLearning);
  function markFirst(first) {
    state.observations[state.index] = { first };
    if (first === 'help') { update({ shown: true }); return; }
    advanceFirst();
  }
  function advanceFirst() {
    const index = state.index + 1;
    const step = index < selected.length ? 'first' : retryWords().length && fillers.length ? 'gap' : 'done';
    update({ index, step, shown: false });
  }
  function showAnswer(word, next, label) {
    app.append(element('strong', word.term, 'answer'));
    const feedback = element('p', '', 'feedback');
    feedback.setAttribute('role', 'status');
    actions(button(label, next), button('听发音', async () => {
      sound?.pause();
      sound = new Audio(word.sound);
      try { await sound.play(); feedback.textContent = ''; }
      catch { feedback.textContent = '声音暂时播不了，可以看单词。'; }
    }, 'secondary'));
    app.append(feedback);
  }
  function recall(word, isRetry) {
    const retry = retryWords();
    app.append(element('p', isRetry ? `再想一次 · ${state.retry + 1}/${retry.length}` : `短回忆 · ${state.index + 1}/${selected.length}`, 'stage'));
    title(state.shown ? '看看这个词' : isRetry ? '再说一次英文' : '看图，说英文');
    const cue = element('figure', '', 'cue');
    cue.append(image(word, word.meaning), element('figcaption', word.meaning));
    app.append(cue);
    if (!isRetry) {
      if (state.shown) showAnswer(word, advanceFirst, '继续');
      else actions(button('我想起来了', () => markFirst('recalled')), button('给我提示', () => markFirst('help'), 'secondary'));
    } else {
      const finish = () => update({ retry: state.retry + 1, step: state.retry + 1 < retry.length ? 'retry' : 'done', shown: false });
      const recordRetry = (result) => {
        const i = selected.indexOf(word);
        state.observations[i].retry = result;
        if (result === 'help') update({ shown: true });
        else finish();
      };
      if (state.shown) showAnswer(word, finish, '继续');
      else actions(button('这次想起来了', () => recordRetry('recalled')), button('再看一遍', () => recordRetry('help'), 'secondary'));
    }
  }
  function gap() {
    const correct = fillers[state.gap];
    app.append(element('p', `复习老朋友 · ${state.gap + 1}/2`, 'stage'));
    title('看英文，找图片');
    const cue = element('p', correct.term, 'answer');
    cue.lang = 'en';
    app.append(cue);
    const grid = element('div', '', 'pictures'), feedback = element('p', '', 'feedback');
    feedback.setAttribute('role', 'status');
    const choices = [fillers[(state.gap + 2) % 3], fillers[(state.gap + 1) % 3], fillers[state.gap]];
    if (state.gap === 1) choices.reverse();
    for (const row of choices) {
      const option = button('', () => {
        if (row !== correct) { feedback.textContent = '再看看，选一张图。'; return; }
        update({ gap: state.gap + 1, step: state.gap === 0 ? 'gap' : 'retry' });
      }, 'picture');
      option.append(image(row, '选图 ' + (grid.children.length + 1)));
      grid.append(option);
    }
    app.append(grid, feedback);
  }
  function render() {
    app.replaceChildren();
    document.body.classList.toggle('landing', screen === 'home');
    if (screen === 'home') {
      title('隔天短回忆');
      app.append(element('p', '先说说还记得的英文。卡住时，可以点提示。'));
      if (!selected.length) {
        app.append(element('p', '今天没有到期回忆题。'));
        actions(continueButton());
      }
      else if (state.step === 'done') actions(continueButton(), button('查看这次回忆', () => { screen = 'learn'; render(); }, 'secondary'));
      else actions(button(state.index || state.shown || state.step !== 'first' ? '继续学习' : '学习', () => { screen = 'learn'; render(); }));
      return;
    }
    if (state.step === 'done') {
      title('短回忆完成');
      const recalled = state.observations.filter(row => row.first === 'recalled').length;
      const helped = state.observations.filter(row => row.first === 'help').length;
      app.append(element('p', `自己报告想起 ${recalled} 个 · 看提示 ${helped} 个`));
      if (state.retry) app.append(element('p', `隔题再试 ${state.retry} 个`));
      if (helped && !fillers.length) app.append(element('p', '今天没有足够的隔题，先留到下次练。'));
      actions(continueButton(), button('先休息', () => { screen = 'home'; render(); }, 'secondary'));
      return;
    }
    app.append(button('先休息', () => { sound?.pause(); screen = 'home'; render(); }, 'rest'));
    if (state.step === 'gap') gap();
    else if (state.step === 'retry') recall(retryWords()[state.retry], true);
    else recall(selected[state.index], false);
  }
  render();
}
