# 听稿

> 桌面端音视频转写工具。导入录音或视频，生成文稿、字幕和时间轴。

听稿面向创作者、播客作者、访谈整理、课程整理和会议记录场景。第一版接入火山引擎 / 豆包语音识别大模型，本地只做文件选择、音频准备和结果导出。

## 功能

- 桌面 GUI：拖拽导入、本地设置、运行日志、打开输出目录。
- 本地音频文件转写：WAV / MP3 / OGG。
- 本地视频文件抽音频：MP4 / MOV / MKV / WEBM 等，需要本机安装 `ffmpeg`。
- 远程音频 URL 转写：适合已上传的大文件。
- 输出 `.txt` 文稿。
- 输出 `.srt` / `.vtt` 字幕。
- 输出 `.json` 原始识别结果。
- 输出 `.md` 带时间轴的 Markdown 文稿。
- 支持标点、ITN 数字规整、语义顺滑、说话人分离开关。

## 桌面版

安装依赖：

```bash
npm install
```

启动：

```bash
npm run desktop
```

打包：

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

## 凭证

桌面版会把凭证保存在系统用户数据目录，不会写进 Git 仓库。

如果控制台给的是 App ID + Access Token：

```dotenv
VOLCENGINE_APP_ID=your_app_id_here
VOLCENGINE_ACCESS_TOKEN=your_access_token_here
```

如果新版控制台只给 API Key / App Key：

```dotenv
VOLCENGINE_API_KEY=your_api_key_or_app_key_here
```

CLI 也支持读取项目根目录的 `.env`。

## CLI

桌面版背后复用同一个 CLI 引擎，方便调试和自动化。

```bash
node ./bin/tinggao.mjs ./meeting.mp4 --language zh-CN --formats txt,srt,vtt,json,md
```

远程音频 URL：

```bash
node ./bin/tinggao.mjs --url https://example.com/audio.mp3 --mode standard --formats txt,srt,json
```

参数：

```text
tinggao <audio-or-video-file> [options]
tinggao --url <audio-url> [options]

--mode <flash|standard>     flash = 一次请求，本地文件可用；standard = URL 异步任务
--formats <list>            txt,srt,vtt,json,md，默认 txt,srt,json
--out-dir <dir>             输出目录，默认 ./output
--basename <name>           输出文件名前缀
--language <code>           语言代码，例如 zh-CN、en-US、ja-JP
--context <text>            上下文提示，例如人名、术语、场景
--speaker                   开启说话人分离
--no-itn                    关闭数字规整
--no-punc                   关闭标点
--ddc                       开启语义顺滑 / 口水词清理
--resource-id <id>          覆盖资源 ID
--poll-interval <seconds>   standard 模式轮询间隔，默认 3 秒
--timeout <seconds>         standard 模式超时，默认 1800 秒
```

## 模式

### 极速模式

适合 2 小时以内、100MB 以内的本地音频 / 视频。听稿会把本地文件准备成音频后提交到极速版接口。

默认资源 ID：

```text
volc.bigasr.auc_turbo
```

### 标准模式

适合更长音频。标准版支持音频 URL 提交，然后通过任务 ID 查询结果。本项目当前不内置对象存储上传，所以 standard 模式暂时要求你传 `--url`。

默认资源 ID：

```text
volc.seedasr.auc
```

## 路线图

- [ ] 任务记录：保留历史转写项目。
- [ ] 字幕预览：时间轴、分段、合并 / 拆分。
- [ ] 批量转写：整个文件夹排队处理。
- [ ] 术语表：人名、品牌名、专业词提升准确率。
- [ ] 多 provider：火山、OpenAI、阿里云、腾讯云等后端可插拔。
- [ ] 对象存储集成：大文件自动上传后走标准模式。

## 官方文档

- [火山引擎：豆包语音识别大模型产品简介](https://www.volcengine.com/docs/6561/1354871)
- [火山引擎：大模型录音文件极速版识别 API](https://www.volcengine.com/docs/6561/1631584)
- [火山引擎：大模型录音文件标准版 API](https://www.volcengine.com/docs/6561/1354868)
- [火山引擎：大模型流式语音识别 API](https://www.volcengine.com/docs/6561/1354869)

## License

MIT
