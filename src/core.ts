/**
 * The headless player: pure transcript logic plus a zustand store, with no DOM and no zod.
 *
 * A renderer draws from `player.store` and calls `player.commands`. The audio element arrives
 * through `AudioPort`, so tests and other platforms can supply their own.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';

/** The structural shape of a cue, so this module needs no schema at runtime. */
export interface CueLike {
  start: number;
  end: number;
  text: string;
  speaker: string;
  segment: number;
  words: ReadonlyArray<readonly [number, number, string]>;
}

/** The part of an audio element the player uses. */
export interface AudioPort {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SpeechPlayerState {
  time: number;
  duration: number;
  ready: boolean;
  playing: boolean;
  cue: number;
  word: number;
  /** The transcript follows the voice until a person scrolls it. */
  following: boolean;
  /** The position under the thumb while scrubbing; playback stays where it was until release. */
  scrubbing: number | null;
  speedIndex: number;
  status: string;
  failed: boolean;
}

export interface SpeechPlayerConfig {
  speeds: readonly number[];
  skipBackS: number;
  skipAheadS: number;
}

/** Tolerance so a seek to a cue's own start lands in that cue, not the one before it. */
const CUE_EPSILON_S = 0.01;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** `m:ss`, or `h:mm:ss` past the hour. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(whole / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const secs = whole % SECONDS_PER_MINUTE;
  const mm = hours && minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours ? `${hours}:` : ''}${mm}:${secs < 10 ? '0' : ''}${secs}`;
}

/** The index of the cue being spoken at `time`: the last one that has started, or -1. */
export function cueAt(cues: readonly CueLike[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time + CUE_EPSILON_S) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return at;
}

/** The index of the word being spoken within `cue`, or -1 when it has no word times. */
export function wordAt(cue: CueLike | undefined, time: number): number {
  if (!cue || !cue.words.length) return -1;
  let at = 0;
  cue.words.forEach((word, i) => {
    if (word[0] <= time) at = i;
  });
  return at;
}

/** The cues' total length: the last cue's end, which stands in until the audio reports its own. */
export function cuesDuration(cues: readonly CueLike[]): number {
  return cues.length ? cues[cues.length - 1].end : 0;
}

/** Command ids and labels, declared once, for a palette, an MCP surface or a test to reuse. */
export const SPEECH_COMMANDS = {
  toggle: { label: 'Play or pause', hotkey: 'Space' },
  seek: { label: 'Go to a time' },
  skipBack: { label: 'Skip back' },
  skipAhead: { label: 'Skip ahead' },
  playCue: { label: 'Play from a sentence' },
  cycleSpeed: { label: 'Change speed' },
  follow: { label: 'Back to now' },
} as const;

export interface SpeechPlayer {
  store: StoreApi<SpeechPlayerState>;
  cues: readonly CueLike[];
  config: SpeechPlayerConfig;
  /** Reads the audio's position into the store. Call it on a frame and on `seeked`. */
  tick(): void;
  /** Events a renderer forwards from the audio element. */
  events: {
    loaded(): void;
    failed(): void;
    played(): void;
    paused(): void;
  };
  commands: {
    toggle(): void;
    seek(time: number, options?: { play?: boolean }): void;
    skipBack(): void;
    skipAhead(): void;
    playCue(index: number): void;
    cycleSpeed(): void;
    follow(on?: boolean): void;
    scrub(time: number): void;
    commitScrub(): void;
  };
}

/** A player over `cues`, driving `audio`. */
export function createSpeechPlayer(cues: readonly CueLike[], audio: AudioPort, config: SpeechPlayerConfig): SpeechPlayer {
  const store = createStore<SpeechPlayerState>()(
    immer<SpeechPlayerState>(() => ({
      time: 0,
      duration: cuesDuration(cues),
      ready: false,
      playing: false,
      cue: -1,
      word: -1,
      following: true,
      scrubbing: null,
      speedIndex: 0,
      status: 'Loading audio…',
      failed: false,
    })),
  );
  const set = (recipe: (draft: SpeechPlayerState) => void) => store.setState(recipe as never);

  const tick = () => {
    const time = audio.currentTime;
    const cue = cueAt(cues, time);
    const word = wordAt(cues[cue], time);
    const now = store.getState();
    if (now.time !== time || now.cue !== cue || now.word !== word) {
      set((d) => {
        d.time = time;
        d.cue = cue;
        d.word = word;
      });
    }
  };

  const say = (status: string, failed = false) =>
    set((d) => {
      d.status = status;
      d.failed = failed;
    });

  const toggle = () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    const started = audio.play();
    if (started && typeof started.catch === 'function') started.catch(() => say('Tap play to start.', true));
  };

  const seek = (time: number, options: { play?: boolean } = {}) => {
    const { duration } = store.getState();
    audio.currentTime = Math.max(0, Math.min(duration, time));
    tick();
    if (options.play && audio.paused) toggle();
  };

  const follow = (on = true) =>
    set((d) => {
      d.following = on;
    });

  return {
    store,
    cues,
    config,
    tick,
    events: {
      loaded() {
        const { duration } = audio;
        set((d) => {
          if (Number.isFinite(duration)) d.duration = duration;
          d.ready = true;
          d.status = '';
          d.failed = false;
        });
      },
      failed: () => say('This audio could not be played here.', true),
      played: () =>
        set((d) => {
          d.playing = true;
        }),
      paused: () =>
        set((d) => {
          d.playing = false;
        }),
    },
    commands: {
      toggle,
      seek,
      skipBack: () => seek(audio.currentTime - config.skipBackS),
      skipAhead: () => seek(audio.currentTime + config.skipAheadS),
      playCue(index) {
        const cue = cues[index];
        if (!cue) return;
        follow(true);
        seek(cue.start, { play: true });
      },
      cycleSpeed() {
        const next = (store.getState().speedIndex + 1) % config.speeds.length;
        audio.playbackRate = config.speeds[next];
        set((d) => {
          d.speedIndex = next;
        });
      },
      follow,
      scrub: (time) =>
        set((d) => {
          d.scrubbing = time;
        }),
      commitScrub() {
        const target = store.getState().scrubbing;
        if (target === null) return;
        set((d) => {
          d.scrubbing = null;
          d.following = true;
        });
        seek(target);
      },
    },
  };
}
