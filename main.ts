// site-generator-speed-01: the driver. It reads every case from /input/cases.json, answers each with
// runStream() from solve.js, and writes /output/answers.json — streaming the JSON text out as each file is
// produced, so neither the answer trees nor one 7 MB string are ever held whole.
// The house baseline's driver is MIT and is kept here in shape: the same input and output paths, the same
// setFlagsFromString('--no-incremental-marking') before solve.js is imported, and the same bytes written.

import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { runStream } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  runStream: (input: unknown, sink: (path: string, text: string) => void) => void;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];

const fd = openSync(join(OUTPUT_DIR, 'answers.json'), 'w');
let chunk = '';
const flush = (): void => {
  if (chunk !== '') {
    writeSync(fd, chunk);
    chunk = '';
  }
};
const out = (s: string): void => {
  chunk += s;
  if (chunk.length >= 262144) flush();
};

out('[');
for (let i = 0; i < cases.length; i++) {
  if (i > 0) out(',');
  out('{');
  let first = true;
  runStream(cases[i].input, (path, text) => {
    if (first) first = false;
    else out(',');
    out(JSON.stringify(path));
    out(':');
    out(JSON.stringify(text));
  });
  out('}');
}
out(']');
flush();
closeSync(fd);
