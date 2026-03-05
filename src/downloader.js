// downloader.js — Download audio as MP3 using yt-dlp-exec.
// Based on your download.js and d.js files, merged and cleaned up.
// Uses yt-dlp-exec (the newer, actively maintained package) rather
// than youtube-dl-exec for reliability.

import ytDlp from 'yt-dlp-exec';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { DOWNLOAD_DIR } from './config.js';

// Same https helper as search.js — avoids depending on global fetch (Node < v18)
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Strip characters that are illegal in filenames on all platforms
function sanitize(name) {
  return name.replace(/[\\/*?:"<>|]/g, '').trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Core download function ────────────────────────────────────────────────────

export async function downloadMp3(url, title, destDir = DOWNLOAD_DIR) {
  ensureDir(destDir);

  const safeTitle    = sanitize(title);
  const outputTemplate = path.join(destDir, '%(title)s.%(ext)s');

  // We use yt-dlp-exec (your download.js package) with extractAudio + mp3
  // so the result is always a clean MP3 regardless of the source format.
  // audioQuality: '0' means best quality (VBR 0 = ~245kbps average).
  await ytDlp(url, {
    extractAudio:     true,
    audioFormat:      'mp3',
    audioQuality:     '0',
    output:           outputTemplate,
    noCheckCertificates: true,
    addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
  });

  return path.join(destDir, `${safeTitle}.mp3`);
}

// ── Playlist download (from your playlist.js) ─────────────────────────────────

export async function downloadPlaylist(playlistId, destDir = DOWNLOAD_DIR) {
  ensureDir(destDir);

  const { API_KEY, YT_BASE } = await import('./config.js');
  const params = new URLSearchParams({
    part:       'snippet',
    maxResults: '50',
    playlistId,
    key:        API_KEY,
  });

  const res  = await httpsGet(`${YT_BASE}/playlistItems?${params}`);
  if (data.error) throw new Error(data.error.message);

  const items = data.items || [];
  const results = [];

  for (const item of items) {
    const videoId = item.snippet.resourceId.videoId;
    const title   = item.snippet.title;
    const url     = `https://www.youtube.com/watch?v=${videoId}`;

    process.stderr.write(`  Downloading: ${title.substring(0, 50)}...\r`);
    try {
      const saved = await downloadMp3(url, title, destDir);
      results.push({ title, url, saved, ok: true });
    } catch (err) {
      results.push({ title, url, ok: false, error: err.message });
    }
  }

  return results;
}
