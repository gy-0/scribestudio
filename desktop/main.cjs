const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

let mainWindow;
let activeJob = null;
const DEFAULT_OUTPUT_DIR_NAME = 'ScribeStudio Output';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: 'ScribeStudio',
    backgroundColor: '#101114',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function userConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function legacyConfigPaths() {
  const appData = app.getPath('appData');
  return [
    path.join(appData, 'tinggao', 'config.json'),
    path.join(appData, '听稿', 'config.json')
  ];
}

function defaultConfig() {
  return {
    apiKey: '',
    appId: '',
    accessToken: '',
    language: 'zh-CN',
    mode: 'flash',
    formats: ['txt', 'srt', 'vtt', 'json', 'md'],
    outputDir: path.join(app.getPath('documents'), DEFAULT_OUTPUT_DIR_NAME)
  };
}

function loadConfig() {
  const file = userConfigPath();
  const candidates = fs.existsSync(file) ? [file] : legacyConfigPaths().filter((candidate) => fs.existsSync(candidate));
  if (!candidates.length) return defaultConfig();
  try {
    const loaded = { ...defaultConfig(), ...JSON.parse(fs.readFileSync(candidates[0], 'utf8')) };
    if (candidates[0] !== file) saveConfig(loaded);
    return loaded;
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  const safe = {
    apiKey: String(config.apiKey || ''),
    appId: String(config.appId || ''),
    accessToken: String(config.accessToken || ''),
    language: String(config.language || 'zh-CN'),
    mode: String(config.mode || 'flash'),
    formats: Array.isArray(config.formats) ? config.formats : ['txt', 'srt', 'vtt', 'json', 'md'],
    outputDir: String(config.outputDir || path.join(app.getPath('documents'), DEFAULT_OUTPUT_DIR_NAME)),
    resourceId: String(config.resourceId || ''),
    context: String(config.context || ''),
    speaker: Boolean(config.speaker),
    ddc: Boolean(config.ddc)
  };
  fs.mkdirSync(path.dirname(userConfigPath()), { recursive: true });
  fs.writeFileSync(userConfigPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function cliPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'scribestudio.mjs');
  }
  return path.join(app.getAppPath(), 'bin', 'scribestudio.mjs');
}

function cliWorkingDirectory() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function redact(line) {
  return String(line)
    .replace(/(VOLCENGINE_ACCESS_TOKEN=)[^\s]+/g, '$1[redacted]')
    .replace(/(VOLCENGINE_API_KEY=)[^\s]+/g, '$1[redacted]')
    .replace(/(X-Api-Access-Key[:=]\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/(Access Token[:：]\s*)[^\s]+/gi, '$1[redacted]');
}

function buildCliArgs(payload) {
  const args = [];
  if (payload.url) {
    args.push('--url', payload.url);
  } else if (payload.inputPath) {
    args.push(payload.inputPath);
  } else {
    throw new Error('请选择本地音视频文件，或者填写远程音频 URL。');
  }

  args.push('--mode', payload.mode || 'flash');
  args.push('--formats', (payload.formats && payload.formats.length ? payload.formats : ['txt', 'srt', 'json']).join(','));
  args.push('--out-dir', payload.outputDir || path.join(app.getPath('documents'), DEFAULT_OUTPUT_DIR_NAME));

  if (payload.basename) args.push('--basename', payload.basename);
  if (payload.language) args.push('--language', payload.language);
  if (payload.context) args.push('--context', payload.context);
  if (payload.resourceId) args.push('--resource-id', payload.resourceId);
  if (payload.speaker) args.push('--speaker');
  if (payload.ddc) args.push('--ddc');

  return args;
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function parseWrittenFiles(stdout) {
  const files = [];
  let inFiles = false;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (line.trim() === '文件:') {
      inFiles = true;
      continue;
    }
    if (!inFiles) continue;
    const match = line.match(/^-\s+(.+)$/);
    if (match && fs.existsSync(match[1])) files.push(match[1]);
    else if (line.trim()) inFiles = false;
  }
  return files;
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function hydrateTranscript(files) {
  const byExt = new Map(files.map((file) => [path.basename(file), file]));
  const jsonFile = files.find((file) => file.endsWith('.asr.json'));
  const txtFile = files.find((file) => file.endsWith('.transcript.txt'));
  const mdFile = files.find((file) => file.endsWith('.transcript.md'));
  const srtFile = files.find((file) => file.endsWith('.srt'));
  const vttFile = files.find((file) => file.endsWith('.vtt'));
  let text = txtFile ? readTextFile(txtFile).trim() : '';
  let utterances = [];

  if (jsonFile) {
    try {
      const raw = JSON.parse(readTextFile(jsonFile));
      const result = raw.result && !Array.isArray(raw.result) ? raw.result : Array.isArray(raw.result) ? raw.result[0] || {} : raw;
      if (!text && typeof result.text === 'string') text = result.text;
      if (Array.isArray(result.utterances)) {
        utterances = result.utterances
          .filter((u) => Number.isFinite(Number(u.start_time)) && Number.isFinite(Number(u.end_time)) && u.text)
          .map((u) => ({
            start: Number(u.start_time),
            end: Math.max(Number(u.end_time), Number(u.start_time) + 1),
            text: String(u.text).trim(),
            speaker: u.speaker || u.speaker_id || u.user_id || ''
          }));
      }
    } catch {
      // Keep the UI usable even if a provider changes the raw JSON shape.
    }
  }

  return {
    files: files.map((file) => ({
      path: file,
      name: path.basename(file),
      kind: file.endsWith('.srt') ? 'SRT'
        : file.endsWith('.vtt') ? 'VTT'
          : file.endsWith('.asr.json') ? 'JSON'
            : file.endsWith('.md') ? 'MD'
              : 'TXT',
      size: fs.existsSync(file) ? fs.statSync(file).size : 0
    })),
    text,
    utterances,
    markdown: mdFile ? readTextFile(mdFile) : '',
    subtitles: {
      srt: srtFile ? byExt.get(path.basename(srtFile)) : '',
      vtt: vttFile ? byExt.get(path.basename(vttFile)) : ''
    }
  };
}

ipcMain.handle('dialog:choose-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频或视频文件',
    properties: ['openFile'],
    filters: [
      { name: 'Audio / Video', extensions: ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:choose-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_event, config) => saveConfig(config));

ipcMain.handle('path:open', async (_event, targetPath) => {
  if (!targetPath) return false;
  await shell.openPath(targetPath);
  return true;
});

ipcMain.handle('path:media-url', (_event, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return '';
  return pathToFileURL(targetPath).toString();
});

ipcMain.handle('transcribe:start', async (_event, payload) => {
  if (activeJob) throw new Error('已经有一个转写任务在运行。');

  const config = saveConfig(payload);
  const args = buildCliArgs(payload);
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    VOLCENGINE_API_KEY: config.apiKey || process.env.VOLCENGINE_API_KEY || '',
    VOLCENGINE_APP_ID: config.appId || process.env.VOLCENGINE_APP_ID || '',
    VOLCENGINE_ACCESS_TOKEN: config.accessToken || process.env.VOLCENGINE_ACCESS_TOKEN || ''
  };

  if (!env.VOLCENGINE_API_KEY && (!env.VOLCENGINE_APP_ID || !env.VOLCENGINE_ACCESS_TOKEN)) {
    throw new Error('请先填写 API Key，或者填写 App ID + Access Token。');
  }

  fs.mkdirSync(payload.outputDir || config.outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath(), ...args], {
      cwd: cliWorkingDirectory(),
      env,
      windowsHide: true
    });
    activeJob = child;
    emit('transcribe:state', { running: true });
    emit('transcribe:log', `ScribeStudio task started\n${args.map((x) => x.includes(' ') ? JSON.stringify(x) : x).join(' ')}\n\n`);

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk) => {
      const text = redact(chunk.toString());
      output += text;
      emit('transcribe:log', text);
    });

    child.stderr.on('data', (chunk) => {
      const text = redact(chunk.toString());
      errorOutput += text;
      emit('transcribe:log', text);
    });

    child.on('error', (error) => {
      activeJob = null;
      emit('transcribe:state', { running: false });
      reject(error);
    });

    child.on('close', (code) => {
      activeJob = null;
      emit('transcribe:state', { running: false });
      const success = code === 0;
      const written = success ? parseWrittenFiles(output) : [];
      const transcript = success ? hydrateTranscript(written) : null;
      const payloadResult = { success, code, output, errorOutput, outputDir: payload.outputDir || config.outputDir, written, transcript };
      emit('transcribe:done', payloadResult);
      if (success) resolve(payloadResult);
      else reject(new Error(`转写失败，退出码：${code}`));
    });
  });
});

ipcMain.handle('transcribe:cancel', () => {
  if (!activeJob) return false;
  activeJob.kill('SIGTERM');
  activeJob = null;
  emit('transcribe:state', { running: false });
  return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
