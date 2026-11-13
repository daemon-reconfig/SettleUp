// Serverless sync. Each group is a shared secret (it lives in the invite link).
// Every change is an operation that is:
//   - encrypted with a key derived from that secret (AES-GCM), so relays only see noise,
//   - signed by this device's own key, so everyone can tell who made it,
//   - stored on this device, and mirrored through public Nostr relays to the other devices.
// Relays are just mailboxes. Any device that has the data re-uploads whatever a relay is missing.
import { get, set } from 'idb-keyval';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { reduce, type Op, type Rec } from './ledger';
import type { Group } from './money';

const KIND = 30078; // NIP-78 "application data" — accepted by general-purpose relays
// Checked to accept and return our events without an account. Any one of them being up is enough.
const DEFAULT_RELAYS = ['wss://relay.primal.net', 'wss://relay.snort.social', 'wss://offchain.pub', 'wss://nostr.oxtr.dev', 'wss://purplerelay.com', 'wss://relay.nostr.net'];
const MAX_EVENTS = 20000;

function relayUrls(): string[] {
  try {
    const q = new URLSearchParams(location.search).get('relays');
    if (q) sessionStorage.setItem('chukta:relays', q);
    const s = sessionStorage.getItem('chukta:relays') || localStorage.getItem('chukta:relays');
    if (s) return s.split(',').map((u) => u.trim()).filter(Boolean);
  } catch { /* ignore */ }
  const env = import.meta.env.VITE_RELAYS as string | undefined;
  return env ? env.split(',') : DEFAULT_RELAYS;
}

// ---- encoding & crypto --------------------------------------------------
const te = new TextEncoder(), td = new TextDecoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/'));
export const newId = () => b64url(crypto.getRandomValues(new Uint8Array(9)));
export const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(16))); // 128-bit, 22 chars

async function deriveKeys(secret: string) {
  const base = await crypto.subtle.importKey('raw', unb64url(secret), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const p = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('chukta/v1'), info: te.encode(info) });
  const aes = await crypto.subtle.deriveKey(p('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // The tag is how relays file the group's events. It can't be turned back into the secret.
  const tag = hex(new Uint8Array(await crypto.subtle.deriveBits(p('tag'), base, 128)));
  return { aes, tag };
}
async function seal(aes: CryptoKey, data: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(JSON.stringify(data))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64(out);
}
async function unseal(aes: CryptoKey, content: string): Promise<{ ts: number; op: Op } | null> {
  try {
    const raw = unb64(content);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, aes, raw.slice(12));
    const d = JSON.parse(td.decode(pt));
    return d && typeof d.ts === 'number' && d.op ? d : null;
  } catch { return null; } // wrong key or tampered — ignore
}

// ---- one open group -----------------------------------------------------
export interface SyncStatus { online: boolean; pending: number; searched: boolean }
type Listener = (group: Group | null, status: SyncStatus) => void;

class Session {
  events = new Map<string, Event>();
  recs = new Map<string, Rec>();
  acked = new Set<string>(); // events at least one relay is known to hold
  group: Group | null = null;
  listeners = new Set<Listener>();
  relays = new Map<string, Relay | null>();
  eosed = 0;
  closed = false;
  lastTs = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(public secret: string, public tag: string, private aes: CryptoKey, private sk: Uint8Array, public pk: string) {}

  get status(): SyncStatus {
    const online = [...this.relays.values()].some((r) => r?.connected);
    let pending = 0;
    for (const id of this.events.keys()) if (!this.acked.has(id)) pending++;
    return { online, pending, searched: this.eosed > 0 };
  }

  async load() {
    const saved = (await get<Event[]>(`ev:${this.tag}`).catch(() => undefined)) ?? [];
    await Promise.all(saved.map((e) => this.ingest(e, false)));
    this.recompute();
    for (const url of relayUrls()) this.connect(url);
    setTimeout(() => { if (!this.eosed) { this.eosed = 1; this.notify(); } }, 8000); // give up waiting, show what we have
  }

  /** Verify-by-relay-lib already happened for network events; here we decrypt and file it. */
  private async ingest(ev: Event, persist = true) {
    if (this.events.has(ev.id) || this.events.size >= MAX_EVENTS) return false;
    if (ev.kind !== KIND || ev.content.length > 20000 || !ev.tags.some((t) => t[0] === 'h' && t[1] === this.tag)) return false;
    const body = await unseal(this.aes, ev.content);
    if (!body || this.events.has(ev.id)) return false;
    this.events.set(ev.id, ev);
    this.recs.set(ev.id, { id: ev.id, author: ev.pubkey, ts: body.ts, op: body.op });
    if (ev.pubkey === this.pk) this.lastTs = Math.max(this.lastTs, body.ts);
    if (persist) this.schedule();
    return true;
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.recompute();
      set(`ev:${this.tag}`, [...this.events.values()]).catch(() => {});
    }, 40);
  }
  private recompute() { this.group = reduce(this.recs.values(), this.secret); this.notify(); }
  notify() { const s = this.status; for (const l of this.listeners) l(this.group, s); }

  private async connect(url: string) {
    if (this.closed) return;
    this.relays.set(url, null);
    const retry = () => { if (!this.closed) setTimeout(() => this.connect(url), 6000); };
    let relay: Relay;
    try { relay = await Relay.connect(url); } catch { return retry(); }
    if (this.closed) return relay.close();
    this.relays.set(url, relay);
    relay.onclose = () => { this.relays.set(url, null); this.notify(); retry(); };
    const got = new Set<string>();
    relay.subscribe([{ kinds: [KIND], '#h': [this.tag] }], {
      onevent: (ev) => { got.add(ev.id); this.acked.add(ev.id); this.ingest(ev); },
      oneose: () => {
        this.eosed++;
        // Heal: give this relay anything we hold that it didn't send us.
        for (const ev of this.events.values()) if (!got.has(ev.id)) this.send(relay, ev);
        this.notify();
      },
    });
    this.notify();
  }

  private send(relay: Relay, ev: Event) {
    relay.publish(ev).then(() => { this.acked.add(ev.id); this.notify(); }, () => {});
  }

  /** Record a change: applies locally right away, then goes out to the relays. */
  async emit(op: Op) {
    const ts = (this.lastTs = Math.max(Date.now(), this.lastTs + 1));
    const ev = finalizeEvent({
      kind: KIND, created_at: Math.floor(ts / 1000),
      tags: [['d', newId()], ['h', this.tag]],
      content: await seal(this.aes, { v: 1, ts, op }),
    }, this.sk);
    this.events.set(ev.id, ev);
    this.recs.set(ev.id, { id: ev.id, author: ev.pubkey, ts, op });
    this.recompute();
    await set(`ev:${this.tag}`, [...this.events.values()]).catch(() => {});
    for (const r of this.relays.values()) if (r?.connected) this.send(r, ev);
  }
}

const sessions = new Map<string, Promise<Session>>();
function open(secret: string): Promise<Session> {
  let s = sessions.get(secret);
  if (!s) {
    s = (async () => {
      if (!/^[A-Za-z0-9_-]{22}$/.test(secret)) throw new Error('That group link isn’t valid');
      if (!crypto?.subtle) throw new Error('This browser can’t encrypt — open the app over https');
      const { aes, tag } = await deriveKeys(secret);
      // A separate signing key per group, so groups can't be linked to each other.
      const keyName = `chukta:sk:${tag}`;
      let skHex = localStorage.getItem(keyName);
      if (!skHex) localStorage.setItem(keyName, (skHex = hex(generateSecretKey())));
      const sk = unhex(skHex);
      const session = new Session(secret, tag, aes, sk, getPublicKey(sk));
      await session.load();
      return session;
    })();
    sessions.set(secret, s);
    s.catch(() => sessions.delete(secret));
  }
  return s;
}

// ---- what the UI calls --------------------------------------------------
const fail = (msg: string): never => { throw new Error(msg); };
async function act(gid: string, op: Op | Op[], check?: (g: Group | null, s: Session) => void): Promise<Group> {
  const s = await open(gid);
  check?.(s.group, s);
  for (const o of Array.isArray(op) ? op : [op]) await s.emit(o);
  return s.group ?? fail('Something went wrong');
}
const editable = (g: Group | null, s: Session, mid: string) => {
  const m = g?.members.find((x) => x.id === mid) ?? fail('Person not found');
  if (m.owner && m.owner !== s.pk) fail(`Only ${m.name} can change their own details`);
  return m;
};
type ExpenseBody = Omit<Extract<Op, { t: 'expense' }>, 't' | 'id'>;

export const api = {
  /** Watch a group. The callback fires with the current state now and on every change. */
  watch(gid: string, cb: (group: Group | null, status: SyncStatus, myKey: string) => void, onError: (e: Error) => void) {
    let off = () => {};
    let stopped = false;
    open(gid).then((s) => {
      if (stopped) return;
      const l: Listener = (g, st) => cb(g, st, s.pk);
      s.listeners.add(l);
      off = () => s.listeners.delete(l);
      l(s.group, s.status);
    }, onError);
    return () => { stopped = true; off(); };
  },
  async createGroup(name: string, members: { name: string; vpa: string }[]): Promise<Group> {
    const gid = newSecret();
    return act(gid, [{ t: 'group', name }, ...members.map((m, i): Op => ({ t: 'member', id: newId(), ...m, claim: i === 0 }))]);
  },
  renameGroup: (gid: string, name: string) => act(gid, { t: 'group', name }),
  /** claim=true means "this new person is me". */
  addMember: (gid: string, m: { name: string; vpa: string }, claim = false) =>
    act(gid, { t: 'member', id: newId(), ...m, claim }, (g, s) => {
      if (claim && g?.members.some((x) => x.owner === s.pk)) fail('You’re already in this group');
    }),
  /** "This existing name is me" — ties it to this device. */
  async claim(gid: string, mid: string): Promise<Group> {
    const s = await open(gid);
    const m = s.group?.members.find((x) => x.id === mid) ?? fail('Person not found');
    if (m.owner) fail(`${m.name} has already joined from another device`);
    if (s.group!.members.some((x) => x.owner === s.pk)) fail('You’re already in this group');
    await s.emit({ t: 'member', id: m.id, name: m.name, vpa: m.vpa, claim: true });
    return s.group!;
  },
  release: (gid: string, mid: string) =>
    act(gid, { t: 'member', id: mid, name: '-', vpa: '', release: true }, (g, s) => { if (g?.creator !== s.pk) fail('Only the person who made the group can do this'); }),
  updateMember: (gid: string, mid: string, m: { name: string; vpa: string }) =>
    act(gid, { t: 'member', id: mid, ...m }, (g, s) => { editable(g, s, mid); }),
  removeMember: (gid: string, mid: string) =>
    act(gid, { t: 'del', id: mid }, (g, s) => {
      const m = editable(g, s, mid);
      if (g!.expenses.some((e) => m.id in e.paidBy || m.id in e.shares) || g!.settlements.some((x) => x.from === m.id || x.to === m.id))
        fail('This person is part of expenses or payments, so they can’t be removed');
    }),
  saveExpense: (gid: string, e: ExpenseBody, eid?: string) => act(gid, { t: 'expense', id: eid ?? newId(), ...e }),
  deleteExpense: (gid: string, eid: string) => act(gid, { t: 'del', id: eid }),
  settle: (gid: string, x: { from: string; to: string; amount: number }) => act(gid, { t: 'settle', id: newId(), ...x }),
  undoSettle: (gid: string, sid: string) => act(gid, { t: 'del', id: sid }),
};
