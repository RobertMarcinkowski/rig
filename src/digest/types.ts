// Plan morning-digest § 1. The shapes section 2 builds against: one row per job for a night's
// run log (runs/<night>.jsonl). The reader itself is in read.ts.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed. `at` keeps the log's offset.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One job over one night. Times are the log's `at` strings as written: never converted to UTC.
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError?: string; // the last line's error; undefined when it had none
  firstAt: string;
  lastAt: string;
};

// What a night reads as. `badLines` counts lines that did not parse: counted, never thrown.
// An empty file is { rows: [], badLines: 0 }; a night with no file is null (see readNight).
export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
};

// The reader's signature: <runsDir>/<night>.jsonl, night as YYYY-MM-DD. Synchronous, like the
// status board's own reads. Implemented in read.ts.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
