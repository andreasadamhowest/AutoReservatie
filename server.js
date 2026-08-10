const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tcqnxxhhkxashblpmeii.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_-H8t6IEnxwkVHCFbCZWz8w_HcobMQzw';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw ? JSON.parse(raw) : { reservations: [] };
  } catch (error) {
    return { reservations: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

let state = loadState();

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase is not configured on the server');
  }

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

  return response.status === 204 ? null : response.json();
}

function normalizeReservation(entry) {
  return {
    id: entry.id,
    date: entry.date,
    start: entry.start_time || entry.start || '',
    end: entry.end_time || entry.end || '',
    name: entry.name || '',
    note: entry.note || '',
  };
}

async function readReservationsFromStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const data = await supabaseRequest('reservations?select=id,date,start_time,end_time,name,note');
      return (data || []).map(normalizeReservation);
    } catch (error) {
      console.error('Could not read reservations from Supabase:', error.message);
    }
  }

  return state.reservations || [];
}

async function writeReservationsToStore(reservations) {
  state = { ...state, reservations };
  saveState(state);

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const payload = reservations.map((reservation) => ({
        id: reservation.id,
        date: reservation.date,
        start_time: reservation.start,
        end_time: reservation.end,
        name: reservation.name,
        note: reservation.note || '',
      }));

      const existing = await supabaseRequest('reservations?select=id');
      const existingIds = new Set((existing || []).map((row) => row.id));
      const currentIds = new Set(reservations.map((reservation) => reservation.id));
      const idsToDelete = [...existingIds].filter((id) => !currentIds.has(id));

      await supabaseRequest('reservations?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(payload),
      });

      for (const id of idsToDelete) {
        await supabaseRequest(`reservations?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
    } catch (error) {
      console.error('Could not sync reservations to Supabase:', error.message);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (pathname === '/api/reservations') {
    if (req.method === 'GET') {
      try {
        const reservations = await readReservationsFromStore();
        sendJson(res, 200, { reservations });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const reservations = Array.isArray(body.reservations) ? body.reservations : [];
        await writeReservationsToStore(reservations);
        sendJson(res, 200, { ok: true, reservations });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return;
    }

    res.writeHead(405, { Allow: 'GET, POST' });
    res.end();
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname.replace(/^\//, ''));
  const safePath = path.normalize(filePath).startsWith(ROOT) ? filePath : path.join(ROOT, 'index.html');

  fs.readFile(safePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server error');
      }
      return;
    }

    const ext = path.extname(safePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
