const PALETTE = ['#e8a33d', '#6fa876', '#d6524a', '#7aa7d6', '#c98fd6', '#d6b25a', '#5ac1b8'];
const COLOR_OPTIONS = ['#e8a33d', '#6fa876', '#d6524a', '#7aa7d6', '#c98fd6', '#5ac1b8', '#f0b24b', '#4f9d69'];

const SUPABASE_URL = 'https://tcqnxxhhkxashblpmeii.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-H8t6IEnxwkVHCFbCZWz8w_HcobMQzw';

function createReservationId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Supabase request failed');
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

function normalizeName(value) {
  return (value || '').trim().toLowerCase();
}

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % PALETTE.length;
  return PALETTE[Math.abs(h)];
}
function colorForPerson(name) {
  return myName && name && normalizeName(name) === normalizeName(myName) && myColor ? myColor : colorFor(name);
}
function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}
function fmtDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDateKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const DOW = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DOW_FULL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

let reservations = [];
let myName = '';
let myColor = '';
let currentProfileId = '';
let pendingDeleteId = null;
let selectedDate = fmtDateKey(new Date());
let showingAll = false;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();

function readProfiles() {
  try {
    const raw = localStorage.getItem('reservatie-profiles');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeProfiles(profiles) {
  localStorage.setItem('reservatie-profiles', JSON.stringify(profiles));
}

function ensureProfileId() {
  if (currentProfileId) return currentProfileId;
  const saved = localStorage.getItem('reservatie-current-profile-id');
  if (saved) {
    currentProfileId = saved;
    return currentProfileId;
  }
  const profiles = readProfiles();
  const existingIds = Object.keys(profiles);
  if (existingIds.length) {
    currentProfileId = existingIds.sort((a, b) => (profiles[b].updatedAt || 0) - (profiles[a].updatedAt || 0))[0];
    localStorage.setItem('reservatie-current-profile-id', currentProfileId);
    return currentProfileId;
  }
  currentProfileId = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem('reservatie-current-profile-id', currentProfileId);
  return currentProfileId;
}

async function loadReservations() {
  try {
    const data = await supabaseRequest('reservations?select=id,date,start_time,end_time,name,note');
    reservations = (data || []).map((r) => ({
      id: r.id,
      date: r.date,
      start: r.start_time,
      end: r.end_time,
      name: r.name,
      note: r.note || '',
    }));
  } catch (e) {
    console.error('Load reservations failed', e);
    reservations = [];
  }
}

async function saveReservations() {
  try {
    const payload = reservations.map((r) => ({
      id: r.id || createReservationId(),
      date: r.date,
      start_time: r.start,
      end_time: r.end,
      name: r.name,
      note: r.note || '',
    }));

    const existing = await supabaseRequest('reservations?select=id');
    const existingIds = new Set((existing || []).map((row) => row.id));
    const currentIds = new Set(reservations.map((r) => r.id));
    const idsToDelete = [...existingIds].filter((id) => !currentIds.has(id));

    await supabaseRequest('reservations?on_conflict=id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(payload),
    });

    for (const id of idsToDelete) {
      try {
        await supabaseRequest(`reservations?id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      } catch (deleteError) {
        console.warn('Delete skipped for stale row', id, deleteError);
      }
    }
  } catch (e) {
    console.error('Opslaan mislukt', e);
    alert('Opslaan is mislukt. Probeer opnieuw.');
  }
}
async function loadMyName() {
  try {
    const profileId = ensureProfileId();
    const profiles = readProfiles();
    const profile = profiles[profileId];
    myName = profile && profile.name ? profile.name.trim() : '';
    myColor = profile && profile.color ? profile.color : '';
  } catch (e) {
    myName = '';
    myColor = '';
  }
}
async function saveMyName(n, createNewProfile = false, color = myColor) {
  try {
    const cleanName = (n || '').trim();
    const profiles = readProfiles();
    const profileId = createNewProfile ? `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : ensureProfileId();
    profiles[profileId] = { name: cleanName, color: color || '', updatedAt: Date.now() };
    writeProfiles(profiles);
    currentProfileId = profileId;
    localStorage.setItem('reservatie-current-profile-id', profileId);
    myName = cleanName;
    myColor = color || '';
  } catch (e) {
    console.error('Opslaan naam mislukt', e);
  }
}

function overlaps(dateKey, start, end, excludeId) {
  return reservations.find((r) => r.date === dateKey && r.id !== excludeId && start < r.end && r.start < end);
}

function renderMe() {
  document.getElementById('meLabel').textContent = myName || 'Kies naam';
  document.getElementById('meDot').style.background = myName ? myColor || colorFor(myName) : '#666';
}

function renderColorOptions() {
  const container = document.getElementById('colorOptions');
  if (!container) return;
  container.innerHTML = '';
  COLOR_OPTIONS.forEach((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-option' + (myColor === color ? ' active' : '');
    btn.style.background = color;
    btn.setAttribute('data-color', color);
    btn.addEventListener('click', () => {
      myColor = color;
      document.querySelectorAll('.color-option').forEach((el) => el.classList.toggle('active', el.getAttribute('data-color') === color));
      renderMe();
    });
    container.appendChild(btn);
  });
}

function renderNextUp() {
  const now = new Date();
  const nowKey = fmtDateKey(now);
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const upcoming = reservations.filter((r) => r.date > nowKey || (r.date === nowKey && r.end > nowTime)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const el = document.getElementById('nextUp');
  if (upcoming.length === 0) {
    el.style.display = 'none';
    return;
  }
  const n = upcoming[0];
  const d = parseDateKey(n.date);
  const dayLabel = n.date === nowKey ? 'vandaag' : `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="label">Eerstvolgende rit</div>
    <div class="row">
      <span class="who">${escapeHtml(n.name)}${n.note ? ' · ' + escapeHtml(n.note) : ''}</span>
      <span class="when">${dayLabel} ${n.start}–${n.end}</span>
    </div>`;
}

const FULL_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

function namesForDate(key) {
  return [...new Set(reservations.filter((r) => r.date === key).map((r) => r.name))];
}

function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = `${FULL_MONTHS[viewMonth]} ${viewYear}`;

  const dowRow = document.getElementById('calDow');
  dowRow.innerHTML = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => `<div>${d}</div>`).join('');

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = fmtDateKey(today);

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  // Monday-first offset: JS getDay() 0=Sun..6=Sat -> convert to 0=Mon..6=Sun
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const key = fmtDateKey(d);
    const isOtherMonth = d.getMonth() !== viewMonth;
    const cell = document.createElement('div');
    const isPast = d < today;
    cell.className = 'cal-cell' + (isOtherMonth ? ' other-month' : '') + (key === todayKey ? ' today' : '') + (key === selectedDate ? ' selected' : '') + (isPast ? ' past-day' : '');
    const names = namesForDate(key);
    const dotsHtml = names
      .slice(0, 4)
      .map((n) => `<span style="background:${colorForPerson(n)}"></span>`)
      .join('');
    cell.innerHTML = `<div>${d.getDate()}</div><div class="dots">${dotsHtml}</div>`;
    if (!isPast) {
      cell.addEventListener('click', () => {
        selectedDate = key;
        if (isOtherMonth) {
          viewYear = d.getFullYear();
          viewMonth = d.getMonth();
        }
        renderAll();
      });
    }
    grid.appendChild(cell);
    // stop after completing the week that contains the last day of month, but keep full 6 rows for stable height
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderDayPanel() {
  const title = document.getElementById('panelTitle');
  const sub = document.getElementById('panelSub');
  const list = document.getElementById('resList');

  const d = parseDateKey(selectedDate);
  const today = fmtDateKey(new Date());
  title.textContent = selectedDate === today ? 'Vandaag' : `${DOW_FULL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const dayRes = reservations.filter((r) => r.date === selectedDate).sort((a, b) => a.start.localeCompare(b.start));
  sub.textContent = dayRes.length ? `${dayRes.length} reservatie${dayRes.length > 1 ? 's' : ''}` : '';
  list.innerHTML = '';
  if (dayRes.length === 0) {
    list.innerHTML = `<div class="empty">Nog niets gepland voor deze dag.<br>Wees de eerste!</div>`;
    return;
  }
  dayRes.forEach((r) => {
    list.appendChild(buildCard(r, `${r.start}–${r.end}`));
  });
}

function buildCard(r, timeLabel) {
  const card = document.createElement('div');
  card.className = 'res-card';
  card.style.borderLeftColor = colorForPerson(r.name);
  const canDelete = normalizeName(r.name) === normalizeName(myName);
  card.innerHTML = `
    <div class="time">${timeLabel}</div>
    <div class="mid">
      <div class="who">${escapeHtml(r.name)}</div>
      ${r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ''}
    </div>
    ${canDelete ? `<button class="del" data-id="${r.id}">✕</button>` : ''}
  `;
  const delBtn = card.querySelector('.del');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      if (!deleteOverlay) return;
      pendingDeleteId = r.id;
      document.getElementById('deleteMessage').textContent = `Weet je zeker dat je deze reservatie wilt verwijderen?`;
      deleteOverlay.classList.add('open');
    });
  }
  return card;
}

function renderAll() {
  renderMe();
  renderColorOptions();
  renderNextUp();
  renderCalendar();
  renderDayPanel();
}

// add reservation flow
const overlay = document.getElementById('overlay');
const fDate = document.getElementById('fDate');
const todayInput = new Date();
todayInput.setHours(0, 0, 0, 0);
fDate.min = fmtDateKey(todayInput);

document.getElementById('openAdd').addEventListener('click', () => {
  const fallbackDate = selectedDate < fDate.min ? fDate.min : selectedDate;
  fDate.value = fallbackDate;
  document.getElementById('formErr').classList.remove('show');
  overlay.classList.add('open');
});
document.getElementById('cancelAdd').addEventListener('click', () => overlay.classList.remove('open'));
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) overlay.classList.remove('open');
});

document.getElementById('saveAdd').addEventListener('click', async () => {
  const errEl = document.getElementById('formErr');
  errEl.classList.remove('show');
  if (!myName) {
    nameOverlay.classList.add('open');
    return;
  }
  const date = document.getElementById('fDate').value;
  const start = document.getElementById('fStart').value;
  const end = document.getElementById('fEnd').value;
  const note = document.getElementById('fNote').value.trim();

  if (!date || !start || !end) {
    errEl.textContent = 'Vul datum, van- en tot-tijd in.';
    errEl.classList.add('show');
    return;
  }
  const selectedDay = parseDateKey(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selectedDay < today) {
    errEl.textContent = 'Je kunt geen reservatie maken op een dag die al voorbij is.';
    errEl.classList.add('show');
    return;
  }
  if (start >= end) {
    errEl.textContent = 'De eindtijd moet na de starttijd liggen.';
    errEl.classList.add('show');
    return;
  }
  const clash = overlaps(date, start, end, null);
  if (clash) {
    errEl.textContent = `Botst met de reservatie van ${clash.name} (${clash.start}–${clash.end}).`;
    errEl.classList.add('show');
    return;
  }
  reservations.push({
    id: createReservationId(),
    date,
    start,
    end,
    name: myName,
    note,
  });
  await saveReservations();
  selectedDate = date;
  const savedD = parseDateKey(date);
  viewYear = savedD.getFullYear();
  viewMonth = savedD.getMonth();
  showingAll = false;
  document.getElementById('fNote').value = '';
  overlay.classList.remove('open');
  renderAll();
});

document.getElementById('prevMonth').addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear--;
  }
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  viewMonth++;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear++;
  }
  renderCalendar();
});
document.getElementById('calToday').addEventListener('click', () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  selectedDate = fmtDateKey(now);
  renderAll();
});

// name flow
const nameOverlay = document.getElementById('nameOverlay');
const deleteOverlay = document.getElementById('deleteOverlay');
document.getElementById('meEdit').addEventListener('click', () => {
  document.getElementById('nameInput').value = myName;
  myColor = myColor || COLOR_OPTIONS[0];
  renderColorOptions();
  nameOverlay.classList.add('open');
});
document.getElementById('mePill').addEventListener('click', (e) => {
  if (e.target.id === 'meEdit') return;
  document.getElementById('nameInput').value = myName;
  myColor = myColor || COLOR_OPTIONS[0];
  renderColorOptions();
  nameOverlay.classList.add('open');
});
document.getElementById('nameCancel').addEventListener('click', () => nameOverlay.classList.remove('open'));
nameOverlay.addEventListener('click', (e) => {
  if (e.target === nameOverlay) nameOverlay.classList.remove('open');
});
document.getElementById('nameSave').addEventListener('click', async () => {
  const v = document.getElementById('nameInput').value.trim();
  if (!v) return;
  const color = myColor || COLOR_OPTIONS[0];
  const createNewProfile = !!myName && v.toLowerCase() !== myName.toLowerCase();
  await saveMyName(v, createNewProfile, color);
  nameOverlay.classList.remove('open');
  renderAll();
});

if (deleteOverlay) {
  document.getElementById('deleteCancel').addEventListener('click', () => {
    pendingDeleteId = null;
    deleteOverlay.classList.remove('open');
  });
  deleteOverlay.addEventListener('click', (e) => {
    if (e.target === deleteOverlay) {
      pendingDeleteId = null;
      deleteOverlay.classList.remove('open');
    }
  });
  document.getElementById('deleteConfirm').addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    reservations = reservations.filter((x) => x.id !== pendingDeleteId);
    pendingDeleteId = null;
    deleteOverlay.classList.remove('open');
    await saveReservations();
    renderAll();
  });
}

async function init() {
  await Promise.all([loadReservations(), loadMyName()]);
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (!myName) {
    nameOverlay.classList.add('open');
  }
  renderAll();
}
init();
