const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------- Optional ArifPay (only used if ARIFPAY_API_KEY is set and the package is installed) ----------
let arifpay = null;
try {
  let Arifpay = require('arifpay'); Arifpay = Arifpay.default || Arifpay;
  if (process.env.ARIFPAY_API_KEY) arifpay = new Arifpay(process.env.ARIFPAY_API_KEY);
} catch (e) { /* ArifPay not installed — that's fine */ }

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));

// ======================= Database layer =======================
// If DATABASE_URL is set  -> PostgreSQL (e.g. Supabase). Data is persistent and survives restarts/redeploys.
// If it is NOT set        -> local SQLite file (development only; on Replit this can reset on redeploy).
// All SQL below is written to run on both. Placeholders are `?` and are converted for PostgreSQL.
let db;
if (process.env.DATABASE_URL) {
  let pg;
  try { pg = require('pg'); } catch (e) { throw new Error('DATABASE_URL is set but the "pg" package is missing. Run: npm install'); }
  pg.types.setTypeParser(20, v => Number(v)); // BIGINT -> number
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
  const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  db = {
    kind: 'postgres',
    async query(sql, p = []) { return (await pool.query(conv(sql), p)).rows; },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(7316)'); // serialises bookings across all server instances
        const out = await fn({ query: async (sql, p = []) => (await c.query(conv(sql), p)).rows });
        await c.query('COMMIT');
        return out;
      } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
      finally { c.release(); }
    }
  };
} else {
  const { DatabaseSync } = require('node:sqlite'); // built into Node.js 22.5+
  const file = path.join(ROOT, 'data', 'el-bethel.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = DELETE');
  sqlite.exec('PRAGMA synchronous = FULL');
  const q = (sql, p = []) => {
    const st = sqlite.prepare(sql);
    if (/^\s*(SELECT|WITH)/i.test(sql)) return st.all(...p).map(r => ({ ...r }));
    st.run(...p); return [];
  };
  let chain = Promise.resolve();
  db = {
    kind: 'sqlite',
    async query(sql, p = []) { return q(sql, p); },
    tx(fn) {
      const run = chain.then(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try { const out = await fn({ query: async (sql, p = []) => q(sql, p) }); sqlite.exec('COMMIT'); return out; }
        catch (e) { try { sqlite.exec('ROLLBACK'); } catch (_) {} throw e; }
      });
      chain = run.catch(() => {});
      return run;
    }
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, room_type TEXT NOT NULL, room_number TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL, nights INTEGER NOT NULL, total INTEGER NOT NULL, breakfast INTEGER NOT NULL DEFAULT 0, guest_full_name TEXT NOT NULL, guest_phone TEXT NOT NULL, guest_email TEXT, guest_notes TEXT, created_at TEXT NOT NULL, created_by TEXT, arifpay_session_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL, amount INTEGER NOT NULL, reference TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS room_overrides (room_number TEXT PRIMARY KEY, state TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_number, check_in, check_out)`
];

// ======================= Hotel data (ETB) =======================
const prices = { Single: 1400, Deluxe: 2000, Twin: 2400 };
const ROOM_LIST = {
  Single: ['102','103','104','105','202','203','204','205','206','209','301','302','303','304','306','401','402','403','404','405','408','409'],
  Deluxe: ['106','107','108','207','208','307','308','309','406','407'],
  // TODO(Dagi): the hotel says there are 3 Twin rooms but only 201 and 305 are known. Add the third number here.
  Twin: ['201','305']
};
const rooms = Object.entries(ROOM_LIST).flatMap(([type, nums]) => nums.map(number => ({ number, type, floor: number[0] })));
const ACTIVE = ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'];

// ======================= Helpers =======================
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const id = prefix => `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const hash = (p, s = crypto.randomBytes(16).toString('hex')) => `${s}:${crypto.scryptSync(p, s, 64).toString('hex')}`;
function verify(p, h) { const [s, x] = String(h).split(':'); if (!s || !x) return false; try { return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(p, s, 64)); } catch { return false; } }
const dateNights = (a, b) => Math.ceil((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(new Date(s + 'T00:00:00Z'));
async function audit(t, userId, action, details) {
  await (t || db).query('INSERT INTO audit_logs (id,user_id,action,details,created_at) VALUES (?,?,?,?,?)', [id('AUD'), userId || null, action, JSON.stringify(details || {}), new Date().toISOString()]);
}
function rowToBooking(b) {
  return { id: b.id, status: b.status, source: b.source, roomType: b.room_type, roomNumber: b.room_number, checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, total: b.total, guest: { fullName: b.guest_full_name, phone: b.guest_phone, email: b.guest_email, notes: b.guest_notes }, createdAt: b.created_at, createdBy: b.created_by };
}
function calculate(type, ci, co) {
  if (!prices[type]) throw Object.assign(new Error('Invalid room type'), { status: 400 });
  if (!isDate(ci) || !isDate(co)) throw Object.assign(new Error('Invalid dates'), { status: 400 });
  const nights = dateNights(ci, co);
  if (!Number.isInteger(nights) || nights < 1) throw Object.assign(new Error('Check-out must be after check-in'), { status: 400 });
  return { nights, total: prices[type] * nights };
}
async function overrides(t = db) { const m = new Map(); for (const r of await t.query('SELECT room_number, state FROM room_overrides')) m.set(r.room_number, r.state); return m; }
async function busyRooms(t, ci, co) {
  const rows = await t.query(`SELECT DISTINCT room_number FROM bookings WHERE status IN (${ACTIVE.map(() => '?').join(',')}) AND check_in < ? AND check_out > ?`, [...ACTIVE, co, ci]);
  return new Set(rows.map(r => r.room_number));
}
async function availableRooms(ci, co, type) {
  const [ov, busy] = await Promise.all([overrides(), busyRooms(db, ci, co)]);
  return rooms.filter(r => (!type || r.type === type) && !(ov.get(r.number) && ov.get(r.number) !== 'AVAILABLE') && !busy.has(r.number));
}
async function createBooking(body, source = 'ONLINE', actor = null) {
  const { roomType, roomNumber, checkIn, checkOut, guest } = body || {};
  if (!roomType || !roomNumber || !checkIn || !checkOut || !guest || !String(guest.fullName || '').trim() || !String(guest.phone || '').trim()) throw Object.assign(new Error('Required booking information is missing'), { status: 400 });
  const room = rooms.find(r => r.number === String(roomNumber) && r.type === roomType);
  if (!room) throw Object.assign(new Error('Selected room is unavailable'), { status: 400 });
  const calc = calculate(roomType, checkIn, checkOut);
  return db.tx(async t => {
    const ov = await overrides(t);
    if (ov.get(room.number) && ov.get(room.number) !== 'AVAILABLE') throw Object.assign(new Error('Selected room is unavailable'), { status: 400 });
    if ((await busyRooms(t, checkIn, checkOut)).has(room.number)) throw Object.assign(new Error('Room has just been booked. Please select another room.'), { status: 409 });
    const bookingId = id('EBH'), now = new Date().toISOString();
    const status = source === 'WALK_IN' ? 'CONFIRMED' : 'PENDING_PAYMENT';
    await t.query('INSERT INTO bookings (id,status,source,room_type,room_number,check_in,check_out,nights,total,breakfast,guest_full_name,guest_phone,guest_email,guest_notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [bookingId, status, source, roomType, room.number, checkIn, checkOut, calc.nights, calc.total, 0, String(guest.fullName).trim(), String(guest.phone).trim(), String(guest.email || '').trim(), String(guest.notes || ''), now, actor ? actor.id : null]);
    if (source === 'WALK_IN') await t.query('INSERT INTO payments (id,booking_id,method,status,amount,reference,created_at) VALUES (?,?,?,?,?,?,?)', [id('PAY'), bookingId, 'OFFLINE', 'PENDING', calc.total, '', now]);
    await audit(t, actor && actor.id, source === 'WALK_IN' ? 'CREATE_WALK_IN' : 'CREATE_ONLINE', { bookingId, roomNumber: room.number });
    return rowToBooking((await t.query('SELECT * FROM bookings WHERE id = ?', [bookingId]))[0]);
  });
}
const getBooking = async bid => (await db.query('SELECT * FROM bookings WHERE id = ?', [bid]))[0];

// ---------- Sessions & auth ----------
async function createSession(userId) {
  const t = crypto.randomBytes(32).toString('hex'), now = Date.now();
  await db.query('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)', [t, userId, now, now + SESSION_TTL_MS]);
  return t;
}
async function getSession(token) {
  const row = (await db.query('SELECT * FROM sessions WHERE token = ?', [token]))[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) { await db.query('DELETE FROM sessions WHERE token = ?', [token]); return null; }
  return row;
}
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now(), rec = loginAttempts.get(ip);
  if (!rec || now - rec.windowStart > LOGIN_WINDOW_MS) { loginAttempts.set(ip, { count: 1, windowStart: now }); return { blocked: false }; }
  rec.count += 1;
  return rec.count > LOGIN_MAX_ATTEMPTS ? { blocked: true, retryAfterSec: Math.ceil((rec.windowStart + LOGIN_WINDOW_MS - now) / 1000) } : { blocked: false };
}
setInterval(() => { const n = Date.now(); for (const [ip, r] of loginAttempts) if (n - r.windowStart > LOGIN_WINDOW_MS) loginAttempts.delete(ip); }, 30 * 60 * 1000).unref();
setInterval(() => { db.query('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]).catch(() => {}); }, 60 * 60 * 1000).unref();

const auth = wrap(async (req, res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '') || req.headers['x-session-token'];
  const s = t && await getSession(t);
  if (!s) return res.status(401).json({ error: 'Authentication required' });
  const u = (await db.query('SELECT * FROM users WHERE id = ?', [s.user_id]))[0];
  if (!u || u.disabled) return res.status(401).json({ error: 'Account disabled' });
  req.user = u; req.sessionToken = t; next();
});
const role = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Permission denied' });

// ======================= Public API =======================
app.get('/api/health', wrap(async (q, s) => { await db.query('SELECT 1 AS ok'); s.json({ ok: true, service: 'El-Bethel Hotel', rooms: rooms.length, db: db.kind }); }));
app.get('/api/rooms', wrap(async (q, s) => { const ov = await overrides(); s.json({ rooms: rooms.map(r => ({ ...r, state: ov.get(r.number) || 'AVAILABLE' })), prices }); }));
app.get('/api/availability', wrap(async (q, s) => {
  const { checkIn, checkOut, type } = q.query;
  if (!checkIn || !checkOut) return s.status(400).json({ error: 'checkIn and checkOut are required' });
  calculate(type || 'Single', checkIn, checkOut);
  const a = await availableRooms(checkIn, checkOut, type);
  s.json({ rooms: a, count: a.length });
}));
app.post('/api/bookings', wrap(async (q, s) => s.status(201).json({ booking: await createBooking(q.body) })));
app.get('/api/bookings/:id', wrap(async (q, s) => {
  const row = await getBooking(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  s.json({ booking: rowToBooking(row) });
}));

// Online payment through ArifPay (only if configured); otherwise the page falls back to the manual CBE flow
app.post('/api/bookings/:id/payment-intent', wrap(async (q, s) => {
  const row = await getBooking(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  if (row.status !== 'PENDING_PAYMENT') return s.status(409).json({ error: 'Booking is not awaiting payment' });
  if (!arifpay) return s.status(503).json({ error: 'Online payment is not configured yet.', bookingId: row.id, amount: row.total });
  const base = process.env.PUBLIC_BASE_URL || `${q.protocol}://${q.get('host')}`;
  const session = await arifpay.checkout.create({
    cancelUrl: `${base}/#book`, errorUrl: `${base}/#book`, successUrl: `${base}/#book`, notifyUrl: `${base}/api/arifpay/webhook`,
    nonce: crypto.randomBytes(8).toString('hex'), expireDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(), paymentMethods: [],
    items: [{ name: `${row.room_type} Room — ${row.nights} night(s), Room ${row.room_number}`, price: row.total, quantity: 1 }],
    beneficiaries: process.env.ARIFPAY_BENEFICIARY_ACCOUNT ? [{ accountNumber: process.env.ARIFPAY_BENEFICIARY_ACCOUNT, bank: process.env.ARIFPAY_BENEFICIARY_BANK || 'CBETETAA', amount: row.total }] : undefined
  }, { sandbox: process.env.ARIFPAY_SANDBOX !== 'false' });
  const sessionId = session.sessionId || (session.data && session.data.sessionId);
  if (sessionId) await db.query('UPDATE bookings SET arifpay_session_id = ? WHERE id = ?', [sessionId, row.id]);
  s.json({ bookingId: row.id, amount: row.total, paymentUrl: session.paymentUrl || (session.data && session.data.paymentUrl), status: 'REDIRECT', provider: 'arifpay' });
}));
// ArifPay notification: never trust the body — re-fetch the session from ArifPay before marking anything as paid.
app.post('/api/arifpay/webhook', wrap(async (q, s) => {
  const sessionId = q.body && (q.body.sessionId || (q.body.data && q.body.data.sessionId) || q.body.session_id);
  if (!sessionId || !arifpay) return s.status(400).json({ error: 'Missing sessionId or ArifPay not configured' });
  const row = (await db.query('SELECT * FROM bookings WHERE arifpay_session_id = ?', [sessionId]))[0];
  if (!row) return s.status(404).json({ error: 'No booking matches this session' });
  const session = await arifpay.checkout.fetch(sessionId, { sandbox: process.env.ARIFPAY_SANDBOX !== 'false' });
  console.log('ArifPay session status check:', JSON.stringify(session));
  const st = String((session && ((session.transcation && session.transcation.status) || (session.transaction && session.transaction.status) || session.status)) || '').toUpperCase();
  if (!(st.includes('SUCCESS') || st.includes('PAID') || st.includes('COMPLETE'))) return s.json({ ok: true, status: st || 'PENDING' });
  if (row.status === 'CONFIRMED') return s.json({ ok: true, idempotent: true });
  await db.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?", [row.id]);
  await db.query('INSERT INTO payments (id,booking_id,method,status,amount,reference,created_at) VALUES (?,?,?,?,?,?,?)', [id('PAY'), row.id, 'ARIFPAY', 'PAID', row.total, sessionId, new Date().toISOString()]);
  s.json({ ok: true, status: 'CONFIRMED' });
}));
// Manual confirmation with a code the hotel gives the guest after the bank transfer is received.
// NOTE: anyone who learns the code can confirm a booking — for stronger control confirm in the staff portal instead.
app.post('/api/bookings/:id/confirm-payment', wrap(async (q, s) => {
  const row = await getBooking(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  if (row.status !== 'PENDING_PAYMENT') return s.status(409).json({ error: 'Booking is not awaiting payment' });
  const secret = process.env.PAYMENT_CONFIRM_PASSWORD;
  if (!secret) return s.status(503).json({ error: 'Payment confirmation is not configured for this hotel yet.' });
  const given = String((q.body || {}).password || '');
  const ok = given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) { await audit(null, null, 'PAYMENT_CODE_FAILED', { bookingId: row.id, ip: q.ip }); return s.status(401).json({ error: 'Incorrect payment confirmation code.' }); }
  await db.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?", [row.id]);
  await db.query('INSERT INTO payments (id,booking_id,method,status,amount,reference,created_at) VALUES (?,?,?,?,?,?,?)', [id('PAY'), row.id, 'MANUAL', 'PAID', row.total, '', new Date().toISOString()]);
  await audit(null, null, 'PAYMENT_CONFIRMED_MANUAL', { bookingId: row.id });
  s.json({ booking: rowToBooking(await getBooking(row.id)) });
}));

// ======================= Admin API =======================
app.post('/api/admin/login', wrap(async (q, s) => {
  const limit = checkRateLimit(q.ip || 'unknown');
  if (limit.blocked) { s.set('Retry-After', String(limit.retryAfterSec)); return s.status(429).json({ error: `Too many login attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` }); }
  const { username, password } = q.body || {};
  const u = (await db.query('SELECT * FROM users WHERE username = ? AND disabled = 0', [String(username || '')]))[0];
  if (!u || !verify(password || '', u.password_hash)) return s.status(401).json({ error: 'Invalid username or password' });
  s.json({ token: await createSession(u.id), user: { id: u.id, username: u.username, role: u.role } });
}));
app.post('/api/admin/logout', auth, wrap(async (q, s) => { await db.query('DELETE FROM sessions WHERE token = ?', [q.sessionToken]); s.json({ ok: true }); }));
app.get('/api/admin/me', auth, (q, s) => s.json({ user: { id: q.user.id, username: q.user.username, role: q.user.role } }));
app.get('/api/admin/dashboard', auth, role('SUPER_ADMIN', 'RECEPTION', 'FINANCE'), wrap(async (q, s) => {
  const today = new Date().toISOString().slice(0, 10);
  const one = async (sql, p = []) => Number(((await db.query(sql, p))[0] || {}).c || 0);
  const [confirmed, todayCount, revenue, pending, ov] = await Promise.all([
    one("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bookings WHERE status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')"),
    one('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bookings WHERE created_at LIKE ?', [today + '%']),
    one("SELECT CAST(COALESCE(SUM(amount),0) AS INTEGER) AS c FROM payments WHERE status = 'PAID'"),
    one("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bookings WHERE status = 'PENDING_PAYMENT'"),
    overrides()
  ]);
  const out = rooms.filter(r => ov.get(r.number) && ov.get(r.number) !== 'AVAILABLE').length;
  s.json({ rooms: rooms.length, available: rooms.length - out, outOfService: out, todayBookings: todayCount, confirmed, revenue, pending });
}));
app.get('/api/admin/bookings', auth, role('SUPER_ADMIN', 'RECEPTION', 'FINANCE'), wrap(async (q, s) => {
  const rows = q.query.status
    ? await db.query('SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC LIMIT 500', [String(q.query.status)])
    : await db.query('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500');
  s.json({ bookings: rows.map(rowToBooking) });
}));
app.post('/api/admin/bookings/walk-in', auth, role('SUPER_ADMIN', 'RECEPTION'), wrap(async (q, s) => s.status(201).json({ booking: await createBooking(q.body, 'WALK_IN', q.user) })));
app.post('/api/admin/bookings/:id/status', auth, role('SUPER_ADMIN', 'RECEPTION'), wrap(async (q, s) => {
  const row = await getBooking(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  if (!['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(q.body && q.body.status)) return s.status(400).json({ error: 'Invalid status' });
  await db.query('UPDATE bookings SET status = ? WHERE id = ?', [q.body.status, row.id]);
  await audit(null, q.user.id, 'UPDATE_BOOKING_STATUS', { bookingId: row.id, status: q.body.status });
  s.json({ booking: rowToBooking(await getBooking(row.id)) });
}));
app.get('/api/admin/payments', auth, role('SUPER_ADMIN', 'FINANCE'), wrap(async (q, s) => s.json({ payments: await db.query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 1000') })));
app.post('/api/admin/rooms/:number/state', auth, role('SUPER_ADMIN'), wrap(async (q, s) => {
  const r = rooms.find(x => x.number === q.params.number);
  if (!r) return s.status(404).json({ error: 'Room not found' });
  const state = q.body && q.body.state;
  if (!['AVAILABLE', 'OUT_OF_SERVICE', 'MAINTENANCE'].includes(state)) return s.status(400).json({ error: 'Invalid room state' });
  if (state === 'AVAILABLE') await db.query('DELETE FROM room_overrides WHERE room_number = ?', [r.number]);
  else await db.query('INSERT INTO room_overrides (room_number, state) VALUES (?, ?) ON CONFLICT (room_number) DO UPDATE SET state = excluded.state', [r.number, state]);
  await audit(null, q.user.id, 'ROOM_STATE_CHANGE', { roomNumber: r.number, state });
  s.json({ room: { ...r, state } });
}));
app.get('/api/admin/users', auth, role('SUPER_ADMIN'), wrap(async (q, s) => s.json({ users: await db.query('SELECT id, username, role, disabled, created_at AS "createdAt" FROM users ORDER BY created_at') })));
app.post('/api/admin/users', auth, role('SUPER_ADMIN'), wrap(async (q, s) => {
  const { username, password, role: r } = q.body || {};
  if (!username || !password || !['SUPER_ADMIN', 'RECEPTION', 'FINANCE'].includes(r)) return s.status(400).json({ error: 'username, password and valid role required' });
  if ((await db.query('SELECT 1 AS x FROM users WHERE username = ?', [String(username)])).length) return s.status(409).json({ error: 'Username already exists' });
  const uid = id('USR');
  await db.query('INSERT INTO users (id,username,role,password_hash,disabled,created_at) VALUES (?,?,?,?,?,?)', [uid, String(username), r, hash(String(password)), 0, new Date().toISOString()]);
  await audit(null, q.user.id, 'CREATE_USER', { username, role: r });
  s.status(201).json({ user: { id: uid, username, role: r, disabled: 0 } });
}));
app.post('/api/admin/users/:id/disable', auth, role('SUPER_ADMIN'), wrap(async (q, s) => {
  const u = (await db.query('SELECT * FROM users WHERE id = ?', [q.params.id]))[0];
  if (!u) return s.status(404).json({ error: 'User not found' });
  if (u.id === q.user.id) return s.status(400).json({ error: 'You cannot disable your own account' });
  await db.query('UPDATE users SET disabled = 1 WHERE id = ?', [u.id]);
  await db.query('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  await audit(null, q.user.id, 'DISABLE_USER', { userId: u.id });
  s.json({ ok: true });
}));
app.get('/api/admin/audit', auth, role('SUPER_ADMIN'), wrap(async (q, s) => {
  const rows = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500');
  s.json({ auditLogs: rows.map(a => ({ ...a, details: (() => { try { return JSON.parse(a.details); } catch { return {}; } })() })) });
}));

app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(ROOT, 'public', 'index.html'));
  res.status(404).json({ error: 'Not found' });
});
app.use((err, req, res, next) => {
  if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

async function init() {
  for (const stmt of SCHEMA) await db.query(stmt);
  const username = process.env.SUPER_ADMIN_USERNAME || 'admin';
  if (!(await db.query('SELECT 1 AS x FROM users WHERE username = ?', [username])).length) {
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!password) console.warn('WARNING: SUPER_ADMIN_PASSWORD is not set — using an insecure default. Set it in Secrets!');
    await db.query('INSERT INTO users (id,username,role,password_hash,disabled,created_at) VALUES (?,?,?,?,?,?)', [id('USR'), username, 'SUPER_ADMIN', hash(password || 'CHANGE-ME-NOW'), 0, new Date().toISOString()]);
  }
  if (db.kind === 'sqlite') console.warn('NOTICE: DATABASE_URL is not set — using local SQLite. On hosts like Replit this data can be lost on redeploy. Set DATABASE_URL for persistent storage.');
  app.listen(PORT, () => console.log(`El-Bethel Hotel running on port ${PORT} (database: ${db.kind})`));
}
init().catch(e => { console.error('Startup failed:', e); process.exit(1); });
