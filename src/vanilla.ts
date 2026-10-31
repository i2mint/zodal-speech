/**
 * The DOM renderer: `mountSpeechPlayer(host, track, options)`, with no framework.
 *
 * It draws the transcript and the transport inside `host` and returns a handle whose
 * `destroy()` removes every listener it added. Import `@zodal/speech/styles.css` beside it.
 */
import { createSpeechPlayer, cuesDuration, formatTime, type CueLike, type SpeechPlayer } from './core.js';

/** The track as this renderer reads it. Validate with `parseSpeechTrack` where data is untrusted. */
export interface MountTrack {
  title: string;
  lang?: string;
  audio: { src: string } | { base64: string };
  mime?: string;
  filename?: string;
  cues: ReadonlyArray<Partial<CueLike> & Pick<CueLike, 'start' | 'end' | 'text'>>;
}

export interface MountOptions {
  speeds?: readonly number[];
  skipBackS?: number;
  skipAheadS?: number;
  bar?: 'sticky' | 'fixed';
  hotkeys?: boolean;
  /** Offers the audio as a download. */
  download?: boolean;
}

export interface MountedSpeechPlayer {
  player: SpeechPlayer;
  audio: HTMLAudioElement;
  destroy(): void;
}

const DEFAULT_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
const DEFAULT_SKIP_BACK_S = 15;
const DEFAULT_SKIP_AHEAD_S = 30;
/** How long after the page's own smooth scroll a scroll event is not a person's. */
const OWN_SCROLL_MS = 900;
const ARROW_SEEK_S = 5;
const SCROLL_KEYS = ['PageUp', 'PageDown', 'Home', 'End'];
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';
const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function normalise(cue: MountTrack['cues'][number]): CueLike {
  return { speaker: 'narrator', segment: 0, words: [], ...cue };
}

function audioUrl(track: MountTrack): { url: string; revoke: () => void } {
  if ('src' in track.audio) return { url: track.audio.src, revoke: () => {} };
  const binary = atob(track.audio.base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // A blob: URL, because every browser can seek in one.
  const url = URL.createObjectURL(new Blob([bytes], { type: track.mime ?? 'audio/mpeg' }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/** One paragraph per segment, one span per sentence and per word. */
function drawTranscript(cues: readonly CueLike[]) {
  const text = el('div', { class: 'zs-text', 'aria-label': 'Transcript' });
  const sentences: HTMLElement[] = [];
  const words: HTMLElement[][] = [];
  const many = new Set(cues.map((c) => c.speaker)).size > 1;
  let paragraph: HTMLElement | null = null;
  let segment = -1;
  cues.forEach((cue, i) => {
    if (cue.segment !== segment || !paragraph) {
      segment = cue.segment;
      paragraph = el('p');
      text.append(paragraph);
      if (many) paragraph.append(el('span', { class: 'zs-who' }, cue.speaker));
    } else {
      paragraph.append(' ');
    }
    const sentence = el('span', { class: 'zs-s', 'data-cue': String(i), tabindex: '0', role: 'button' });
    const spans = (cue.words.length ? cue.words.map((w) => w[2]) : [cue.text]).map((word, k) => {
      if (k) sentence.append(' ');
      const span = el('span', { class: 'zs-w' }, word);
      sentence.append(span);
      return span;
    });
    paragraph.append(sentence);
    sentences.push(sentence);
    words.push(spans);
  });
  return { text, sentences, words };
}

/** Mounts a player for `track` inside `host`. */
export function mountSpeechPlayer(host: HTMLElement, track: MountTrack, options: MountOptions = {}): MountedSpeechPlayer {
  const cues = track.cues.map(normalise);
  const config = {
    speeds: options.speeds?.length ? options.speeds : DEFAULT_SPEEDS,
    skipBackS: options.skipBackS ?? DEFAULT_SKIP_BACK_S,
    skipAheadS: options.skipAheadS ?? DEFAULT_SKIP_AHEAD_S,
  };
  const audio = el('audio', { preload: 'auto' });
  const player = createSpeechPlayer(cues, audio, config);
  const { commands, store, events } = player;
  const { url, revoke } = audioUrl(track);

  const { text, sentences, words } = drawTranscript(cues);
  const range = el('input', { class: 'zs-seek', type: 'range', min: '0', max: '0', step: '0.1', value: '0', 'aria-label': 'Position' });
  const ghost = el('div', { class: 'zs-ghost' });
  const now = el('span', { class: 'zs-now' }, '0:00');
  const status = el('span', { class: 'zs-status', 'aria-live': 'polite' });
  const total = el('span', { class: 'zs-total' }, formatTime(cuesDuration(cues)));
  const speed = el('button', { class: 'zs-speed', type: 'button', 'aria-label': 'Playback speed' }, `${config.speeds[0]}×`);
  const back = el('button', { class: 'zs-skip', type: 'button', 'aria-label': `Back ${config.skipBackS} seconds` }, `−${config.skipBackS}s`);
  const ahead = el('button', { class: 'zs-skip', type: 'button', 'aria-label': `Ahead ${config.skipAheadS} seconds` }, `+${config.skipAheadS}s`);
  const icon = document.createElementNS(SVG_NS, 'path');
  icon.setAttribute('d', ICON_PLAY);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.append(icon);
  const play = el('button', { class: 'zs-play', type: 'button', 'aria-label': 'Play', disabled: '' }, svg);
  const followButton = el('button', { class: 'zs-follow', type: 'button', hidden: '' }, 'Back to now');
  const bar = el(
    'div',
    { class: `zs-bar zs-bar-${options.bar ?? 'sticky'}` },
    el(
      'div',
      { class: 'zs-bar-in' },
      el('div', { class: 'zs-track' }, range, ghost),
      el('div', { class: 'zs-times' }, now, status, total),
      el('div', { class: 'zs-controls' }, speed, back, play, ahead, el('span', { class: 'zs-spacer' })),
    ),
  );
  const root = el('div', { class: 'zs-player' }, text, followButton, bar, audio);
  if (options.download && track.filename !== '') {
    const link = el('a', { class: 'zs-download', href: url, download: track.filename ?? 'speech.mp3' }, 'Download audio');
    root.prepend(link);
  }
  host.append(root);

  // Everything added to something outside `root` goes through here, so destroy() can undo it.
  const undo: Array<() => void> = [revoke];
  const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, handler as EventListener, opts);
    undo.push(() => target.removeEventListener(type, handler as EventListener, opts));
  };

  // Scrolling by hand stops the following; the page's own smooth scroll does not.
  let ownScrollUntil = 0;
  const bring = (node: HTMLElement) => {
    ownScrollUntil = Date.now() + OWN_SCROLL_MS;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView?.({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  };
  const byHand = () => {
    if (Date.now() > ownScrollUntil) commands.follow(false);
  };
  listen(window, 'wheel', byHand, { passive: true });
  listen(window, 'touchmove', byHand, { passive: true });
  listen<KeyboardEvent>(window, 'keydown', (event) => {
    if (SCROLL_KEYS.includes(event.key)) commands.follow(false);
  });

  // Draw: one subscriber, and each part changes only when its own value did.
  let frame = 0;
  const loop = () => {
    player.tick();
    if (!audio.paused) frame = requestAnimationFrame(loop);
  };
  let shown = store.getState();
  const paint = (state = store.getState(), last = shown, first = false) => {
    if (first || state.cue !== last.cue) {
      sentences[last.cue]?.classList.remove('zs-on');
      sentences[state.cue]?.classList.add('zs-on');
      if (state.following && sentences[state.cue]) bring(sentences[state.cue]);
    }
    if (first || state.cue !== last.cue || state.word !== last.word || state.playing !== last.playing) {
      words[last.cue]?.[last.word]?.classList.remove('zs-on');
      if (state.playing) words[state.cue]?.[state.word]?.classList.add('zs-on');
    }
    if (first || state.playing !== last.playing) {
      root.classList.toggle('zs-playing', state.playing);
      icon.setAttribute('d', state.playing ? ICON_PAUSE : ICON_PLAY);
      play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    }
    if (first || state.following !== last.following || state.playing !== last.playing) {
      followButton.hidden = state.following || !state.playing;
      if (state.following && !last.following && sentences[state.cue]) bring(sentences[state.cue]);
    }
    if (first || state.duration !== last.duration) {
      range.max = String(state.duration);
      total.textContent = formatTime(state.duration);
    }
    if (first || state.ready !== last.ready) play.disabled = !state.ready;
    if (first || state.status !== last.status || state.failed !== last.failed) {
      status.textContent = state.status;
      status.classList.toggle('zs-err', state.failed);
    }
    if (first || state.speedIndex !== last.speedIndex) speed.textContent = `${config.speeds[state.speedIndex]}×`;
    if (first || state.scrubbing !== last.scrubbing) {
      bar.classList.toggle('zs-dragging', state.scrubbing !== null);
      if (state.scrubbing !== null && last.scrubbing === null) {
        ghost.style.left = `${(100 * state.time) / (state.duration || 1)}%`;
      }
    }
    const shownTime = state.scrubbing ?? state.time;
    if (state.scrubbing === null) range.value = String(state.time);
    now.textContent = formatTime(shownTime);
    shown = state;
  };
  paint(shown, shown, true);
  undo.push(store.subscribe((state, previous) => paint(state, previous)));

  // The audio element tells the store what happened.
  listen(audio, 'loadedmetadata', events.loaded);
  listen(audio, 'error', events.failed);
  listen(audio, 'play', () => {
    events.played();
    loop();
  });
  listen(audio, 'pause', () => {
    cancelAnimationFrame(frame);
    events.paused();
    player.tick();
  });
  listen(audio, 'seeked', player.tick);
  listen(audio, 'ended', events.paused);

  // The person tells the commands what to do.
  listen<MouseEvent>(text, 'click', (event) => {
    const sentence = (event.target as Element).closest?.('.zs-s') as HTMLElement | null;
    if (sentence) commands.playCue(Number(sentence.dataset.cue));
  });
  listen<KeyboardEvent>(text, 'keydown', (event) => {
    const sentence = (event.target as Element).closest?.('.zs-s') as HTMLElement | null;
    if (!sentence || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    commands.playCue(Number(sentence.dataset.cue));
  });
  listen(followButton, 'click', () => commands.follow(true));
  listen(play, 'click', commands.toggle);
  listen(back, 'click', commands.skipBack);
  listen(ahead, 'click', commands.skipAhead);
  listen(speed, 'click', commands.cycleSpeed);
  // Scrubbing moves the readout and a ghost of where playback is; the seek happens on release.
  listen(range, 'input', () => commands.scrub(Number(range.value)));
  listen(range, 'change', commands.commitScrub);

  if (options.hotkeys) {
    listen<KeyboardEvent>(document, 'keydown', (event) => {
      if ((event.target as Element).closest?.('button, input, a, summary, [role="button"]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        commands.toggle();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        commands.seek(audio.currentTime - ARROW_SEEK_S);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        commands.seek(audio.currentTime + ARROW_SEEK_S);
      }
    });
  }

  // The lock screen. Not every browser has it, and some refuse individual actions.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title });
      navigator.mediaSession.setActionHandler('seekbackward', commands.skipBack);
      navigator.mediaSession.setActionHandler('seekforward', commands.skipAhead);
      undo.push(() => {
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
      });
    } catch {
      // The transport on the page still works.
    }
  }

  audio.src = url;

  return {
    player,
    audio,
    destroy() {
      cancelAnimationFrame(frame);
      audio.pause();
      undo.forEach((fn) => fn());
      root.remove();
    },
  };
}
