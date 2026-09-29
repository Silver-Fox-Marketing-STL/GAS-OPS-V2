// The order workspace: dealer → Vehicles (CAO pre-fill / VIN list / match
// table) → Run (checklist + progress) → Finalize as a TEST order → output
// folder. Same server calls as ViewRun.html, google.script.run swapped for
// call() (Execution API, runs as the signed-in user); finalize always passes
// dealId 'test' — the spike never touches Pipedrive or the VIN log.
import { call, ApiError } from './api';
import { POLL_MS } from './config';
import { el, clear, plural, tag } from './dom';
import type {
  Dealer, UserProfile, CaoSummary, CaoResult, DealerVinData, LoggedIdentifiers,
  RunProgress, RunResult, FinalizeResult, PendingRun
} from './types';

export interface OrderHost {
  root: HTMLElement;
  title: HTMLElement;
  status: HTMLElement;
  dealers: Dealer[];
  users: UserProfile[];
  lastUser: string;
  onRunLogged: () => void;     // queue refresh after a card is logged / abandoned
}

type CardState = { state: 'pending' | 'busy' | 'finalized' | 'abandoned'; rowIndex: number | null; msg: string; err: boolean };

const S = {
  dealerKey: '', dealerName: '', userKey: '',
  vinData: null as DealerVinData | null,
  loggedIds: null as Set<string> | null,
  features: {} as Record<string, string>,
  bypass: false,
  cao: null as CaoSummary | null,
  runId: null as string | null,
  running: false,
  result: null as RunResult | null,
  cards: [] as CardState[]
};

let host: OrderHost;
let ui: {
  dealerSel: HTMLSelectElement; userSel: HTMLSelectElement;
  stepVehicles: HTMLElement; stepRun: HTMLElement; stepFinalize: HTMLElement;
  caoBtn: HTMLButtonElement; caoStrip: HTMLElement;
  vinBox: HTMLTextAreaElement; bypass: HTMLInputElement; countEl: HTMLElement;
  tableWrap: HTMLElement;
  checks: HTMLElement; runBtn: HTMLButtonElement;
  progress: HTMLElement; progFill: HTMLElement; progMsg: HTMLElement; progPct: HTMLElement;
  cards: HTMLElement; folderLink: HTMLAnchorElement;
};
let pollTimer: number | null = null;

// ── Status line (in the app header, like the HtmlService desk) ──────────────
function status(msg: string, kind: 'info' | 'success' | 'error' | 'empty' = 'info'): void {
  host.status.textContent = msg;
  host.status.className = 'hd-status ' + kind;
  host.status.hidden = !msg;
}

// ── Mount once ───────────────────────────────────────────────────────────────
export function mount(h: OrderHost): void {
  host = h;
  clear(host.root);

  const dealerSel = el('select', { class: 'field', 'aria-label': 'Dealer', onchange: () => setDealer(dealerSel.value) },
    el('option', { value: '', text: 'Choose a dealer…' }),
    ...host.dealers.map((d) => el('option', { value: d.key, text: d.name }))
  );
  const userSel = el('select', { class: 'field', 'aria-label': 'Running as', onchange: () => { S.userKey = userSel.value; updateChecks(); } },
    el('option', { value: '', text: 'Running as…' }),
    ...host.users.map((u) => el('option', { value: u.key, text: u.name }))
  );
  const defaultUser = host.users.find((u) => u.key === host.lastUser)?.key ?? host.users[0]?.key ?? '';
  userSel.value = defaultUser; S.userKey = defaultUser;

  const caoBtn = el('button', { class: 'btn', type: 'button', onclick: () => void prefillCao() }, 'Pre-fill from CAO');
  const caoStrip = el('div', { class: 'cao-strip', hidden: true });
  const vinBox = el('textarea', { class: 'vin-box', rows: '10', spellcheck: 'false', placeholder: 'One VIN per line', oninput: () => renderTable() });
  const bypass = el('input', { type: 'checkbox', onchange: () => { S.bypass = bypass.checked; renderTable(); } });
  const countEl = el('span', { class: 'hint' });
  const tableWrap = el('div', { class: 'table-wrap' });
  const checks = el('ul', { class: 'checks' });
  const runBtn = el('button', { class: 'btn primary', type: 'button', onclick: () => void run() }, 'Run order');
  const progFill = el('div', { class: 'prog-fill' });
  const progMsg = el('span', { class: 'prog-msg' });
  const progPct = el('span', { class: 'prog-pct' });
  const progress = el('div', { class: 'progress', hidden: true }, el('div', { class: 'prog-bar' }, progFill), el('div', { class: 'prog-row' }, progMsg, progPct));
  const cards = el('div', { class: 'cards' });
  const folderLink = el('a', { class: 'btn', target: '_blank', rel: 'noopener', href: '#' }, 'Open output folder');

  const stepVehicles = el('section', { class: 'step', hidden: true },
    el('h2', {}, el('span', { class: 'step-n', text: '1' }), 'Vehicles'),
    el('div', { class: 'row' }, caoBtn, el('label', { class: 'check' }, bypass, ' Bypass filters')),
    caoStrip,
    el('div', { class: 'vehicles' },
      el('div', { class: 'vin-col' }, el('div', { class: 'overline', text: 'VINs' }), vinBox, countEl),
      el('div', { class: 'table-col' }, el('div', { class: 'overline', text: 'Match against inventory' }), tableWrap)
    )
  );
  const stepRun = el('section', { class: 'step', hidden: true },
    el('h2', {}, el('span', { class: 'step-n', text: '2' }), 'Run'),
    checks,
    el('div', { class: 'row' }, runBtn),
    progress
  );
  const stepFinalize = el('section', { class: 'step', hidden: true },
    el('h2', {}, el('span', { class: 'step-n', text: '3' }), 'Finalize'),
    el('p', { class: 'hint', text: 'Spike scope: every card logs as a TEST order (never Pipedrive, never the VIN log).' }),
    cards,
    el('div', { class: 'row' }, folderLink)
  );

  host.root.append(
    el('div', { class: 'order-head' },
      el('label', { class: 'lbl' }, el('span', { class: 'overline', text: 'Dealer' }), dealerSel),
      el('label', { class: 'lbl' }, el('span', { class: 'overline', text: 'Running as' }), userSel)
    ),
    stepVehicles, stepRun, stepFinalize
  );

  ui = { dealerSel, userSel, stepVehicles, stepRun, stepFinalize, caoBtn, caoStrip, vinBox, bypass, countEl, tableWrap, checks, runBtn, progress, progFill, progMsg, progPct, cards, folderLink };
  host.title.textContent = 'Pick a dealer';
}

// ── Dealer ───────────────────────────────────────────────────────────────────
export function open(key: string, name: string): void {
  ui.dealerSel.value = key;
  setDealer(key, name);
}

function setDealer(key: string, name?: string): void {
  if (S.running) { status('A run is in progress — wait for it to finish.', 'error'); ui.dealerSel.value = S.dealerKey; return; }
  if (S.result && S.cards.some((c) => c.state === 'pending' || c.state === 'busy')) {
    if (!confirm('This order has results that are not finalized or abandoned. Switch dealer and drop them?')) { ui.dealerSel.value = S.dealerKey; return; }
  }
  S.dealerKey = key;
  S.dealerName = name ?? host.dealers.find((d) => d.key === key)?.name ?? key;
  S.vinData = null; S.loggedIds = null; S.features = {}; S.cao = null; S.result = null; S.cards = [];
  ui.vinBox.value = '';
  ui.caoStrip.hidden = true; clear(ui.caoStrip);
  ui.progress.hidden = true; clear(ui.cards);
  status('', 'empty');
  host.title.textContent = key ? S.dealerName : 'Pick a dealer';
  ui.stepVehicles.hidden = !key;
  ui.stepRun.hidden = !key;
  ui.stepFinalize.hidden = true;
  renderTable();
  if (key) void loadDealerData(key);
}

async function loadDealerData(key: string): Promise<void> {
  const [data, logged] = await Promise.all([
    call<DealerVinData>('getDealerVinData', [key]).catch(() => null),
    call<LoggedIdentifiers>('getLoggedIdentifiers', [key]).catch(() => null)
  ]);
  if (S.dealerKey !== key) return;     // superseded by a newer dealer switch
  S.vinData = data;
  S.loggedIds = logged ? new Set(logged.identifiers.map((s) => s.toUpperCase())) : null;
  renderTable();
}

// ── Vehicles ─────────────────────────────────────────────────────────────────
function vinLines(): string[] {
  return ui.vinBox.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function dedupe(list: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const v of list) { const k = v.toUpperCase(); if (!seen.has(k)) { seen.add(k); out.push(v); } }
  return out;
}
function appendVins(list: string[]): void {
  const have = new Set(vinLines().map((v) => v.toUpperCase()));
  const add = list.filter((v) => !have.has(v.toUpperCase()));
  ui.vinBox.value = [...vinLines(), ...add].join('\n');
  renderTable();
}
function removeVin(vinKey: string): void {
  ui.vinBox.value = vinLines().filter((v) => v.toUpperCase() !== vinKey).join('\n');
  renderTable();
}
function isDupe(vinKey: string): boolean {
  if (!S.loggedIds) return false;
  if (S.loggedIds.has(vinKey)) return true;
  const d = S.vinData?.vinData[vinKey];
  return !!(d && d.stock && S.loggedIds.has(d.stock.toUpperCase()));
}

async function prefillCao(): Promise<void> {
  if (!S.dealerKey) return;
  ui.caoBtn.disabled = true; ui.caoBtn.textContent = 'Loading…';
  status('Pulling inventory and applying filters…');
  try {
    const r = await call<CaoResult>('getCaoVins', [S.dealerKey]);
    appendVins(r.vins);
    S.cao = r.summary; renderCao(r.summary);
    status(r.vins.length === 0 ? 'No net-new vehicles found after filters and dedup.' : 'Added ' + plural(r.vins.length, 'net-new VIN') + ' from CAO. Review, then run.', r.vins.length ? 'success' : 'info');
  } catch (e) {
    status('CAO error: ' + (e as Error).message, 'error');
  } finally {
    ui.caoBtn.disabled = false; ui.caoBtn.textContent = 'Pre-fill from CAO';
  }
}

const REJECT_LABELS: Record<string, string> = {
  no_stock: 'Missing stock number', no_price: 'Missing or invalid price', no_url: 'Missing URL',
  type: 'Type not allowed', status: 'Status excluded', price_low: 'Below min price',
  price_high: 'Above max price', seasoning: 'Not yet seasoned', cao_excluded: 'Excluded from CAO (manual-only)'
};
function rejectLabel(k: string): string {
  if (REJECT_LABELS[k]) return REJECT_LABELS[k];
  if (k.startsWith('cond:')) return 'Condition: ' + k.slice(5).replace(/_/g, ' ');
  return k;
}
function renderCao(s: CaoSummary): void {
  clear(ui.caoStrip);
  const stat = (n: number, label: string) => el('div', { class: 'stat' }, el('div', { class: 'stat-n', text: String(n) }), el('div', { class: 'stat-l', text: label }));
  ui.caoStrip.append(stat(s.totalInventory, 'in inventory'), stat(s.afterFiltering, 'after filters'), stat(s.alreadyPrinted, 'already printed'), stat(s.netNew, 'net new'));
  const rejected = s.totalInventory - s.afterFiltering;
  if (rejected > 0) {
    const items = Object.entries(s.rejectionBreakdown).filter(([, n]) => n > 0)
      .map(([k, n]) => el('div', { class: 'rej-row' }, el('span', { text: rejectLabel(k) }), el('span', { text: String(n) })));
    ui.caoStrip.append(el('details', { class: 'rej' }, el('summary', { text: 'Filtered out (' + rejected + ')' }), ...items));
  }
  ui.caoStrip.hidden = false;
}

interface Checks { lines: number; found: number; notFound: number; filtered: number; dupes: number; missingFeat: number }
const C: Checks = { lines: 0, found: 0, notFound: 0, filtered: 0, dupes: 0, missingFeat: 0 };

function renderTable(): void {
  clear(ui.tableWrap);
  const lines = vinLines();
  ui.countEl.textContent = lines.length ? plural(lines.length, 'VIN') : '';
  C.lines = lines.length; C.found = 0; C.notFound = 0; C.filtered = 0; C.dupes = 0; C.missingFeat = 0;
  if (!lines.length) {
    ui.tableWrap.append(el('div', { class: 'empty', text: S.dealerKey ? 'Enter VINs, or pre-fill from CAO.' : 'Pick a dealer first.' }));
    updateChecks(); return;
  }
  const vd = S.vinData;
  const hasFeatures = !!vd && Object.keys(vd.featuresTypes).length > 0;
  const head = el('tr', {}, ...['VIN', 'Year', 'Make', 'Model', 'Type', 'Stock', 'Status', ...(hasFeatures ? ['Features'] : []), ''].map((h) => el('th', { text: h })));
  const body = el('tbody');
  for (const raw of lines) {
    const key = raw.toUpperCase();
    const d = vd?.vinData[key];
    const dupe = isDupe(key);
    if (dupe) C.dupes++;
    const filt = (!S.bypass && d && vd?.filtered) ? (vd.filtered[key] ?? '') : '';
    if (filt) C.filtered++;
    const x = el('td', { class: 'x-cell' }, el('button', { class: 'x', type: 'button', title: 'Remove from order', onclick: () => removeVin(key) }, '✕'));
    if (!d) {
      C.notFound++;
      body.append(el('tr', { class: 'nf' }, el('td', { class: 'mono', text: key }), el('td', { colspan: String(6 + (hasFeatures ? 1 : 0)) }, vd ? tag('not in inventory', 'danger') : el('span', { class: 'hint', text: 'checking…' })), x));
      continue;
    }
    C.found++;
    const flags = el('span', { class: 'flags' });
    if (dupe) flags.append(tag('logged', 'warning'));
    if (filt) flags.append(tag('filtered: ' + filt, 'warning'));
    const cells = [
      el('td', { class: 'mono' }, key, flags),
      el('td', { text: d.year }), el('td', { text: d.make }), el('td', { text: d.model }),
      el('td', {}, tag(d.type, typeTone(d.type))), el('td', { class: 'mono', text: d.stock }), el('td', { text: d.status })
    ];
    if (hasFeatures) {
      if (vd!.featuresTypes[d.type]) {
        const txt = S.features[key] ?? '';
        if (!txt.trim()) C.missingFeat++;
        const inp = el('input', { class: 'feat', type: 'text', value: txt, placeholder: 'Required', oninput: () => { S.features[key] = inp.value; updateChecks(); } });
        cells.push(el('td', {}, inp));
      } else cells.push(el('td', { class: 'hint', text: '—' }));
    }
    body.append(el('tr', {}, ...cells, x));
  }
  ui.tableWrap.append(el('table', { class: 'match' }, el('thead', {}, head), body));
  updateChecks();
}
function typeTone(t: string): 'success' | 'warning' | 'info' | 'neutral' {
  if (t === 'New') return 'success';
  if (t === 'PO') return 'warning';
  if (t === 'CPO' || t === 'CPO-EL') return 'info';
  return 'neutral';
}

// ── Run ──────────────────────────────────────────────────────────────────────
function updateChecks(): void {
  clear(ui.checks);
  const li = (text: string, tone: 'ok' | 'warn' | 'stop') => ui.checks.append(el('li', { class: tone, text }));
  const warnings: string[] = [];
  if (!S.userKey) li('Choose who is running (QR base path).', 'stop');
  if (!C.lines) li('No VINs yet.', 'stop'); else li(plural(C.found, 'VIN') + ' matched inventory.', C.found ? 'ok' : 'stop');
  if (C.notFound) { li(plural(C.notFound, 'VIN') + ' not in inventory (will not print).', 'warn'); warnings.push('nf'); }
  if (C.filtered) { li(plural(C.filtered, 'VIN') + ' filtered by dealer rules (tick Bypass to force).', 'warn'); warnings.push('filt'); }
  if (C.dupes) { li(plural(C.dupes, 'VIN') + ' already in the VIN log (billing flags dupes; still prints).', 'warn'); warnings.push('dupe'); }
  if (C.missingFeat) li(plural(C.missingFeat, 'row') + ' need Features text.', 'stop');
  const blocked = !S.userKey || !C.lines || !C.found || C.missingFeat > 0 || S.running;
  ui.runBtn.disabled = blocked;
  ui.runBtn.textContent = S.running ? 'Running…' : (warnings.length ? 'Run anyway' : 'Run order');
}

async function run(): Promise<void> {
  if (S.running || !S.dealerKey) return;
  const vins = dedupe(vinLines());
  const featuresMap: Record<string, string> = {};
  for (const v of vins) {
    const k = v.toUpperCase(); const d = S.vinData?.vinData[k];
    if (d && S.vinData?.featuresTypes[d.type]) { const t = (S.features[k] ?? '').trim(); if (t) featuresMap[k] = t; }
  }
  if (S.result && S.cards.some((c) => c.state === 'pending' || c.state === 'busy')) {
    if (!confirm('A new run discards the un-finalized results below. Continue?')) return;
  }
  const runId = String(Date.now());
  S.runId = runId; S.running = true; S.result = null; S.cards = [];
  ui.stepFinalize.hidden = true; clear(ui.cards);
  status('', 'empty');
  updateChecks();
  startPolling(runId);
  try {
    const result = await call<RunResult | null>('pasteVinsAndRun', [S.dealerKey, vins, '', runId, S.bypass, S.userKey, null, featuresMap, {}]);
    if (!result) {
      // runDealer does not throw on failure: it returns null and records the
      // reason in the run's progress record. Read it BEFORE stopPolling clears it.
      let msg = 'The run failed on the server (no reason recorded).';
      try {
        const p = await call<RunProgress>('getRunProgress', [runId]);
        if (p && p.error) msg = p.error;
      } catch { /* keep the generic message */ }
      throw new Error(msg);
    }
    stopPolling();
    progress({ message: 'Complete!', percent: 100, done: true, error: null });
    S.result = result;
    status('Done — ' + S.dealerName + ' order complete. Finalize or abandon below.', 'success');
    showFinalize(result);
    void call('deleteRunDraft', [S.dealerKey]).catch(() => undefined);
  } catch (e) {
    stopPolling();
    const msg = (e as Error).message;
    progress({ message: 'Error: ' + msg, percent: 0, done: true, error: msg });
    status('Error: ' + msg, (e as ApiError).kind === 'auth' ? 'error' : 'error');
  } finally {
    S.running = false;
    updateChecks();
  }
}

function startPolling(runId: string): void {
  ui.progress.hidden = false;
  progress({ message: 'Starting…', percent: 0, done: false, error: null });
  const started = Date.now();
  pollTimer = window.setInterval(async () => {
    try {
      const p = await call<RunProgress>('getRunProgress', [runId]);
      if (S.runId !== runId) return;
      progress(p);
      ui.progPct.textContent = (p.percent || 0) + '% · ' + Math.round((Date.now() - started) / 1000) + 's';
    } catch { /* skip tick */ }
  }, POLL_MS);
}
function stopPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (S.runId) { void call('clearRunProgress', [S.runId]).catch(() => undefined); S.runId = null; }
}
function progress(p: RunProgress): void {
  ui.progMsg.textContent = p.message || 'Running…';
  ui.progPct.textContent = (p.percent || 0) + '%';
  ui.progFill.style.width = (p.percent || 0) + '%';
  ui.progFill.classList.toggle('done', !!p.done && !p.error);
  ui.progFill.classList.toggle('error', !!p.error);
}

// ── Finalize (test order only) ───────────────────────────────────────────────
function showFinalize(result: RunResult): void {
  ui.folderLink.href = result.outputFolderUrl;
  S.cards = result.pendingRuns.map(() => ({ state: 'pending', rowIndex: null, msg: '', err: false }));
  renderCards();
  ui.stepFinalize.hidden = false;
  ui.stepFinalize.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCards(): void {
  clear(ui.cards);
  S.result?.pendingRuns.forEach((entry, i) => ui.cards.append(cardEl(entry, i)));
}

function cardEl(entry: PendingRun, i: number): HTMLElement {
  const c = S.cards[i];
  const busy = c.state === 'busy';
  const done = c.state === 'finalized' || c.state === 'abandoned';
  const actions = done ? null : el('div', { class: 'row' },
    el('button', { class: 'btn primary', type: 'button', disabled: busy, onclick: () => void finalizeCard(i) }, 'Log as test order'),
    el('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void abandonCard(i) }, 'Abandon')
  );
  return el('div', { class: 'card ' + c.state },
    el('div', { class: 'card-head' },
      el('span', { class: 'card-title', text: entry.label }),
      el('span', { class: 'hint', text: plural(entry.totalMatched, 'unit') + ' / ' + entry.totalOrdered + ' ordered · ' + entry.durationSec + 's' })
    ),
    entry.errors?.length ? el('div', { class: 'card-err', text: entry.errors.join(' · ') }) : null,
    actions,
    el('div', { class: 'card-status' + (c.err ? ' err' : ''), text: c.msg })
  );
}

async function finalizeCard(i: number): Promise<void> {
  const entry = S.result!.pendingRuns[i]; const c = S.cards[i];
  c.state = 'busy'; c.msg = 'Logging test run…'; c.err = false; renderCards();
  try {
    // Spike scope: ALWAYS a test order (dealId 'test' → never Pipedrive, never committable).
    const r = await call<FinalizeResult>('finalizeRun', [S.dealerKey, entry, 'test']);
    c.state = 'finalized'; c.rowIndex = r.rowIndex; c.msg = 'Logged ✓ (run log row ' + r.rowIndex + ', ' + plural(r.vinCount, 'VIN') + ') — test orders are never committed.';
  } catch (e) {
    c.state = 'pending'; c.msg = 'Error: ' + (e as Error).message; c.err = true;
  }
  renderCards(); afterCard();
}

async function abandonCard(i: number): Promise<void> {
  const entry = S.result!.pendingRuns[i]; const c = S.cards[i];
  if (!confirm('Abandon "' + entry.label + '"? The output doc, QR codes and CSVs for this run are deleted.')) return;
  c.state = 'busy'; c.msg = 'Abandoning…'; c.err = false; renderCards();
  try {
    await call('abandonRun', [S.dealerKey, entry.outputDocId, entry.qrFileIds, entry.csvFileIds]);
    c.state = 'abandoned'; c.msg = 'Abandoned — nothing logged.';
  } catch (e) {
    c.state = 'pending'; c.msg = 'Error: ' + (e as Error).message; c.err = true;
  }
  renderCards(); afterCard();
}

function afterCard(): void {
  if (S.cards.every((c) => c.state === 'finalized' || c.state === 'abandoned')) host.onRunLogged();
}
