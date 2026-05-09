#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import crypto from 'node:crypto';

const FLASH_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const STANDARD_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const STANDARD_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const STATUS_OK = '20000000';
const STATUS_PROCESSING = new Set(['20000001', '20000002']);
const FLASH_LIMIT_BYTES = 100 * 1024 * 1024;
const ACCEPTED_AUDIO = new Set(['.wav', '.mp3', '.ogg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.flv']);

function printHelp() {
  console.log(`
ScribeStudio — media transcription and caption studio.

Usage:
  scribestudio <audio-or-video-file> [options]
  scribestudio --url <audio-url> [options]

Examples:
  scribestudio ./meeting.mp4 --formats txt,srt,vtt,json
  scribestudio ./voice.mp3 --language zh-CN --out-dir ./output
  scribestudio --url https://example.com/audio.mp3 --mode standard --speaker

Options:
  --url <url>                 Transcribe a remote audio URL instead of a local file.
  --mode <flash|standard>     flash = one request, local files supported; standard = async URL jobs. Default: flash.
  --formats <list>            Output formats: txt,srt,vtt,json,md. Default: txt,srt,json.
  --out-dir <dir>             Output directory. Default: ./output.
  --basename <name>           Output base filename. Default: input filename or task id.
  --language <code>           Optional language code, e.g. zh-CN, en-US, ja-JP.
  --context <text>            Optional context hint for names, terms, speaker background, etc.
  --speaker                   Enable speaker clustering when the selected endpoint supports it.
  --no-itn                    Disable inverse text normalization.
  --no-punc                   Disable punctuation.
  --ddc                       Enable semantic smoothing / filler cleanup.
  --resource-id <id>          Override Volcengine resource id.
  --poll-interval <seconds>   Standard mode polling interval. Default: 3.
  --timeout <seconds>         Standard mode timeout. Default: 1800.
  -h, --help                  Show this help.

Credentials:
  Put VOLCENGINE_API_KEY in .env for new-console accounts, or set VOLCENGINE_APP_ID
  and VOLCENGINE_ACCESS_TOKEN for App ID / Access Token accounts.
`);
}

function fail(message, code = 1) {
  console.error(`\nError: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    input: undefined,
    url: undefined,
    mode: 'flash',
    formats: ['txt', 'srt', 'json'],
    outDir: 'output',
    basename: undefined,
    language: undefined,
    context: undefined,
    speaker: false,
    itn: true,
    punc: true,
    ddc: false,
    resourceId: undefined,
    pollInterval: 3,
    timeout: 1800,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) fail(`Missing value for ${token}`);
      return argv[i];
    };

    if (token === '-h' || token === '--help') args.help = true;
    else if (token === '--url') args.url = next();
    else if (token === '--mode') args.mode = next();
    else if (token === '--formats' || token === '--format') args.formats = next().split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    else if (token === '--out-dir') args.outDir = next();
    else if (token === '--basename') args.basename = next();
    else if (token === '--language') args.language = next();
    else if (token === '--context') args.context = next();
    else if (token === '--speaker') args.speaker = true;
    else if (token === '--no-itn') args.itn = false;
    else if (token === '--no-punc') args.punc = false;
    else if (token === '--ddc') args.ddc = true;
    else if (token === '--resource-id') args.resourceId = next();
    else if (token === '--poll-interval') args.pollInterval = Number(next());
    else if (token === '--timeout') args.timeout = Number(next());
    else if (token.startsWith('--')) fail(`Unknown option: ${token}`);
    else if (!args.input) args.input = token;
    else fail(`Unexpected extra argument: ${token}`);
  }

  if (!['flash', 'standard'].includes(args.mode)) fail('--mode must be flash or standard');
  const allowedFormats = new Set(['txt', 'srt', 'vtt', 'json', 'md']);
  for (const fmt of args.formats) {
    if (!allowedFormats.has(fmt)) fail(`Unsupported output format: ${fmt}`);
  }
  if (!Number.isFinite(args.pollInterval) || args.pollInterval <= 0) fail('--poll-interval must be a positive number');
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) fail('--timeout must be a positive number');
  return args;
}

function loadDotEnv(startDir = process.cwd()) {
  const envPath = join(startDir, '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value.replace(/^['"]|['"]$/g, '');
  }
}

function credentialHeaders(resourceId, requestId) {
  const apiKey = process.env.VOLCENGINE_API_KEY || process.env.DOUBAO_API_KEY;
  const appKey = process.env.VOLCENGINE_APP_ID || process.env.VOLCENGINE_APP_KEY || process.env.DOUBAO_APP_ID || process.env.DOUBAO_APP_KEY;
  const accessKey = process.env.VOLCENGINE_ACCESS_TOKEN || process.env.VOLCENGINE_ACCESS_KEY || process.env.DOUBAO_ACCESS_TOKEN || process.env.DOUBAO_ACCESS_KEY;

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1'
  };

  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
    return { headers, uid: apiKey.slice(0, 16) };
  }
  if (appKey && accessKey) {
    headers['X-Api-App-Key'] = appKey;
    headers['X-Api-Access-Key'] = accessKey;
    return { headers, uid: appKey };
  }

  fail('Missing credentials. Set VOLCENGINE_API_KEY for new-console accounts, or set VOLCENGINE_APP_ID + VOLCENGINE_ACCESS_TOKEN for App ID / Access Token accounts.');
}

function inferAudioFormat(pathOrUrl) {
  const clean = String(pathOrUrl).split('?')[0].split('#')[0].toLowerCase();
  const ext = extname(clean).replace('.', '');
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg') return ext;
  if (ext === 'opus') return 'ogg';
  if (ext === 'm4a' || ext === 'aac') return 'mp3';
  return undefined;
}

function hasFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

function runFfmpeg(args, purpose) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`${purpose} failed:\n${result.stderr || result.stdout || 'unknown error'}`);
  }
}

function prepareWithFfmpeg(absolute, ext) {
  const tmpDir = join(process.cwd(), '.scribestudio-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const base = `${basename(absolute, ext)}-${Date.now()}`;
  const wavOut = join(tmpDir, `${base}.wav`);

  console.log(`正在用 ffmpeg 无损提取音频: ${absolute} -> ${wavOut}`);
  runFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', absolute,
    '-vn',
    '-c:a', 'pcm_s16le',
    wavOut
  ], 'ffmpeg lossless audio extraction');

  const wavSize = statSync(wavOut).size;
  if (wavSize <= FLASH_LIMIT_BYTES) {
    return { path: wavOut, format: 'wav', temp: true };
  }

  const mp3Out = join(tmpDir, `${base}.mp3`);
  console.log(`无损 WAV 超过极速版 100MB 限制，改用高质量 MP3: ${wavOut} -> ${mp3Out}`);
  runFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', absolute,
    '-vn',
    '-codec:a', 'libmp3lame',
    '-q:a', '0',
    mp3Out
  ], 'ffmpeg high quality MP3 conversion');

  const mp3Size = statSync(mp3Out).size;
  if (mp3Size > FLASH_LIMIT_BYTES) {
    fail(`Converted MP3 is still over 100MB (${Math.round(mp3Size / 1024 / 1024)}MB). Use --mode standard with a public/object-storage URL.`);
  }
  return { path: mp3Out, format: 'mp3', temp: true };
}

function prepareLocalInput(inputPath) {
  const absolute = resolve(inputPath);
  if (!existsSync(absolute)) fail(`Input file not found: ${absolute}`);

  const ext = extname(absolute).toLowerCase();
  const size = statSync(absolute).size;

  if (ACCEPTED_AUDIO.has(ext) && size <= FLASH_LIMIT_BYTES) {
    return { path: absolute, format: inferAudioFormat(absolute), temp: false };
  }

  if (!hasFfmpeg()) {
    if (VIDEO_EXTENSIONS.has(ext)) {
      fail('Video input requires ffmpeg. Install ffmpeg, or extract audio manually to WAV/MP3/OGG.');
    }
    if (size > FLASH_LIMIT_BYTES) {
      fail('Local file is over 100MB for flash mode. Install ffmpeg so ScribeStudio can compress it, or use --mode standard with --url.');
    }
    fail(`Unsupported local format: ${ext}. Use WAV/MP3/OGG, or install ffmpeg for conversion.`);
  }

  return prepareWithFfmpeg(absolute, ext);
}

function buildRequest({ uid, audio, args }) {
  const request = {
    user: { uid },
    audio,
    request: {
      model_name: 'bigmodel',
      enable_itn: args.itn,
      enable_punc: args.punc,
      enable_ddc: args.ddc,
      enable_speaker_info: args.speaker,
      show_utterances: true
    }
  };

  if (args.language) request.audio.language = args.language;
  if (args.context) {
    request.request.context = {
      context_type: 'dialog_ctx',
      context_data: [{ text: args.context }]
    };
  }

  return request;
}

async function postJson(url, body, headers) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  let json = null;
  const text = await response.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { response, json };
}

function statusFrom(response) {
  return response.headers.get('X-Api-Status-Code') || response.headers.get('x-api-status-code') || '';
}

function messageFrom(response) {
  return response.headers.get('X-Api-Message') || response.headers.get('x-api-message') || '';
}

function logIdFrom(response) {
  return response.headers.get('X-Tt-Logid') || response.headers.get('x-tt-logid') || '';
}

async function recognizeFlash(args) {
  const requestId = crypto.randomUUID();
  const resourceId = args.resourceId || process.env.VOLCENGINE_RESOURCE_ID || 'volc.bigasr.auc_turbo';
  const { headers, uid } = credentialHeaders(resourceId, requestId);
  let audio;

  if (args.url) {
    audio = { url: args.url };
    const format = inferAudioFormat(args.url);
    if (format) audio.format = format;
  } else {
    const prepared = prepareLocalInput(args.input);
    const data = readFileSync(prepared.path).toString('base64');
    audio = { data };
    if (prepared.format) audio.format = prepared.format;
  }

  const body = buildRequest({ uid, audio, args });
  console.log(`提交极速识别任务: request_id=${requestId}, resource_id=${resourceId}`);
  const { response, json } = await postJson(FLASH_URL, body, headers);
  const code = statusFrom(response);
  const message = messageFrom(response);
  const logId = logIdFrom(response);

  if (code !== STATUS_OK) {
    fail(`ASR flash failed. status=${code || response.status}, message=${message || response.statusText}, logid=${logId}\n${JSON.stringify(json, null, 2)}`);
  }

  return { requestId, logId, raw: json };
}

async function recognizeStandard(args) {
  if (!args.url) fail('Standard mode currently requires --url because the official async API accepts an audio URL. For local files, use flash mode or upload to object storage first.');

  const requestId = crypto.randomUUID();
  const resourceId = args.resourceId || process.env.VOLCENGINE_RESOURCE_ID || 'volc.seedasr.auc';
  const { headers, uid } = credentialHeaders(resourceId, requestId);
  const audio = { url: args.url };
  const format = inferAudioFormat(args.url);
  if (format) audio.format = format;

  const body = buildRequest({ uid, audio, args });
  console.log(`提交标准识别任务: request_id=${requestId}, resource_id=${resourceId}`);
  const submit = await postJson(STANDARD_SUBMIT_URL, body, headers);
  const submitCode = statusFrom(submit.response);
  const submitMessage = messageFrom(submit.response);
  const submitLogId = logIdFrom(submit.response);
  if (submitCode !== STATUS_OK) {
    fail(`ASR submit failed. status=${submitCode || submit.response.status}, message=${submitMessage || submit.response.statusText}, logid=${submitLogId}\n${JSON.stringify(submit.json, null, 2)}`);
  }

  const started = Date.now();
  while (Date.now() - started < args.timeout * 1000) {
    await sleep(args.pollInterval * 1000);
    const query = await postJson(STANDARD_QUERY_URL, {}, headers);
    const code = statusFrom(query.response);
    const message = messageFrom(query.response);
    const logId = logIdFrom(query.response);
    if (code === STATUS_OK) {
      return { requestId, logId, raw: query.json };
    }
    if (STATUS_PROCESSING.has(code)) {
      console.log(`Waiting: status=${code}, message=${message || 'processing'}`);
      continue;
    }
    fail(`ASR query failed. status=${code || query.response.status}, message=${message || query.response.statusText}, logid=${logId}\n${JSON.stringify(query.json, null, 2)}`);
  }
  fail(`Timed out after ${args.timeout}s waiting for standard recognition.`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function getResultObject(raw) {
  if (!raw) return {};
  if (raw.result && !Array.isArray(raw.result)) return raw.result;
  if (Array.isArray(raw.result)) return raw.result[0] || {};
  return raw;
}

function extractText(raw) {
  const result = getResultObject(raw);
  if (typeof result.text === 'string') return result.text;
  if (Array.isArray(result.utterances)) return result.utterances.map((u) => u.text).filter(Boolean).join('\n');
  return '';
}

function extractUtterances(raw) {
  const result = getResultObject(raw);
  if (!Array.isArray(result.utterances)) return [];
  return result.utterances
    .filter((u) => Number.isFinite(Number(u.start_time)) && Number.isFinite(Number(u.end_time)) && u.text)
    .map((u) => ({
      start: Number(u.start_time),
      end: Math.max(Number(u.end_time), Number(u.start_time) + 1),
      text: String(u.text).trim(),
      speaker: u.speaker || u.speaker_id || u.user_id || undefined
    }));
}

function formatSrtTime(ms) {
  const totalMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(millis).padStart(3, '0')}`;
}

function formatVttTime(ms) {
  return formatSrtTime(ms).replace(',', '.');
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function speakerPrefix(utterance) {
  return utterance.speaker !== undefined ? `Speaker ${utterance.speaker}: ` : '';
}

function toSrt(utterances, fallbackText) {
  if (!utterances.length) {
    return `1\n00:00:00,000 --> 00:00:01,000\n${fallbackText || ''}\n`;
  }
  return utterances.map((u, index) => [
    String(index + 1),
    `${formatSrtTime(u.start)} --> ${formatSrtTime(u.end)}`,
    `${speakerPrefix(u)}${u.text}`,
    ''
  ].join('\n')).join('\n');
}

function toVtt(utterances, fallbackText) {
  const body = utterances.length
    ? utterances.map((u) => [
        `${formatVttTime(u.start)} --> ${formatVttTime(u.end)}`,
        `${speakerPrefix(u)}${u.text}`,
        ''
      ].join('\n')).join('\n')
    : `00:00:00.000 --> 00:00:01.000\n${fallbackText || ''}\n`;
  return `WEBVTT\n\n${body}`;
}

function toMarkdown({ text, utterances, source, requestId, logId }) {
  const lines = [
    '# Transcript',
    '',
    `- Source: ${source}`,
    `- Request ID: ${requestId}`,
    logId ? `- Log ID: ${logId}` : undefined,
    '',
    '## Full text',
    '',
    text || '',
    '',
    '## Segments',
    ''
  ].filter((x) => x !== undefined);

  if (!utterances.length) {
    lines.push('_No utterance timestamps returned._');
  } else {
    for (const u of utterances) {
      lines.push(`- \`${formatVttTime(u.start)} → ${formatVttTime(u.end)}\` ${speakerPrefix(u)}${u.text}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function outputBaseName(args, requestId) {
  if (args.basename) return safeName(args.basename);
  if (args.input) return safeName(basename(args.input, extname(args.input)));
  if (args.url) {
    const parsed = new URL(args.url);
    const urlBase = basename(parsed.pathname, extname(parsed.pathname));
    return safeName(urlBase || requestId);
  }
  return requestId;
}

function safeName(name) {
  return name.replace(/[^A-Za-z0-9._\-\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'transcript';
}

function writeOutputs({ args, result }) {
  const raw = result.raw;
  const text = extractText(raw);
  const utterances = extractUtterances(raw);
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const base = outputBaseName(args, result.requestId);
  const written = [];
  const source = args.input ? resolve(args.input) : args.url;

  for (const fmt of args.formats) {
    let path;
    let content;
    if (fmt === 'txt') {
      path = join(outDir, `${base}.transcript.txt`);
      content = `${text}\n`;
    } else if (fmt === 'srt') {
      path = join(outDir, `${base}.srt`);
      content = toSrt(utterances, text);
    } else if (fmt === 'vtt') {
      path = join(outDir, `${base}.vtt`);
      content = toVtt(utterances, text);
    } else if (fmt === 'json') {
      path = join(outDir, `${base}.asr.json`);
      content = JSON.stringify({ request_id: result.requestId, log_id: result.logId, source, ...raw }, null, 2);
    } else if (fmt === 'md') {
      path = join(outDir, `${base}.transcript.md`);
      content = toMarkdown({ text, utterances, source, requestId: result.requestId, logId: result.logId });
    }
    writeFileSync(path, content, 'utf8');
    written.push(path);
  }

  return { written, text, utterances };
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input && !args.url) {
    printHelp();
    fail('Provide a local file or --url.');
  }
  if (args.input && args.url) fail('Use either a local file or --url, not both.');

  const result = args.mode === 'flash'
    ? await recognizeFlash(args)
    : await recognizeStandard(args);
  const { written, text, utterances } = writeOutputs({ args, result });

  console.log('\n完成。');
  console.log(`字数: ${text.length}`);
  console.log(`分段: ${utterances.length}`);
  console.log('文件:');
  for (const file of written) console.log(`- ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
