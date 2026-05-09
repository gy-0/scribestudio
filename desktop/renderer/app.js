const $ = (id) => document.getElementById(id);

const api = window.scribeStudio;
const fields = {
  inputPath: $('inputPath'),
  url: $('url'),
  apiKey: $('apiKey'),
  appId: $('appId'),
  accessToken: $('accessToken'),
  mode: $('mode'),
  language: $('language'),
  context: $('context'),
  resourceId: $('resourceId'),
  speaker: $('speaker'),
  ddc: $('ddc'),
  outputDir: $('outputDir'),
  basename: $('basename')
};

const state = {
  utterances: [],
  text: '',
  files: [],
  mediaUrl: '',
  mediaKind: '',
  activeView: 'segments'
};

const log = $('log');
const status = $('status');
const startButton = $('start');
const cancelButton = $('cancel');
const dropZone = $('dropZone');
const videoPreview = $('videoPreview');
const audioPreview = $('audioPreview');
const emptyPreview = $('emptyPreview');
const liveCaption = $('liveCaption');
const theater = $('theater');
const theaterVideo = $('theaterVideo');
const theaterCaption = $('theaterCaption');
const theaterToggle = $('theaterToggle');
const LIVE_CAPTION_PLACEHOLDER = '字幕生成后会在这里跟随播放。';
const THEATER_CAPTION_PLACEHOLDER = '选择一句字幕开始播放。';

function appendLog(text) {
  if (log.textContent === '等待任务开始。') log.textContent = '';
  log.textContent += text;
  log.scrollTop = log.scrollHeight;
}

function setStatus(text, type = 'idle') {
  status.textContent = text;
  status.className = `status ${type}`;
}

function setRunning(running) {
  startButton.disabled = running;
  cancelButton.disabled = !running;
  setStatus(running ? '转写中' : '待开始', running ? 'running' : 'idle');
}

function selectedFormats() {
  return Array.from(document.querySelectorAll('input[name="format"]:checked')).map((input) => input.value);
}

function setFormats(formats) {
  const chosen = new Set(formats && formats.length ? formats : ['txt', 'srt', 'vtt', 'json', 'md']);
  for (const input of document.querySelectorAll('input[name="format"]')) {
    input.checked = chosen.has(input.value);
  }
}

function payload() {
  return {
    inputPath: fields.inputPath.value.trim(),
    url: fields.url.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    appId: fields.appId.value.trim(),
    accessToken: fields.accessToken.value.trim(),
    mode: fields.mode.value,
    language: fields.language.value.trim() || 'zh-CN',
    context: fields.context.value.trim(),
    resourceId: fields.resourceId.value.trim(),
    speaker: fields.speaker.checked,
    ddc: fields.ddc.checked,
    outputDir: fields.outputDir.value.trim(),
    basename: fields.basename.value.trim(),
    formats: selectedFormats()
  };
}

function fillConfig(config) {
  fields.apiKey.value = config.apiKey || '';
  fields.appId.value = config.appId || '';
  fields.accessToken.value = config.accessToken || '';
  fields.mode.value = config.mode || 'flash';
  fields.language.value = config.language || 'zh-CN';
  fields.context.value = config.context || '';
  fields.resourceId.value = config.resourceId || '';
  fields.speaker.checked = Boolean(config.speaker);
  fields.ddc.checked = Boolean(config.ddc);
  fields.outputDir.value = config.outputDir || '';
  setFormats(config.formats);
}

function mediaTypeFromPath(filePath) {
  const ext = filePath.split('?')[0].split('.').pop().toLowerCase();
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac'].includes(ext)) return 'audio';
  return '';
}

async function updateMediaPreview(filePath) {
  state.mediaUrl = '';
  state.mediaKind = mediaTypeFromPath(filePath);
  videoPreview.hidden = true;
  audioPreview.hidden = true;
  emptyPreview.hidden = false;
  theaterToggle.disabled = true;
  $('mediaMeta').textContent = filePath ? filePath.split('/').pop() : '导入本地素材后可在这里审看。';

  if (!filePath || !state.mediaKind) return;
  const url = await api.mediaUrl(filePath);
  if (!url) return;

  state.mediaUrl = url;
  emptyPreview.hidden = true;
  if (state.mediaKind === 'video') {
    videoPreview.src = url;
    videoPreview.hidden = false;
    theaterVideo.src = url;
    theaterToggle.disabled = false;
  } else {
    audioPreview.src = url;
    audioPreview.hidden = false;
  }
}

function activeMedia() {
  return state.mediaKind === 'video' ? videoPreview : audioPreview;
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderFiles(files) {
  const list = $('fileList');
  list.innerHTML = '';
  if (!files.length) {
    list.className = 'file-list empty';
    list.textContent = '还没有生成文件。';
    return;
  }
  list.className = 'file-list';
  for (const file of files) {
    const item = document.createElement('button');
    item.className = 'file-item';
    item.type = 'button';
    item.innerHTML = `<span class="file-kind">${file.kind}</span><span><strong>${file.name}</strong><small>${Math.ceil(file.size / 1024)} KB</small></span>`;
    item.addEventListener('click', () => api.openPath(file.path));
    list.appendChild(item);
  }
}

function renderSegments(utterances) {
  const list = $('segmentList');
  list.innerHTML = '';
  if (!utterances.length) {
    list.className = 'segment-list empty';
    list.textContent = state.text ? '服务没有返回逐句时间轴，可在“全文”里查看。' : '暂无识别结果。';
    return;
  }
  list.className = 'segment-list';
  for (const utterance of utterances) {
    const item = document.createElement('button');
    item.className = 'segment-item';
    item.type = 'button';
    item.dataset.start = String(utterance.start);
    item.innerHTML = `
      <span class="segment-time">${formatClock(utterance.start)}</span>
      <span class="segment-body">
        ${utterance.speaker ? `<small>Speaker ${utterance.speaker}</small>` : ''}
        <strong>${escapeHtml(utterance.text)}</strong>
      </span>
    `;
    item.addEventListener('click', () => seekToUtterance(utterance));
    list.appendChild(item);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function seekToUtterance(utterance) {
  const media = activeMedia();
  if (media && state.mediaUrl) {
    media.currentTime = utterance.start / 1000;
    media.play().catch(() => {});
  }
  if (!theater.hidden && state.mediaKind === 'video') {
    theaterVideo.currentTime = utterance.start / 1000;
    theaterVideo.play().catch(() => {});
  }
  updateCaption(utterance.text);
}

function updateCaption(text, { showPlaceholder = false } = {}) {
  liveCaption.textContent = text || (showPlaceholder ? LIVE_CAPTION_PLACEHOLDER : '');
  theaterCaption.textContent = text || (showPlaceholder ? THEATER_CAPTION_PLACEHOLDER : '');
}

function currentUtterance(currentTime) {
  const ms = currentTime * 1000;
  return state.utterances.find((u) => ms >= u.start && ms <= u.end) || null;
}

function syncCaption(event) {
  const utterance = currentUtterance(event.currentTarget.currentTime);
  updateCaption(utterance ? utterance.text : '', { showPlaceholder: !state.utterances.length });
}

function applyResult(transcript) {
  state.utterances = transcript?.utterances || [];
  state.text = transcript?.text || '';
  state.files = transcript?.files || [];
  $('fullText').value = state.text;
  $('resultSummary').textContent = state.utterances.length
    ? `${state.utterances.length} 段，${state.text.length} 字。点击任意一句可跳到对应时间。`
    : state.text
      ? `${state.text.length} 字。当前结果没有逐句时间轴。`
      : '没有读到可展示的识别结果，请查看任务日志。';
  renderSegments(state.utterances);
  renderFiles(state.files);
  updateCaption('', { showPlaceholder: !state.utterances.length });
}

function switchView(view) {
  state.activeView = view;
  for (const button of document.querySelectorAll('.tab')) {
    button.classList.toggle('active', button.dataset.view === view);
  }
  $('segmentsView').hidden = view !== 'segments';
  $('textView').hidden = view !== 'text';
  $('translateView').hidden = view !== 'translate';
}

async function init() {
  const config = await api.loadConfig();
  fillConfig(config);

  api.onLog(appendLog);
  api.onState((nextState) => setRunning(Boolean(nextState.running)));
  api.onDone((result) => {
    if (result.success) {
      setStatus('已完成', 'idle');
      applyResult(result.transcript);
    } else {
      setStatus('失败', 'error');
    }
  });
}

$('chooseFile').addEventListener('click', async () => {
  const file = await api.chooseFile();
  if (file) {
    fields.inputPath.value = file;
    await updateMediaPreview(file);
  }
});

fields.inputPath.addEventListener('change', () => updateMediaPreview(fields.inputPath.value.trim()));

$('chooseOutput').addEventListener('click', async () => {
  const dir = await api.chooseOutputDir();
  if (dir) fields.outputDir.value = dir;
});

$('openOutput').addEventListener('click', async () => {
  if (fields.outputDir.value.trim()) await api.openPath(fields.outputDir.value.trim());
});

startButton.addEventListener('click', async () => {
  const data = payload();
  if (!data.outputDir) {
    appendLog('请选择输出目录。\n');
    return;
  }
  if (!data.inputPath && !data.url) {
    appendLog('请选择本地文件，或者填写远程 URL。\n');
    return;
  }
  if (!data.apiKey && (!data.appId || !data.accessToken)) {
    appendLog('请先填写 API Key，或者填写 App ID + Access Token。\n');
    return;
  }

  log.textContent = '';
  renderFiles([]);
  renderSegments([]);
  updateCaption('', { showPlaceholder: true });
  setRunning(true);
  try {
    const result = await api.startTranscribe(data);
    if (result?.transcript) applyResult(result.transcript);
  } catch (error) {
    appendLog(`\n${error.message || error}\n`);
    setStatus('失败', 'error');
  } finally {
    setRunning(false);
  }
});

cancelButton.addEventListener('click', async () => {
  await api.cancelTranscribe();
  appendLog('\n已请求取消任务。\n');
});

for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => switchView(button.dataset.view));
}

$('copyTranslatePrompt').addEventListener('click', async () => {
  const target = $('targetLanguage').value;
  const prompt = `请把下面的转写稿翻译成${target}，保留段落顺序，语气自然，专有名词按上下文处理：\n\n${state.text || $('fullText').value}`;
  await navigator.clipboard.writeText(prompt);
  $('translationText').value = prompt;
});

$('runLocalTranslate').addEventListener('click', async () => {
  const sourceText = state.text || $('fullText').value;
  if (!sourceText.trim()) {
    $('translationText').value = '请先完成转写，或在“全文”里填入要翻译的内容。';
    return;
  }
  const languageMap = { 英文: 'en', 中文: 'zh', 日文: 'ja', 韩文: 'ko' };
  const targetLanguage = languageMap[$('targetLanguage').value] || 'en';
  const translatorApi = window.Translator || window.ai?.translator;
  if (!translatorApi?.create) {
    $('translationText').value = '当前 Electron/Chromium 没有可用的本机翻译引擎。请使用“复制翻译提示”交给你常用的翻译模型。';
    return;
  }
  $('translationText').value = '正在翻译...';
  try {
    const translator = await translatorApi.create({ sourceLanguage: 'zh', targetLanguage });
    $('translationText').value = await translator.translate(sourceText);
  } catch (error) {
    $('translationText').value = `本机翻译失败：${error.message || error}\n\n可以改用“复制翻译提示”。`;
  }
});

theaterToggle.addEventListener('click', () => {
  if (!state.mediaUrl || state.mediaKind !== 'video') return;
  theater.hidden = false;
  theaterVideo.currentTime = videoPreview.currentTime || 0;
  theaterVideo.play().catch(() => {});
});

$('closeTheater').addEventListener('click', () => {
  theater.hidden = true;
  videoPreview.currentTime = theaterVideo.currentTime || 0;
  theaterVideo.pause();
});

videoPreview.addEventListener('timeupdate', syncCaption);
audioPreview.addEventListener('timeupdate', syncCaption);
theaterVideo.addEventListener('timeupdate', syncCaption);

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}

dropZone.addEventListener('drop', async (event) => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file && file.path) {
    fields.inputPath.value = file.path;
    await updateMediaPreview(file.path);
  }
});

init().catch((error) => appendLog(`${error.message || error}\n`));
