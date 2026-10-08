document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.getElementById('hamburger');
  const navMenu = document.getElementById('navMenu');
  const checkForm = document.getElementById('checkForm');
  const bookingForm = document.getElementById('bookingForm');
  const roomsContainer = document.getElementById('roomsContainer');
  const selectedRoomSelect = document.getElementById('selectedRoom');

  // Mobile Menu Toggle
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }

  // Set default dates in search bar (Today & Tomorrow)
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  if (document.getElementById('checkIn')) document.getElementById('checkIn').value = today;
  if (document.getElementById('checkOut')) document.getElementById('checkOut').value = tomorrow;

  // Fetch and display rooms dynamically from API
  async function loadRooms() {
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      
      if (roomsContainer) {
        roomsContainer.innerHTML = '';
        data.rooms.forEach(room => {
          const price = data.prices[room.type] || 0;
          const imgUrl = room.type === 'Single' 
            ? 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=600&q=80'
            : 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=600&q=80';

          const card = document.createElement('div');
          card.className = 'room-card';
          card.innerHTML = `
            <img src="${imgUrl}" alt="${room.type} Room" class="room-img">
            <div class="room-info">
              <h3 class="room-title">ክፍል ${room.number} (${room.type})</h3>
              <div class="room-price">$${price} / በሌሊት</div>
              <p>ምቹ አልጋ፣ ነፃ ዋይፋይ፣ ቁርስ የተካተተበት (${data.breakfast[room.type] || 1} ሰው)</p>
              <br>
              <a href="#book" class="btn-primary btn-block text-center" onclick="selectRoomForBooking('${room.number}', '${room.type}')">ይህንን ክፍል ምረጥ</a>
            </div>
          `;
          roomsContainer.appendChild(card);
        });
      }
    } catch (err) {
      console.error(' Error loading rooms:', err);
    }
  }

  // Check Availability
  if (checkForm) {
    checkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const checkIn = document.getElementById('checkIn').value;
      const checkOut = document.getElementById('checkOut').value;
      const type = document.getElementById('roomType').value;

      try {
        const res = await fetch(`/api/availability?checkIn=${checkIn}&checkOut=${checkOut}&type=${type}`);
        const data = await res.json();
        
        if (data.rooms) {
          selectedRoomSelect.innerHTML = '<option value="">ክፍል ይምረጡ...</option>';
          data.rooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ number: r.number, type: r.type });
            opt.textContent = `ክፍል ${r.number} (${r.type})`;
            selectedRoomSelect.appendChild(opt);
          });
          alert(`የተፈለጉት ቀናት ላይ ${data.count} ክፍሎች ክፍት ናቸው። እባክዎ ከስር ካለው ቅጽ ላይ መርጠው ትዕዛዙን ይጨርሱ!`);
          document.getElementById('book').scrollIntoView({ behavior: 'smooth' });
        }
      } catch (err) {
        alert('ክፍሎችን መፈለግ አልተቻለም፡ ' + err.message);
      }
    });
  }

  // Submit Booking Form
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const roomValue = selectedRoomSelect.value;
      if (!roomValue) return alert('እባክዎን ክፍል ይምረጡ!');

      const parsedRoom = JSON.parse(roomValue);
      const checkIn = document.getElementById('checkIn').value || today;
      const checkOut = document.getElementById('checkOut').value || tomorrow;

      const payload = {
        roomType: parsedRoom.type,
        roomNumber: parsedRoom.number,
        checkIn: checkIn,
        checkOut: checkOut,
        guest: {
          fullName: document.getElementById('guestName').value,
          phone: document.getElementById('guestPhone').value,
          email: document.getElementById('guestEmail').value,
          notes: document.getElementById('guestNotes').value
        }
      };

      try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
          alert(`ቡኪንግዎ በስኬት ተመዝግቧል! \nየቡኪንግ ቁጥርዎ (ID)፡ ${data.booking.id} \nጠቅላላ ዋጋ፡ $${data.booking.total}`);
          bookingForm.reset();
        } else {
          alert('ስህተት አለ፡ ' + data.error);
        }
      } catch (err) {
        alert('ትዕዛዙን ማስተላለፍ አልተቻለም።');
      }
    });
  }

  loadRooms();
});

// Select specific room from card
function selectRoomForBooking(roomNumber, roomType) {
  const select = document.getElementById('selectedRoom');
  select.innerHTML = `<option value='${JSON.stringify({number: roomNumber, type: roomType})}'>ክፍል ${roomNumber} (${roomType})</option>`;
}

// Modal Handlers
function openAdminModal() {
  document.getElementById('adminModal').style.display = 'flex';
}
function closeAdminModal() {
  document.getElementById('adminModal').style.display = 'none';
}
