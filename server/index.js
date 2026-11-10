// Chukta server: tiny JSON API over SQLite + server-sent events for live sync.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'chukta.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, vpa TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
    amount INTEGER NOT NULL, created_by TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS members_group ON members(group_id);
  CREATE INDEX IF NOT EXISTS expenses_group ON expenses(group_id);
  CREATE INDEX IF NOT EXISTS settlements_group ON settlements(group_id);
`);

const MAX_AMOUNT = 1e11; // paise (₹100 crore) — sanity cap
const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

const cleanName = (v, what = 'Name') => {
  if (typeof v !== 'string' || !v.trim()) bad(`${what} is required`);
  return v.trim().slice(0, 60);
};
const cleanVpa = (v) => {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || !VPA_RE.test(v.trim())) bad('That UPI ID doesn’t look right (expected name@bank)');
  return v.trim().toLowerCase();
};

function loadGroup(id) {
  const group = db.prepare('SELECT id, name, created_at AS createdAt FROM groups WHERE id = ?').get(id);
  if (!group) throw new HttpError(404, 'Group not found');
  const members = db.prepare('SELECT id, name, vpa FROM members WHERE group_id = ? ORDER BY created_at, rowid').all(id);
  const expenses = db.prepare('SELECT id, data, created_at AS createdAt FROM expenses WHERE group_id = ? ORDER BY created_at DESC')
    .all(id).map((r) => ({ ...JSON.parse(r.data), id: r.id, createdAt: r.createdAt }));
  const settlements = db.prepare(
    'SELECT id, from_id AS "from", to_id AS "to", amount, created_by AS createdBy, created_at AS createdAt FROM settlements WHERE group_id = ? ORDER BY created_at DESC'
  ).all(id);
  return { ...group, members, expenses, settlements };
}

const memberIds = (groupId) =>
  new Set(db.prepare('SELECT id FROM members WHERE group_id = ?').all(groupId).map((m) => m.id));

function paiseMap(obj, ids, what) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) bad(`${what} is missing`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!ids.has(k)) bad(`${what} references someone who isn’t in this group`);
    if (!Number.isInteger(v) || v < 0 || v > MAX_AMOUNT) bad(`${what} has an invalid amount`);
    if (v > 0) out[k] = v;
  }
  return out;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function cleanExpense(body, ids) {
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) bad('Enter an amount');
  const paidBy = paiseMap(body.paidBy, ids, 'Paid by');
  const shares = paiseMap(body.shares, ids, 'Split');
  if (sum(paidBy) !== amount) bad('“Paid by” amounts must add up to the total');
  if (sum(shares) !== amount) bad('The split must add up to the total');
  const split = body.split && typeof body.split === 'object' ? body.split : {};
  const mode = ['equal', 'exact', 'percent', 'shares', 'adjust'].includes(split.mode) ? split.mode : 'exact';
  const values = {};
  for (const [k, v] of Object.entries(split.values || {})) {
    if (ids.has(k) && typeof v === 'number' && Number.isFinite(v)) values[k] = v;
  }
  return {
    title: cleanName(body.title, 'Title'),
    emoji: typeof body.emoji === 'string' ? [...body.emoji].slice(0, 4).join('') : '🧾',
    amount, paidBy, shares, split: { mode, values },
    createdBy: ids.has(body.createdBy) ? body.createdBy : null,
  };
}

// ---- live updates -------------------------------------------------------
const listeners = new Map(); // groupId -> Set<res>
function broadcast(groupId) {
  for (const res of listeners.get(groupId) || []) res.write(`data: changed\n\n`);
}
setInterval(() => {
  for (const set of listeners.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

// ---- routes -------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '100kb' }));

const api = express.Router();
// The native apps load their UI from inside the app, so API calls are cross-origin.
// There are no cookies or logins — the unguessable group id is the only credential — so any origin is fine.
api.use((req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
api.get('/health', (_req, res) => res.json({ chukta: true }));
const done = (res, groupId) => { broadcast(groupId); res.json(loadGroup(groupId)); };
const requireGroup = (id) => {
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(id)) throw new HttpError(404, 'Group not found');
};

api.post('/groups', (req, res) => {
  const name = cleanName(req.body.name, 'Group name');
  const members = Array.isArray(req.body.members) ? req.body.members.slice(0, 50) : [];
  if (!members.length) bad('Add at least one person');
  const rows = members.map((m) => ({ id: randomUUID(), name: cleanName(m.name), vpa: cleanVpa(m.vpa) }));
  const id = randomBytes(12).toString('base64url');
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO groups VALUES (?, ?, ?)').run(id, name, now);
    rows.forEach((m, i) => db.prepare('INSERT INTO members VALUES (?, ?, ?, ?, ?)').run(m.id, id, m.name, m.vpa, now + i));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json(loadGroup(id));
});

api.get('/groups/:gid', (req, res) => res.json(loadGroup(req.params.gid)));

api.patch('/groups/:gid', (req, res) => {
  requireGroup(req.params.gid);
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(cleanName(req.body.name, 'Group name'), req.params.gid);
  done(res, req.params.gid);
});

api.get('/groups/:gid/events', (req, res) => {
  requireGroup(req.params.gid);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(': connected\n\n');
  const gid = req.params.gid;
  if (!listeners.has(gid)) listeners.set(gid, new Set());
  listeners.get(gid).add(res);
  req.on('close', () => {
    listeners.get(gid)?.delete(res);
    if (!listeners.get(gid)?.size) listeners.delete(gid);
  });
});

api.post('/groups/:gid/members', (req, res) => {
  const { gid } = req.params;
  requireGroup(gid);
  if (memberIds(gid).size >= 50) bad('Groups are limited to 50 people');
  db.prepare('INSERT INTO members VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), gid, cleanName(req.body.name), cleanVpa(req.body.vpa), Date.now());
  done(res, gid);
});

api.patch('/groups/:gid/members/:mid', (req, res) => {
  const { gid, mid } = req.params;
  if (!memberIds(gid).has(mid)) throw new HttpError(404, 'Person not found');
  db.prepare('UPDATE members SET name = ?, vpa = ? WHERE id = ? AND group_id = ?')
    .run(cleanName(req.body.name), cleanVpa(req.body.vpa), mid, gid);
  done(res, gid);
});

api.delete('/groups/:gid/members/:mid', (req, res) => {
  const { gid, mid } = req.params;
  const g = loadGroup(gid);
  const involved = g.expenses.some((e) => mid in e.paidBy || mid in e.shares) ||
    g.settlements.some((s) => s.from === mid || s.to === mid);
  if (involved) bad('This person is part of expenses or payments, so they can’t be removed');
  db.prepare('DELETE FROM members WHERE id = ? AND group_id = ?').run(mid, gid);
  done(res, gid);
});

api.post('/groups/:gid/expenses', (req, res) => {
  const { gid } = req.params;
  requireGroup(gid);
  const data = cleanExpense(req.body, memberIds(gid));
  db.prepare('INSERT INTO expenses VALUES (?, ?, ?, ?)').run(randomUUID(), gid, JSON.stringify(data), Date.now());
  done(res, gid);
});

api.put('/groups/:gid/expenses/:eid', (req, res) => {
  const { gid, eid } = req.params;
  requireGroup(gid);
  const data = cleanExpense(req.body, memberIds(gid));
  const r = db.prepare('UPDATE expenses SET data = ? WHERE id = ? AND group_id = ?').run(JSON.stringify(data), eid, gid);
  if (!r.changes) throw new HttpError(404, 'Expense not found');
  done(res, gid);
});

api.delete('/groups/:gid/expenses/:eid', (req, res) => {
  requireGroup(req.params.gid);
  db.prepare('DELETE FROM expenses WHERE id = ? AND group_id = ?').run(req.params.eid, req.params.gid);
  done(res, req.params.gid);
});

api.post('/groups/:gid/settlements', (req, res) => {
  const { gid } = req.params;
  requireGroup(gid);
  const ids = memberIds(gid);
  const { from, to, amount, createdBy } = req.body;
  if (!ids.has(from) || !ids.has(to) || from === to) bad('Invalid payment');
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) bad('Invalid amount');
  db.prepare('INSERT INTO settlements VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), gid, from, to, amount, ids.has(createdBy) ? createdBy : null, Date.now());
  done(res, gid);
});

api.delete('/groups/:gid/settlements/:sid', (req, res) => {
  requireGroup(req.params.gid);
  db.prepare('DELETE FROM settlements WHERE id = ? AND group_id = ?').run(req.params.sid, req.params.gid);
  done(res, req.params.gid);
});

app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Chukta running on http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  on your Wi-Fi: http://${a.address}:${port}`);
  }
});
