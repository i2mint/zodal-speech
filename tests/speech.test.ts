import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toColumnDefs } from '@zodal/ui';
import {
  SpeechTrackSchema,
  createSpeechPlayer,
  cueAt,
  formatTime,
  mountSpeechPlayer,
  parseSpeechTrack,
  speechTrackCollection,
  wordAt,
  type AudioPort,
  type CueLike,
} from '../src/index.js';

const cue = (start: number, end: number, text: string, extra: Partial<CueLike> = {}): CueLike => ({
  start,
  end,
  text,
  speaker: 'narrator',
  segment: 0,
  words: [],
  ...extra,
});
const CUES = [cue(0, 2, 'One.'), cue(2, 4, 'Two.'), cue(4, 9, 'Three.', { segment: 1 })];

function fakeAudio(): AudioPort & { paused: boolean; duration: number } {
  return {
    currentTime: 0,
    duration: 9,
    paused: true,
    playbackRate: 1,
    play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  };
}
const CONFIG = { speeds: [1, 2], skipBackS: 15, skipAheadS: 30 };

describe('the model', () => {
  it('applies defaults and accepts inline bytes or a URL', () => {
    const track = parseSpeechTrack({ title: 'T', audio: { src: 'a.mp3' }, cues: [{ start: 0, end: 1, text: 'Hi.' }] });
    expect(track.cues[0]).toMatchObject({ speaker: 'narrator', segment: 0, words: [] });
    expect(track.mime).toBe('audio/mpeg');
    expect(SpeechTrackSchema.safeParse({ title: 'T', audio: { base64: 'AA==' }, cues: [] }).success).toBe(true);
  });

  it('refuses a track with no audio, saying so', () => {
    expect(() => parseSpeechTrack({ title: 'T', audio: {}, cues: [] })).toThrow(/Not a speech track/);
  });

  it('is a zodal collection whose table omits the audio and the cues', () => {
    const ids = toColumnDefs(speechTrackCollection).map((c: { id: string }) => c.id);
    expect(ids).toContain('title');
    expect(ids).not.toContain('cues');
    expect(ids).not.toContain('audio');
  });
});

describe('transcript logic', () => {
  it('finds the cue being spoken', () => {
    expect(cueAt(CUES, 0)).toBe(0);
    expect(cueAt(CUES, 2.5)).toBe(1);
    expect(cueAt(CUES, 100)).toBe(2);
    expect(cueAt([cue(1, 2, 'x')], 0.5)).toBe(-1);
    expect(cueAt([], 1)).toBe(-1);
  });

  it('lands in the cue a seek targeted, despite rounding', () => {
    expect(cueAt(CUES, 1.995)).toBe(1);
  });

  it('finds the word being spoken', () => {
    const withWords = cue(0, 2, 'a b', { words: [[0, 1, 'a'], [1, 2, 'b']] });
    expect(wordAt(withWords, 1.5)).toBe(1);
    expect(wordAt(cue(0, 1, 'x'), 0.5)).toBe(-1);
    expect(wordAt(undefined, 0.5)).toBe(-1);
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('the headless player', () => {
  it('plays from a tapped sentence and resumes following', () => {
    const audio = fakeAudio();
    const p = createSpeechPlayer(CUES, audio, CONFIG);
    p.commands.follow(false);
    p.commands.playCue(1);
    expect(audio.currentTime).toBe(2);
    expect(audio.paused).toBe(false);
    expect(p.store.getState()).toMatchObject({ cue: 1, following: true });
  });

  it('clamps skips to the track', () => {
    const audio = fakeAudio();
    const p = createSpeechPlayer(CUES, audio, CONFIG);
    p.events.loaded();
    p.commands.skipAhead();
    expect(audio.currentTime).toBe(9);
    p.commands.skipBack();
    expect(audio.currentTime).toBe(0);
  });

  it('seeks only when a scrub is released', () => {
    const audio = fakeAudio();
    const p = createSpeechPlayer(CUES, audio, CONFIG);
    p.commands.scrub(5);
    expect(audio.currentTime).toBe(0);
    expect(p.store.getState().scrubbing).toBe(5);
    p.commands.commitScrub();
    expect(audio.currentTime).toBe(5);
    expect(p.store.getState().scrubbing).toBeNull();
  });

  it('cycles speed and sets it on the audio', () => {
    const audio = fakeAudio();
    const p = createSpeechPlayer(CUES, audio, CONFIG);
    p.commands.cycleSpeed();
    expect(audio.playbackRate).toBe(2);
    p.commands.cycleSpeed();
    expect(audio.playbackRate).toBe(1);
  });

  it('says so when the browser refuses to start', async () => {
    const audio = fakeAudio();
    audio.play = () => Promise.reject(new Error('blocked'));
    const p = createSpeechPlayer(CUES, audio, CONFIG);
    p.commands.toggle();
    await new Promise((r) => setTimeout(r));
    expect(p.store.getState()).toMatchObject({ status: 'Tap play to start.', failed: true });
  });
});

describe('the DOM renderer', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.append(host);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    window.HTMLMediaElement.prototype.load = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });
  const mount = (opts = {}) =>
    mountSpeechPlayer(host, { title: 'T', audio: { src: 'a.mp3' }, cues: CUES }, opts);

  it('draws one paragraph per segment and one span per sentence, as text', () => {
    mountSpeechPlayer(host, { title: 'T', audio: { src: 'a.mp3' }, cues: [cue(0, 1, '<img src=x onerror=alert(1)>')] });
    expect(host.querySelector('img')).toBeNull();
    host.innerHTML = '';
    mount();
    expect(host.querySelectorAll('.zs-text p').length).toBe(2);
    expect(host.querySelectorAll('.zs-s').length).toBe(3);
  });

  it('names speakers only when there is more than one', () => {
    mount();
    expect(host.querySelector('.zs-who')).toBeNull();
    host.innerHTML = '';
    mountSpeechPlayer(host, { title: 'T', audio: { src: 'a' }, cues: [cue(0, 1, 'a'), cue(1, 2, 'b', { speaker: 'guest', segment: 1 })] });
    expect(host.querySelectorAll('.zs-who').length).toBe(2);
  });

  it('seeks when a sentence is tapped', () => {
    const { audio, player } = mount();
    let at = 0;
    Object.defineProperty(audio, 'currentTime', { get: () => at, set: (v: number) => { at = v; }, configurable: true });
    (host.querySelectorAll('.zs-s')[2] as HTMLElement).click();
    expect(at).toBe(4);
    expect(player.store.getState().cue).toBe(2);
    expect(host.querySelectorAll('.zs-s')[2].classList.contains('zs-on')).toBe(true);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('stops following on a hand scroll and offers the way back', async () => {
    const { audio, player } = mount();
    Object.defineProperty(audio, 'paused', { value: false, configurable: true });
    audio.dispatchEvent(new Event('play'));
    // The page has just scrolled itself to the first sentence, which is not a person scrolling.
    window.dispatchEvent(new Event('wheel'));
    expect(player.store.getState().following).toBe(true);
    const later = Date.now() + 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    window.dispatchEvent(new Event('wheel'));
    clock.mockRestore();
    expect(player.store.getState().following).toBe(false);
    const back = host.querySelector('.zs-follow') as HTMLButtonElement;
    expect(back.hidden).toBe(false);
    back.click();
    expect(player.store.getState().following).toBe(true);
    expect(back.hidden).toBe(true);
  });

  it('leaves no listener or element behind', () => {
    const { destroy, player } = mount();
    destroy();
    expect(host.children.length).toBe(0);
    window.dispatchEvent(new Event('wheel'));
    expect(player.store.getState().following).toBe(true);
  });

  it('leaves the keyboard alone unless asked', () => {
    const { player } = mount();
    const spy = vi.spyOn(player.commands, 'toggle');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
  it('never sets the host font on its root, and lets [hidden] win', () => {
    expect(css).not.toMatch(/\.zs-player\s*\{[^}]*font/);
    expect(css).toContain('[hidden] { display: none !important; }');
  });
});

describe('the one-file bundle', () => {
  const bundle = join(process.cwd(), 'dist/player.iife.js');
  it.runIf(existsSync(bundle))('loads where there is no `process`, and exposes mount', () => {
    const page = vm.createContext({});
    vm.runInContext(`${readFileSync(bundle, 'utf8')};globalThis.got = typeof ZodalSpeech.mount;`, page);
    expect((page as { got?: string }).got).toBe('function');
  });
});
