# Viet Dubber

Tự động download video Trung Quốc (Bilibili / Douyin / Weibo) → thuyết minh tiếng Việt bằng AI → xuất file video.

## Pipeline

```
URL (Bilibili / Douyin / Weibo)
  │
  ▼ [downloader]  yt-dlp
  Video file (.mp4)
  │
  ▼ [transcriber] OpenAI Whisper API
  Transcript tiếng Trung (SRT / JSON)
  │
  ▼ [translator]  OpenAI GPT-4o
  Script tiếng Việt (đã dịch + chỉnh nhịp)
  │
  ▼ [tts]         edge-tts (vi-VN-HoaiMyNeural)
  Audio thuyết minh tiếng Việt (.mp3)
  │
  ▼ [processor]   FFmpeg
  Video gốc (mute) + audio TTS ghép lại
  │
  Output: video_vi.mp4
```

## Cài đặt

### 1. Prerequisites

```bash
# yt-dlp
pip install yt-dlp

# ffmpeg (Windows)
winget install ffmpeg

# edge-tts
pip install edge-tts
```

### 2. Project

```bash
pnpm install
cp .env.example .env
# Điền OPENAI_API_KEY
```

### 3. Chạy

```bash
# Dub một video
pnpm dub -- --url "https://www.bilibili.com/video/BV1xx..."

# Có thêm options
pnpm dub -- --url "..." --voice vi-VN-NamMinhNeural --output ./output
```

## Cấu trúc

```
packages/
  downloader/   yt-dlp wrapper
  transcriber/  Whisper API
  translator/   GPT-4o translate
  tts/          edge-tts wrapper
  processor/    FFmpeg audio replace
  pipeline/     CLI orchestrator
```

## Voices

| Voice | Giới tính | Chất lượng |
|---|---|---|
| `vi-VN-HoaiMyNeural` | Nữ | ⭐⭐⭐⭐⭐ (mặc định) |
| `vi-VN-NamMinhNeural` | Nam | ⭐⭐⭐⭐⭐ |

## Environment Variables

| Biến | Mô tả |
|---|---|
| `OPENAI_API_KEY` | Required — Whisper + GPT |
| `OPENAI_BASE_URL` | Optional — custom endpoint |
| `OUTPUT_DIR` | Thư mục lưu output (default: `./output`) |
| `WORK_DIR` | Thư mục làm việc tạm (default: `./tmp`) |
| `TTS_VOICE` | edge-tts voice (default: `vi-VN-HoaiMyNeural`) |
| `TTS_RATE` | Tốc độ đọc, ví dụ `+0%`, `-10%` |
| `WHISPER_MODEL` | `whisper-1` (default) |
| `GPT_MODEL` | `gpt-4o` (default) |
