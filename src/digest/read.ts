import type { ReadNight } from './types.js';

// Reads <runsDir>/<night>.jsonl into one row per job. Returns null when the night has no file,
// so the page can 404 it and still render an empty file as "nothing ran".
// Stub: the next issue (plan § 1) fills it in.
export const readNight: ReadNight = (_runsDir, _night) => {
  throw new Error('not implemented');
};
