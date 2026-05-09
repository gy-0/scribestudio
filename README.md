# ScribeStudio

> A desktop media transcription studio for turning audio, video, and web media into transcripts, captions, and reviewable timelines.

ScribeStudio is built for creators, podcasters, interviewers, course makers, and anyone who needs to move from media to usable text quickly. The first release focuses on local audio/video files and Volcengine / Doubao Speech ASR, with a desktop workbench for previewing media, running transcription, and exporting results.

## Features

- Desktop workbench for local audio and video transcription.
- Built-in media preview for reviewing source files alongside transcript results.
- Local audio support: WAV / MP3 / OGG.
- Local video support: MP4 / MOV / MKV / WEBM and more through `ffmpeg`.
- High-quality audio preparation: video and unsupported audio formats are extracted to WAV first, preserving sample rate and channels when the flash API size limit allows it.
- Remote audio URL transcription for already hosted media.
- Export transcript text, SRT, VTT, provider JSON, and Markdown with timeline segments.
- Optional punctuation, ITN number normalization, semantic smoothing, context hints, and speaker clustering.

## Desktop App

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run desktop
```

Build release packages:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

## Credentials

The desktop app stores credentials in the system user data directory, not in this repository.

If the console provides App ID + Access Token:

```dotenv
VOLCENGINE_APP_ID=your_app_id_here
VOLCENGINE_ACCESS_TOKEN=your_access_token_here
```

If the newer console provides an API Key / App Key:

```dotenv
VOLCENGINE_API_KEY=your_api_key_or_app_key_here
```

The CLI also reads `.env` from the project root.

## CLI

The desktop app uses the same CLI engine, which is useful for debugging and automation.

```bash
node ./bin/scribestudio.mjs ./meeting.mp4 --language zh-CN --formats txt,srt,vtt,json,md
```

Remote audio URL:

```bash
node ./bin/scribestudio.mjs --url https://example.com/audio.mp3 --mode standard --formats txt,srt,json
```

Options:

```text
scribestudio <audio-or-video-file> [options]
scribestudio --url <audio-url> [options]

--mode <flash|standard>     flash = one request, local files supported; standard = async URL jobs
--formats <list>            txt,srt,vtt,json,md, default txt,srt,json
--out-dir <dir>             output directory, default ./output
--basename <name>           output filename prefix
--language <code>           language code, e.g. zh-CN, en-US, ja-JP
--context <text>            context hints for names, terms, or scene background
--speaker                   enable speaker clustering
--no-itn                    disable inverse text normalization
--no-punc                   disable punctuation
--ddc                       enable semantic smoothing / filler cleanup
--resource-id <id>          override Volcengine resource id
--poll-interval <seconds>   standard mode polling interval, default 3 seconds
--timeout <seconds>         standard mode timeout, default 1800 seconds
```

## Modes

### Flash Mode

Best for local audio/video under the provider flash API limits. ScribeStudio prepares local media as audio and submits it to the flash endpoint.

Default resource ID:

```text
volc.bigasr.auc_turbo
```

### Standard Mode

Best for longer hosted audio. The standard endpoint accepts an audio URL and returns results through polling. ScribeStudio does not yet include object-storage upload, so standard mode currently requires `--url`.

Default resource ID:

```text
volc.seedasr.auc
```

## Roadmap

- [ ] Project history for previous transcription jobs.
- [ ] In-app caption timeline editing, merging, and splitting.
- [ ] URL ingestion for video sites, podcasts, and hosted media.
- [ ] One-click audio extraction from downloaded web media.
- [ ] Batch transcription for folders.
- [ ] Glossaries for names, brands, and specialized terms.
- [ ] Pluggable ASR providers.
- [ ] Object-storage integration for large local files.

## Official Docs

- [Volcengine: Doubao Speech Recognition Model](https://www.volcengine.com/docs/6561/1354871)
- [Volcengine: Big Model Recording File Flash API](https://www.volcengine.com/docs/6561/1631584)
- [Volcengine: Big Model Recording File Standard API](https://www.volcengine.com/docs/6561/1354868)
- [Volcengine: Big Model Streaming Speech Recognition API](https://www.volcengine.com/docs/6561/1354869)

## License

MIT
