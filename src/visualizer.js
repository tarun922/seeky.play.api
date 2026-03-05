// visualizer.js — Terminal audio visualizer
//
// ═══════════════════════════════════════════════════════════════════════════
// HOW THIS WORKS: THE SIGNAL PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════
//
// A visualizer needs to answer one question every ~60ms:
//   "What frequencies are present in the audio RIGHT NOW, and how loud
//    is each one?"
//
// To answer that, we run a three-stage pipeline:
//
//   CDN URL → FFmpeg (decode to raw PCM) → Node (FFT analysis) → terminal
//
// STAGE 1: FFmpeg decodes the audio
// ----------------------------------
// The CDN URL contains compressed audio (opus or aac). We can't analyze
// compressed bytes directly — they're encoded in a format optimized for
// storage, not math. FFmpeg decodes them to raw PCM: a flat stream of
// numbers where each number is the air-pressure amplitude at a single
// moment in time. We request mono (1 channel), 8000 Hz sample rate, and
// signed 16-bit integers (s16le). Why 8000 Hz? Because the FFT analysis
// we do next requires N samples where N is a power of 2, and 8000 Hz
// gives us enough frequency resolution for a nice visualizer without
// burning CPU. (For reference, CD quality is 44100 Hz — overkill here.)
//
// STAGE 2: FFT analysis in Node
// ------------------------------
// FFT stands for Fast Fourier Transform. It takes a window of N time-domain
// samples (a snapshot of the waveform) and converts it into N/2 frequency
// bins (how loud is 0-62Hz? 62-125Hz? 125-250Hz? etc.). This is the
// mathematical heart of every visualizer you've ever seen.
//
// We implement a simple recursive Cooley-Tukey FFT in pure JavaScript.
// It operates on complex numbers (real + imaginary parts), but our input
// is purely real (PCM amplitudes), so we set imaginary parts to 0.
// After the transform, the magnitude of each complex number tells us the
// energy (loudness) at that frequency bin.
//
// We use a Hann window function before the FFT to reduce "spectral
// leakage" — without it, sharp edges at the start/end of each analysis
// window would create phantom frequencies that don't actually exist in
// the audio and make the visualizer look noisy and jittery.
//
// STAGE 3: Drawing bar charts in the terminal
// --------------------------------------------
// We group the 512 FFT bins into ~24 display bands (matching the terminal
// width), apply logarithmic scaling (because human hearing is logarithmic —
// we perceive octaves, not linear Hz steps), smooth between frames to avoid
// jitter, then draw Unicode block characters (█ ▇ ▆ ▅ ▄ ▃ ▂ ▁) stacked
// vertically to create smooth-looking bars.
//
// IMPORTANT: mpv plays the ACTUAL audio (with full quality, buffering, etc.)
// FFmpeg is a SEPARATE process that independently re-decodes the same CDN
// URL at a lower quality just for analysis. The two run in parallel.
// This means the visualizer may be very slightly behind the actual audio
// (~0.1-0.5s), but this is imperceptible to the human ear/eye.
//
// If `cava` is installed (a dedicated terminal visualizer), we use that
// instead — it integrates directly with PipeWire/PulseAudio and reads
// the actual audio output, so it's perfectly in sync.

import { spawn, execSync } from 'child_process';
import readline             from 'readline';

// ── Utilities ──────────────────────────────────────────────────────────────────

function hasCommand(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Hann window ────────────────────────────────────────────────────────────────
// Multiplying each sample by a Hann window coefficient before the FFT tapers
// the edges of the analysis window smoothly to zero. This prevents the FFT
// from "seeing" a hard discontinuity at the window boundaries, which would
// create false frequency components (spectral leakage). Think of it as
// telling the FFT "this chunk of audio fades in and fades out" rather than
// "it abruptly starts and stops".

function makeHannWindow(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  return w;
}

// ── Cooley-Tukey FFT ───────────────────────────────────────────────────────────
// This is the classic recursive divide-and-conquer FFT algorithm.
// It splits the input into even-indexed and odd-indexed samples, recursively
// transforms each half, then combines them using "butterfly" operations.
// Time complexity: O(N log N) vs O(N²) for a naive DFT — crucial for real-time.
//
// Input: re[] and im[] arrays of length N (must be a power of 2)
// Output: re[] and im[] are modified in place to contain frequency-domain data
// Magnitude of bin k = sqrt(re[k]² + im[k]²) → energy at that frequency

function fft(re, im) {
  const N = re.length;
  if (N <= 1) return;

  // Split into even and odd
  const reEven = new Float64Array(N / 2), imEven = new Float64Array(N / 2);
  const reOdd  = new Float64Array(N / 2), imOdd  = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    reEven[i] = re[i * 2];     imEven[i] = im[i * 2];
    reOdd[i]  = re[i * 2 + 1]; imOdd[i]  = im[i * 2 + 1];
  }

  // Recurse
  fft(reEven, imEven);
  fft(reOdd,  imOdd);

  // Butterfly combine: for each frequency bin k, combine the even and odd
  // half-transforms using a "twiddle factor" (a complex rotation e^(-2πi k/N))
  for (let k = 0; k < N / 2; k++) {
    const angle   = -2 * Math.PI * k / N;
    const twRe    = Math.cos(angle);
    const twIm    = Math.sin(angle);
    // Complex multiply: (twRe + i*twIm) * (reOdd[k] + i*imOdd[k])
    const tRe     = twRe * reOdd[k] - twIm * imOdd[k];
    const tIm     = twRe * imOdd[k] + twIm * reOdd[k];
    re[k]         =  reEven[k] + tRe;
    im[k]         =  imEven[k] + tIm;
    re[k + N / 2] =  reEven[k] - tRe;
    im[k + N / 2] =  imEven[k] - tIm;
  }
}

// ── Frequency band mapping ─────────────────────────────────────────────────────
// Human hearing spans ~20 Hz to 20,000 Hz, but we perceive it logarithmically:
// the difference between 100Hz and 200Hz sounds the same as between 1000Hz
// and 2000Hz (both are one octave). So we map our FFT bins to display bands
// using logarithmic spacing rather than linear spacing.
//
// With 8000 Hz sample rate and 1024-point FFT, each bin covers ~7.8 Hz.
// We group them into `numBands` display bands with log-spaced boundaries.

function makeLogBands(numBands, fftSize, sampleRate) {
  const nyquist   = sampleRate / 2;             // max representable frequency
  const binHz     = nyquist / (fftSize / 2);    // Hz per FFT bin
  const minFreq   = 40;                         // ignore sub-bass rumble
  const maxFreq   = Math.min(nyquist, 14000);   // ignore inaudible highs

  const bands = [];
  for (let i = 0; i < numBands; i++) {
    // Exponential interpolation from minFreq to maxFreq
    const freqLo = minFreq * Math.pow(maxFreq / minFreq,  i      / numBands);
    const freqHi = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / numBands);
    bands.push({
      lo: Math.max(1, Math.floor(freqLo / binHz)),
      hi: Math.min(fftSize / 2 - 1, Math.ceil(freqHi / binHz)),
    });
  }
  return bands;
}

// ── Bar rendering ──────────────────────────────────────────────────────────────
// Unicode block characters give us 8 sub-character heights, letting us draw
// bars with smooth sub-row precision despite being a text terminal.

const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// ANSI escape sequences for colours and cursor control.
// We use a gradient from deep blue (bass) through cyan to white (treble),
// giving the visualizer a "cold to hot" feel.
const COLORS = [
  '\x1b[34m',   // blue      (bass)
  '\x1b[36m',   // cyan
  '\x1b[96m',   // bright cyan
  '\x1b[37m',   // white     (treble)
];

function pickColor(bandIndex, numBands) {
  const idx = Math.floor((bandIndex / numBands) * COLORS.length);
  return COLORS[Math.min(idx, COLORS.length - 1)];
}

const RESET = '\x1b[0m';
const HIDE_CURSOR  = '\x1b[?25l';
const SHOW_CURSOR  = '\x1b[?25h';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const MOVE_HOME    = '\x1b[H';

// Move cursor to row R, col C (1-indexed)
const MOVE = (r, c) => `\x1b[${r};${c}H`;

// ── The Visualizer class ───────────────────────────────────────────────────────

const FFT_SIZE   = 1024;   // analysis window size (power of 2)
const SAMPLE_RATE = 8000;  // Hz — low but sufficient for visual analysis
const FRAME_MS   = 1000 / 50;  // target ~50 FPS
const BAR_HEIGHT = 12;     // how many rows tall the visualizer is
const SMOOTHING  = 0.75;   // higher = smoother but slower response (0–1)

const hannWindow = makeHannWindow(FFT_SIZE);

export class Visualizer {
  constructor(cdnUrl, trackTitle, trackDuration) {
    this._url       = cdnUrl;
    this._title     = trackTitle;
    this._duration  = trackDuration || 0;
    this._ffmpeg    = null;
    this._mpv       = null;
    this._stopped   = false;

    // PCM ring buffer — we keep the last FFT_SIZE samples for analysis
    this._pcmBuf    = new Int16Array(FFT_SIZE);
    this._bufPos    = 0;   // write pointer into the ring buffer
    this._bufFilled = 0;   // how many samples we've received so far

    // Smoothed bar heights from the previous frame (for animation smoothing)
    this._prevBars  = null;

    // Wall-clock start time so we can track elapsed seconds
    this._startTime = null;

    // Timer handle for the render loop
    this._renderTimer = null;
  }

  // ── Public: start everything ────────────────────────────────────────────────

  async start() {
    // Hide cursor and go full-screen
    process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN);

    // Draw the static UI frame (title bar, instructions) that won't change
    this._drawFrame();

    this._startTime = Date.now();

    // Spawn mpv for actual audio playback (inherits stdout so OSD still works)
    this._mpv = spawn('mpv', [
      '--no-video',
      '--really-quiet',
      this._url,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    // Spawn FFmpeg independently to decode the same URL for analysis only.
    // -vn         : discard video
    // -ac 1       : downmix to mono (simpler analysis, same result visually)
    // -ar 8000    : resample to 8000 Hz (plenty for visualization)
    // -f s16le    : output raw signed 16-bit little-endian PCM
    // pipe:1      : write to stdout
    this._ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'quiet',
      '-i',        this._url,
      '-vn',
      '-ac',       '1',
      '-ar',       String(SAMPLE_RATE),
      '-f',        's16le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    // Feed PCM bytes into our ring buffer as FFmpeg produces them
    this._ffmpeg.stdout.on('data', (chunk) => {
      // Each sample is 2 bytes (Int16). We read them sequentially and write
      // them into the ring buffer, wrapping around when we reach the end.
      for (let i = 0; i + 1 < chunk.length; i += 2) {
        this._pcmBuf[this._bufPos] = chunk.readInt16LE(i);
        this._bufPos = (this._bufPos + 1) % FFT_SIZE;
        if (this._bufFilled < FFT_SIZE) this._bufFilled++;
      }
    });

    // Start the render loop — runs every FRAME_MS milliseconds
    this._renderTimer = setInterval(() => this._renderFrame(), FRAME_MS);

    // Wait for mpv to finish (= song ended or user pressed q)
    await new Promise(resolve => {
      this._mpv.on('close', resolve);
      // Also handle Ctrl+C
      process.once('SIGINT', () => { this.stop(); resolve(); });
    });

    this.stop();
  }

  // ── Public: stop everything cleanly ────────────────────────────────────────

  stop() {
    if (this._stopped) return;
    this._stopped = true;

    if (this._renderTimer) clearInterval(this._renderTimer);
    if (this._ffmpeg?.exitCode === null) this._ffmpeg.kill();
    if (this._mpv?.exitCode === null)    this._mpv.kill();

    // Restore terminal state
    process.stdout.write(SHOW_CURSOR + CLEAR_SCREEN + RESET);
  }

  // ── Private: draw the static frame (title bar + instructions) ──────────────

  _drawFrame() {
    const cols  = process.stdout.columns  || 80;
    const rows  = process.stdout.rows     || 24;

    // Title bar at the top
    const titleLine = ` ♪  ${this._title}`.substring(0, cols - 2);
    process.stdout.write(MOVE(1, 1) + '\x1b[46m\x1b[30m' +
      titleLine.padEnd(cols) + RESET);

    // Instructions at the bottom
    const hint = '  q / Ctrl+C to stop  ';
    process.stdout.write(MOVE(rows, 1) + '\x1b[2m' +
      hint.padEnd(cols) + RESET);
  }

  // ── Private: one rendered frame ─────────────────────────────────────────────

  _renderFrame() {
    if (this._stopped) return;

    const cols    = process.stdout.columns  || 80;
    const rows    = process.stdout.rows     || 24;
    const numBands = Math.max(8, cols - 4);  // one bar per terminal column

    // ── 1. Copy ring buffer into analysis window (in correct order) ──────────
    // The ring buffer is a circular structure: _bufPos points to the NEXT
    // write position, so the oldest sample is at _bufPos and the newest is
    // at (_bufPos - 1 + FFT_SIZE) % FFT_SIZE. We copy them out in order.
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);  // starts as all zeros

    if (this._bufFilled < FFT_SIZE) return;  // not enough data yet

    for (let i = 0; i < FFT_SIZE; i++) {
      const sampleIdx = (this._bufPos + i) % FFT_SIZE;
      // Normalize Int16 (-32768..32767) to (-1..1), then apply Hann window
      re[i] = (this._pcmBuf[sampleIdx] / 32768) * hannWindow[i];
    }

    // ── 2. Run FFT ───────────────────────────────────────────────────────────
    fft(re, im);

    // ── 3. Compute band energies ─────────────────────────────────────────────
    const bands    = makeLogBands(numBands, FFT_SIZE, SAMPLE_RATE);
    const energies = new Float64Array(numBands);

    for (let b = 0; b < numBands; b++) {
      let sum = 0, count = 0;
      for (let k = bands[b].lo; k <= bands[b].hi; k++) {
        // Magnitude = sqrt(re² + im²); we square it for energy (power spectrum)
        sum += re[k] * re[k] + im[k] * im[k];
        count++;
      }
      energies[b] = count > 0 ? Math.sqrt(sum / count) : 0;
    }

    // ── 4. Convert energies to bar heights with log scaling + smoothing ──────
    // Log scaling: human loudness perception is logarithmic (dB), so we
    // take log of the energy before mapping to bar height. This makes quiet
    // sounds visible rather than being squished to zero.
    const vizRows = Math.max(4, rows - 4);  // rows available for bars
    const totalHeight = vizRows * 8;        // sub-character precision

    if (!this._prevBars) this._prevBars = new Float64Array(numBands);

    const barHeights = new Float64Array(numBands);
    for (let b = 0; b < numBands; b++) {
      // Map energy to 0–1 range using log scaling
      const logEnergy = energies[b] > 0
        ? Math.max(0, (Math.log(energies[b] * 200 + 1)) / Math.log(40))
        : 0;
      const target = Math.min(1, logEnergy) * totalHeight;

      // Exponential moving average smoothing between frames.
      // The asymmetry (attack faster than decay) makes the visualizer feel
      // punchy — bars jump up quickly and fall down smoothly.
      const prev = this._prevBars[b];
      barHeights[b] = target > prev
        ? prev * (SMOOTHING * 0.5) + target * (1 - SMOOTHING * 0.5)  // fast attack
        : prev * SMOOTHING         + target * (1 - SMOOTHING);         // slow decay

      this._prevBars[b] = barHeights[b];
    }

    // ── 5. Build and write the frame ─────────────────────────────────────────
    // We build the entire frame as one string and write it in a single
    // process.stdout.write() call to avoid flickering from partial updates.
    let out = MOVE_HOME;

    // Skip row 1 (title bar) — draw bars from row 2 downward
    for (let row = 0; row < vizRows; row++) {
      out += MOVE(row + 2, 1);
      // row 0 = top of visualizer (highest bars), row vizRows-1 = bottom
      const rowFromBottom = vizRows - 1 - row;

      for (let b = 0; b < numBands; b++) {
        const h = barHeights[b];
        // How many "units" of height fill this row?
        // Each row is 8 units tall (for the 8 block characters).
        const rowBottom = rowFromBottom * 8;
        const rowTop    = rowBottom + 8;

        if (h <= rowBottom) {
          // Bar doesn't reach this row at all
          out += ' ';
        } else if (h >= rowTop) {
          // Bar completely fills this row
          out += pickColor(b, numBands) + '█' + RESET;
        } else {
          // Bar partially fills this row — use sub-character block
          const partial = Math.floor(h - rowBottom);
          out += pickColor(b, numBands) + BLOCKS[Math.max(0, partial)] + RESET;
        }
      }
    }

    // ── 6. Progress bar ───────────────────────────────────────────────────────
    const elapsed = (Date.now() - this._startTime) / 1000;
    const total   = this._duration;
    const barCols = cols - 16;
    const filled  = total > 0 ? Math.floor((elapsed / total) * barCols) : 0;
    const timeStr = `${_fmt(elapsed)} / ${total > 0 ? _fmt(total) : '?'}`;

    out += MOVE(vizRows + 2, 1) +
      '\x1b[36m' + '─'.repeat(Math.min(filled, barCols)) +
      '\x1b[2m'  + '─'.repeat(Math.max(0, barCols - filled)) +
      RESET + '  ' + '\x1b[36m' + timeStr + RESET;

    process.stdout.write(out);
  }
}

// ── cava integration (preferred on Linux) ─────────────────────────────────────
// cava reads directly from PipeWire/PulseAudio, so it's perfectly in sync
// with the actual audio output. We spawn it in a subshell that takes over
// the terminal while mpv plays in the background.

export async function playWithCava(cdnUrl, trackTitle, trackDuration) {
  process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN);

  console.log(`\x1b[36m  ♪  ${trackTitle}\x1b[0m`);
  console.log('\x1b[2m  cava visualizer — press q to stop\x1b[0m\n');

  // mpv in background (no terminal control)
  const mpv = spawn('mpv', ['--no-video', '--really-quiet', cdnUrl],
    { stdio: 'ignore' });

  // cava takes over the terminal for its display
  const cava = spawn('cava', [], { stdio: 'inherit' });

  await new Promise(resolve => {
    mpv.on('close', () => { cava.kill(); resolve(); });
    cava.on('close', () => { mpv.kill();  resolve(); });
    process.once('SIGINT', () => { mpv.kill(); cava.kill(); resolve(); });
  });

  process.stdout.write(SHOW_CURSOR + CLEAR_SCREEN + RESET);
}

// ── Main export: play with the best available visualizer ──────────────────────

export async function playWithVisualizer(cdnUrl, trackTitle, trackDuration) {
  if (!hasCommand('mpv')) {
    throw new Error('mpv is required for the visualizer');
  }

  if (hasCommand('cava')) {
    // cava is the gold standard — perfectly synced, dedicated visualizer
    return playWithCava(cdnUrl, trackTitle, trackDuration);
  }

  if (hasCommand('ffmpeg')) {
    // Our own FFT-based visualizer using FFmpeg for PCM decoding
    const viz = new Visualizer(cdnUrl, trackTitle, trackDuration);
    return viz.start();
  }

  throw new Error('Install ffmpeg (or cava) to use the visualizer');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmt(secs) {
  if (!secs) return '0:00';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
