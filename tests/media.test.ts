import { describe, it, expect } from 'vitest';
import { createRegistry } from 'acture';
import { createMediaPlayer, mediaCommands, urlSource, CONTINUOUS_COMMAND_IDS, type MediaPort } from '../src/media';

/** A fake port: no DOM, no UI. */
function fakePort(): MediaPort {
  let paused = true;
  return {
    currentTime: 0, duration: 100, playbackRate: 1, volume: 1,
    get paused() { return paused; },
    play() { paused = false; }, pause() { paused = true; },
  };
}

describe('headless control, as an external controller (gesture, MIDI) would drive it', () => {
  it('drives a port through commands alone, with a 60 Hz stream of targets', async () => {
    const port = fakePort();
    const player = createMediaPlayer(port);
    const registry = createRegistry();
    registry.registerAll(mediaCommands(player));
    await registry.dispatch('media.enqueue', { item: await urlSource('https://x.test/a%20b.mp3') });
    expect((await registry.dispatch('media.play')).ok).toBe(true);
    expect(player.store.getState().playing).toBe(true);
    for (let i = 0; i < 60; i++) await registry.dispatch('media.seekTo', { seconds: i });
    await registry.dispatch('media.setRate', { rate: 1.5 });
    await registry.dispatch('media.setVolume', { volume: 0.4 });
    expect(port.currentTime).toBe(59);
    expect(port.playbackRate).toBe(1.5);
    expect(player.store.getState()).toMatchObject({ time: 59, rate: 1.5, volume: 0.4 });
    expect(player.store.getState().queue[0].title).toBe('a b.mp3');
  });
  it('rejects bad params and clamps seeks', async () => {
    const port = fakePort();
    const registry = createRegistry();
    registry.registerAll(mediaCommands(createMediaPlayer(port)));
    expect((await registry.dispatch('media.setVolume', { volume: 2 })).ok).toBe(false);
    await registry.dispatch('media.seekTo', { seconds: 500 });
    expect(port.currentTime).toBe(100);
  });
  it('queues play-next ahead of the rest and lists continuous ids as registered commands', async () => {
    const player = createMediaPlayer(fakePort());
    const mk = (id: string) => ({ id, src: id, title: id });
    player.enqueue(mk('a')); player.enqueue(mk('c')); player.enqueue(mk('b'), { next: true });
    expect(player.store.getState().queue.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    player.next();
    expect(player.store.getState().index).toBe(1);
    const ids = mediaCommands(player).map((c) => c.id);
    for (const id of CONTINUOUS_COMMAND_IDS) expect(ids).toContain(id);
  });
});
