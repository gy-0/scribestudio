# ScribeStudio Product Brief

## One Sentence

ScribeStudio is a desktop media transcription studio: import local media or paste a source URL, extract audio, transcribe speech, generate captions, and review everything in one workspace.

## Name

Final name: **ScribeStudio**.

Why it fits:

- "Scribe" points to transcription without binding the product to Whisper, Doubao, or any single model.
- "Studio" matches the intended workflow: media preview, caption generation, transcript review, exports, and future URL ingestion.
- The name can grow from a local transcription utility into a broader media-to-text workbench.
- Repo name: `scribestudio`.

## Target Users

1. Video creators who need SRT / VTT captions from source footage.
2. Podcast creators who need editable transcripts from episodes.
3. Interviewers and researchers who need searchable, timestamped transcripts.
4. Course and meeting users who need reusable notes from recordings.

## Product Principles

- The first screen should be the real workspace, not a marketing page.
- Source, preview, transcript, captions, and exports should feel connected.
- Use high-quality audio preparation by default; do not degrade audio unless required by provider limits.
- Keep provider/model details in settings and logs rather than the primary workflow.
- Make the default path reliable: Chinese language hint, flash mode, and common export formats.
- Credentials are necessary configuration, but they should not dominate the main interface.

## MVP Scope

- Desktop GUI first.
- CLI engine retained for automation and debugging.
- Local files use flash mode.
- Remote audio URLs use standard mode.
- Export text, SRT, VTT, Markdown, and raw JSON.
- Preview local audio/video and hydrate transcription results into the app.

## Expansion Direction

- Paste URLs from video sites, podcast pages, and hosted media.
- Download web media, extract original audio, and generate subtitles/transcripts.
- Caption review inside the video player.
- Project history and batch workflows.
