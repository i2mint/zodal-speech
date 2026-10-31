# @zodal/speech

A zodal model and player for speech audio with a synced transcript. The sentence being spoken is highlighted and kept in view, tapping a sentence plays from it, and scrolling by hand pauses the following until "Back to now". It works like the transcripts in a podcast app.

```ts
import { mountSpeechPlayer } from '@zodal/speech/vanilla';
import '@zodal/speech/styles.css';

mountSpeechPlayer(document.getElementById('player')!, {
  title: 'Morning overview',
  audio: { src: 'overview.mp3' },
  cues: [
    { start: 0, end: 2.1, text: 'Four sessions ran overnight.' },
    { start: 2.1, end: 4.6, text: 'One of them needs you.' },
  ],
});
```

## What is in it

| Import | What | Needs |
|---|---|---|
| `@zodal/speech` | `SpeechTrackSchema` and friends, `parseSpeechTrack`, `speechTrackCollection`, plus everything below | zod, `@zodal/core` |
| `@zodal/speech/core` | The headless player: `createSpeechPlayer`, `cueAt`, `wordAt`, `formatTime`, `SPEECH_COMMANDS` | no DOM, no zod |
| `@zodal/speech/vanilla` | The DOM renderer: `mountSpeechPlayer` | no framework |
| `@zodal/speech/player.iife.js` | The renderer as one file, with the global `ZodalSpeech.mount`, for a page that inlines its script | nothing |
| `@zodal/speech/styles.css` | The look, tuned through `--zs-*` tokens | |
| `@zodal/speech/speech-track.schema.json` | JSON Schema generated from the Zod schema, for a writer in another language | |

## The model

A **track** is a title, some audio and a list of cues. A **cue** is one sentence with `start` and `end` in seconds, plus its `speaker`, its `segment` (consecutive cues of a segment form a paragraph) and optional `words` as `[start, end, text]` tuples.

The audio is `{ src }` or `{ base64 }`. Use `base64` when one file has to play anywhere: a sandboxed frame has no origin and cannot fetch a sibling file, and a `blob:` URL can be seeked in every browser.

`mountSpeechPlayer` does not validate, so the page-sized bundle stays free of zod. Call `parseSpeechTrack` where data arrives from outside your own code. Cue text is always written as text, never as HTML.

## A library of tracks

`speechTrackCollection` is an ordinary zodal collection, so a list of overviews gets columns, filters and a store like any other, with the audio and cues hidden from the table:

```ts
import { speechTrackCollection } from '@zodal/speech';
import { toColumnDefs } from '@zodal/ui';

const columns = toColumnDefs(speechTrackCollection);
```

## Options

`SpeechPlayerOptionsSchema` declares them: `speeds`, `skipBackS`, `skipAheadS`, `bar` (`sticky` stays inside its host, `fixed` owns the bottom of the page) and `hotkeys` (Space and the arrow keys, off by default, because an embedded widget does not own the keyboard). `mountSpeechPlayer` also takes `download` to offer the audio as a file.

## Another renderer

`createSpeechPlayer(cues, audio, config)` holds all the behaviour in a zustand store. A React renderer subscribes to `player.store` and calls `player.commands`, and adds nothing else. `AudioPort` is the part of an audio element the player uses, so a test can pass a plain object.

`SPEECH_COMMANDS` names each action once, ready to register in acture when an app has a palette, hotkeys or an MCP surface.

## Licence

MIT
