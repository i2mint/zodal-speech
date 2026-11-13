/**
 * Seed of `@zodal/media`: a headless media player core with no DOM and no React.
 *
 * Three pieces: `MediaPort` (the part of an HTMLMediaElement the player uses), `createMediaPlayer`
 * (a zustand store over a port, plus a queue), and `MEDIA_COMMANDS` (every transport action as an
 * acture command). Keyboard, Media Session, a palette, MCP or an external controller such as
 * gesture input or MIDI are all just senders of those commands; a script with no UI can import
 * this module and drive a port.
 *
 * Continuous commands (`seekTo`, `setRate`, `setVolume`) take a target value and are idempotent, so a
 * sender may emit them at 60 Hz; they are listed in `CONTINUOUS_COMMAND_IDS` so history and undo can skip them.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { z } from 'zod';
import { defineCommand, ok, err, type AnyCommandRecord } from 'acture';
import { seekLanded, type SeekablePort } from './playback.js';

/** The part of an HTMLMediaElement the player uses. */
export interface MediaPort extends SeekablePort {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  playbackRate: number;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
}

/** A playable item. `src` is a URL the port can load (a presigned S3 URL, a stream route, a file URL). */
export interface MediaItem {
  id: string;
  src: string;
  title: string;
  kind?: 'audio' | 'video';
  /** Where to resume, in seconds. */
  resumeAt?: number;
}

/** Turns a source reference into an item. A source is any function with this shape. */
export type MediaSource = (ref: string) => MediaItem | Promise<MediaItem>;

/** The simplest source: a URL (S3, a stream route or an HTML media element's file) becomes an item. */
export const urlSource: MediaSource = (ref) => ({
  id: ref,
  src: ref,
  title: decodeURIComponent(ref.split('/').pop()?.split('?')[0] ?? ref),
});

export interface MediaState {
  queue: MediaItem[];
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  volume: number;
}

export interface MediaPlayerOptions {
  /** Called when the current item changes, so the host can set the element's `src`. */
  load?: (item: MediaItem, port: MediaPort) => void;
  skipBackS?: number;
  skipAheadS?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const DEFAULT_SKIP_BACK_S = 15;
const DEFAULT_SKIP_AHEAD_S = 30;

export interface MediaPlayer {
  store: StoreApi<MediaState>;
  port: MediaPort;
  play(): Promise<void>;
  pause(): void;
  toggle(): Promise<void>;
  seekTo(seconds: number): void;
  skipBy(deltaSeconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  enqueue(item: MediaItem, opts?: { next?: boolean }): void;
  next(): void;
  previous(): void;
  /** Pull time and duration from the port into the store; call from `timeupdate` or a timer. */
  sync(): void;
}

/** Creates the headless player over any `MediaPort`. */
export function createMediaPlayer(port: MediaPort, options: MediaPlayerOptions = {}): MediaPlayer {
  const { load, skipBackS = DEFAULT_SKIP_BACK_S, skipAheadS = DEFAULT_SKIP_AHEAD_S } = options;
  const store = createStore<MediaState>(() => ({
    queue: [], index: -1, playing: false, time: 0, duration: 0, rate: 1, volume: 1,
  }));
  const set = store.setState;
  const get = store.getState;

  const sync = () => set({ time: port.currentTime, duration: port.duration || 0, playing: !port.paused });
  // A seek made after the end must land before play() on WebKit (see playback.ts).
  let soughtAfterEnd = false;
  let held: AbortController | null = null;
  const select = (index: number) => {
    const item = get().queue[index];
    if (!item) return;
    set({ index });
    load?.(item, port);
    if (item.resumeAt) port.currentTime = item.resumeAt;
    sync();
  };
  const player: MediaPlayer = {
    store, port, sync,
    async play() {
      if (get().index < 0 && get().queue.length) select(0);
      if (soughtAfterEnd) {
        held?.abort();
        const mine = (held = new AbortController());
        try {
          await seekLanded(port, { signal: mine.signal });
        } catch {
          return; // paused while the seek was landing
        } finally {
          if (held === mine) held = null;
        }
      }
      soughtAfterEnd = false;
      await port.play();
      sync();
    },
    pause() { held?.abort(); port.pause(); sync(); },
    async toggle() { if (port.paused) await player.play(); else player.pause(); },
    seekTo(seconds) {
      const max = port.duration || Infinity;
      soughtAfterEnd = soughtAfterEnd || !!port.ended;
      port.currentTime = clamp(seconds, 0, max);
      sync();
    },
    skipBy(delta) { player.seekTo(port.currentTime + delta); },
    setRate(rate) { port.playbackRate = clamp(rate, 0.25, 4); set({ rate: port.playbackRate }); },
    setVolume(volume) { port.volume = clamp(volume, 0, 1); set({ volume: port.volume }); },
    enqueue(item, { next = false } = {}) {
      const { queue, index } = get();
      const at = next ? index + 1 : queue.length;
      const q = [...queue.slice(0, at), item, ...queue.slice(at)];
      set({ queue: q });
      if (index < 0) select(0);
    },
    next() { if (get().index + 1 < get().queue.length) select(get().index + 1); },
    previous() {
      if (port.currentTime > skipBackS / 3 || get().index <= 0) player.seekTo(0);
      else select(get().index - 1);
    },
  };
  void skipBackS; void skipAheadS;
  return player;
}

/** Commands that carry a target value and are safe at 60 Hz; history and undo should skip them. */
export const CONTINUOUS_COMMAND_IDS = ['media.seekTo', 'media.setRate', 'media.setVolume'] as const;

/** Builds the transport commands bound to one player. Register them with an acture registry. */
export function mediaCommands(player: MediaPlayer): AnyCommandRecord[] {
  const cat = 'media';
  const done = () => ok(undefined);
  return [
    defineCommand({ id: 'media.play', title: 'Play', category: cat, keybinding: 'Space',
      execute: async () => { await player.play(); return done(); } }),
    defineCommand({ id: 'media.pause', title: 'Pause', category: cat,
      execute: () => { player.pause(); return done(); } }),
    defineCommand({ id: 'media.toggle', title: 'Play or pause', category: cat, keybinding: 'k',
      execute: async () => { await player.toggle(); return done(); } }),
    defineCommand({ id: 'media.next', title: 'Next', category: cat, keybinding: 'n',
      execute: () => { player.next(); return done(); } }),
    defineCommand({ id: 'media.previous', title: 'Previous', category: cat, keybinding: 'p',
      execute: () => { player.previous(); return done(); } }),
    defineCommand({ id: 'media.skipBy', title: 'Skip by seconds', category: cat,
      params: z.object({ seconds: z.number() }),
      execute: (p: { seconds: number }) => { player.skipBy(p.seconds); return done(); } }),
    defineCommand({ id: 'media.seekTo', title: 'Seek to position', category: 'media.continuous',
      description: 'Absolute target in seconds; idempotent, safe to send at 60 Hz.',
      params: z.object({ seconds: z.number().min(0) }),
      execute: (p: { seconds: number }) => { player.seekTo(p.seconds); return done(); } }),
    defineCommand({ id: 'media.setRate', title: 'Set speed', category: 'media.continuous',
      params: z.object({ rate: z.number().positive() }),
      execute: (p: { rate: number }) => { player.setRate(p.rate); return done(); } }),
    defineCommand({ id: 'media.setVolume', title: 'Set volume', category: 'media.continuous',
      params: z.object({ volume: z.number().min(0).max(1) }),
      execute: (p: { volume: number }) => { player.setVolume(p.volume); return done(); } }),
    defineCommand({ id: 'media.enqueue', title: 'Add to queue', category: cat,
      params: z.object({ item: z.object({ id: z.string(), src: z.string(), title: z.string() }), next: z.boolean().optional() }),
      execute: (p: { item: MediaItem; next?: boolean }) => {
        if (!p.item.src) return err('invalid_item', 'src is required');
        player.enqueue(p.item, { next: p.next });
        return done();
      } }),
  ];
}
