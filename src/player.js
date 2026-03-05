// player.js — Play a direct audio CDN URL via a system media player.
//
// IMPORTANT CHANGE FROM PREVIOUS VERSION
// ----------------------------------------
// We no longer pass YouTube watch URLs (youtube.com/watch?v=...) to the
// player.  Instead, streamCache.js extracts the raw signed CDN URL first
// (an HTTPS URL pointing directly to Google's audio servers), and we pass
// *that* to mpv/vlc/ffplay.
//
// Why this is more reliable:
//   • mpv with a watch URL requires its yt-dlp plugin to be compiled in
//     and up to date.  On many Fedora / Arch builds, this is broken.
//   • mpv with a raw HTTPS URL is dead simple — it's just an audio file
//     over the internet.  No yt-dlp plugin needed at all.
//
// The signed CDN URL is valid for ~6 hours, so even if there's a small
// gap between extraction and playback it's completely fine.

import { spawn }    from 'child_process';
import { execSync } from 'child_process';

function hasCommand(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Player command builders ───────────────────────────────────────────────────
// Each builder receives a raw HTTPS audio URL (NOT a YouTube watch URL).

function buildMpvCmd(url) {
  return [
    'mpv',
    '--no-video',          // audio only, no window
    '--really-quiet',      // suppress most output
    '--term-osd-bar',      // show a progress bar in the terminal
    url,
  ];
}

function buildVlcCmd(url) {
  return ['vlc', '--intf', 'rc', '--no-video', '--play-and-exit', '--quiet', url];
}

function buildFfplayCmd(url) {
  // ffplay handles a plain HTTPS audio URL with no extra configuration.
  return ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', url];
}

// ── Player detection ──────────────────────────────────────────────────────────

export function findPlayer() {
  if (hasCommand('mpv'))    return { name: 'mpv',    build: buildMpvCmd    };
  if (hasCommand('vlc'))    return { name: 'vlc',    build: buildVlcCmd    };
  if (hasCommand('ffplay')) return { name: 'ffplay', build: buildFfplayCmd };
  return null;
}

// ── Play a raw CDN audio URL ──────────────────────────────────────────────────
// Blocks until playback ends or the user presses q / Ctrl+C.
// The player inherits our stdin/stdout/stderr so it can draw its OSD bar.

export function playAudioUrl(cdnUrl) {
  const player = findPlayer();
  if (!player) return Promise.reject(new Error('NO_PLAYER'));

  return new Promise((resolve, reject) => {
    const args = player.build(cdnUrl);
    const proc = spawn(args[0], args.slice(1), { stdio: 'inherit' });
    proc.on('close', code => resolve({ player: player.name, code }));
    proc.on('error', reject);
  });
}
