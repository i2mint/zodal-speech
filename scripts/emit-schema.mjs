// Writes the track's JSON Schema, so a writer in another language validates against the Zod SSOT.
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SpeechTrackSchema } from '../dist/index.js';

const schema = z.toJSONSchema(SpeechTrackSchema, { io: 'input' });
writeFileSync(new URL('../dist/speech-track.schema.json', import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
