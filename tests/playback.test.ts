import { describe, expect, it, vi } from 'vitest';
import { createSpeechPlayer, seekThenPlay, type AudioPort } from '../src/index.js';
import { createMediaPlayer, type MediaPort } from '../src/media.js';

/**
 * An element that behaves like WebKit's (annals, 2026-11-13): a seek lands later (on `land()`),
 * and play() on an ended element whose seek has not landed starts from 0.
 */
function webkitLike(duration = 9) {
  let engineAt = duration;
  let target: number | null = null;
  const listeners = new Set<() => void>();
  const el = {
    duration,
    paused: true,
    ended: true,
    playbackRate: 1,
    volume: 1,
    get seeking() { return target !== null; },
    get currentTime() { return target ?? engineAt; },
    set currentTime(t: number) { target = t; this.ended = false; },
    play: vi.fn(function (this: { paused: boolean }) {
      if (target !== null) target = null, engineAt = 0; // the trap: the pending seek is lost
      el.paused = false;
      return Promise.resolve();
    }),
    pause() { el.paused = true; },
    addEventListener: (_: 'seeked', f: () => void) => { listeners.add(f); },
    removeEventListener: (_: 'seeked', f: () => void) => { listeners.delete(f); },
    /** The seek lands: the engine moves and `seeked` fires. */
    land() {
      if (target === null) return;
      engineAt = target; target = null;
      [...listeners].forEach((f) => f());
    },
    get engineAt() { return engineAt; },
  };
  return el;
}

describe('seekThenPlay', () => {
  it('plays from the chosen point after the end, once the seek has landed', async () => {
    const el = webkitLike();
    const done = seekThenPlay(el, 4);
    expect(el.play).not.toHaveBeenCalled();
    el.land();
    await done;
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.engineAt).toBe(4);
  });

  it('plays at once, inside the tap, when the element had not ended', async () => {
    const el = webkitLike();
    el.ended = false;
    await seekThenPlay(el, 4);
    expect(el.play).toHaveBeenCalledOnce();
  });

  it('plays anyway when the seek never says it landed', async () => {
    vi.useFakeTimers();
    try {
      const el = webkitLike();
      const done = seekThenPlay(el, 4, { timeoutMs: 100 });
      vi.advanceTimersByTime(100);
      await done;
      expect(el.play).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is what the transcript player does when a sentence is tapped after the end', async () => {
    const el = webkitLike();
    const cues = [
      { start: 0, end: 2, text: 'One.', speaker: 'n', segment: 0, words: [] },
      { start: 4, end: 9, text: 'Two.', speaker: 'n', segment: 0, words: [] },
    ];
    const player = createSpeechPlayer(cues, el as unknown as AudioPort, { speeds: [1], skipBackS: 10, skipAheadS: 10 });
    player.commands.playCue(1);
    expect(el.play).not.toHaveBeenCalled();
    el.land();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.engineAt).toBe(4);
  });

  it('is what the media player does on seekTo then play after the end', async () => {
    const el = webkitLike();
    const player = createMediaPlayer(el as unknown as MediaPort);
    player.seekTo(4);
    const playing = player.play();
    el.land();
    await playing;
    expect(el.engineAt).toBe(4);
  });
});
