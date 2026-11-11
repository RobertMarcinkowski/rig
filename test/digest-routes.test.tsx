import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// runs/ is read-only. Fixtures written here go to a temp dir.
const tmp = mkdtempSync(join(tmpdir(), 'rig-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };
const app = createApp({ ...base, runsDir: tmp });

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const night = (name: string, lines: string[]) => writeFileSync(join(tmp, `${name}.jsonl`), lines.join('\n') + '\n');

// Written out of job order on purpose. z/fail fails; m/retry has 3 retries; a/null has no owner.
night('2026-03-01', [
  line({ at: '2026-03-01T23:00:00+01:00', job: 'z/fail', status: 'fail', owner: 'rook', error: 'boom' }),
  line({ at: '2026-03-01T23:01:00+01:00', job: 'm/retry', status: 'retry', owner: 'rook', error: 'e' }),
  line({ at: '2026-03-01T23:02:00+01:00', job: 'm/retry', status: 'retry', owner: 'rook', error: 'e' }),
  line({ at: '2026-03-01T23:03:00+01:00', job: 'm/retry', status: 'retry', owner: 'rook', error: 'e' }),
  line({ at: '2026-03-01T23:04:00+01:00', job: 'm/retry', status: 'ok', owner: 'rook' }),
  line({ at: '2026-03-01T23:05:00+01:00', job: 'a/null', status: 'ok', owner: null }),
  line({ at: '2026-03-01T23:06:00+01:00', job: 'c/calm', status: 'ok', owner: 'lane-07' }),
]);
writeFileSync(join(tmp, '2026-03-02.jsonl'), '');
night('2026-03-03', [
  line({ at: '2026-03-03T23:00:00+01:00', job: 'b/job', status: 'ok', owner: 'rook' }),
  'not json',
  line({ at: '2026-03-03T23:01:00+01:00', job: 'a/job', status: 'ok', owner: 'rook' }),
]);

const ORDER = ['a/null', 'c/calm', 'm/retry', 'z/fail'];

type Api = { night: string; rows: { job: string; owner: string | null }[]; badLines: number };
const getPage = async (n: string) => {
  const res = await app.request(`/digest/${n}`);
  return { res, html: await res.text() };
};
const getJson = async (n: string) => {
  const res = await app.request(`/api/digest/${n}`);
  return { res, body: (await res.json()) as Api };
};
// The <tr> (with its opening tag) containing a job's cell.
const rowOf = (html: string, job: string) => {
  const m = html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>).)*<td>${job}</td>.*?</tr>`, 's'));
  expect(m, `row for ${job}`).not.toBeNull();
  return m![0];
};
const jobsOnPage = (html: string) => [...html.matchAll(/<tr[^>]*><td>([^<]+)<\/td>/g)].map((m) => m[1]);

describe('GET /digest/:night', () => {
  it('200 lists the jobs sorted by job', async () => {
    const { res, html } = await getPage('2026-03-01');
    expect(res.status).toBe(200);
    expect(jobsOnPage(html)).toEqual(ORDER);
  });

  it('renders a null owner as a dash', async () => {
    const { html } = await getPage('2026-03-01');
    expect(rowOf(html, 'a/null')).toContain('<td>—</td>');
  });

  it('marks fail and retries >= 3 rows as warn, not calm ones', async () => {
    const { html } = await getPage('2026-03-01');
    expect(rowOf(html, 'z/fail')).toMatch(/^<tr class="warn">/);
    expect(rowOf(html, 'm/retry')).toMatch(/^<tr class="warn">/);
    expect(rowOf(html, 'c/calm')).not.toContain('warn');
    expect(rowOf(html, 'a/null')).not.toContain('warn');
  });

  it('404 html for a night with no file', async () => {
    const { res, html } = await getPage('2026-03-09');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('no run log for 2026-03-09');
  });

  it('empty night says nothing ran', async () => {
    const { res, html } = await getPage('2026-03-02');
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('could not be read');
  });

  it('a bad line still gives 200 with the could-not-be-read note', async () => {
    const { res, html } = await getPage('2026-03-03');
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(jobsOnPage(html)).toEqual(['a/job', 'b/job']);
  });

  it('no note when every line reads', async () => {
    const { html } = await getPage('2026-03-01');
    expect(html).not.toContain('could not be read');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 lists the jobs sorted by job, null owner as null', async () => {
    const { res, body } = await getJson('2026-03-01');
    expect(res.status).toBe(200);
    expect(body.night).toBe('2026-03-01');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(ORDER);
    expect(body.rows.find((r) => r.job === 'a/null')!.owner).toBeNull();
  });

  it('404 json for a night with no file', async () => {
    const { res, body } = await getJson('2026-03-09');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body).toEqual({ error: 'no run log for this night', night: '2026-03-09' });
  });

  it('404 for a night that is not a date', async () => {
    expect((await getJson('nope')).res.status).toBe(404);
  });

  it('empty night has rows: []', async () => {
    const { res, body } = await getJson('2026-03-02');
    expect(res.status).toBe(200);
    expect(body).toEqual({ night: '2026-03-02', rows: [], badLines: 0 });
  });

  it('a bad line still gives 200 and a badLines count', async () => {
    const { res, body } = await getJson('2026-03-03');
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/job', 'b/job']);
  });
});

describe('page and JSON agree', () => {
  it.each(['2026-03-01', '2026-03-03'])('same jobs, same order for %s', async (n) => {
    const { html } = await getPage(n);
    const { body } = await getJson(n);
    expect(jobsOnPage(html)).toEqual(body.rows.map((r) => r.job));
  });
});

describe('real runs/ fixtures (read only)', () => {
  const real = createApp({ ...base, runsDir: 'runs' });

  it('2026-10-28: 5 jobs, 1 bad line, page and JSON agree', async () => {
    const body = (await (await real.request('/api/digest/2026-10-28')).json()) as Api;
    const html = await (await real.request('/digest/2026-10-28')).text();
    expect(body.rows).toHaveLength(5);
    expect(body.badLines).toBe(1);
    expect(html).toContain('1 line could not be read');
    expect(jobsOnPage(html)).toEqual(body.rows.map((r) => r.job));
  });
});
