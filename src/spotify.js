// spotify.js — Resolve Spotify links to YouTube via play-dl.
// Based directly on your spot.js — same play-dl package, same logic,
// cleaned up and exported as functions for the CLI to call.
//
// How play-dl works here:
//   1. You give it a Spotify song or playlist URL
//   2. It fetches the track metadata from Spotify's public API
//   3. It searches YouTube for "<track name> <artist> audio"
//   4. Returns the YouTube watch URL which mpv can play directly

import playdl from 'play-dl';
import { downloadMp3 } from './downloader.js';
import { DOWNLOAD_DIR } from './config.js';

// ── Resolve a Spotify song URL → YouTube watch URL ────────────────────────────

export async function resolveSpotifySong(spotifyUrl) {
  const valid = await playdl.validate(spotifyUrl);
  if (!valid || !valid.startsWith('sp_')) {
    throw new Error('Not a valid Spotify URL');
  }

  // Refresh token if it has expired (play-dl manages this internally)
  if (playdl.is_expired()) await playdl.refreshToken();

  const spotifyData = await playdl.spotify(spotifyUrl);

  // For a single track, spotifyData is the track object directly.
  // Build a clean search query exactly like your spot.js does.
  const query   = `${spotifyData.name} ${spotifyData.artists[0].name} audio`;
  const results = await playdl.search(query, { limit: 1 });

  if (!results?.length) throw new Error(`No YouTube match found for "${spotifyData.name}"`);

  return {
    title:    spotifyData.name,
    artist:   spotifyData.artists[0].name,
    ytUrl:    results[0].url,
    ytTitle:  results[0].title,
    duration: spotifyData.durationInSec,
  };
}

// ── Resolve a Spotify playlist → array of YouTube matches ─────────────────────

export async function resolveSpotifyPlaylist(spotifyUrl) {
  const valid = await playdl.validate(spotifyUrl);
  if (!valid || !valid.startsWith('sp_')) {
    throw new Error('Not a valid Spotify URL');
  }

  if (playdl.is_expired()) await playdl.refreshToken();

  const playlist = await playdl.spotify(spotifyUrl);
  // play-dl stores playlist tracks in a Map keyed by page number
  const tracks   = playlist.fetched_tracks?.get('1') || [];

  const results = [];
  for (const track of tracks) {
    try {
      const query  = `${track.name} ${track.artists[0].name} audio`;
      const yt     = await playdl.search(query, { limit: 1 });
      results.push({
        title:  track.name,
        artist: track.artists[0].name,
        ytUrl:  yt?.[0]?.url || null,
      });
    } catch {
      results.push({ title: track.name, artist: track.artists[0].name, ytUrl: null });
    }
  }

  return { name: playlist.name, tracks: results };
}
