import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

// runs/ is read-only: these tests only read it. Anything written goes to a temp dir.
const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs and 1 bad line, rows sorted by job', () => {
    expect(night).not.toBeNull();
    expect(night!.badLines).toBe(1);
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts parsed lines per status', () => {
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('lane/sync: runs, one retry, times as written', () => {
    expect(night!.rows.find((r) => r.job === 'lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: undefined,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('keeps the row whose owner is null', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, retries: 0, lastStatus: 'ok' });
    expect(row!.lastError).toBeUndefined();
  });

  it('fixtures/refresh: 3 retries, last line ok so no last error', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', owner: 'rook' });
    expect(row!.lastError).toBeUndefined();
    expect(row!.firstAt).toBe('2026-10-29T01:30:00+01:00');
    expect(row!.lastAt).toBe('2026-10-29T01:37:00+01:00');
  });

  it('notes/backup: fail with its error', () => {
    expect(night!.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });
});

describe('readNight on runs/2026-10-27.jsonl', () => {
  it('a clean night: no retries, no fails, no bad lines', () => {
    const night = readNight('runs', '2026-10-27');
    expect(night!.badLines).toBe(0);
    expect(night!.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(night!.rows.every((r) => r.retries === 0 && r.lastStatus === 'ok')).toBe(true);
    expect(night!.rows.find((r) => r.job === 'lane/sync')?.runs).toBe(4);
  });
});

describe('readNight edge cases (temp dir)', () => {
  it('a night with no file is null', () => {
    expect(readNight(tmp, '2026-01-01')).toBeNull();
    expect(readNight('runs', '2026-10-30')).toBeNull();
  });

  it('a night that is not YYYY-MM-DD is null, no path built', () => {
    writeFileSync(join(tmp, 'evil.jsonl'), '{"at":"2026-10-28T23:00:00+01:00","job":"x","status":"ok","owner":null}\n');
    expect(readNight(tmp, 'evil')).toBeNull();
    expect(readNight(tmp, '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
  });

  it('an empty file is an empty digest, not null', () => {
    writeFileSync(join(tmp, '2026-02-01.jsonl'), '');
    expect(readNight(tmp, '2026-02-01')).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts every kind of bad line, skips blank lines, never throws', () => {
    const lines = [
      '{"at":"2026-02-02T23:00:00+01:00","job":"b/job","status":"retry","owner":"a","error":"e1"}',
      'not json',
      '[1,2]',
      'null',
      '{"job":"b/job","status":"ok","owner":"a"}', // missing at
      '{"at":"yesterday","job":"b/job","status":"ok","owner":"a"}', // invalid at
      '{"at":"2026-02-02T23:01:00+01:00","status":"ok","owner":"a"}', // missing job
      '{"at":"2026-02-02T23:01:00+01:00","job":"b/job","status":"skipped","owner":"a"}', // bad status
      '{"at":"2026-02-02T23:01:00+01:00","job":"b/job","status":"ok"}', // missing owner
      '{"at":"2026-02-02T23:01:00+01:00","job":"b/job","status":"ok","owner":7}', // owner not string/null
      '',
      '   ',
      '{"at":"2026-02-02T23:05:00+01:00","job":"a/job","status":"ok","owner":null}',
      '{"at":"2026-02-02T23:06:00+01:00","job":"b/job","status":"fail","owner":"c","error":"boom"}',
      '{"at":"2026-02-03T01:00:00+01:00","job":"b/job","status":"ok","owner":"c"}',
    ];
    writeFileSync(join(tmp, '2026-02-02.jsonl'), lines.join('\r\n') + '\r\n');
    const night = readNight(tmp, '2026-02-02');
    expect(night!.badLines).toBe(9);
    expect(night!.counts).toEqual({ ok: 2, retry: 1, fail: 1 });
    expect(night!.rows.map((r) => r.job)).toEqual(['a/job', 'b/job']);
    expect(night!.rows[1]).toEqual({
      job: 'b/job',
      owner: 'c', // lines disagree: the last line's owner
      runs: 3,
      retries: 1,
      lastStatus: 'ok',
      lastError: undefined,
      firstAt: '2026-02-02T23:00:00+01:00',
      lastAt: '2026-02-03T01:00:00+01:00',
    });
  });
});
