let token = localStorage.ebToken || '', me = null;
const $ = s => document.querySelector(s);
const api = async (u, o = {}) => {
  o.headers = { ...(o.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const r = await fetch(u, o);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw Error('Session expired'); }
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
};

function logout() {
  token = ''; localStorage.removeItem('ebToken');
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  $('#loginMsg').textContent = '';
  try {
    const d = await api('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
    token = d.token; localStorage.ebToken = token; me = d.user;
    startApp();
  } catch (err) { $('#loginMsg').textContent = err.message; }
};

$('#logoutBtn').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {} logout(); });

document.querySelectorAll('nav [data-view]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('nav [data-view]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + btn.dataset.view).classList.remove('hidden');
  loadView(btn.dataset.view);
}));

async function startApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  if (me.role !== 'SUPER_ADMIN') $('#usersTabBtn').style.display = 'none';
  loadView('dashboard');
}

async function loadView(view) {
  if (view === 'dashboard') {
    const d = await api('/api/admin/dashboard');
    $('#statGrid').innerHTML = `
      <div class="stat"><span>${d.rooms}</span><small>Total rooms</small></div>
      <div class="stat"><span>${d.available}</span><small>Available</small></div>
      <div class="stat"><span>${d.todayBookings}</span><small>Today's bookings</small></div>
      <div class="stat"><span>${d.confirmed}</span><small>Confirmed</small></div>
      <div class="stat"><span>$${d.revenue}</span><small>Revenue</small></div>
      <div class="stat"><span>${d.pending}</span><small>Pending payment</small></div>`;
  }
  if (view === 'bookings') {
    const d = await api('/api/admin/bookings');
    $('#bookingsTable').innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>Room</th><th>Guest</th><th>Dates</th><th>Total</th><th>Status</th></tr></thead><tbody>${
      d.bookings.map(b => `<tr><td>${b.id}</td><td>${b.roomType} ${b.roomNumber}</td><td>${b.guest.fullName}</td><td>${b.checkIn} → ${b.checkOut}</td><td>$${b.total}</td><td>${b.status}</td></tr>`).join('')
    }</tbody></table>`;
  }
  if (view === 'rooms') {
    const d = await api('/api/rooms');
    $('#roomsTable').innerHTML = `<table class="data-table"><thead><tr><th>Room</th><th>Type</th><th>State</th></tr></thead><tbody>${
      d.rooms.map(r => `<tr><td>${r.number}</td><td>${r.type}</td><td>${r.state}</td></tr>`).join('')
    }</tbody></table>`;
  }
  if (view === 'users') {
    const d = await api('/api/admin/users');
    $('#usersTable').innerHTML = `<table class="data-table"><thead><tr><th>Username</th><th>Role</th><th>Status</th></tr></thead><tbody>${
      d.users.map(u => `<tr><td>${u.username}</td><td>${u.role}</td><td>${u.disabled ? 'Disabled' : 'Active'}</td></tr>`).join('')
    }</tbody></table>`;
  }
}

$('#walkInForm').onsubmit = async e => {
  e.preventDefault();
  $('#wiMsg').textContent = '';
  try {
    await api('/api/admin/bookings/walk-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomType: $('#wiType').value, roomNumber: $('#wiRoom').value, checkIn: $('#wiCheckIn').value, checkOut: $('#wiCheckOut').value, guest: { fullName: $('#wiName').value, phone: $('#wiPhone').value } }) });
    $('#wiMsg').textContent = 'Booking created.';
    loadView('bookings');
  } catch (err) { $('#wiMsg').textContent = err.message; }
};

$('#userForm').onsubmit = async e => {
  e.preventDefault();
  $('#userMsg').textContent = '';
  try {
    await api('/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: $('#newUsername').value, password: $('#newPassword').value, role: $('#newRole').value }) });
    $('#userMsg').textContent = 'User created.';
    loadView('users');
  } catch (err) { $('#userMsg').textContent = err.message; }
};

if (token) { api('/api/admin/me').then(d => { me = d.user; startApp(); }).catch(() => logout()); }
