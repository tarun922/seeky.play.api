// streamCache.js — Background stream URL extractor with prefetch queue.
//
// THE CORE IDEA
// -------------
// The moment the user picks a number from the results list, we want to
// start extracting that video's direct audio CDN URL in the background —
// even before they've chosen "Stream" from the action menu.  By the time
// they actually click Stream, the URL is likely already ready.
//
// If it isn't ready yet, we show "⏳ Song in queue, extracting..."
// and await the in-flight Promise.  The user never waits twice for the
// same video — once extracted, the URL is cached forever for that session.
//
// HOW EXTRACTION WORKS
// ---------------------
// We use yt-dlp-exec (your download.js package) with dumpSingleJson:true
// to get the full format list, then pick the best audio-only stream.
// This is DIFFERENT from the broken approach of passing the URL to mpv —
// we extract first, then give mpv the raw HTTPS audio CDN URL.
// mpv can always play a plain HTTPS URL without any yt-dlp plugin at all.
//
// WHY THIS IS RELIABLE
// ---------------------
// The 403 problem happened when we extracted the URL in one process and
// then passed it to a NEW process that made a fresh HTTP request.
// Here, the extraction happens in Node (yt-dlp-exec as a child process),
// and mpv receives the raw URL immediately after extraction completes —
// within the same few-second window before the signed token expires.
// In practice, YouTube's signed URLs stay valid for 6 hours, so even
// a short delay between extraction and playback is completely fine.
//
// CACHE STRUCTURE
// ---------------
// The cache is a Map keyed by YouTube video ID.
// Each entry is one of:
//   { status: 'pending',  promise: Promise<string> }   — extracting now
//   { status: 'ready',    url: string }                — done, URL available
//   { status: 'error',    error: string }              — extraction failed

import ytDlp from 'yt-dlp-exec';

// How long to wait for yt-dlp to respond before giving up (ms).
// 30s is generous — extraction usually takes 3–8s on a normal connection.
const EXTRACT_TIMEOUT_MS = 30_000;

class StreamCache {
  constructor() {
    // Map<videoId, CacheEntry>
    this._cache = new Map();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  // Call this the moment the user picks a number. It fires and forgets —
  // extraction runs in the background and the result is stored in the cache.
  // Calling prefetch() on a video that's already being extracted (or is
  // already done) is a no-op — we never double-extract.
  prefetch(videoId, ytUrl) {
    if (this._cache.has(videoId)) return; // already in flight or cached
    const promise = this._extract(videoId, ytUrl);
    this._cache.set(videoId, { status: 'pending', promise });
  }

  // Get the stream URL for a video, waiting if extraction is still in flight.
  // Returns a Promise<string> that resolves to the direct audio CDN URL.
  // Throws if extraction failed or timed out.
  async getStreamUrl(videoId, ytUrl) {
    // If not yet started (e.g. user went straight to Stream without the
    // resultsLoop triggering prefetch), start extraction now.
    if (!this._cache.has(videoId)) {
      this.prefetch(videoId, ytUrl);
    }

    const entry = this._cache.get(videoId);

    if (entry.status === 'ready')  return entry.url;
    if (entry.status === 'error')  throw new Error(entry.error);

    // Still pending — wait for the in-flight Promise
    return entry.promise;
  }

  // Check the current state of a video's extraction without waiting.
  // Returns 'pending' | 'ready' | 'error' | 'idle' (not yet started)
  getStatus(videoId) {
    const entry = this._cache.get(videoId);
    if (!entry) return 'idle';
    return entry.status;
  }

  // Clear the cache (called between search sessions so stale URLs don't
  // pile up — though 6-hour expiry means it rarely matters in practice)
  clear() {
    this._cache.clear();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  async _extract(videoId, ytUrl) {
    try {
      const url = await Promise.race([
        this._doExtract(ytUrl),
        // Timeout guard so a hanging yt-dlp call never blocks forever
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Extraction timed out')), EXTRACT_TIMEOUT_MS)
        ),
      ]);

      // Update cache entry from 'pending' to 'ready'
      this._cache.set(videoId, { status: 'ready', url });
      return url;

    } catch (err) {
      this._cache.set(videoId, { status: 'error', error: err.message });
      throw err;
    }
  }

  async _doExtract(ytUrl) {
    // Ask yt-dlp to dump the full JSON for this video (no download).
    // This gives us the complete format list so we can pick the best
    // audio-only stream ourselves.
    const info = await ytDlp(ytUrl, {
      dumpSingleJson:      true,
      noCheckCertificates: true,
      preferFreeFormats:   true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
    });

    // Find the best audio-only format.
    // We sort by audio bitrate (abr) descending so we always get the
    // highest quality available.  The logic mirrors your one_extractor.js.
    const audioFormats = (info.formats || [])
      .filter(f =>
        (f.resolution === 'audio only' || (f.acodec && f.acodec !== 'none' && f.vcodec === 'none'))
        && f.url  // must have an actual URL
      )
      .sort((a, b) => (b.abr || 0) - (a.abr || 0));  // best quality first

    if (!audioFormats.length) {
      throw new Error('No audio-only stream found for this video');
    }

    return audioFormats[0].url;
  }
}

// Export a single shared instance — the whole app shares one cache
// so prefetched URLs from the results loop are visible in handleStream().
export const streamCache = new StreamCache();
