# 🎵 Seeky Playback

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey?style=flat-square)
![Stars](https://img.shields.io/github/stars/tarun922/seeky.play.api?style=flat-square&color=ffd700)

> **A terminal music player that actually respects your time.**  
> Search YouTube. Stream instantly. Download MP3s. Resolve Spotify links. All without leaving your terminal.

A Node.js CLI for terminal dwellers tired of opening a browser just to listen to music. `youtube cli linux` · `terminal music player nodejs` · `mp3 downloader command line` · `spotify to youtube cli` · `yt-dlp nodejs`

---

## Why this exists

I got tired of switching apps just to listen to music. Every time I wanted a song — open a browser, sign in, deal with ads, watch autoplaying videos, get distracted by recommendations. The whole ritual was exhausting.

I live in the terminal. So I built Seeky — a music player that lives there too. The best part is **smart prefetching**: the moment you pick a song from search results, Seeky starts resolving the stream URL in the background. By the time you hit play, it's already ready. *Instant. No lag. No wait. Just music.*

And there's a **real terminal visualizer** built on a Cooley-Tukey FFT — not a fake animation. Actual frequency analysis of the audio, rendered in Unicode block characters at 50fps.

---

## Features

| Feature | Description |
|---|---|
| 🔎 **YouTube Search** | Search via YouTube Data API v3 — results show title, channel, duration, view count |
| ⚡ **Smart Prefetch** | Stream URLs extracted in background the moment you browse results — play is instant |
| ▶ **Stream via mpv** | Direct CDN URL handed to mpv, no browser overhead, pure audio in your terminal |
| ↓ **MP3 Downloads** | yt-dlp extracts best audio and saves as MP3 to `~/Music/MusiCLI` |
| 📋 **Playlist Download** | Paste a YouTube playlist URL, download every track as MP3 in one go |
| 🟢 **Spotify Resolution** | Paste any Spotify song or playlist link — resolved to YouTube automatically via play-dl |
| ≋ **Terminal Visualizer** | Real-time FFT, Hann windowing, log-spaced frequency bands, 50fps Unicode block bars |
| 🎛 **cava Support** | If `cava` is installed, uses it for perfectly synced visualizer from PipeWire/PulseAudio |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/tarun922/seeky.play.api
cd seeky.play.api
```

### 2. Install mpv (the only system dependency)

```bash
# Ubuntu / Debian
sudo apt install mpv

# macOS
brew install mpv

# Fedora
sudo dnf install mpv
```

Seeky hands the audio CDN URL directly to mpv for playback. This is the only reliable approach — piping extracted URLs through a separate process causes 403 errors because YouTube signs stream tokens to a specific HTTP session.

### 3. Install Node dependencies

Requires **Node.js 18+**.

```bash
npm install
```

Installs: `yt-dlp-exec`, `play-dl`, `chalk`, `inquirer`, `ora`, `cli-table3`, `figures`

### 4. Add your YouTube API key

Edit `src/config.js`:

```js
export const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_DATA_API_V3_KEY';
```

Get a free key at [Google Cloud Console](https://console.cloud.google.com/) → Enable YouTube Data API v3.

### 5. Run it

```bash
node index.js
```

### Optional: visualizer extras

For the terminal visualizer, install `ffmpeg`:

```bash
sudo apt install ffmpeg     # Ubuntu/Debian
brew install ffmpeg         # macOS
```

For the **best** visualizer experience (perfectly synced to audio output via PipeWire/PulseAudio):

```bash
sudo apt install cava       # Ubuntu/Debian
sudo dnf install cava       # Fedora
```

---

## Project Structure

```
index.js            ← Interactive CLI entry point (menus, prompts, stream/download logic)
src/
  config.js         ← YouTube API key + shared constants
  search.js         ← YouTube Data API v3 search
  player.js         ← mpv/vlc/ffplay streaming handler
  downloader.js     ← yt-dlp-exec MP3 + playlist downloads
  spotify.js        ← play-dl Spotify song/playlist resolution
  streamCache.js    ← Background prefetch system (stream URL extraction + caching)
  visualizer.js     ← FFT-based terminal visualizer (Cooley-Tukey, Hann window, Unicode blocks)
```

---

## How the Visualizer Works

The visualizer runs a three-stage signal processing pipeline:

```
CDN URL → FFmpeg (raw PCM) → Cooley-Tukey FFT → Log frequency bands → Unicode terminal
```

**Stage 1 — FFmpeg decodes the audio**  
The CDN URL contains compressed audio (opus or aac). FFmpeg decodes it to raw PCM: signed 16-bit integers at 8000 Hz mono. We use 8000 Hz because it gives enough frequency resolution for the FFT without burning CPU — CD quality (44100 Hz) would be overkill.

**Stage 2 — Hann windowing + FFT**  
Each frame applies a Hann window function before the FFT to eliminate spectral leakage (phantom frequencies from hard frame edges). Then a 1024-point Cooley-Tukey FFT converts the time-domain PCM into frequency bins. Time complexity: O(N log N).

**Stage 3 — Log-spaced bands → terminal bars**  
Human hearing is logarithmic, so FFT bins are mapped to ~24 display bands using logarithmic spacing. Bar heights use exponential smoothing with fast attack / slow decay for a punchy feel. Unicode block characters (`▁▂▃▄▅▆▇█`) give sub-character height precision. Everything renders at 50fps in a single `process.stdout.write()` call to prevent flickering.

mpv plays the actual audio separately. FFmpeg re-decodes the same URL independently at lower quality just for analysis. They run in parallel — the visualizer trails audio by ~0.1–0.5s at most, imperceptible in practice.

---

## How Prefetching Works

`src/streamCache.js` maintains a session-scoped cache of extracted stream URLs:

- **On number pick**: `streamCache.prefetch(videoId, url)` fires immediately in the background
- **On stream action**: `streamCache.getStreamUrl(videoId, url)` either returns instantly (if already ready) or awaits the in-flight Promise
- **Cache states**: `idle` → `pending` → `ready` or `error`

The results table shows `⚡` next to tracks with cached URLs and `⟳` next to tracks currently extracting. Cache is cleared between search sessions.

---

## Dependencies

| Package | Purpose |
|---|---|
| `yt-dlp-exec` | Stream URL extraction and MP3 downloads |
| `play-dl` | Spotify link resolution |
| `chalk` | Terminal colors |
| `inquirer` | Interactive menus |
| `ora` | Loading spinners |
| `cli-table3` | Search results table |

**System**: `mpv` (required), `ffmpeg` (visualizer), `cava` (optional, best visualizer)

---

## License

MIT — do whatever you want with it.
