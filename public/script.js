const $ = s => document.querySelector(s);
let currentBookingId = null, selectedRoom = null;
const ci = $('#checkIn'), co = $('#checkOut'), type = $('#roomType');

$('#checkBtn').addEventListener('click', async () => {
  const msg = $('#bookingMsg'); msg.textContent = '';
  if (!ci.value || !co.value) { msg.textContent = 'Select check-in and check-out dates.'; return; }
  const r = await fetch(`/api/availability?checkIn=${ci.value}&checkOut=${co.value}&type=${type.value}`);
  const d = await r.json();
  const box = $('#availability');
  if (!r.ok) { box.innerHTML = ''; msg.textContent = d.error; return; }
  if (!d.rooms.length) { box.innerHTML = ''; msg.textContent = 'No rooms available for those dates.'; return; }
  box.innerHTML = d.rooms.map(room => `<button type="button" class="room-choice" data-room="${room.number}">Room ${room.number}</button>`).join('');
  [...box.children].forEach(btn => btn.addEventListener('click', () => {
    [...box.children].forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRoom = btn.dataset.room;
    $('#guestFields').classList.remove('hidden');
    const nights = Math.ceil((new Date(co.value) - new Date(ci.value)) / 86400000);
    fetch('/api/rooms').then(r => r.json()).then(info => {
      const price = info.prices[type.value];
      $('#total').textContent = `${nights} night(s) × $${price} = $${nights * price}`;
    });
  }));
});

$('#bookingForm').onsubmit = async e => {
  e.preventDefault();
  if (!selectedRoom) return $('#bookingMsg').textContent = 'Select an available room number first.';
  const body = { roomType: type.value, roomNumber: selectedRoom, checkIn: ci.value, checkOut: co.value, guest: { fullName: $('#fullName').value, phone: $('#phone').value, email: $('#email').value, notes: $('#notes').value } };
  const r = await fetch('/api/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) return $('#bookingMsg').textContent = d.error;
  currentBookingId = d.booking.id;
  $('#guestFields').classList.add('hidden');
  $('#paymentGate').classList.remove('hidden');
  $('#payGateTotal').textContent = `Total: $${d.booking.total.toLocaleString()} — Booking ${d.booking.id}`;
  $('#bookingMsg').textContent = '';
};

$('#payGateBtn').addEventListener('click', async () => {
  const msg = $('#bookingMsg'); msg.textContent = '';
  const r = await fetch(`/api/bookings/${currentBookingId}/confirm-payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#payCode').value }) });
  const d = await r.json();
  if (!r.ok) { msg.textContent = d.error; return; }
  $('#paymentGate').innerHTML = '<div class="total">Booking confirmed! We look forward to your stay.</div>';
});
