/**
 * Playing from a chosen point, safely on every engine, with no DOM beyond the port itself.
 *
 * The trap: in WebKit (Safari, and every browser on an iPhone or iPad) `el.currentTime = t;
 * el.play()` on an element that has *ended* starts from the end, which ends again at once, or
 * from 0, because the seek has not landed when `play()` runs. Chromium and Firefox apply the
 * seek first. It shows as "after the audio finished, tapping a transcript line plays from the
 * start" (annals, 2026-11-13). Measured in Playwright WebKit: 12 of 12 taps restarted at 0;
 * calling `play()` first and seeking again still failed 10 of 12; waiting for `seeked` and then
 * playing was right 16 of 16.
 *
 * So `seekThenPlay` reads whether the element had ended *before* seeking (after the seek WebKit
 * already reports `ended === false`), and if it had and the seek is still landing, it plays on
 * `seeked`. The element has played before, so playing outside the tap is allowed.
 */

/** The part of a media element `seekThenPlay` uses. The optional members are an HTMLMediaElement's. */
export interface SeekablePort {
  currentTime: number;
  play(): Promise<void> | void;
  /** True once playback reached the end. A port without it is never waited on. */
  readonly ended?: boolean;
  /** True while a seek is landing. */
  readonly seeking?: boolean;
  addEventListener?(type: 'seeked', listener: () => void): void;
  removeEventListener?(type: 'seeked', listener: () => void): void;
}

/** Play anyway after this long, if no seek is under way by then (a seek still landing is still awaited). */
export const SEEK_LAND_TIMEOUT_MS = 1500;

export interface SeekThenPlayOptions {
  /** What starting playback means; defaults to `port.play()`. A player passes its own, to catch a refusal. */
  play?: () => Promise<void> | void;
  timeoutMs?: number;
  /** Cancels a play held for its seek (a pause meanwhile): the promise rejects with an AbortError. */
  signal?: AbortSignal;
}

function abortError(): Error {
  const e = new Error('The play was cancelled while its seek was landing.');
  e.name = 'AbortError';
  return e;
}

/** Resolves once `port`'s seek has landed (`seeked`), or at once when no seek is landing. */
export function seekLanded(
  port: SeekablePort,
  { timeoutMs = SEEK_LAND_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!port.seeking || !port.addEventListener) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      port.removeEventListener?.('seeked', landed);
      signal?.removeEventListener('abort', aborted);
    };
    const landed = () => { settle(); resolve(); };
    const aborted = () => { settle(); reject(abortError()); };
    // Playing while the seek is still under way is the bug itself, so the timer only ends a wait
    // whose seek is over without a `seeked` (a source that went away).
    timer = setTimeout(() => { if (!port.seeking) landed(); }, timeoutMs);
    port.addEventListener!('seeked', landed);
    signal?.addEventListener('abort', aborted);
  });
}

/**
 * Seeks `port` to `time` and plays from there, also when it has ended (see the module note).
 * Plays synchronously, inside the tap, whenever it can; returns what playing returned.
 */
export function seekThenPlay(port: SeekablePort, time: number, options: SeekThenPlayOptions = {}): Promise<void> {
  const play = options.play ?? (() => port.play());
  const wasEnded = !!port.ended;
  port.currentTime = time;
  if (!wasEnded || !port.seeking) return Promise.resolve(play());
  return seekLanded(port, options).then(() => play());
}
