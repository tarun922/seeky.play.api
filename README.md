# 🎵 MusiCLI (Node.js)

Interactive music CLI — search YouTube, stream, download MP3, handle playlists, resolve Spotify links.

## Quick start

```bash
npm install
node index.js
```

## Dependencies

```bash
npm install
```

Installs: `yt-dlp-exec`, `youtube-dl-exec`, `play-dl`, `chalk`, `inquirer`, `ora`, `cli-table3`

## System requirement: mpv (for streaming)

Streaming hands the YouTube URL directly to mpv, which has yt-dlp built in.
This is the only reliable way to play YouTube audio — extracting the CDN URL
separately and piping it causes 403 errors because YouTube signs its tokens
to a specific HTTP session.

```bash
sudo apt install mpv        # Fedora: sudo dnf install mpv
brew install mpv            # macOS
```

## Features

| Mode | What it does |
|---|---|
| 🔎 Search YouTube | YouTube Data API v3 search with duration + view counts |
| ▶ Stream | Direct YouTube URL → mpv (no window, terminal progress bar) |
| ↓ Download MP3 | yt-dlp-exec → best audio → MP3, saved to ~/Music/MusiCLI |
| 📋 Playlist | YouTube playlist → download all tracks as MP3 |
| 🟢 Spotify | Spotify song/playlist URL → resolve to YouTube → stream or download |

## Project structure

```
index.js          ← Interactive CLI (entry point)
src/
  config.js       ← API key + shared constants
  search.js       ← YouTube Data API v3 search
  player.js       ← mpv/vlc/ffplay streaming
  downloader.js   ← yt-dlp-exec MP3 + playlist downloads
  spotify.js      ← play-dl Spotify resolution
```
