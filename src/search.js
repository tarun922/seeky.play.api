// search.js — YouTube search via the Data API v3.
//
// We use Node's built-in `https` module for HTTP requests instead of
// the global `fetch()`. This is important for compatibility — `fetch`
// was only added as a Node.js global in v18, so on v16 and earlier it
// throws "fetch failed" or "fetch is not defined". The `https` module
// has been available since Node v0.3, so this works everywhere.

import https from 'https';
import { API_KEY, YT_BASE, DEFAULT_RESULTS } from './config.js';

// ── Simple HTTPS GET helper ───────────────────────────────────────────────────
// Returns a Promise that resolves to the parsed JSON body.
// This replaces every `fetch(url).then(r => r.json())` call.

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

// ── Formatting helpers ────────────────────────────────────────────────────────

// YouTube returns durations as ISO 8601 like "PT4M31S" → we want "4:31"
function parseDuration(iso) {
  if (!iso) return '—';
  const h = Number((iso.match(/(\d+)H/) || [0, 0])[1]);
  const m = Number((iso.match(/(\d+)M/) || [0, 0])[1]);
  const s = Number((iso.match(/(\d+)S/) || [0, 0])[1]);
  const total = h * 3600 + m * 60 + s;
  const mm = Math.floor(total / 60), ss = total % 60;
  const hh = Math.floor(mm / 60),   rem = mm % 60;
  if (hh) return `${hh}:${String(rem).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${mm}:${String(ss).padStart(2,'0')}`;
}

export function isoToSeconds(iso) {
  if (!iso) return null;
  const h = Number((iso.match(/(\d+)H/) || [0, 0])[1]);
  const m = Number((iso.match(/(\d+)M/) || [0, 0])[1]);
  const s = Number((iso.match(/(\d+)S/) || [0, 0])[1]);
  return h * 3600 + m * 60 + s;
}

function fmtViews(n) {
  if (!n) return '—';
  n = Number(n);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

// ── Core search function ──────────────────────────────────────────────────────

export async function searchYouTube(query, maxResults = DEFAULT_RESULTS) {
  // Call 1: search endpoint — returns video IDs + snippet metadata.
  // videoCategoryId=10 filters to Music category, as in your original search.js
  const searchParams = new URLSearchParams({
    part:            'snippet',
    type:            'video',
    videoCategoryId: '10',
    maxResults,
    q:               query,
    key:             API_KEY,
  });

  const searchData = await httpsGet(`${YT_BASE}/search?${searchParams}`);
  if (searchData.error) throw new Error(searchData.error.message);

  const items = searchData.items || [];
  if (!items.length) return [];

  const results = items
    .filter(item => item.id?.videoId)
    .map(item => ({
      id:          item.id.videoId,
      title:       item.snippet.title,
      channel:     item.snippet.channelTitle,
      url:         `https://www.youtube.com/watch?v=${item.id.videoId}`,
      thumbnail:   item.snippet.thumbnails?.high?.url || '',
      publishedAt: item.snippet.publishedAt,
      duration:    null,
      durationStr: '—',
      views:       null,
      viewsStr:    '—',
    }));

  const ids = results.map(r => r.id).join(',');

  // Call 2: videos endpoint — get duration + view count for all results
  // in a single batched request (one API call, not one per video)
  const detailParams = new URLSearchParams({
    part: 'contentDetails,statistics',
    id:   ids,
    key:  API_KEY,
  });

  const detailData = await httpsGet(`${YT_BASE}/videos?${detailParams}`);

  const detailMap = {};
  for (const v of (detailData.items || [])) detailMap[v.id] = v;

  for (const r of results) {
    const d = detailMap[r.id];
    if (!d) continue;
    const iso = d.contentDetails?.duration;
    const vc  = d.statistics?.viewCount;
    r.duration    = isoToSeconds(iso);
    r.durationStr = parseDuration(iso);
    r.views       = vc ? Number(vc) : null;
    r.viewsStr    = fmtViews(vc);
  }

  return results;
}
