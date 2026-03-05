#!/usr/bin/env node
// index.js — MusiCLI: interactive music terminal
// YouTube search · Stream (prefetched CDN URLs) · Download MP3
// YouTube playlists · Spotify resolution

import chalk    from 'chalk';
import inquirer from 'inquirer';
import ora      from 'ora';
import Table    from 'cli-table3';
import readline from 'readline';

import { searchYouTube }                          from './src/search.js';
import { findPlayer, playAudioUrl }               from './src/player.js';
import { playWithVisualizer }                     from './src/visualizer.js';
import { streamCache }                            from './src/streamCache.js';
import { downloadMp3, downloadPlaylist }          from './src/downloader.js';
import { resolveSpotifySong, resolveSpotifyPlaylist } from './src/spotify.js';
import { DOWNLOAD_DIR }                           from './src/config.js';

// ── Banner ────────────────────────────────────────────────────────────────────

function banner() {
  console.log(chalk.cyan(`
  ███╗   ███╗██╗   ██╗███████╗██╗ ██████╗██╗     ██╗
  ████╗ ████║██║   ██║██╔════╝██║██╔════╝██║     ██║
  ██╔████╔██║██║   ██║███████╗██║██║     ██║     ██║
  ██║╚██╔╝██║██║   ██║╚════██║██║██║     ██║     ██║
  ██║ ╚═╝ ██║╚██████╔╝███████║██║╚██████╗███████╗██║
  ╚═╝     ╚═╝ ╚═════╝ ╚══════╝╚═╝ ╚═════╝╚══════╝╚═╝`));
  console.log(chalk.dim('  YouTube · Stream · Download · Playlist · Spotify\n'));

  const player = findPlayer();
  if (!player) {
    console.log(chalk.yellow('  ⚠  No media player found. Streaming will not work.'));
    console.log(chalk.dim('     Install mpv: sudo apt install mpv  /  brew install mpv\n'));
  } else {
    console.log(chalk.dim(`  ♪  Streaming via ${player.name}\n`));
  }
}

// ── Results table ─────────────────────────────────────────────────────────────

function printResults(results) {
  const table = new Table({
    head: [chalk.cyan('#'), chalk.cyan('Title'), chalk.cyan('Channel'),
           chalk.cyan('Dur'), chalk.cyan('Views')],
    colWidths: [4, 50, 22, 8, 9],
    style: { border: ['cyan'] },
    wordWrap: true,
  });

  results.forEach((r, i) => {
    // Show a small "⚡" next to tracks whose stream URL is already cached,
    // so the user can see the prefetch system working in real time.
    const cached  = streamCache.getStatus(r.id) === 'ready'   ? chalk.green(' ⚡') : '';
    const loading = streamCache.getStatus(r.id) === 'pending' ? chalk.yellow(' ⟳') : '';
    table.push([
      chalk.yellow(String(i + 1)),
      r.title + cached + loading,
      chalk.blue(r.channel),
      chalk.dim(r.durationStr),
      chalk.dim(r.viewsStr),
    ]);
  });

  console.log('\n' + table.toString() + '\n');
}

// ── Simple readline prompt ────────────────────────────────────────────────────

function prompt(label) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.cyan(`  ${label}: `), ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ── Action menu for a selected track ─────────────────────────────────────────

async function pickAction(track) {
  console.log(chalk.cyan('\n  ┌─ ') + chalk.white(track.title));
  console.log(chalk.cyan('  └─ ') +
    chalk.dim(`${track.channel}  ·  ${track.durationStr}  ·  ${track.viewsStr} views\n`));

  const { action } = await inquirer.prompt([{
    type:    'list',
    name:    'action',
    message: 'What do you want to do?',
    prefix:  chalk.cyan(' ♪'),
    choices: [
      { name: `${chalk.green('▶')}  Stream now`,             value: 'stream'     },
      { name: `${chalk.magenta('≋')}  Stream + Visualizer`,   value: 'visualize'  },
      { name: `${chalk.yellow('↓')}  Download MP3`,           value: 'download'   },
      { name: `${chalk.blue('🔗')} Show YouTube link`,       value: 'link'       },
      { name: `${chalk.dim('←')}  Back to results`,          value: 'back'       },
      { name: `${chalk.red('✕')}  Quit`,                     value: 'quit'       },
    ],
  }]);

  return action;
}

// ── Stream handler — uses the prefetched CDN URL ──────────────────────────────

async function handleStream(track) {
  if (!findPlayer()) {
    console.log(chalk.red('\n  ✗  No media player found.'));
    console.log(chalk.dim('     Install mpv:  sudo apt install mpv  /  brew install mpv\n'));
    return;
  }

  const status = streamCache.getStatus(track.id);

  if (status === 'idle' || status === 'pending') {
    // URL is not ready yet — show the "in queue" message and wait.
    // "idle" means prefetch never triggered (e.g. direct URL mode),
    // "pending" means it's currently extracting in the background.
    const waitSpinner = ora({
      text:    status === 'pending'
                 ? chalk.yellow('⏳ Song in queue, extracting stream URL…')
                 : chalk.yellow('⏳ Extracting stream URL…'),
      color:   'yellow',
      spinner: 'dots2',
    }).start();

    try {
      // This awaits the already-in-flight Promise if status was 'pending',
      // or starts a fresh extraction if status was 'idle'.
      // Either way, we block here until the URL is ready.
      const cdnUrl = await streamCache.getStreamUrl(track.id, track.url);
      waitSpinner.succeed(chalk.green('Stream ready — starting playback'));
      await _play(track.title, cdnUrl);

    } catch (err) {
      waitSpinner.fail(chalk.red(`Extraction failed: ${err.message}`));
    }

  } else if (status === 'ready') {
    // URL was already prefetched — instant start, no waiting at all.
    console.log(chalk.green('\n  ⚡ Stream ready — starting instantly'));
    try {
      const cdnUrl = await streamCache.getStreamUrl(track.id, track.url);
      await _play(track.title, cdnUrl);
    } catch (err) {
      console.log(chalk.red(`\n  ✗  Playback error: ${err.message}\n`));
    }

  } else if (status === 'error') {
    // A previous extraction attempt failed. Try again fresh.
    console.log(chalk.yellow('\n  ⚠  Previous extraction failed, retrying…'));
    streamCache.clear(); // remove stale error entry
    streamCache.prefetch(track.id, track.url);
    const spinner = ora({ text: 'Extracting…', color: 'cyan', spinner: 'dots' }).start();
    try {
      const cdnUrl = await streamCache.getStreamUrl(track.id, track.url);
      spinner.succeed(chalk.green('Got stream — starting playback'));
      await _play(track.title, cdnUrl);
    } catch (err) {
      spinner.fail(chalk.red(`Extraction failed again: ${err.message}`));
    }
  }
}

// Internal helper: print the "Now playing" header then spawn the player.
async function _play(title, cdnUrl) {
  console.log(chalk.green('\n  ▶  Now playing: ') + title);
  console.log(chalk.dim('     Press q or Ctrl+C to stop\n'));
  try {
    await playAudioUrl(cdnUrl);
    console.log(chalk.dim('\n  Playback finished.\n'));
  } catch (err) {
    console.log(chalk.red(`\n  ✗  Player error: ${err.message}\n`));
  }
}

// ── Visualizer handler ────────────────────────────────────────────────────────

async function handleVisualize(track) {
  if (!findPlayer()) {
    console.log(chalk.red('\n  ✗  mpv is required for the visualizer.'));
    console.log(chalk.dim('     sudo dnf install mpv  /  sudo apt install mpv\n'));
    return;
  }

  // Same prefetch-aware URL resolution as handleStream
  const status = streamCache.getStatus(track.id);
  let cdnUrl;

  if (status === 'ready') {
    cdnUrl = await streamCache.getStreamUrl(track.id, track.url);
    console.log(chalk.green('\n  ⚡ Stream ready — launching visualizer'));
  } else {
    const spinner = ora({
      text:    chalk.yellow('⏳ Extracting stream URL…'),
      color:   'yellow',
      spinner: 'dots2',
    }).start();
    try {
      cdnUrl = await streamCache.getStreamUrl(track.id, track.url);
      spinner.succeed(chalk.green('Stream ready'));
    } catch (err) {
      spinner.fail(chalk.red(`Extraction failed: ${err.message}`));
      return;
    }
  }

  console.log(chalk.dim('  Starting visualizer… (Ctrl+C or q to stop)\n'));
  try {
    await playWithVisualizer(cdnUrl, track.title, track.duration || 0);
  } catch (err) {
    // Restore terminal in case visualizer crashed mid-draw
    process.stdout.write('\x1b[?25h\x1b[0m\x1b[2J\x1b[H');
    console.log(chalk.red(`\n  ✗  Visualizer error: ${err.message}`));
    console.log(chalk.dim('  Tip: install ffmpeg or cava for visualizer support.'));
    console.log(chalk.dim('       sudo dnf install ffmpeg cava\n'));
  }
}



async function handleDownload(track) {
  const spinner = ora({ text: `Downloading: ${track.title}`, color: 'cyan', spinner: 'dots' }).start();
  try {
    const saved = await downloadMp3(track.url, track.title);
    spinner.succeed(chalk.green('Saved: ') + chalk.dim(saved));
  } catch (err) {
    spinner.fail(chalk.red(`Download failed: ${err.message}`));
  }
  console.log();
}

// ── Results loop — triggers prefetch on every number pick ─────────────────────

async function resultsLoop(results) {
  // Clear stale cache entries from any previous search
  streamCache.clear();

  while (true) {
    printResults(results);  // re-render on each loop so ⚡ indicators update

    const pick = await prompt(`Pick 1–${results.length}, [b]ack, [q]uit`);

    if (pick.toLowerCase() === 'q') return 'quit';
    if (pick.toLowerCase() === 'b') return 'back';

    const idx = parseInt(pick, 10);
    if (isNaN(idx) || idx < 1 || idx > results.length) {
      console.log(chalk.yellow(`  Enter a number between 1 and ${results.length}.\n`));
      continue;
    }

    const track = results[idx - 1];

    // ── THE KEY LINE ────────────────────────────────────────────────────────
    // Start extracting the stream URL for this track RIGHT NOW, in the
    // background.  By the time the user reads the action menu, scrolls to
    // "Stream", and presses Enter, the extraction will very likely be done.
    // If it isn't, handleStream() will wait for it and show the queue message.
    streamCache.prefetch(track.id, track.url);

    const action = await pickAction(track);

    if (action === 'quit')      return 'quit';
    if (action === 'back')      continue;
    if (action === 'stream')    await handleStream(track);
    if (action === 'visualize') await handleVisualize(track);
    if (action === 'download')  await handleDownload(track);
    if (action === 'link') {
      console.log(chalk.cyan('\n  YouTube URL:'));
      console.log(chalk.underline(`  ${track.url}\n`));
    }
  }
}

// ── Main menu ─────────────────────────────────────────────────────────────────

async function mainMenu() {
  const { mode } = await inquirer.prompt([{
    type:    'list',
    name:    'mode',
    message: 'What are you looking for?',
    prefix:  chalk.cyan(' ♪'),
    choices: [
      { name: `${chalk.cyan('🔎')} Search YouTube`,               value: 'search'   },
      { name: `${chalk.magenta('🎵')} Play a YouTube URL directly`, value: 'url'      },
      { name: `${chalk.green('📋')} Download a YouTube playlist`,  value: 'playlist' },
      { name: `${chalk.green('🟢')} Resolve a Spotify link`,       value: 'spotify'  },
      { name: `${chalk.red('✕')}  Quit`,                          value: 'quit'     },
    ],
  }]);
  return mode;
}

// ── Mode handlers ─────────────────────────────────────────────────────────────

async function modeSearch() {
  const query = await prompt('Search');
  if (!query) return;

  const spinner = ora({ text: `Searching for "${query}"…`, color: 'cyan', spinner: 'dots2' }).start();
  try {
    const results = await searchYouTube(query);
    spinner.stop();
    if (!results.length) {
      console.log(chalk.yellow('\n  No results found.\n'));
      return;
    }
    await resultsLoop(results);
  } catch (err) {
    spinner.fail(chalk.red(`Search failed: ${err.message}`));
  }
}

async function modeDirectUrl() {
  const url = await prompt('YouTube URL');
  if (!url) return;

  // Extract video ID from the URL so the cache can key on it
  const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  const id    = match ? match[1] : url;

  const track = { id, title: url, channel: '—', durationStr: '—', viewsStr: '—', url };

  // Start prefetching immediately since we already know the URL
  streamCache.prefetch(id, url);

  const action = await pickAction(track);
  if (action === 'stream')   await handleStream(track);
  if (action === 'download') await handleDownload(track);
  if (action === 'link') console.log(chalk.cyan('\n  URL: ') + chalk.underline(url) + '\n');
}

async function modePlaylist() {
  const input = await prompt('YouTube Playlist URL or ID');
  if (!input) return;

  const match = input.match(/[?&]list=([^&]+)/);
  const plId  = match ? match[1] : input;

  const spinner = ora({ text: 'Downloading playlist…', color: 'cyan', spinner: 'dots' }).start();
  try {
    const results = await downloadPlaylist(plId);
    spinner.stop();
    const ok   = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log(chalk.green(`\n  ✓  ${ok} tracks saved to ${DOWNLOAD_DIR}`));
    if (fail) {
      console.log(chalk.yellow(`  ⚠  ${fail} tracks failed`));
      results.filter(r => !r.ok).forEach(r =>
        console.log(chalk.dim(`     ✗ ${r.title}: ${r.error}`))
      );
    }
    console.log();
  } catch (err) {
    spinner.fail(chalk.red(`Playlist failed: ${err.message}`));
  }
}

async function modeSpotify() {
  const url = await prompt('Spotify song or playlist URL');
  if (!url) return;

  const spinner = ora({ text: 'Resolving Spotify link…', color: 'cyan', spinner: 'dots' }).start();
  try {
    if (url.includes('/playlist/')) {
      const data = await resolveSpotifyPlaylist(url);
      spinner.stop();
      console.log(chalk.cyan(`\n  Playlist: ${data.name}\n`));

      const results = data.tracks.filter(t => t.ytUrl).map(t => ({
        id:          t.ytUrl,
        title:       `${t.title} — ${t.artist}`,
        channel:     t.artist,
        url:         t.ytUrl,
        durationStr: '—',
        viewsStr:    '—',
      }));

      if (!results.length) {
        console.log(chalk.yellow('  No tracks could be resolved.\n'));
        return;
      }
      await resultsLoop(results);

    } else {
      const data  = await resolveSpotifySong(url);
      spinner.stop();
      const mins  = Math.floor((data.duration || 0) / 60);
      const secs  = String((data.duration || 0) % 60).padStart(2, '0');
      const track = {
        id:          data.ytUrl,
        title:       `${data.title} — ${data.artist}`,
        channel:     data.artist,
        url:         data.ytUrl,
        durationStr: data.duration ? `${mins}:${secs}` : '—',
        viewsStr:    '—',
      };
      streamCache.prefetch(track.id, track.url);
      const action = await pickAction(track);
      if (action === 'stream')   await handleStream(track);
      if (action === 'download') await handleDownload(track);
      if (action === 'link') console.log(chalk.cyan('\n  URL: ') + chalk.underline(track.url) + '\n');
    }
  } catch (err) {
    spinner.fail(chalk.red(`Spotify error: ${err.message}`));
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  banner();
  while (true) {
    const mode = await mainMenu();
    if (mode === 'quit') {
      console.log(chalk.dim('\n  ♪ Thanks for listening. Goodbye.\n'));
      process.exit(0);
    }
    if (mode === 'search')   await modeSearch();
    if (mode === 'url')      await modeDirectUrl();
    if (mode === 'playlist') await modePlaylist();
    if (mode === 'spotify')  await modeSpotify();
  }
}

main().catch(err => {
  console.error(chalk.red('\nFatal error:'), err.message);
  process.exit(1);
});
