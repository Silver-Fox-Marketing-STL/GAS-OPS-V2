// Today's work queue — a port of App.html queueBuild_: one row per dealer with
// something on the desk (scheduled / scanned / draft / to commit), printed
// dealers folded behind a count. Four reads, assembled client-side.
import { call } from './api';
import { el, clear, tag, plural } from './dom';
import type { PrintSchedule, Drafts, Submissions, RunLogRow } from './types';

interface Tag { tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'; text: string }
export interface QueueRow { key: string; name: string; tags: Tag[]; done: boolean }

export interface QueueHost {
  list: HTMLElement;          // rows render here
  sub: HTMLElement;           // "Friday, 3 to print"
  onOpen: (key: string, name: string) => void;
}

let items: QueueRow[] = [];
let activeKey = '';
let seq = 0;

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

export async function load(host: QueueHost): Promise<void> {
  const mySeq = ++seq;
  const [sched, drafts, subs, runs] = await Promise.all([
    settle(call<PrintSchedule>('getPrintSchedule', [false])),
    settle(call<Drafts>('getMyRunDrafts')),
    settle(call<Submissions>('getVinSubmissions')),
    settle(call<RunLogRow[]>('getRunsForDealer', ['']))
  ]);
  if (mySeq !== seq) return;
  items = build(sched, drafts, subs, runs);
  const s = sched && sched.ok ? sched : null;
  const todo = items.filter((r) => !r.done).length;
  host.sub.textContent = s && s.day ? s.day + (todo ? ', ' + todo + ' to print' : '') : '';
  render(host);
}

function build(sched: PrintSchedule | null, drafts: Drafts | null, subs: Submissions | null, runs: RunLogRow[] | null): QueueRow[] {
  const byKey: Record<string, QueueRow> = {};
  const order: string[] = [];
  const row = (key: string, name: string): QueueRow => {
    if (!byKey[key]) { byKey[key] = { key, name: name || key, tags: [], done: false }; order.push(key); }
    return byKey[key];
  };

  const subList = subs && Array.isArray(subs.submissions) ? subs.submissions : null;
  let inbox: Record<string, number> | null = null;
  if (subList) {
    inbox = {};
    for (const x of subList) if (x && x.dealerKey) inbox[x.dealerKey] = (inbox[x.dealerKey] ?? 0) + 1;
  }
  let uncommitted: Record<string, number> | null = null;
  if (Array.isArray(runs)) {
    uncommitted = {};
    for (const r of runs) {
      if (r && r.status === 'pending' && String(r.dealId) !== 'test' && r.dealerKey) uncommitted[r.dealerKey] = (uncommitted[r.dealerKey] ?? 0) + 1;
    }
  }
  const scannedTag = (r: QueueRow, fallbackPending: number | undefined) => {
    const n = inbox ? (inbox[r.key] ?? 0) : Number(fallbackPending) || 0;
    if (n) r.tags.push({ tone: 'warning', text: n + ' scanned' });
  };

  const s = sched && sched.ok ? sched : null;
  if (s) for (const d of s.upNext ?? []) { const r = row(d.key, d.name); r.tags.push({ tone: 'info', text: 'scheduled' }); scannedTag(r, d.pending); }
  for (const d of drafts?.drafts ?? []) { const r = row(d.dealerKey, d.dealerName); r.tags.push({ tone: 'neutral', text: 'draft, ' + plural(d.vinCount, 'VIN') }); }
  if (inbox && subList) {
    const names: Record<string, string> = {};
    for (const x of subList) if (x && x.dealerKey && !names[x.dealerKey]) names[x.dealerKey] = x.dealerName || x.dealerKey;
    for (const k of Object.keys(inbox)) if (!byKey[k]) scannedTag(row(k, names[k]), 0);
  }
  if (s) for (const d of s.ranToday ?? []) {
    const key = d.key || d.name;
    const r = row(key, d.name);
    r.done = true;
    r.tags.push({ tone: 'success', text: plural(d.runs ?? 0, 'run') + ', ' + (d.vins ?? 0) + ' VINs' });
    if (!r.tags.some((t) => /scanned$/.test(t.text))) scannedTag(r, d.pending);
  }
  if (uncommitted && runs) {
    const runNames: Record<string, string> = {};
    for (const r of runs) if (r && r.dealerKey && !runNames[r.dealerKey]) runNames[r.dealerKey] = r.dealerName || r.dealerKey;
    for (const k of Object.keys(uncommitted)) row(k, runNames[k]).tags.push({ tone: 'warning', text: uncommitted[k] + ' to commit' });
  }
  return order.map((k) => byKey[k]);
}

function rowEl(r: QueueRow, host: QueueHost): HTMLElement {
  const node = el('div', {
    class: 'queue-item' + (r.done ? ' done' : '') + (r.key === activeKey ? ' active' : ''),
    role: 'button', tabindex: '0',
    onclick: () => { markActive(r.key); host.onOpen(r.key, r.name); },
    onkeydown: (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); markActive(r.key); host.onOpen(r.key, r.name); } }
  },
    el('div', { class: 'q-name', text: r.name }),
    el('div', { class: 'q-tags' }, ...r.tags.map((t) => tag(t.text, t.tone)))
  );
  return node;
}

function render(host: QueueHost): void {
  clear(host.list);
  if (!items.length) { host.list.append(el('div', { class: 'rail-empty', text: 'Nothing on the desk today.' })); return; }
  const todo = items.filter((r) => !r.done), done = items.filter((r) => r.done);
  if (!todo.length) host.list.append(el('div', { class: 'rail-empty', text: 'Nothing left to print.' }));
  for (const r of todo) host.list.append(rowEl(r, host));
  if (done.length) {
    host.list.append(el('details', { class: 'queue-done' },
      el('summary', { text: done.length + ' printed today' }),
      ...done.map((r) => rowEl(r, host))
    ));
  }
}

export function markActive(key: string): void {
  activeKey = key;
  document.querySelectorAll<HTMLElement>('.queue-item').forEach((n, i) => {
    const r = itemAt(i);
    n.classList.toggle('active', !!key && !!r && r.key === key);
  });
}

// Rendered order = todo rows, then done rows (inside <details>).
function itemAt(i: number): QueueRow | undefined {
  const ordered = [...items.filter((r) => !r.done), ...items.filter((r) => r.done)];
  return ordered[i];
}
