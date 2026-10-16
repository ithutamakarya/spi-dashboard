let authToken = localStorage.getItem('kiosk_admin_token') || '';

// DOM Elements
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const pinInput = document.getElementById('pin-input');
const loginError = document.getElementById('login-error');
const adminApp = document.getElementById('admin-app');
const logoutBtn = document.getElementById('logout-btn');

const statSync = document.getElementById('stat-sync');
const statMediaCount = document.getElementById('stat-media-count');
const statLastSync = document.getElementById('stat-last-sync');
const btnSyncNow = document.getElementById('btn-sync-now');
const btnTestConn = document.getElementById('btn-test-connection');
const testResult = document.getElementById('test-conn-result');

const displayForm = document.getElementById('display-form');
const onedriveForm = document.getElementById('onedrive-form');
const galleryGrid = document.getElementById('gallery-grid');

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'tab-gallery') loadGallery();
  });
});

// Authentication
function checkAuth() {
  if (authToken) {
    loginModal.classList.add('hidden');
    adminApp.classList.remove('hidden');
    loadData();
  } else {
    loginModal.classList.remove('hidden');
    adminApp.classList.add('hidden');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinInput.value })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      authToken = data.token;
      localStorage.setItem('kiosk_admin_token', authToken);
      pinInput.value = '';
      checkAuth();
    } else {
      loginError.textContent = data.error || 'PIN salah!';
      loginError.classList.remove('hidden');
    }
  } catch (err) {
    loginError.textContent = 'Gagal menghubungi server.';
    loginError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', () => {
  authToken = '';
  localStorage.removeItem('kiosk_admin_token');
  checkAuth();
});

// API Helpers
async function fetchWithAuth(url, options = {}) {
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${authToken}`
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    authToken = '';
    localStorage.removeItem('kiosk_admin_token');
    checkAuth();
    throw new Error('Sesi berakhir, silakan login kembali.');
  }
  return res;
}

// Load Data
async function loadData() {
  loadStatus();
  loadConfig();
}

async function loadStatus() {
  try {
    const res = await fetch('/api/sync/status');
    const data = await res.json();
    statMediaCount.textContent = `${data.mediaCount} berkas`;

    if (data.isSyncing) {
      statSync.textContent = 'Sedang Menyinkronkan...';
      statSync.className = 'badge badge-idle';
    } else if (data.lastSyncStatus === 'SUCCESS') {
      statSync.textContent = 'Tersinkronisasi';
      statSync.className = 'badge badge-success';
    } else if (data.lastSyncStatus === 'ERROR') {
      statSync.textContent = 'Gagal Sync';
      statSync.className = 'badge badge-error';
    } else {
      statSync.textContent = 'Idle';
      statSync.className = 'badge badge-idle';
    }

    statLastSync.textContent = data.lastSyncTime ? new Date(data.lastSyncTime).toLocaleString('id-ID') : 'Belum pernah';
  } catch (e) {
    console.error(e);
  }
}

async function loadConfig() {
  try {
    const res = await fetchWithAuth('/api/admin/config');
    const config = await res.json();

    // Populate Display Form
    document.getElementById('showClock').checked = !!config.display.showClock;
    document.getElementById('showMarquee').checked = !!config.display.showMarquee;
    document.getElementById('marqueeText').value = config.display.marqueeText || '';
    document.getElementById('marqueeSpeed').value = config.display.marqueeSpeed || 'medium';
    document.getElementById('imageDurationSeconds').value = config.display.imageDurationSeconds || 10;
    document.getElementById('mediaFit').value = config.display.mediaFit || 'contain';
    document.getElementById('videoMuted').checked = config.display.videoMuted !== false;

    // Populate OneDrive Form
    document.getElementById('tenantId').value = config.onedrive.tenantId || '';
    document.getElementById('clientId').value = config.onedrive.clientId || '';
    document.getElementById('clientSecret').value = config.onedrive.clientSecret || '';
    document.getElementById('targetUserEmail').value = config.onedrive.targetUserEmail || '';
    document.getElementById('targetFolderPath').value = config.onedrive.targetFolderPath || '/SignageMedia';
    document.getElementById('syncIntervalMinutes').value = config.onedrive.syncIntervalMinutes || 10;
  } catch (err) {
    console.error(err);
  }
}

// Save Display Settings
displayForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    display: {
      showClock: document.getElementById('showClock').checked,
      showMarquee: document.getElementById('showMarquee').checked,
      marqueeText: document.getElementById('marqueeText').value,
      marqueeSpeed: document.getElementById('marqueeSpeed').value,
      imageDurationSeconds: parseInt(document.getElementById('imageDurationSeconds').value, 10),
      mediaFit: document.getElementById('mediaFit').value,
      videoMuted: document.getElementById('videoMuted').checked
    }
  };

  const newPin = document.getElementById('adminPin').value;
  if (newPin) payload.adminPin = newPin;

  try {
    const res = await fetchWithAuth('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('Pengaturan tampilan berhasil disimpan!');
      document.getElementById('adminPin').value = '';
    }
  } catch (err) {
    alert('Gagal menyimpan: ' + err.message);
  }
});

// Save OneDrive Settings
onedriveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    onedrive: {
      tenantId: document.getElementById('tenantId').value,
      clientId: document.getElementById('clientId').value,
      clientSecret: document.getElementById('clientSecret').value,
      targetUserEmail: document.getElementById('targetUserEmail').value,
      targetFolderPath: document.getElementById('targetFolderPath').value,
      syncIntervalMinutes: parseInt(document.getElementById('syncIntervalMinutes').value, 10)
    }
  };

  try {
    const res = await fetchWithAuth('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('Pengaturan OneDrive berhasil disimpan!');
      loadStatus();
    }
  } catch (err) {
    alert('Gagal menyimpan: ' + err.message);
  }
});

// Test Connection
btnTestConn.addEventListener('click', async () => {
  testResult.className = 'result-box';
  testResult.textContent = 'Menguji koneksi ke Microsoft Graph...';
  testResult.classList.remove('hidden');

  try {
    const res = await fetchWithAuth('/api/sync/test', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      testResult.className = 'result-box result-success';
      testResult.textContent = '✓ ' + data.message;
    } else {
      testResult.className = 'result-box result-error';
      testResult.textContent = '✗ ' + data.message;
    }
  } catch (err) {
    testResult.className = 'result-box result-error';
    testResult.textContent = '✗ ' + err.message;
  }
});

// Trigger Manual Sync
btnSyncNow.addEventListener('click', async () => {
  btnSyncNow.disabled = true;
  btnSyncNow.textContent = 'Menyinkronkan...';
  try {
    const res = await fetchWithAuth('/api/sync/trigger', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`Sinkronisasi selesai! ${data.syncedFiles} berkas baru diunduh.`);
    } else {
      alert(`Sinkronisasi selesai dengan catatan: ${data.errors.join(', ')}`);
    }
    loadStatus();
    loadGallery();
  } catch (err) {
    alert('Gagal sinkronisasi: ' + err.message);
  } finally {
    btnSyncNow.disabled = false;
    btnSyncNow.textContent = '⚡ Sync Sekarang';
  }
});

// Gallery Loader
async function loadGallery() {
  galleryGrid.innerHTML = '<p>Memuat media...</p>';
  try {
    const res = await fetch('/api/playlist');
    const items = await res.json();

    if (items.length === 0) {
      galleryGrid.innerHTML = '<p>Belum ada media di penyimpanan lokal.</p>';
      return;
    }

    galleryGrid.innerHTML = items.map(item => {
      let previewHtml;
      if (item.type === 'image') {
        previewHtml = `<img src="${item.url}" class="media-preview" alt="${item.filename}">`;
      } else {
        previewHtml = `<div class="media-preview">🎬</div>`;
      }

      return `
        <div class="media-card">
          ${previewHtml}
          <div class="media-info">
            <strong>${item.filename}</strong><br>
            <small>${item.type.toUpperCase()} • ${(item.size / 1024 / 1024).toFixed(2)} MB</small>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    galleryGrid.innerHTML = '<p>Gagal memuat galeri.</p>';
  }
}

// Initial Auth Check
checkAuth();
setInterval(loadStatus, 15000);
