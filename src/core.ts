/**
 * The headless player: pure transcript logic plus a zustand store, with no DOM and no zod.
 *
 * A renderer draws from `player.store` and calls `player.commands`. The audio element arrives
 * through `AudioPort`, so tests and other platforms can supply their own.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';
import { cueAt, cuesDuration, seekThenPlay, wordAt } from '@zodal/media';

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
  /** An HTMLMediaElement's; with them a tap after the end plays from the tap on Safari too (playback.ts). */
  readonly ended?: boolean;
  readonly seeking?: boolean;
  addEventListener?(type: 'seeked', listener: () => void): void;
  removeEventListener?(type: 'seeked', listener: () => void): void;
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

// The lookup by time is @zodal/media's, shared with the lyrics and subtitle views.
export { cueAt, wordAt, cuesDuration, formatTime, CUE_EPSILON_S } from '@zodal/media/cues';

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

  const start = () => {
    const started = audio.play();
    if (started && typeof started.catch === 'function') started.catch(() => say('Tap play to start.', true));
  };

  // A play held until its seek lands (after the end, on Safari): a tap on Play meanwhile means pause.
  let held: AbortController | null = null;
  const release = () => {
    held?.abort();
    held = null;
  };

  const toggle = () => {
    if (held) release();
    else if (!audio.paused) audio.pause();
    else start();
  };

  const seek = (time: number, options: { play?: boolean } = {}) => {
    const { duration } = store.getState();
    const to = Math.max(0, Math.min(duration, time));
    release();
    if (options.play && audio.paused) {
      const mine = new AbortController();
      held = mine;
      seekThenPlay(audio, to, { play: start, signal: mine.signal }).then(
        () => { if (held === mine) held = null; },
        () => undefined, // cancelled: nothing to play
      );
    } else {
      audio.currentTime = to;
    }
    tick();
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
