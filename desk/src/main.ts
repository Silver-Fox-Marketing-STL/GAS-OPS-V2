// Entry: config check → sign-in gate → shell (top bar, work-queue rail,
// workspace) → bootstrap + queue. Everything is a real page on our own origin:
// native selects, native dialogs, real storage, no HtmlService sandbox.
import './styles.css';
import { APP_NAME, CONFIG_OK, EXEC_URL } from './config';
import { Auth } from './auth';
import { call, ApiError } from './api';
import { el, clear, byId } from './dom';
import * as Queue from './queue';
import * as Order from './order';
import type { Bootstrap, Ping } from './types';

const root = byId('app');
let lastAuthMessage = '';

function theme(): string { try { return localStorage.getItem('desk.theme') ?? ''; } catch { return ''; } }
function setTheme(t: string): void {
  try { t ? localStorage.setItem('desk.theme', t) : localStorage.removeItem('desk.theme'); } catch { /* ignore */ }
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
function toggleTheme(): void {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  setTheme(dark ? 'light' : 'dark');
}

// ── Screens ──────────────────────────────────────────────────────────────────
function screenConfig(): void {
  clear(root);
  root.append(el('div', { class: 'gate' },
    el('h1', { text: APP_NAME }),
    el('p', { text: 'This build has no API URL or OAuth client id. Copy desk/.env.example to desk/.env.local (local dev) or set the DESK_EXEC_URL / DESK_GOOGLE_CLIENT_ID repository variables (Pages build).' })
  ));
}

function screenSignIn(message = ''): void {
  clear(root);
  const btnHost = el('div', { class: 'gsi' });
  root.append(el('div', { class: 'gate' },
    el('div', { class: 'brand', text: 'SilverFox' }),
    el('h1', { text: 'Order desk' }),
    el('p', { class: 'hint', text: 'Sign in with your Silver Fox Google account. The desk API checks the account against its allowlist on every call.' }),
    message ? el('div', { class: 'gate-msg', text: message }) : null,
    btnHost,
    el('p', { class: 'hint small', text: 'API: ' + EXEC_URL.replace(/^https:\/\/script\.google\.com\/macros\/s\//, '…/').slice(0, 48) + '…' })
  ));
  Auth.renderButton(btnHost, () => void boot()).catch((e: Error) => {
    btnHost.replaceWith(el('div', { class: 'gate-msg', text: e.message }));
  });
}

async function boot(): Promise<void> {
  const claims = Auth.claims();
  if (!claims) { screenSignIn(lastAuthMessage); return; }
  clear(root);

  const envChip = el('span', { class: 'chip', text: 'connecting…' });
  const userChip = el('span', { class: 'chip user', text: claims.email });
  const status = el('span', { class: 'hd-status empty', hidden: true });
  const title = el('span', { class: 'hd-title', text: 'Pick a dealer' });
  const queueList = el('div', { class: 'queue' }, el('div', { class: 'rail-empty', text: 'Loading today’s work…' }));
  const queueSub = el('span', { class: 'rail-sub' });
  const workspace = el('div', { class: 'workspace' });

  root.append(
    el('header', { class: 'topbar' },
      el('div', { class: 'brand', text: 'SilverFox' }),
      envChip,
      el('span', { class: 'spacer' }),
      userChip,
      el('button', { class: 'tb-btn', type: 'button', onclick: toggleTheme, title: 'Toggle light / dark' }, 'Theme'),
      el('button', { class: 'tb-btn', type: 'button', onclick: () => { Auth.signOut(); lastAuthMessage = ''; screenSignIn(); } }, 'Sign out')
    ),
    el('div', { class: 'body' },
      el('nav', { class: 'rail', 'aria-label': 'Work' },
        el('div', { class: 'rail-sec' },
          el('div', { class: 'rail-h' }, 'Today ', queueSub),
          queueList
        ),
        el('div', { class: 'rail-foot', text: 'SilverFox desk · spike' })
      ),
      el('main', { class: 'main' },
        el('div', { class: 'hd' }, title, status),
        workspace
      )
    )
  );

  const queueHost = { list: queueList, sub: queueSub, onOpen: (key: string, name: string) => Order.open(key, name) };

  try {
    const [ping, bs] = await Promise.all([
      call<Ping>('apiPing', ['desk boot']),
      call<Bootstrap>('getAppBootstrap')
    ]);
    envChip.textContent = ping.env.toUpperCase() + ' · ' + ping.email;
    envChip.classList.add(ping.env === 'prod' ? 'prod' : 'ok');
    Order.mount({
      root: workspace, title, status,
      dealers: bs.dealers, users: bs.users.profiles, lastUser: bs.users.lastUser,
      onRunLogged: () => void Queue.load(queueHost)
    });
    await Queue.load(queueHost);
  } catch (e) {
    const err = e as ApiError;
    if (err.kind === 'auth') { lastAuthMessage = err.message; screenSignIn(err.message); return; }
    envChip.textContent = 'offline';
    envChip.classList.add('bad');
    workspace.append(el('div', { class: 'gate-msg', text: err.message }));
  }
}

// ── Go ───────────────────────────────────────────────────────────────────────
setTheme(theme());
if (!CONFIG_OK) screenConfig();
else if (Auth.token()) void boot();
else screenSignIn();
