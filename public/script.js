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

// Dark/Light theme toggle
(function(){
  const root=document.documentElement, btn=$('#themeToggle');
  function apply(t){root.setAttribute('data-theme',t); if(btn) btn.textContent = t==='dark'?'☀️':'🌙';}
  let saved=null; try{saved=localStorage.getItem('ebTheme');}catch(e){}
  apply(saved||'light');
  btn?.addEventListener('click',()=>{const n=root.getAttribute('data-theme')==='dark'?'light':'dark';apply(n);try{localStorage.setItem('ebTheme',n);}catch(e){}});
})();

// Simple language switch (English/Amharic text swap demo — extend dict as needed)
const EB_I18N = {
  am: { nav_about:"ስለ እኛ", nav_rooms:"ክፍሎች", nav_gallery:"ፎቶዎች", nav_reviews:"አስተያየት", nav_faq:"ጥያቄዎች", nav_contact:"አግኙን" }
};
$('#langSelect')?.addEventListener('change', e => {
  document.documentElement.lang = e.target.value;
});

// Gallery rail arrows
(function(){
  const rail=$('#galleryRail'), track=$('#galleryTrack');
  if(!rail||!track) return;
  $('#galPrev')?.addEventListener('click',()=>rail.scrollBy({left:-300,behavior:'smooth'}));
  $('#galNext')?.addEventListener('click',()=>rail.scrollBy({left:300,behavior:'smooth'}));
})();

// Theme toggle
(function(){
  const root=document.documentElement, btn=$('#themeToggle');
  function apply(t){root.setAttribute('data-theme',t); if(btn) btn.textContent = t==='dark'?'☀️':'🌙';}
  let saved=null; try{saved=localStorage.getItem('ebTheme');}catch(e){}
  apply(saved || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
  btn?.addEventListener('click', ()=>{const n=root.getAttribute('data-theme')==='dark'?'light':'dark'; apply(n); try{localStorage.setItem('ebTheme',n);}catch(e){}});
})();

// Gallery rail: auto-scroll + arrows
(function(){
  const wrap=$('#galleryRail'), track=$('#galleryTrack');
  if(!wrap||!track) return;
  const originals=[...track.children];
  originals.forEach(c=>track.appendChild(c.cloneNode(true)));
  function step(){return (originals[0].offsetWidth||280)+14;}
  function full(){return track.scrollWidth/2;}
  let paused=false;
  wrap.addEventListener('mouseenter',()=>paused=true);
  wrap.addEventListener('mouseleave',()=>paused=false);
  wrap.addEventListener('touchstart',()=>paused=true,{passive:true});
  wrap.addEventListener('touchend',()=>setTimeout(()=>paused=false,3000));
  $('#galPrev')?.addEventListener('click',()=>wrap.scrollBy({left:-step(),behavior:'smooth'}));
  $('#galNext')?.addEventListener('click',()=>wrap.scrollBy({left:step(),behavior:'smooth'}));
  function tick(){ if(!paused){wrap.scrollLeft+=0.5; if(wrap.scrollLeft>=full()) wrap.scrollLeft-=full();} requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})();

// Social links — Dagi will add real URLs here
const SOCIAL_LINKS = { tiktok:'', whatsapp:'', telegram:'' };
(function(){
  const el=$('#socialLinks'); if(!el) return;
  const icons={ tiktok:'TT', whatsapp:'WA', telegram:'TG' };
  Object.entries(SOCIAL_LINKS).forEach(([name,url])=>{
    if(!url) return;
    const a=document.createElement('a'); a.href=url; a.target='_blank'; a.rel='noopener'; a.textContent=icons[name]||name;
    el.appendChild(a);
  });
})();
