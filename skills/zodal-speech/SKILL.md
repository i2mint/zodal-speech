---
name: zodal-speech
description: >-
  Play speech audio with a synced transcript using @zodal/speech: the sentence being spoken is highlighted and followed, tapping a sentence plays from it, scrolling by hand pauses the following. Use for any web UI that plays narration, a podcast, an audio overview, a spoken answer or text-to-speech output, and for "read this aloud with the text", "audio with a scrolling script", "tap a sentence to listen from there", or a list of audio overviews. Covers the Zod model, the headless store, the DOM renderer and how a server-side writer produces a one-file player page. Not for music or sound effects with no transcript: use a plain audio element.
metadata:
  audience: developers
---

# zodal-speech

Do not write another `<audio>` element with a hand-made transcript. Use this package, and add what is missing to it.

## Pick the entry

| You have | Use |
|---|---|
| A page or app in the browser | `mountSpeechPlayer(host, track, options)` from `@zodal/speech/vanilla`, plus `@zodal/speech/styles.css` |
| A React app | No React renderer yet. Build it over `createSpeechPlayer` from `@zodal/speech/core` and contribute it here |
| A server writing a self-contained page | Inline `player.iife.js` and `styles.css`, then call `ZodalSpeech.mount(el, track, { hotkeys: true, download: true })`. `briefsmith.player_html` in thorwhalen/hailing is the worked example |
| Python, or another language, producing tracks | Validate against `speech-track.schema.json`, generated from the Zod schema |
| A list of tracks | `speechTrackCollection`, with `toColumnDefs` and a `DataProvider` |

## Rules

- **The Zod schema is the source of truth.** Change `src/schema.ts`; the JSON Schema is generated at build time.
- **Inline the audio as `base64` in a sandboxed frame** (an annals document, for one). It has no origin, so it cannot fetch a sibling file.
- **The transport goes at the top (`bar: 'top'`, the default), embedded or not.** A host can cut off a widget's bottom (a frame taller than the screen did, in annals: the owner never saw Play), never its top. `sticky` / `fixed` (bottom) are for a page that owns the whole screen and wants a podcast-style bar. `hotkeys` stays off when embedded, because an embedded widget does not own the keyboard.
- **Call `destroy()` when the host goes away.** The player listens on `window` and `document`.
- **Cue timing comes from the writer.** The player does not align text to audio. `briefsmith.render_timed` does it in Python, and exact word times from a voice API can replace its estimate.

## Known limits

- Word highlighting is only as exact as the word times given. briefsmith's are estimated within each sentence.
- Tested in Chromium. Check WebKit on a real iPhone before relying on the lock-screen controls.
