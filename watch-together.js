const sources = {
  bilibili: { label: '哔哩哔哩', badge: 'B', kind: '视频' },
  douyin: { label: '抖音', badge: '♪', kind: '视频' },
  xiaoyuzhou: { label: '小宇宙', badge: '◉', kind: '播客' },
};

// Only known HTTPS provider pages are accepted. Never turn pasted markup into HTML.
export function parseWatchLink(value) {
  const text = String(value || '').trim();
  const invalid = (error) => ({ valid: false, error });
  if (!text) return invalid('粘贴一个链接，把喜欢的内容带过来。');
  if (text.length > 4000) return invalid('分享文字太长了，试试只粘贴链接。');
  const links = text.match(/https?:\/\/[^\s<>"'\u3000，。；！？（）【】]+/gi) || [];
  if (links.length > 1) return invalid('一次陪你看一个内容，请只保留一个链接。');
  let candidate = links[0] || text;
  candidate = candidate.replace(/[),.;!?]+$/, '');
  if (/^(?:www\.|m\.|v\.)?(?:bilibili\.com|b23\.tv|douyin\.com|xiaoyuzhoufm\.com)\//i.test(candidate)) candidate = `https://${candidate}`;
  let url;
  try { url = new URL(candidate); } catch { return invalid('这个链接还没识别出来，请粘贴完整的网址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return invalid('请使用平台的 HTTPS 分享链接。');
  const host = url.hostname;
  let platform;
  if (['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv'].includes(host)) platform = 'bilibili';
  if (['douyin.com', 'www.douyin.com', 'v.douyin.com'].includes(host)) platform = 'douyin';
  if (['xiaoyuzhoufm.com', 'www.xiaoyuzhoufm.com'].includes(host)) platform = 'xiaoyuzhou';
  if (!platform) return invalid('先支持 B 站、抖音和小宇宙的分享链接。');
  const source = sources[platform];
  let embedUrl = '';
  let cleanUrl = url.href;
  if (platform === 'bilibili' && host !== 'b23.tv') {
    const match = url.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/);
    if (!match) return invalid('请复制 B 站具体视频的链接，而不是首页或个人主页。');
    const requestedPage = Number(url.searchParams.get('p'));
    const part = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 999 ? requestedPage : 1;
    const params = new URLSearchParams({ autoplay: '0', danmaku: '0', p: String(part) });
    params.set(match[1].startsWith('BV') ? 'bvid' : 'aid', match[1].replace(/^av/, ''));
    embedUrl = `https://player.bilibili.com/player.html?${params}`;
    cleanUrl = `https://www.bilibili.com/video/${match[1]}/${part > 1 ? `?p=${part}` : ''}`;
  } else if (platform === 'xiaoyuzhou' && !/^\/episode\/[a-f0-9]{24}\/?$/i.test(url.pathname)) {
    return invalid('请复制小宇宙具体单集的分享链接。');
  } else if (url.pathname === '/') {
    return invalid('请粘贴具体内容的链接，而不是平台首页。');
  }
  return { valid: true, platform, ...source, url: cleanUrl, embedUrl, mode: embedUrl ? 'embed' : 'external' };
}

export function getWatchInputFeedback(draft) {
  const assessment = parseWatchLink(draft);
  return String(draft || '').trim() && !assessment.valid ? assessment.error : '';
}

export function createWatchState() {
  let draft = '';
  let selected = null;
  let view = 'input';
  return {
    getSnapshot: () => ({ draft, selected: selected ? { ...selected } : null, view, assessment: parseWatchLink(draft) }),
    setDraft: (value) => { draft = String(value).slice(0, 4000); },
    start: () => { const link = parseWatchLink(draft); if (!link.valid) return false; selected = link; view = 'watch'; return true; },
    edit: () => { view = 'input'; },
    clear: () => { selected = null; draft = ''; view = 'input'; },
  };
}

export function mountWatchTogether(root = document, { stopChatAudio = () => {} } = {}) {
  const page = root.querySelector('[data-watch-page]');
  const open = root.querySelector('[data-open-watch]');
  if (!page || !open) return;
  const chat = root.querySelector('[data-chat-app]');
  const state = createWatchState();
  const input = page.querySelector('[data-watch-input]');
  const submit = page.querySelector('[data-watch-submit]');
  const feedback = page.querySelector('[data-watch-feedback]');
  const player = page.querySelector('[data-watch-player]');
  const editor = page.querySelector('[data-watch-editor]');
  const room = page.querySelector('[data-watch-room]');
  let opened = false;

  const unloadPlayer = () => { player.replaceChildren(); };
  const renderInput = () => {
    const { draft, assessment } = state.getSnapshot();
    submit.disabled = !assessment.valid;
    feedback.textContent = getWatchInputFeedback(draft);
    feedback.hidden = !feedback.textContent;
    page.querySelector('[data-watch-clear]').hidden = !draft;
  };
  const renderView = () => {
    const { view, selected } = state.getSnapshot();
    const watching = view === 'watch';
    editor.hidden = watching; room.hidden = !watching;
    page.querySelector('[data-watch-edit]').hidden = !watching;
    page.classList.toggle('is-watching', watching);
    page.querySelector('[data-watch-heading]').textContent = watching ? '今晚，一起看。' : '粘贴你想看的链接';
    if (!watching) { unloadPlayer(); input.value = state.getSnapshot().draft; renderInput(); return; }
    unloadPlayer();
    room.dataset.platform = selected.platform;
    page.querySelector('[data-watch-url]').textContent = selected.url;
    if (selected.mode === 'embed') {
      const iframe = document.createElement('iframe');
      iframe.title = 'B 站官方视频播放器'; iframe.src = selected.embedUrl;
      iframe.allow = 'fullscreen; picture-in-picture; encrypted-media';
      iframe.allowFullscreen = true; iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      player.append(iframe);
    } else {
      const external = document.createElement('a'); external.className = 'watch-external';
      external.target = '_blank'; external.rel = 'noopener noreferrer';
      external.href = selected.url; external.textContent = `打开${selected.label}原页面 ↗`;
      const card = document.createElement('div'); card.className = 'watch-provider-card';
      const icon = document.createElement('span'); icon.className = 'watch-provider-icon'; icon.textContent = selected.badge;
      const title = document.createElement('strong'); title.textContent = `${selected.label}内容已准备好`;
      const text = document.createElement('p'); text.textContent = selected.platform === 'bilibili' ? '这是短链接。打开原页面后，复制含 BV 号的完整视频链接，即可在这里观看。' : '这个来源暂未接通内嵌播放，可以先在原页面观看或收听。';
      card.append(icon, title, text, external); player.append(card);
    }
  };
  const edit = () => { state.edit(); renderView(); input.focus(); };
  const close = () => {
    opened = false; unloadPlayer(); state.edit();
    page.hidden = true; chat.hidden = false; open.focus();
  };
  open.addEventListener('click', (event) => {
    event.preventDefault(); stopChatAudio();
    chat.hidden = true; page.hidden = false; opened = true;
    state.edit(); renderView(); page.querySelector('[data-watch-close]').focus();
  });
  input.addEventListener('input', () => { state.setDraft(input.value); renderInput(); });
  page.querySelector('[data-watch-form]').addEventListener('submit', (event) => {
    event.preventDefault(); if (!state.start()) { renderInput(); return; }
    renderView(); page.querySelector('[data-watch-edit]').focus();
  });
  page.querySelector('[data-watch-clear]').addEventListener('click', () => { state.setDraft(''); input.value = ''; renderInput(); input.focus(); });
  page.querySelector('[data-watch-edit]').addEventListener('click', edit);
  for (const button of page.querySelectorAll('[data-watch-close]')) button.addEventListener('click', close);
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && opened) { event.preventDefault(); close(); } });
  renderInput();
}
