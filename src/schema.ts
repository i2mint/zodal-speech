/**
 * The model: what a piece of speech audio with a synced transcript is.
 *
 * These schemas are the single source of truth. Types are inferred from them, the collection
 * below is defined over them, and `dist/speech-track.schema.json` is generated from them for
 * writers in other languages.
 */
import { defineCollection } from '@zodal/core';
import { z } from 'zod';

/** `[start, end, text]`, in seconds. A tuple, because a transcript holds thousands of them. */
export const SpeechWordSchema = z.tuple([z.number().min(0), z.number().min(0), z.string()]);

/** One sentence and when it is spoken. Consecutive cues of a `segment` form a paragraph. */
export const SpeechCueSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string(),
  speaker: z.string().default('narrator'),
  segment: z.number().int().min(0).default(0),
  words: z.array(SpeechWordSchema).default([]),
});

/**
 * Where the audio is: a URL, or the bytes themselves.
 *
 * Inline bytes let one file play anywhere, including a sandboxed frame that has no origin and
 * so cannot fetch a sibling file.
 */
export const SpeechAudioSchema = z.union([
  z.object({ src: z.string().min(1) }).strict(),
  z.object({ base64: z.string().min(1) }).strict(),
]);

/** Only links a page can safely open: relative, or http(s). */
const safeLink = z.string().regex(/^(https?:\/\/|\/(?!\/))/i, 'must be http(s) or start with one /');

/** What a track was based on: a label, or a label with a link to it. */
export const SpeechSourceSchema = z.union([
  z.string().min(1),
  z.object({ title: z.string().min(1), url: safeLink.optional() }).strict(),
]);

export const SpeechTrackSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().default(''),
  lang: z.string().default('en'),
  audio: SpeechAudioSchema,
  mime: z.string().default('audio/mpeg'),
  filename: z.string().default('speech.mp3'),
  cues: z.array(SpeechCueSchema),
  sources: z.array(SpeechSourceSchema).default([]),
});

/** How the player behaves. Bounded numbers, so zodal-dials can infer a settings surface. */
export const SpeechPlayerOptionsSchema = z.object({
  speeds: z.array(z.number().positive()).min(1).default([1, 1.25, 1.5, 1.75, 2, 0.75]),
  skipBackS: z.number().int().min(1).max(120).default(15),
  skipAheadS: z.number().int().min(1).max(120).default(30),
  /** `fixed` owns the bottom of the page; `sticky` stays inside its host. */
  bar: z.enum(['sticky', 'fixed']).default('sticky'),
  /** Space and the arrow keys. Off by default: an embedded widget does not own the keyboard. */
  hotkeys: z.boolean().default(false),
});

export type SpeechWord = z.infer<typeof SpeechWordSchema>;
export type SpeechCue = z.infer<typeof SpeechCueSchema>;
export type SpeechAudio = z.infer<typeof SpeechAudioSchema>;
export type SpeechSource = z.infer<typeof SpeechSourceSchema>;
export type SpeechTrack = z.infer<typeof SpeechTrackSchema>;
export type SpeechTrackInput = z.input<typeof SpeechTrackSchema>;
export type SpeechPlayerOptions = z.infer<typeof SpeechPlayerOptionsSchema>;
export type SpeechPlayerOptionsInput = z.input<typeof SpeechPlayerOptionsSchema>;

/** A library of tracks: one with an id, for a `DataProvider`. */
export const SpeechTrackRecordSchema = SpeechTrackSchema.extend({ id: z.string().min(1) });
export type SpeechTrackRecord = z.infer<typeof SpeechTrackRecordSchema>;

/** The collection, so a list of overviews gets columns, filters and a store like any other. */
export const speechTrackCollection = defineCollection(SpeechTrackRecordSchema, {
  fields: {
    id: { hidden: true },
    title: { searchable: true, sortable: true },
    audio: { hidden: true },
    cues: { hidden: true },
    mime: { hidden: true },
    filename: { hidden: true },
  },
});

/** The track, validated, with its defaults applied. Throws a readable error on bad data. */
export function parseSpeechTrack(value: unknown): SpeechTrack {
  const parsed = SpeechTrackSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Not a speech track: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
