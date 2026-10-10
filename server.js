const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'); // built into Node.js 22+, no extra package needed
let Arifpay = null, arifpay = null;
try {
  Arifpay = require('arifpay');
  Arifpay = Arifpay.default || Arifpay;
  if (process.env.ARIFPAY_API_KEY) arifpay = new Arifpay(process.env.ARIFPAY_API_KEY);
} catch (e) { console.warn('ArifPay package not installed yet — run `npm install arifpay` when ready.'); }

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data', 'el-bethel.db');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000;     // 15 minutes
const LOGIN_MAX_ATTEMPTS = 5;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));

// ---------- Database setup ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
// DELETE (not WAL) + synchronous FULL: every write lands in the main file immediately.
// Hosts like Replit Autoscale can kill the process abruptly when it scales to zero;
// WAL risks losing recent not-yet-checkpointed writes. Low-traffic hotel site, so the
// small write-speed cost here is worth the durability.
db.exec('PRAGMA journal_mode = DELETE');
db.exec('PRAGMA synchronous = FULL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
  password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL,
  room_type TEXT NOT NULL, room_number TEXT NOT NULL,
  check_in TEXT NOT NULL, check_out TEXT NOT NULL, nights INTEGER NOT NULL,
  total INTEGER NOT NULL, breakfast INTEGER NOT NULL,
  guest_full_name TEXT NOT NULL, guest_phone TEXT NOT NULL,
  guest_email TEXT, guest_notes TEXT,
  created_at TEXT NOT NULL, created_by TEXT, arifpay_session_id TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, method TEXT NOT NULL,
  status TEXT NOT NULL, amount INTEGER NOT NULL, reference TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_overrides (
  room_number TEXT PRIMARY KEY, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_number, check_in, check_out);
`);

// ---------- Hotel data — from El-Bethel's real listings (el-bethelhotel.com) ----------
// Prices shown in USD on their current site; add more room types/numbers any time.
const prices = { Single: 10, Double: 25 };
const breakfast = { Single: 1, Double: 2 };
const rooms = [
  ['101','Single'],['102','Single'],['103','Single'],['104','Single'],
  ['105','Double'],['106','Double'],['107','Double'],
  ['201','Single'],['202','Single'],['203','Single'],
  ['204','Double'],['205','Double'],['206','Double'],
  ['301','Single'],['302','Single'],['303','Double'],['304','Double']
].map(([number, type]) => ({ number, type, floor: number[0] }));
const OUT = new Set(); // room numbers that are out of service — edit as needed

function id(prefix) { return `${prefix}-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function hash(p, s = crypto.randomBytes(16).toString('hex')) { return `${s}:${crypto.scryptSync(p, s, 64).toString('hex')}`; }
function verify(p, h) { const [s, x] = String(h).split(':'); if (!s || !x) return false; try { return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(p, s, 64)); } catch { return false; } }
function dateNights(a, b) { const x = new Date(a + 'T00:00:00Z'), y = new Date(b + 'T00:00:00Z'); return Math.ceil((y - x) / 86400000); }

function seedAdmin() {
  const username = process.env.SUPER_ADMIN_USERNAME || 'admin';
  const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existing) return;
  const password = process.env.SUPER_ADMIN_PASSWORD || 'CHANGE-ME-NOW';
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id('USR'), username, 'SUPER_ADMIN', hash(password), 0, new Date().toISOString());
}
seedAdmin();

// ---------- Sessions (DB-backed, survive restarts) ----------
function createSession(userId) {
  const t = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(t, userId, now, now + SESSION_TTL_MS);
  return t;
}
function getSession(token) {
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); return null; }
  return row;
}
function deleteSession(token) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }
setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }, 60 * 60 * 1000).unref();

// ---------- Login rate limiting (per IP, in-memory sliding window) ----------
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.windowStart > LOGIN_WINDOW_MS) { loginAttempts.set(ip, { count: 1, windowStart: now }); return { blocked: false }; }
  rec.count += 1;
  if (rec.count > LOGIN_MAX_ATTEMPTS) return { blocked: true, retryAfterSec: Math.ceil((rec.windowStart + LOGIN_WINDOW_MS - now) / 1000) };
  return { blocked: false };
}
setInterval(() => { const now = Date.now(); for (const [ip, rec] of loginAttempts) if (now - rec.windowStart > LOGIN_WINDOW_MS) loginAttempts.delete(ip); }, 30 * 60 * 1000).unref();

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '') || req.headers['x-session-token'];
  const s = t && getSession(t);
  if (!s) return res.status(401).json({ error: 'Authentication required' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!u || u.disabled) return res.status(401).json({ error: 'Account disabled' });
  req.user = u; req.sessionToken = t;
  next();
}
function role(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Permission denied' }); }
function audit(user, action, details) {
  db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?)').run(id('AUD'), user?.id || null, action, JSON.stringify(details || {}), new Date().toISOString());
}

// ---------- Booking helpers ----------
function roomState(r) {
  const row = db.prepare('SELECT state FROM room_overrides WHERE room_number = ?').get(r.number);
  if (row) return row.state;
  return OUT.has(r.number) ? 'OUT_OF_SERVICE' : 'AVAILABLE';
}
const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'];
function roomIsFree(roomNumber, checkIn, checkOut) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const clash = db.prepare(`SELECT 1 FROM bookings WHERE room_number = ? AND status IN (${placeholders}) AND check_in < ? AND check_out > ? LIMIT 1`)
    .get(roomNumber, ...ACTIVE_STATUSES, checkOut, checkIn);
  return !clash;
}
function availableRooms(checkIn, checkOut, type) {
  return rooms.filter(r => roomState(r) === 'AVAILABLE' && (!type || r.type === type) && roomIsFree(r.number, checkIn, checkOut));
}
function calculate(type, ci, co) {
  if (!prices[type]) throw Error('Invalid room type');
  const nights = dateNights(ci, co);
  if (!Number.isInteger(nights) || nights < 1) throw Error('Invalid stay dates');
  return { nights, total: prices[type] * nights };
}
function rowToBooking(b) {
  return { id: b.id, status: b.status, source: b.source, roomType: b.room_type, roomNumber: b.room_number, checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, total: b.total, breakfast: b.breakfast, guest: { fullName: b.guest_full_name, phone: b.guest_phone, email: b.guest_email, notes: b.guest_notes }, createdAt: b.created_at, createdBy: b.created_by };
}
function createBooking(body, source = 'ONLINE', actor = null) {
  const { roomType, roomNumber, checkIn, checkOut, guest } = body;
  if (!roomType || !roomNumber || !checkIn || !checkOut || !guest?.fullName || !guest?.phone) throw Error('Required booking information is missing');
  const room = rooms.find(r => r.number === roomNumber && r.type === roomType);
  if (!room || roomState(room) !== 'AVAILABLE') throw Error('Selected room is unavailable');
  const calc = calculate(roomType, checkIn, checkOut);
  if (!roomIsFree(roomNumber, checkIn, checkOut)) throw Object.assign(new Error('Room has just been booked. Please select another room.'), { status: 409 });
  const bookingId = id('EBH');
  const status = source === 'WALK_IN' ? 'CONFIRMED' : 'PENDING_PAYMENT';
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO bookings (id,status,source,room_type,room_number,check_in,check_out,nights,total,breakfast,guest_full_name,guest_phone,guest_email,guest_notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    bookingId, status, source, roomType, roomNumber, checkIn, checkOut, calc.nights, calc.total, breakfast[roomType],
    guest.fullName.trim(), guest.phone.trim(), (guest.email || '').trim(), guest.notes || '', createdAt, actor?.id || null
  );
  if (source === 'WALK_IN') {
    db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,?)').run(id('PAY'), bookingId, 'OFFLINE', 'PENDING', calc.total, '', createdAt);
  }
  audit(actor, source === 'WALK_IN' ? 'CREATE_WALK_IN' : 'CREATE_ONLINE', { bookingId, roomNumber });
  return rowToBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId));
}

// ---------- Public API ----------
app.get('/api/health', (q, s) => s.json({ ok: true, service: 'El-Bethel Hotel', rooms: rooms.length }));
app.get('/api/rooms', (q, s) => s.json({ rooms: rooms.map(r => ({ ...r, state: roomState(r) })), prices, breakfast }));
app.get('/api/availability', (q, s) => {
  try {
    const { checkIn, checkOut, type } = q.query;
    if (!checkIn || !checkOut) throw Error('checkIn and checkOut are required');
    calculate(type || 'Standard', checkIn, checkOut);
    const a = availableRooms(checkIn, checkOut, type);
    s.json({ rooms: a, count: a.length });
  } catch (e) { s.status(400).json({ error: e.message }); }
});
app.post('/api/bookings', (q, s) => {
  try { s.status(201).json({ booking: createBooking(q.body) }); }
  catch (e) { s.status(e.status || 400).json({ error: e.message }); }
});
app.get('/api/bookings/:id', (q, s) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  s.json({ booking: rowToBooking(row) });
});

// ArifPay checkout (used only if ARIFPAY_API_KEY is configured)
app.post('/api/bookings/:id/payment-intent', async (q, s) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  if (row.status !== 'PENDING_PAYMENT') return s.status(409).json({ error: 'Booking is not awaiting payment' });
  const base = process.env.PUBLIC_BASE_URL || `${q.protocol}://${q.get('host')}`;
  if (!arifpay) return s.status(503).json({ error: 'Payment gateway is not configured for this hotel yet.', bookingId: row.id, amount: row.total });
  try {
    const nonce = crypto.randomBytes(8).toString('hex');
    const expire = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const data = {
      cancelUrl: `${base}/#book`, errorUrl: `${base}/#book`, successUrl: `${base}/#book`,
      notifyUrl: `${base}/api/arifpay/webhook`,
      nonce, expireDate: expire, paymentMethods: [],
      items: [{ name: `${row.room_type} Room — ${row.nights} night(s), Room ${row.room_number}`, price: row.total, quantity: 1 }],
      beneficiaries: process.env.ARIFPAY_BENEFICIARY_ACCOUNT ? [{ accountNumber: process.env.ARIFPAY_BENEFICIARY_ACCOUNT, bank: process.env.ARIFPAY_BENEFICIARY_BANK || 'CBETETAA', amount: row.total }] : undefined
    };
    const session = await arifpay.checkout.create(data, { sandbox: process.env.ARIFPAY_SANDBOX !== 'false' });
    const sessionId = session.sessionId || session.data?.sessionId;
    if (sessionId) db.prepare('UPDATE bookings SET arifpay_session_id = ? WHERE id = ?').run(sessionId, row.id);
    s.json({ bookingId: row.id, amount: row.total, paymentUrl: session.paymentUrl || session.data?.paymentUrl, status: 'REDIRECT', provider: 'arifpay' });
  } catch (e) { console.error('ArifPay session creation failed:', e.message); s.status(502).json({ error: 'ArifPay request failed', detail: e.message }); }
});
app.post('/api/arifpay/webhook', async (q, s) => {
  try {
    const sessionId = q.body?.sessionId || q.body?.data?.sessionId || q.body?.session_id;
    if (!sessionId || !arifpay) return s.status(400).json({ error: 'Missing sessionId or ArifPay not configured' });
    const row = db.prepare('SELECT * FROM bookings WHERE arifpay_session_id = ?').get(sessionId);
    if (!row) return s.status(404).json({ error: 'No booking matches this session' });
    const session = await arifpay.checkout.fetch(sessionId, { sandbox: process.env.ARIFPAY_SANDBOX !== 'false' });
    console.log('ArifPay session status check:', JSON.stringify(session));
    const statusValue = String(session?.transcation?.status || session?.transaction?.status || session?.status || '').toUpperCase();
    const paid = statusValue.includes('SUCCESS') || statusValue.includes('PAID') || statusValue.includes('COMPLETE');
    if (!paid) return s.json({ ok: true, status: statusValue || 'PENDING' });
    if (row.status === 'CONFIRMED') return s.json({ ok: true, idempotent: true });
    db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?").run(row.id);
    db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,?)').run(id('PAY'), row.id, 'ARIFPAY', 'PAID', row.total, sessionId, new Date().toISOString());
    s.json({ ok: true, status: 'CONFIRMED' });
  } catch (e) { console.error('ArifPay webhook error:', e.message); s.status(500).json({ error: 'Webhook processing failed' }); }
});
// Manual/offline payment confirmation, gated by a shared code the hotel keeps privately
app.post('/api/bookings/:id/confirm-payment', (q, s) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  if (row.status !== 'PENDING_PAYMENT') return s.status(409).json({ error: 'Booking is not awaiting payment' });
  const secret = process.env.PAYMENT_CONFIRM_PASSWORD;
  if (!secret) return s.status(503).json({ error: 'Payment confirmation is not configured for this hotel yet.' });
  const given = String((q.body || {}).password || '');
  const match = given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!match) { audit(null, 'PAYMENT_PASSWORD_FAILED', { bookingId: row.id }); return s.status(401).json({ error: 'Incorrect payment confirmation code.' }); }
  db.prepare("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?").run(row.id);
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,?)').run(id('PAY'), row.id, 'MANUAL', 'PAID', row.total, '', new Date().toISOString());
  audit(null, 'PAYMENT_CONFIRMED_MANUAL', { bookingId: row.id });
  s.json({ booking: rowToBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(row.id)) });
});

// ---------- Admin API ----------
app.post('/api/admin/login', (q, s) => {
  const ip = q.headers['x-forwarded-for']?.split(',')[0]?.trim() || q.socket.remoteAddress || 'unknown';
  const limit = checkRateLimit(ip);
  if (limit.blocked) { audit(null, 'LOGIN_RATE_LIMITED', { ip }); s.set('Retry-After', String(limit.retryAfterSec)); return s.status(429).json({ error: `Too many login attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` }); }
  const { username, password } = q.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(username);
  if (!u || !verify(password || '', u.password_hash)) return s.status(401).json({ error: 'Invalid username or password' });
  const t = createSession(u.id);
  s.json({ token: t, user: { id: u.id, username: u.username, role: u.role } });
});
app.post('/api/admin/logout', auth, (q, s) => { deleteSession(q.sessionToken); s.json({ ok: true }); });
app.get('/api/admin/me', auth, (q, s) => s.json({ user: { id: q.user.id, username: q.user.username, role: q.user.role } }));
app.get('/api/admin/dashboard', auth, role('SUPER_ADMIN', 'RECEPTION', 'FINANCE'), (q, s) => {
  const today = new Date().toISOString().slice(0, 10);
  const confirmedCount = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')").get().c;
  const todayCount = db.prepare('SELECT COUNT(*) c FROM bookings WHERE created_at LIKE ?').get(today + '%').c;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) r FROM payments WHERE status = 'PAID'").get().r;
  const pending = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'PENDING_PAYMENT'").get().c;
  const outOfService = rooms.filter(r => roomState(r) !== 'AVAILABLE').length;
  s.json({ rooms: rooms.length, available: rooms.length - outOfService, outOfService, todayBookings: todayCount, confirmed: confirmedCount, revenue, pending });
});
app.get('/api/admin/bookings', auth, role('SUPER_ADMIN', 'RECEPTION', 'FINANCE'), (q, s) => {
  const rowsArr = q.query.status
    ? db.prepare('SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC LIMIT 500').all(q.query.status)
    : db.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500').all();
  s.json({ bookings: rowsArr.map(rowToBooking) });
});
app.post('/api/admin/bookings/walk-in', auth, role('SUPER_ADMIN', 'RECEPTION'), (q, s) => {
  try { s.status(201).json({ booking: createBooking(q.body, 'WALK_IN', q.user) }); }
  catch (e) { s.status(e.status || 400).json({ error: e.message }); }
});
app.post('/api/admin/bookings/:id/status', auth, role('SUPER_ADMIN', 'RECEPTION'), (q, s) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(q.params.id);
  if (!row) return s.status(404).json({ error: 'Booking not found' });
  const allowed = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];
  if (!allowed.includes(q.body.status)) return s.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(q.body.status, row.id);
  audit(q.user, 'UPDATE_BOOKING_STATUS', { bookingId: row.id, status: q.body.status });
  s.json({ booking: rowToBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(row.id)) });
});
app.get('/api/admin/payments', auth, role('SUPER_ADMIN', 'FINANCE'), (q, s) => s.json({ payments: db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 1000').all() }));
app.post('/api/admin/rooms/:number/state', auth, role('SUPER_ADMIN'), (q, s) => {
  const r = rooms.find(x => x.number === q.params.number);
  if (!r) return s.status(404).json({ error: 'Room not found' });
  const state = q.body.state;
  if (!['AVAILABLE', 'OUT_OF_SERVICE', 'MAINTENANCE'].includes(state)) return s.status(400).json({ error: 'Invalid room state' });
  if (state === 'AVAILABLE') db.prepare('DELETE FROM room_overrides WHERE room_number = ?').run(r.number);
  else db.prepare('INSERT OR REPLACE INTO room_overrides VALUES (?,?)').run(r.number, state);
  audit(q.user, 'ROOM_STATE_CHANGE', { roomNumber: r.number, state });
  s.json({ room: { ...r, state: roomState(r) } });
});
app.get('/api/admin/users', auth, role('SUPER_ADMIN'), (q, s) => s.json({ users: db.prepare('SELECT id, username, role, disabled, created_at as createdAt FROM users').all() }));
app.post('/api/admin/users', auth, role('SUPER_ADMIN'), (q, s) => {
  const { username, password, role: r } = q.body || {};
  if (!username || !password || !['SUPER_ADMIN', 'RECEPTION', 'FINANCE'].includes(r)) return s.status(400).json({ error: 'username, password and valid role required' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return s.status(409).json({ error: 'Username already exists' });
  const uid = id('USR');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(uid, username, r, hash(password), 0, new Date().toISOString());
  audit(q.user, 'CREATE_USER', { username, role: r });
  s.status(201).json({ user: { id: uid, username, role: r, disabled: false } });
});
app.post('/api/admin/users/:id/disable', auth, role('SUPER_ADMIN'), (q, s) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(q.params.id);
  if (!u) return s.status(404).json({ error: 'User not found' });
  if (u.id === q.user.id) return s.status(400).json({ error: 'You cannot disable your own account' });
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(q.user, 'DISABLE_USER', { userId: u.id });
  s.json({ ok: true });
});
app.get('/api/admin/audit', auth, role('SUPER_ADMIN'), (q, s) => {
  const rowsArr = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all();
  s.json({ auditLogs: rowsArr.map(a => ({ ...a, details: (() => { try { return JSON.parse(a.details); } catch { return {}; } })() })) });
});

app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(ROOT, 'public', 'index.html'));
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => console.log(`El-Bethel Hotel: http://localhost:${PORT}`));
