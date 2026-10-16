# OneDrive Media Kiosk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun aplikasi micro-app digital signage / kiosk media player lokal di Mini PC (Windows 10/11) yang secara otomatis menyinkronkan media (gambar dan video) dari folder Microsoft OneDrive for Business via Microsoft Graph API, memutarnya secara terus menerus di layar TV (Edge Kiosk Mode), serta menyediakan Web Admin Dashboard di jaringan lokal (LAN) untuk konfigurasi layout dan teks berjalan.

**Architecture:** Node.js Express server menyediakan background sync worker (menggunakan Microsoft Graph SDK dengan Client Credentials flow), media streaming lokal dengan HTTP Range request, REST API, dan melayani frontend statis untuk pemutar Kiosk TV (`/kiosk`) dan Web Admin (`/admin`). Skrip Windows batch (`start-kiosk.bat`) mengatur autostart server dan peluncuran Microsoft Edge Kiosk.

**Tech Stack:** Node.js (v18+ LTS), Express.js, `@azure/identity`, `@microsoft/microsoft-graph-client`, Vitest (Testing), HTML5/CSS3/Vanilla JS (Modern Kiosk & Admin UI), Microsoft Edge Kiosk Mode.

## Global Constraints
- Target platform: Windows 10/11 Mini PC connected to TV via HDMI.
- Port default backend: 3000 (`http://localhost:3000`).
- Media formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.mp4`, `.webm`.
- Directory paths:
  - Cache media: `./media/`
  - Konfigurasi: `./data/config.json`
  - Web root: `./public/` (`./public/kiosk/` dan `./public/admin/`)
- Offline resilient: Player harus selalu memutar media lokal yang ada jika koneksi internet terputus.

---

### Task 1: Project Scaffolding & Configuration Manager

**Files:**
- Create: `package.json`
- Create: `src/config/configManager.js`
- Create: `tests/configManager.test.js`

**Interfaces:**
- Produces:
  - `loadConfig(): object` - Membaca `./data/config.json` atau mengembalikan default jika belum ada.
  - `saveConfig(newConfig: object): object` - Menyimpan konfigurasi ke `./data/config.json`.
  - `verifyPin(pin: string): boolean` - Memeriksa kecocokan PIN admin.
  - `getPublicConfig(): object` - Mengembalikan config tanpa secret credentials.

- [ ] **Step 1: Inisialisasi package.json dan install dependencies**

Run:
```bash
npm init -y
npm install express @azure/identity @microsoft/microsoft-graph-client cors dotenv
npm install -D vitest supertest
```

Update `package.json` scripts section to:
```json
"scripts": {
  "test": "vitest run",
  "start": "node src/server.js"
}
```

- [ ] **Step 2: Tulis failing test untuk ConfigManager**

Create file `tests/configManager.test.js`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../src/config/configManager.js';

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data-test');
const TEST_CONFIG_FILE = path.join(TEST_DATA_DIR, 'config.json');

describe('ConfigManager', () => {
  let configMgr;

  beforeEach(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    configMgr = new ConfigManager(TEST_CONFIG_FILE);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it('mengembalikan default config jika file belum ada', () => {
    const config = configMgr.loadConfig();
    expect(config.adminPin).toBe('1234');
    expect(config.display.showClock).toBe(true);
    expect(config.display.showMarquee).toBe(true);
    expect(config.display.imageDurationSeconds).toBe(10);
  });

  it('menyimpan dan memuat konfigurasi baru', () => {
    configMgr.saveConfig({
      display: {
        marqueeText: 'Halo Kiosk Baru',
        imageDurationSeconds: 15
      }
    });

    const reloaded = configMgr.loadConfig();
    expect(reloaded.display.marqueeText).toBe('Halo Kiosk Baru');
    expect(reloaded.display.imageDurationSeconds).toBe(15);
    expect(reloaded.adminPin).toBe('1234'); // Default tetap ada
  });

  it('verifikasi PIN admin dengan benar', () => {
    expect(configMgr.verifyPin('1234')).toBe(true);
    expect(configMgr.verifyPin('9999')).toBe(false);
  });

  it('getPublicConfig menyembunyikan clientSecret', () => {
    configMgr.saveConfig({
      onedrive: {
        clientSecret: 'super-secret-token',
        clientId: 'client-123'
      }
    });

    const publicConfig = configMgr.getPublicConfig();
    expect(publicConfig.onedrive.clientSecret).toBeUndefined();
    expect(publicConfig.onedrive.clientId).toBe('client-123');
    expect(publicConfig.adminPin).toBeUndefined();
  });
});
```

- [ ] **Step 3: Jalankan test untuk memverifikasi kegagalan**

Run: `npx vitest run tests/configManager.test.js`
Expected: FAIL dengan pesan error modul `../src/config/configManager.js` belum ditemukan.

- [ ] **Step 4: Tulis implementasi minimal ConfigManager**

Create file `src/config/configManager.js`:
```javascript
import fs from 'fs';
import path from 'path';

export const DEFAULT_CONFIG = {
  adminPin: '1234',
  onedrive: {
    tenantId: '',
    clientId: '',
    clientSecret: '',
    targetUserEmail: '',
    targetFolderPath: '/SignageMedia',
    syncIntervalMinutes: 10,
    lastSyncTime: null,
    lastSyncStatus: 'IDLE',
    lastSyncError: null
  },
  display: {
    showClock: true,
    showMarquee: true,
    marqueeText: 'Selamat Datang di Kantor Kami. Harap menjaga ketertiban bersama.',
    marqueeSpeed: 'medium',
    imageDurationSeconds: 10,
    videoMuted: true,
    mediaFit: 'contain'
  }
};

export class ConfigManager {
  constructor(configFilePath) {
    this.configPath = configFilePath || path.resolve(process.cwd(), 'data', 'config.json');
    this.dataDir = path.dirname(this.configPath);
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  loadConfig() {
    this._ensureDir();
    if (!fs.existsSync(this.configPath)) {
      this.saveConfig(DEFAULT_CONFIG);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    try {
      const data = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(data);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        onedrive: { ...DEFAULT_CONFIG.onedrive, ...(parsed.onedrive || {}) },
        display: { ...DEFAULT_CONFIG.display, ...(parsed.display || {}) }
      };
    } catch (err) {
      console.error('Gagal membaca config, gunakan default:', err.message);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  saveConfig(partialConfig) {
    const current = this.loadConfig();
    const updated = {
      ...current,
      ...partialConfig,
      onedrive: {
        ...current.onedrive,
        ...(partialConfig.onedrive || {})
      },
      display: {
        ...current.display,
        ...(partialConfig.display || {})
      }
    };

    fs.writeFileSync(this.configPath, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  verifyPin(pin) {
    const config = this.loadConfig();
    return String(config.adminPin) === String(pin);
  }

  getPublicConfig() {
    const config = this.loadConfig();
    const safeOnedrive = { ...config.onedrive };
    delete safeOnedrive.clientSecret;

    return {
      display: config.display,
      onedrive: safeOnedrive
    };
  }
}

export const defaultConfigManager = new ConfigManager();
```

- [ ] **Step 5: Jalankan test untuk memverifikasi kelulusan**

Run: `npx vitest run tests/configManager.test.js`
Expected: PASS semua 4 pengujian.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config/configManager.js tests/configManager.test.js
git commit -m "feat: add project scaffolding and config manager"
```

---

### Task 2: Local Media Service & Playlist Engine

**Files:**
- Create: `src/services/mediaService.js`
- Create: `tests/mediaService.test.js`

**Interfaces:**
- Consumes: Directory path for `./media`
- Produces:
  - `getPlaylist(): Array<{ filename: string, url: string, type: 'image'|'video', size: number, mtime: string }>`
  - `isSupportedMedia(filename: string): boolean`
  - `getMediaType(filename: string): 'image'|'video'|null`

- [ ] **Step 1: Tulis failing test untuk MediaService**

Create file `tests/mediaService.test.js`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MediaService } from '../src/services/mediaService.js';

const TEST_MEDIA_DIR = path.resolve(process.cwd(), 'media-test');

describe('MediaService', () => {
  let mediaService;

  beforeEach(() => {
    if (fs.existsSync(TEST_MEDIA_DIR)) {
      fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_MEDIA_DIR, { recursive: true });
    mediaService = new MediaService(TEST_MEDIA_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_MEDIA_DIR)) {
      fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true });
    }
  });

  it('mengidentifikasi ekstensi yang didukung dengan tepat', () => {
    expect(mediaService.isSupportedMedia('foto.jpg')).toBe(true);
    expect(mediaService.isSupportedMedia('gambar.PNG')).toBe(true);
    expect(mediaService.isSupportedMedia('video.mp4')).toBe(true);
    expect(mediaService.isSupportedMedia('dokumen.pdf')).toBe(false);
    expect(mediaService.isSupportedMedia('file.tmp')).toBe(false);
  });

  it('mengidentifikasi tipe media image atau video', () => {
    expect(mediaService.getMediaType('foto.jpg')).toBe('image');
    expect(mediaService.getMediaType('video.webm')).toBe('video');
    expect(mediaService.getMediaType('data.csv')).toBe(null);
  });

  it('mengembalikan daftar playlist terurut dari media lokal yang ada', () => {
    // Buat file dummy
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'b.jpg'), 'content b');
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'a.mp4'), 'content a');
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'ignore.txt'), 'ignore');
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'download.mp4.tmp'), 'temp');

    const playlist = mediaService.getPlaylist();
    expect(playlist.length).toBe(2);
    expect(playlist[0].filename).toBe('a.mp4');
    expect(playlist[0].type).toBe('video');
    expect(playlist[0].url).toBe('/media/a.mp4');
    expect(playlist[1].filename).toBe('b.jpg');
    expect(playlist[1].type).toBe('image');
  });
});
```

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `npx vitest run tests/mediaService.test.js`
Expected: FAIL karena `src/services/mediaService.js` belum ada.

- [ ] **Step 3: Tulis implementasi minimal MediaService**

Create file `src/services/mediaService.js`:
```javascript
import fs from 'fs';
import path from 'path';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);

export class MediaService {
  constructor(mediaDir) {
    this.mediaDir = mediaDir || path.resolve(process.cwd(), 'media');
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.mediaDir)) {
      fs.mkdirSync(this.mediaDir, { recursive: true });
    }
  }

  isSupportedMedia(filename) {
    if (!filename || filename.endsWith('.tmp')) return false;
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
  }

  getMediaType(filename) {
    if (!filename) return null;
    const ext = path.extname(filename).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    return null;
  }

  getPlaylist() {
    this._ensureDir();
    try {
      const files = fs.readdirSync(this.mediaDir);
      const playlist = [];

      for (const file of files) {
        if (!this.isSupportedMedia(file)) continue;

        const fullPath = path.join(this.mediaDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;

          playlist.push({
            filename: file,
            url: `/media/${encodeURIComponent(file)}`,
            type: this.getMediaType(file),
            size: stat.size,
            mtime: stat.mtime.toISOString()
          });
        } catch {
          // Abaikan jika file sedang dalam transisi write
        }
      }

      // Urutkan alfabetis A-Z
      playlist.sort((a, b) => a.filename.localeCompare(b.filename));
      return playlist;
    } catch (err) {
      console.error('Error saat membaca playlist media:', err.message);
      return [];
    }
  }
}

export const defaultMediaService = new MediaService();
```

- [ ] **Step 4: Jalankan test untuk memverifikasi kelulusan**

Run: `npx vitest run tests/mediaService.test.js`
Expected: PASS semua 3 pengujian.

- [ ] **Step 5: Commit**

```bash
git add src/services/mediaService.js tests/mediaService.test.js
git commit -m "feat: add local media service and playlist engine"
```

---

### Task 3: Microsoft Graph OneDrive Sync Service

**Files:**
- Create: `src/services/onedriveSyncService.js`
- Create: `tests/onedriveSyncService.test.js`

**Interfaces:**
- Consumes: `ConfigManager`, `MediaService`
- Produces:
  - `sync(): Promise<{ success: boolean, syncedFiles: number, errors: string[] }>`
  - `testConnection(): Promise<{ success: boolean, message: string }>`
  - `startScheduledSync(intervalMinutes: number): void`
  - `stopScheduledSync(): void`

- [ ] **Step 1: Tulis failing test untuk OneDriveSyncService (dengan mock)**

Create file `tests/onedriveSyncService.test.js`:
```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { OneDriveSyncService } from '../src/services/onedriveSyncService.js';
import { ConfigManager } from '../src/config/configManager.js';
import { MediaService } from '../src/services/mediaService.js';

const TEST_DIR = path.resolve(process.cwd(), 'sync-test');
const TEST_CONFIG_FILE = path.join(TEST_DIR, 'config.json');
const TEST_MEDIA_DIR = path.join(TEST_DIR, 'media');

describe('OneDriveSyncService', () => {
  let configMgr;
  let mediaService;
  let syncService;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_MEDIA_DIR, { recursive: true });

    configMgr = new ConfigManager(TEST_CONFIG_FILE);
    mediaService = new MediaService(TEST_MEDIA_DIR);
    syncService = new OneDriveSyncService(configMgr, mediaService);
  });

  afterEach(() => {
    syncService.stopScheduledSync();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('mengembalikan error jika kredensial belum lengkap saat sync', async () => {
    const result = await syncService.sync();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Kredensial OneDrive belum lengkap');
  });

  it('mampu melakukan pembersihan file lokal yang tidak ada di remote (pruning)', async () => {
    // Buat file lokal
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'hapus-saya.jpg'), 'old');
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'tetap-ada.jpg'), 'keep');

    const remoteItems = [
      { name: 'tetap-ada.jpg', file: {}, size: 4, lastModifiedDateTime: '2026-01-01T00:00:00Z' }
    ];

    syncService._pruneLocalFiles(remoteItems);

    expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'hapus-saya.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'tetap-ada.jpg'))).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `npx vitest run tests/onedriveSyncService.test.js`
Expected: FAIL karena `src/services/onedriveSyncService.js` belum ada.

- [ ] **Step 3: Tulis implementasi OneDriveSyncService**

Create file `src/services/onedriveSyncService.js`:
```javascript
import fs from 'fs';
import path from 'path';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';

export class OneDriveSyncService {
  constructor(configManager, mediaService) {
    this.configManager = configManager;
    this.mediaService = mediaService;
    this.timer = null;
    this.isSyncing = false;
  }

  _getGraphClient(onedriveConfig) {
    const { tenantId, clientId, clientSecret } = onedriveConfig;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Kredensial OneDrive belum lengkap (Tenant ID, Client ID, atau Client Secret kosong).');
    }

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    };

    return Client.initWithMiddleware({ authProvider });
  }

  async testConnection() {
    const config = this.configManager.loadConfig();
    try {
      const client = this._getGraphClient(config.onedrive);
      const userEmail = config.onedrive.targetUserEmail;
      const folderPath = config.onedrive.targetFolderPath || '/SignageMedia';

      let requestUrl;
      if (userEmail) {
        requestUrl = `/users/${userEmail}/drive/root:${folderPath}:/children`;
      } else {
        requestUrl = `/drive/root:${folderPath}:/children`;
      }

      await client.api(requestUrl).top(1).get();
      return { success: true, message: 'Koneksi ke Microsoft Graph API & OneDrive berhasil!' };
    } catch (err) {
      return { success: false, message: `Gagal menghubungkan ke OneDrive: ${err.message}` };
    }
  }

  _pruneLocalFiles(remoteItems) {
    const remoteFileNames = new Set(remoteItems.map(item => item.name));
    const localFiles = fs.readdirSync(this.mediaService.mediaDir);

    for (const file of localFiles) {
      if (!this.mediaService.isSupportedMedia(file)) continue;
      if (!remoteFileNames.has(file)) {
        try {
          fs.unlinkSync(path.join(this.mediaService.mediaDir, file));
          console.log(`[Sync] Menghapus file lokal yang tidak ada di cloud: ${file}`);
        } catch (err) {
          console.error(`[Sync] Gagal menghapus file ${file}:`, err.message);
        }
      }
    }
  }

  async sync() {
    if (this.isSyncing) {
      return { success: false, errors: ['Proses sinkronisasi sedang berjalan.'] };
    }

    this.isSyncing = true;
    const config = this.configManager.loadConfig();
    const errors = [];
    let syncedFiles = 0;

    try {
      const client = this._getGraphClient(config.onedrive);
      const userEmail = config.onedrive.targetUserEmail;
      const folderPath = config.onedrive.targetFolderPath || '/SignageMedia';

      const requestUrl = userEmail
        ? `/users/${userEmail}/drive/root:${folderPath}:/children`
        : `/drive/root:${folderPath}:/children`;

      const response = await client.api(requestUrl).get();
      const items = response.value || [];
      const validMediaItems = items.filter(item => item.file && this.mediaService.isSupportedMedia(item.name));

      for (const item of validMediaItems) {
        const localPath = path.join(this.mediaService.mediaDir, item.name);
        const tempPath = path.join(this.mediaService.mediaDir, `${item.name}.tmp`);

        let needDownload = true;
        if (fs.existsSync(localPath)) {
          const stat = fs.statSync(localPath);
          if (stat.size === item.size) {
            needDownload = false;
          }
        }

        if (needDownload) {
          try {
            console.log(`[Sync] Mengunduh: ${item.name} (${item.size} bytes)...`);
            const downloadUrl = item['@microsoft.graph.downloadUrl'];
            const fileStream = await fetch(downloadUrl);
            if (!fileStream.ok) throw new Error(`HTTP ${fileStream.status}`);

            const arrayBuffer = await fileStream.arrayBuffer();
            fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
            fs.renameSync(tempPath, localPath);
            syncedFiles++;
          } catch (dlErr) {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            errors.push(`Gagal mengunduh ${item.name}: ${dlErr.message}`);
          }
        }
      }

      this._pruneLocalFiles(validMediaItems);

      this.configManager.saveConfig({
        onedrive: {
          lastSyncTime: new Date().toISOString(),
          lastSyncStatus: errors.length === 0 ? 'SUCCESS' : 'WARNING',
          lastSyncError: errors.length > 0 ? errors.join(', ') : null
        }
      });

      return { success: errors.length === 0, syncedFiles, errors };
    } catch (err) {
      errors.push(err.message);
      this.configManager.saveConfig({
        onedrive: {
          lastSyncTime: new Date().toISOString(),
          lastSyncStatus: 'ERROR',
          lastSyncError: err.message
        }
      });
      return { success: false, syncedFiles: 0, errors };
    } finally {
      this.isSyncing = false;
    }
  }

  startScheduledSync(intervalMinutes = 10) {
    this.stopScheduledSync();
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      this.sync().catch(err => console.error('[Sync Worker Error]:', err.message));
    }, intervalMs);
    console.log(`[Sync] Background sync dijadwalkan setiap ${intervalMinutes} menit.`);
  }

  stopScheduledSync() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Jalankan test untuk memverifikasi kelulusan**

Run: `npx vitest run tests/onedriveSyncService.test.js`
Expected: PASS semua pengujian.

- [ ] **Step 5: Commit**

```bash
git add src/services/onedriveSyncService.js tests/onedriveSyncService.test.js
git commit -m "feat: add onedrive sync service with graph client and pruning"
```

---

### Task 4: REST API Endpoints & Express Server

**Files:**
- Create: `src/server.js`
- Create: `tests/server.test.js`

**Interfaces:**
- Exposes:
  - `GET /api/health`
  - `GET /api/config/public`
  - `POST /api/auth/login` { pin } -> { success, token }
  - `GET /api/admin/config` (auth required)
  - `PUT /api/admin/config` (auth required)
  - `GET /api/playlist`
  - `POST /api/sync/trigger` (auth required)
  - `POST /api/sync/test` (auth required)
  - `GET /api/sync/status`

- [ ] **Step 1: Tulis failing test untuk server API endpoints**

Create file `tests/server.test.js`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/server.js';
import { ConfigManager } from '../src/config/configManager.js';
import { MediaService } from '../src/services/mediaService.js';
import { OneDriveSyncService } from '../src/services/onedriveSyncService.js';

const TEST_DIR = path.resolve(process.cwd(), 'server-test');

describe('Express Server API', () => {
  let app;
  let configMgr;
  let mediaService;
  let syncService;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const mediaDir = path.join(TEST_DIR, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    configMgr = new ConfigManager(path.join(TEST_DIR, 'config.json'));
    mediaService = new MediaService(mediaDir);
    syncService = new OneDriveSyncService(configMgr, mediaService);

    app = createApp(configMgr, mediaService, syncService);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('GET /api/health mengembalikan status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/config/public mengembalikan konfigurasi tanpa secret', async () => {
    const res = await request(app).get('/api/config/public');
    expect(res.status).toBe(200);
    expect(res.body.display).toBeDefined();
    expect(res.body.onedrive.clientSecret).toBeUndefined();
  });

  it('POST /api/auth/login memvalidasi PIN dengan benar', async () => {
    const valid = await request(app).post('/api/auth/login').send({ pin: '1234' });
    expect(valid.status).toBe(200);
    expect(valid.body.success).toBe(true);
    expect(valid.body.token).toBeDefined();

    const invalid = await request(app).post('/api/auth/login').send({ pin: 'wrong' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.success).toBe(false);
  });

  it('GET /api/playlist mengembalikan daftar array media', async () => {
    const res = await request(app).get('/api/playlist');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test untuk memverifikasi kegagalan**

Run: `npx vitest run tests/server.test.js`
Expected: FAIL karena `createApp` belum diimplementasikan di `src/server.js`.

- [ ] **Step 3: Tulis implementasi `src/server.js`**

Create file `src/server.js`:
```javascript
import express from 'express';
import cors from 'cors';
import path from 'path';
import { defaultConfigManager } from './config/configManager.js';
import { defaultMediaService } from './services/mediaService.js';
import { OneDriveSyncService } from './services/onedriveSyncService.js';

export function createApp(configManager, mediaService, syncService) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Static Media files with Range Support
  app.use('/media', express.static(mediaService.mediaDir, {
    acceptRanges: true,
    maxAge: 0
  }));

  // Public Web static files
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Redirect root to kiosk
  app.get('/', (req, res) => {
    res.redirect('/kiosk');
  });

  // Auth Middleware
  const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Token dibutuhkan' });
    }
    const token = authHeader.split(' ')[1];
    if (token !== 'authenticated-admin-session') {
      return res.status(401).json({ error: 'Unauthorized: Token tidak valid' });
    }
    next();
  };

  // API Endpoints
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/config/public', (req, res) => {
    res.json(configManager.getPublicConfig());
  });

  app.post('/api/auth/login', (req, res) => {
    const { pin } = req.body;
    if (configManager.verifyPin(pin)) {
      return res.json({ success: true, token: 'authenticated-admin-session' });
    }
    return res.status(401).json({ success: false, error: 'PIN salah' });
  });

  app.get('/api/admin/config', authMiddleware, (req, res) => {
    res.json(configManager.loadConfig());
  });

  app.put('/api/admin/config', authMiddleware, (req, res) => {
    const updated = configManager.saveConfig(req.body);
    // Restart sync worker interval if changed
    if (req.body.onedrive && req.body.onedrive.syncIntervalMinutes) {
      syncService.startScheduledSync(req.body.onedrive.syncIntervalMinutes);
    }
    res.json({ success: true, config: updated });
  });

  app.get('/api/playlist', (req, res) => {
    const playlist = mediaService.getPlaylist();
    res.json(playlist);
  });

  app.post('/api/sync/trigger', authMiddleware, async (req, res) => {
    const result = await syncService.sync();
    res.json(result);
  });

  app.post('/api/sync/test', authMiddleware, async (req, res) => {
    const result = await syncService.testConnection();
    res.json(result);
  });

  app.get('/api/sync/status', (req, res) => {
    const config = configManager.loadConfig();
    res.json({
      isSyncing: syncService.isSyncing,
      lastSyncTime: config.onedrive.lastSyncTime,
      lastSyncStatus: config.onedrive.lastSyncStatus,
      lastSyncError: config.onedrive.lastSyncError,
      mediaCount: mediaService.getPlaylist().length
    });
  });

  return app;
}

// Server execution entry
const isDirectExecution = process.argv[1] && process.argv[1].endsWith('server.js');
if (isDirectExecution) {
  const config = defaultConfigManager.loadConfig();
  const syncService = new OneDriveSyncService(defaultConfigManager, defaultMediaService);
  const app = createApp(defaultConfigManager, defaultMediaService, syncService);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`OneDrive Media Kiosk Server Aktif!`);
    console.log(`TV Kiosk Player: http://localhost:${PORT}/kiosk`);
    console.log(`Web Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`=========================================`);
  });

  syncService.startScheduledSync(config.onedrive.syncIntervalMinutes || 10);
  // Jalankan sync perdana setelah server start
  setTimeout(() => {
    syncService.sync().catch(e => console.error('[Initial Sync Failed]:', e.message));
  }, 3000);
}
```

- [ ] **Step 4: Jalankan test untuk memverifikasi kelulusan**

Run: `npx vitest run tests/server.test.js`
Expected: PASS semua 4 pengujian.

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server.test.js
git commit -m "feat: implement express server with secure rest api and media streaming"
```

---

### Task 5: Kiosk TV Player Frontend (`public/kiosk/`)

**Files:**
- Create: `public/kiosk/index.html`
- Create: `public/kiosk/kiosk.css`
- Create: `public/kiosk/kiosk.js`

**Features to implement:**
- Layar penuh bebas kursor (`cursor: none`).
- Dua layer transisi gambar (*crossfade* halus).
- Pemutar video HTML5 dengan deteksi otomatis `ended` -> transisi media berikutnya.
- Overlay: Jam & tanggal real-time, Running Text marquee ticker di bawah.
- Screen Wake Lock API untuk menjaga layar TV tetap aktif 24/7.
- Polling background (setiap 30 detik) untuk update config dan playlist tanpa flicker.
- Error handling: Lewati file corrupt dalam 1 detik (`onerror`), tampilkan standby screen jika playlist kosong.

- [ ] **Step 1: Tulis `public/kiosk/index.html`**

Create file `public/kiosk/index.html`:
```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>TV Kiosk Display</title>
  <link rel="stylesheet" href="/kiosk/kiosk.css">
</head>
<body>
  <div id="kiosk-container">
    <!-- Standby / No Media View -->
    <div id="standby-screen" class="hidden">
      <div class="standby-card">
        <div class="pulse-icon">📺</div>
        <h2>OneDrive TV Kiosk</h2>
        <p id="standby-msg">Menunggu media dari OneDrive...</p>
        <div class="admin-hint">
          Buka Admin Dashboard di LAN: <span id="admin-url-hint">http://ip-minipc:3000/admin</span>
        </div>
      </div>
    </div>

    <!-- Media Player View -->
    <div id="player-screen">
      <div id="image-container-1" class="image-layer active"></div>
      <div id="image-container-2" class="image-layer"></div>
      <video id="video-player" playsinline preload="auto" class="hidden"></video>
    </div>

    <!-- Overlay UI -->
    <div id="overlay-container">
      <!-- Clock Widget -->
      <div id="clock-widget" class="overlay-widget">
        <div id="clock-time">00:00</div>
        <div id="clock-date">Senin, 01 Januari 2026</div>
      </div>

      <!-- Bottom Running Text Marquee -->
      <div id="marquee-widget" class="marquee-bar">
        <div class="marquee-track">
          <span id="marquee-text">Selamat Datang</span>
        </div>
      </div>
    </div>
  </div>

  <script src="/kiosk/kiosk.js"></script>
</body>
</html>
```

- [ ] **Step 2: Tulis `public/kiosk/kiosk.css`**

Create file `public/kiosk/kiosk.css`:
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  user-select: none;
}

body, html {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  cursor: none !important;
}

#kiosk-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* Media Layers */
#player-screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.image-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0;
  transition: opacity 1s ease-in-out;
}

.image-layer.fit-cover {
  background-size: cover;
}

.image-layer.active {
  opacity: 1;
}

#video-player {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

#video-player.fit-cover {
  object-fit: cover;
}

/* Standby Screen */
#standby-screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle, #1a202c 0%, #0d1117 100%);
  color: #fff;
  z-index: 50;
}

.standby-card {
  text-align: center;
  padding: 40px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.pulse-icon {
  font-size: 64px;
  margin-bottom: 20px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

.admin-hint {
  margin-top: 24px;
  padding: 12px 20px;
  background: rgba(0, 120, 212, 0.2);
  border-radius: 8px;
  font-size: 1.1rem;
}

/* Overlay Widgets */
#clock-widget {
  position: absolute;
  top: 24px;
  right: 32px;
  text-align: right;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8), 0 0 4px rgba(0, 0, 0, 0.9);
  z-index: 30;
  pointer-events: none;
}

#clock-time {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: 1px;
}

#clock-date {
  font-size: 1.2rem;
  font-weight: 500;
  opacity: 0.9;
}

/* Marquee Widget */
.marquee-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 54px;
  background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.85) 100%);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  overflow: hidden;
  z-index: 30;
  pointer-events: none;
}

.marquee-track {
  display: inline-block;
  white-space: nowrap;
  padding-left: 100%;
  animation: marquee 25s linear infinite;
}

.marquee-speed-slow .marquee-track { animation-duration: 35s; }
.marquee-speed-medium .marquee-track { animation-duration: 25s; }
.marquee-speed-fast .marquee-track { animation-duration: 15s; }

#marquee-text {
  font-size: 1.4rem;
  font-weight: 500;
  color: #ffffff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}

@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-100%); }
}

.hidden {
  display: none !important;
}
```

- [ ] **Step 3: Tulis `public/kiosk/kiosk.js`**

Create file `public/kiosk/kiosk.js`:
```javascript
let playlist = [];
let currentIndex = -1;
let currentConfig = null;
let slideTimeout = null;
let activeLayer = 1;

const container = document.getElementById('kiosk-container');
const standbyScreen = document.getElementById('standby-screen');
const layer1 = document.getElementById('image-container-1');
const layer2 = document.getElementById('image-container-2');
const videoPlayer = document.getElementById('video-player');
const clockWidget = document.getElementById('clock-widget');
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const marqueeWidget = document.getElementById('marquee-widget');
const marqueeText = document.getElementById('marquee-text');

// 1. Clock Updates
function updateClock() {
  const now = new Date();
  clockTime.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  clockDate.textContent = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// 2. Wake Lock API
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock aktif.');
    } catch (e) {
      console.warn('Wake Lock error:', e.message);
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
requestWakeLock();

// 3. Fetch Config & Playlist
async function fetchConfig() {
  try {
    const res = await fetch('/api/config/public');
    if (!res.ok) return;
    currentConfig = await res.json();
    applyConfig(currentConfig.display);
  } catch (err) {
    console.warn('Gagal memuat config:', err.message);
  }
}

function applyConfig(display) {
  if (!display) return;
  // Clock Toggle
  if (display.showClock) {
    clockWidget.classList.remove('hidden');
  } else {
    clockWidget.classList.add('hidden');
  }

  // Marquee Toggle & Text
  if (display.showMarquee && display.marqueeText) {
    marqueeWidget.classList.remove('hidden');
    marqueeText.textContent = display.marqueeText;
    marqueeWidget.className = `marquee-bar marquee-speed-${display.marqueeSpeed || 'medium'}`;
  } else {
    marqueeWidget.classList.add('hidden');
  }

  // Media Fit
  const fitClass = display.mediaFit === 'cover' ? 'fit-cover' : '';
  layer1.className = `image-layer ${fitClass} ${activeLayer === 1 ? 'active' : ''}`;
  layer2.className = `image-layer ${fitClass} ${activeLayer === 2 ? 'active' : ''}`;
  videoPlayer.className = `${fitClass} ${videoPlayer.classList.contains('hidden') ? 'hidden' : ''}`;
  videoPlayer.muted = display.videoMuted !== false;
}

async function fetchPlaylist() {
  try {
    const res = await fetch('/api/playlist');
    if (!res.ok) return;
    const newPlaylist = await res.json();

    const isDifferent = JSON.stringify(newPlaylist) !== JSON.stringify(playlist);
    if (isDifferent) {
      playlist = newPlaylist;
      if (playlist.length === 0) {
        showStandby();
      } else if (currentIndex === -1) {
        playNext();
      }
    }
  } catch (err) {
    console.warn('Gagal memuat playlist:', err.message);
  }
}

function showStandby() {
  clearTimeout(slideTimeout);
  standbyScreen.classList.remove('hidden');
  videoPlayer.classList.add('hidden');
  layer1.classList.remove('active');
  layer2.classList.remove('active');
  document.getElementById('admin-url-hint').textContent = `http://${window.location.hostname}:3000/admin`;
}

// 4. Playback Engine
function playNext() {
  clearTimeout(slideTimeout);
  if (playlist.length === 0) {
    showStandby();
    return;
  }

  standbyScreen.classList.add('hidden');
  currentIndex = (currentIndex + 1) % playlist.length;
  const item = playlist[currentIndex];

  if (item.type === 'video') {
    playVideo(item);
  } else {
    playImage(item);
  }
}

function playImage(item) {
  videoPlayer.pause();
  videoPlayer.classList.add('hidden');

  const nextLayer = activeLayer === 1 ? layer2 : layer1;
  const currentLayer = activeLayer === 1 ? layer1 : layer2;

  const img = new Image();
  img.onload = () => {
    nextLayer.style.backgroundImage = `url("${item.url}")`;
    nextLayer.classList.add('active');
    currentLayer.classList.remove('active');
    activeLayer = activeLayer === 1 ? 2 : 1;

    const duration = (currentConfig?.display?.imageDurationSeconds || 10) * 1000;
    slideTimeout = setTimeout(playNext, duration);
  };

  img.onerror = () => {
    console.warn('Gagal memuat gambar:', item.url);
    slideTimeout = setTimeout(playNext, 1000); // Skip corrupt file
  };

  img.src = item.url;
}

function playVideo(item) {
  clearTimeout(slideTimeout);
  layer1.classList.remove('active');
  layer2.classList.remove('active');
  videoPlayer.classList.remove('hidden');

  videoPlayer.src = item.url;
  videoPlayer.load();

  videoPlayer.onended = () => {
    playNext();
  };

  videoPlayer.onerror = () => {
    console.warn('Gagal memutar video:', item.url);
    slideTimeout = setTimeout(playNext, 1000); // Skip corrupt file
  };

  videoPlayer.play().catch(e => {
    console.warn('Autoplay video dicegah:', e.message);
    videoPlayer.muted = true;
    videoPlayer.play().catch(() => setTimeout(playNext, 1000));
  });
}

// Init & Periodic sync
fetchConfig();
fetchPlaylist();
setInterval(fetchConfig, 30000);
setInterval(fetchPlaylist, 30000);
```

- [ ] **Step 4: Commit**

```bash
git add public/kiosk/index.html public/kiosk/kiosk.css public/kiosk/kiosk.js
git commit -m "feat: implement kiosk tv player with crossfade, video loop, and overlays"
```

---

### Task 6: Web Admin Dashboard Frontend (`public/admin/`)

**Files:**
- Create: `public/admin/index.html`
- Create: `public/admin/admin.css`
- Create: `public/admin/admin.js`

**Features to implement:**
- PIN Modal Login & logout.
- Tab 1: Layout & Teks Pengumuman (Toggles Jam & Ticker, Input Running Text, Slider Durasi Gambar, Mode Fit, Mute Video).
- Tab 2: Konfigurasi Microsoft OneDrive (Form Azure Tenant, Client ID, Client Secret, Email, Path, tombol Test Koneksi, tombol Sync Sekarang).
- Tab 3: Galeri & Status Media (Thumbnail grid, total size, format badge).

- [ ] **Step 1: Tulis `public/admin/index.html`**

Create file `public/admin/index.html`:
```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - TV Kiosk</title>
  <link rel="stylesheet" href="/admin/admin.css">
</head>
<body>
  <!-- PIN Login Modal -->
  <div id="login-modal" class="modal-overlay">
    <div class="modal-card">
      <h2>🔐 Masuk Admin Kiosk</h2>
      <p>Masukkan PIN untuk mengelola tampilan TV.</p>
      <form id="login-form">
        <input type="password" id="pin-input" placeholder="Masukkan PIN" maxlength="10" required autofocus>
        <button type="submit" class="btn btn-primary">Masuk</button>
      </form>
      <div id="login-error" class="error-msg hidden"></div>
    </div>
  </div>

  <!-- Main Admin Interface -->
  <div id="admin-app" class="hidden">
    <header class="navbar">
      <div class="nav-brand">
        <h1>📺 TV Kiosk Admin</h1>
      </div>
      <div class="nav-actions">
        <a href="/kiosk" target="_blank" class="btn btn-outline">Lihat Layar TV ↗</a>
        <button id="logout-btn" class="btn btn-secondary">Keluar</button>
      </div>
    </header>

    <main class="container">
      <!-- Status Bar -->
      <section class="card status-bar">
        <div class="status-item">
          <span class="label">Status Sync:</span>
          <span id="stat-sync" class="badge">Memeriksa...</span>
        </div>
        <div class="status-item">
          <span class="label">Total Media:</span>
          <span id="stat-media-count" class="val">0 berkas</span>
        </div>
        <div class="status-item">
          <span class="label">Sync Terakhir:</span>
          <span id="stat-last-sync" class="val">-</span>
        </div>
        <div class="status-actions">
          <button id="btn-sync-now" class="btn btn-sm btn-primary">⚡ Sync Sekarang</button>
        </div>
      </section>

      <!-- Navigation Tabs -->
      <div class="tabs">
        <button class="tab-btn active" data-tab="tab-display">🎨 Tampilan & Teks</button>
        <button class="tab-btn" data-tab="tab-onedrive">☁️ Integrasi OneDrive</button>
        <button class="tab-btn" data-tab="tab-gallery">🖼️ Daftar Media</button>
      </div>

      <!-- Tab 1: Display & Marquee -->
      <section id="tab-display" class="tab-content active card">
        <h3>Pengaturan Layar Kiosk TV</h3>
        <form id="display-form">
          <div class="form-group row">
            <label class="toggle-label">
              <input type="checkbox" id="showClock">
              <span>Tampilkan Jam & Tanggal</span>
            </label>
          </div>

          <div class="form-group row">
            <label class="toggle-label">
              <input type="checkbox" id="showMarquee">
              <span>Tampilkan Running Text (Ticker Bawah)</span>
            </label>
          </div>

          <div class="form-group">
            <label for="marqueeText">Isi Teks Pengumuman (Running Text):</label>
            <textarea id="marqueeText" rows="3" class="form-control" placeholder="Tuliskan teks berjalan di sini..."></textarea>
          </div>

          <div class="form-group">
            <label for="marqueeSpeed">Kecepatan Teks Berjalan:</label>
            <select id="marqueeSpeed" class="form-control">
              <option value="slow">Lambat</option>
              <option value="medium">Sedang (Default)</option>
              <option value="fast">Cepat</option>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label for="imageDurationSeconds">Durasi Tampil Foto/Gambar (detik):</label>
              <input type="number" id="imageDurationSeconds" class="form-control" min="3" max="300" value="10">
            </div>

            <div class="form-group col">
              <label for="mediaFit">Ukuran Tampilan Media:</label>
              <select id="mediaFit" class="form-control">
                <option value="contain">Contain (Proporsional Asli + Background)</option>
                <option value="cover">Cover (Penuh Layar TV)</option>
              </select>
            </div>
          </div>

          <div class="form-group row">
            <label class="toggle-label">
              <input type="checkbox" id="videoMuted">
              <span>Mute Audio Video (Direkomendasikan agar tidak berisik di lobi)</span>
            </label>
          </div>

          <div class="form-group">
            <label for="adminPin">Ganti PIN Admin:</label>
            <input type="password" id="adminPin" class="form-control" placeholder="Biarkan kosong jika tidak diubah">
          </div>

          <button type="submit" class="btn btn-primary">Simpan Pengaturan Tampilan</button>
        </form>
      </section>

      <!-- Tab 2: OneDrive Settings -->
      <section id="tab-onedrive" class="tab-content card">
        <h3>Pengaturan Microsoft Graph & OneDrive</h3>
        <p class="subtitle">Kredensial Azure Entra ID dengan izin Application: <code>Files.Read.All</code></p>
        <form id="onedrive-form">
          <div class="form-group">
            <label for="tenantId">Directory (Tenant) ID:</label>
            <input type="text" id="tenantId" class="form-control" placeholder="Contoh: 8a7b6c5d-...">
          </div>

          <div class="form-group">
            <label for="clientId">Application (Client) ID:</label>
            <input type="text" id="clientId" class="form-control" placeholder="Contoh: 1b2c3d4e-...">
          </div>

          <div class="form-group">
            <label for="clientSecret">Client Secret Value:</label>
            <input type="password" id="clientSecret" class="form-control" placeholder="Masukkan rahasia aplikasi...">
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label for="targetUserEmail">Email Akun M365 (Pemilik Folder):</label>
              <input type="email" id="targetUserEmail" class="form-control" placeholder="misal: tv-signage@perusahaan.com">
            </div>

            <div class="form-group col">
              <label for="targetFolderPath">Path Folder di OneDrive:</label>
              <input type="text" id="targetFolderPath" class="form-control" placeholder="/SignageMedia" value="/SignageMedia">
            </div>
          </div>

          <div class="form-group">
            <label for="syncIntervalMinutes">Interval Sinkronisasi Otomatis (menit):</label>
            <input type="number" id="syncIntervalMinutes" class="form-control" min="1" max="1440" value="10">
          </div>

          <div class="button-group">
            <button type="submit" class="btn btn-primary">Simpan Pengaturan OneDrive</button>
            <button type="button" id="btn-test-connection" class="btn btn-secondary">Uji Koneksi</button>
          </div>
          <div id="test-conn-result" class="result-box hidden"></div>
        </form>
      </section>

      <!-- Tab 3: Media Gallery -->
      <section id="tab-gallery" class="tab-content card">
        <h3>Daftar Media Lokal di Mini PC</h3>
        <p class="subtitle">Media yang saat ini tersimpan di folder <code>./media</code> dan aktif diputar.</p>
        <div id="gallery-grid" class="gallery-grid">
          <p>Memuat media...</p>
        </div>
      </section>
    </main>
  </div>

  <script src="/admin/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Tulis `public/admin/admin.css`**

Create file `public/admin/admin.css`:
```css
:root {
  --primary: #0078d4;
  --primary-hover: #106ebe;
  --bg: #f3f4f6;
  --card-bg: #ffffff;
  --text: #1f2937;
  --border: #e5e7eb;
  --success: #107c41;
  --danger: #d13438;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  line-height: 1.5;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}

.modal-card {
  background: var(--card-bg);
  padding: 32px;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.1);
  text-align: center;
}

.modal-card input {
  width: 100%;
  padding: 12px;
  font-size: 1.2rem;
  margin: 16px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: center;
}

/* Navbar */
.navbar {
  background: var(--card-bg);
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.navbar h1 { font-size: 1.25rem; font-weight: 600; }
.nav-actions { display: flex; gap: 12px; }

/* Container */
.container {
  max-width: 1000px;
  margin: 24px auto;
  padding: 0 16px;
}

.card {
  background: var(--card-bg);
  border-radius: 8px;
  border: 1px solid var(--border);
  padding: 24px;
  margin-bottom: 24px;
}

/* Status Bar */
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
}

.status-item .label { font-size: 0.85rem; color: #6b7280; margin-right: 6px; }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; }
.badge-success { background: #dff6dd; color: var(--success); }
.badge-error { background: #fde7e9; color: var(--danger); }
.badge-idle { background: #e5e7eb; color: #4b5563; }

/* Tabs */
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 2px solid var(--border);
}

.tab-btn {
  padding: 10px 18px;
  background: transparent;
  border: none;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  color: #6b7280;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.tab-content { display: none; }
.tab-content.active { display: block; }

/* Forms */
.form-group { margin-bottom: 18px; }
.form-row { display: flex; gap: 16px; }
.form-group.col { flex: 1; }
.form-control {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
  margin-top: 6px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

/* Buttons */
.btn {
  padding: 10px 18px;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: 0.2s;
}

.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-outline { background: transparent; border: 1px solid var(--border); color: #374151; text-decoration: none; }
.btn-sm { padding: 6px 12px; font-size: 0.85rem; }

/* Gallery */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.media-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}

.media-preview {
  width: 100%;
  height: 120px;
  object-fit: cover;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 2rem;
}

.media-info {
  padding: 8px 12px;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-box {
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  font-size: 0.9rem;
}

.result-success { background: #dff6dd; color: var(--success); }
.result-error { background: #fde7e9; color: var(--danger); }
.hidden { display: none !important; }
```

- [ ] **Step 3: Tulis `public/admin/admin.js`**

Create file `public/admin/admin.js`:
```javascript
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
```

- [ ] **Step 4: Commit**

```bash
git add public/admin/index.html public/admin/admin.css public/admin/admin.js
git commit -m "feat: implement web admin dashboard with layout, sync, and media controls"
```

---

### Task 7: Windows Kiosk Launcher Script & Integration Testing

**Files:**
- Create: `scripts/start-kiosk.bat`
- Create: `scripts/setup-autostart.bat`
- Create: `tests/integration.test.js`

**Features:**
- Launcher script otomatis menghidupkan Node.js di background, menunggu server siap, dan membuka Edge Kiosk.
- Setup autostart menempatkan shortcut di folder Windows Startup (`shell:startup`).
- Integration test memverifikasi alur end-to-end (login admin -> ubah config -> cek playlist -> public config).

- [ ] **Step 1: Tulis `scripts/start-kiosk.bat`**

Create file `scripts/start-kiosk.bat`:
```cmd
@echo off
title OneDrive TV Kiosk Launcher
cd /d "%~dp0\.."

echo ========================================================
echo        OneDrive Media Kiosk - Windows Launcher
echo ========================================================

echo [1/3] Menjalankan Server Node.js di latar belakang...
start "OneDriveKioskServer" /b cmd /c "node src/server.js"

echo [2/3] Menunggu Server Siap di http://localhost:3000...
:wait_loop
timeout /t 1 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 goto wait_loop

echo Server siap!
echo [3/3] Membuka Microsoft Edge Kiosk Mode...
start "" "msedge.exe" --kiosk "http://localhost:3000/kiosk" --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=Translate

echo ========================================================
echo Kiosk aktif! Layar TV sedang menampilkan player.
echo Web Admin dapat diakses di http://localhost:3000/admin
echo ========================================================
```

- [ ] **Step 2: Tulis `scripts/setup-autostart.bat`**

Create file `scripts/setup-autostart.bat`:
```cmd
@echo off
title Setup Windows Auto-start Kiosk
cd /d "%~dp0\.."

echo Membuat Shortcut Auto-Start di folder Windows Startup...
set "TARGET_BAT=%CD%\scripts\start-kiosk.bat"
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OneDriveKiosk.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_BAT%'; $s.WorkingDirectory = '%CD%'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
  echo [SUKSES] Kiosk telah terdaftar untuk otomatis mulai saat Mini PC menyala!
  echo Lokasi Shortcut: %SHORTCUT_PATH%
) else (
  echo [GAGAL] Gagal membuat shortcut di folder Startup.
)
pause
```

- [ ] **Step 3: Tulis `tests/integration.test.js`**

Create file `tests/integration.test.js`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/server.js';
import { ConfigManager } from '../src/config/configManager.js';
import { MediaService } from '../src/services/mediaService.js';
import { OneDriveSyncService } from '../src/services/onedriveSyncService.js';

const INT_TEST_DIR = path.resolve(process.cwd(), 'integration-test');

describe('End-to-End Integration Flow', () => {
  let app;
  let configMgr;
  let mediaService;
  let syncService;

  beforeEach(() => {
    if (fs.existsSync(INT_TEST_DIR)) {
      fs.rmSync(INT_TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(INT_TEST_DIR, { recursive: true });
    const mediaDir = path.join(INT_TEST_DIR, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    configMgr = new ConfigManager(path.join(INT_TEST_DIR, 'config.json'));
    mediaService = new MediaService(mediaDir);
    syncService = new OneDriveSyncService(configMgr, mediaService);
    app = createApp(configMgr, mediaService, syncService);
  });

  afterEach(() => {
    if (fs.existsSync(INT_TEST_DIR)) {
      fs.rmSync(INT_TEST_DIR, { recursive: true, force: true });
    }
  });

  it('alur lengkap: login admin -> ubah running text -> sinkronisasi status -> baca public config di player', async () => {
    // 1. Health check
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    // 2. Login admin dengan default PIN '1234'
    const login = await request(app).post('/api/auth/login').send({ pin: '1234' });
    expect(login.status).toBe(200);
    const token = login.body.token;

    // 3. Update running text via admin endpoint
    const updateRes = await request(app)
      .put('/api/admin/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        display: {
          marqueeText: 'Pengumuman Penting Hari Ini',
          imageDurationSeconds: 8
        }
      });
    expect(updateRes.status).toBe(200);

    // 4. Kiosk player mengambil public config
    const pubRes = await request(app).get('/api/config/public');
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.display.marqueeText).toBe('Pengumuman Penting Hari Ini');
    expect(pubRes.body.display.imageDurationSeconds).toBe(8);

    // 5. Simulasikan file media lokal ditambahkan
    const mediaDir = path.join(INT_TEST_DIR, 'media');
    fs.writeFileSync(path.join(mediaDir, 'banner.jpg'), 'fake-image');

    // 6. Kiosk player membaca playlist
    const playlistRes = await request(app).get('/api/playlist');
    expect(playlistRes.status).toBe(200);
    expect(playlistRes.body.length).toBe(1);
    expect(playlistRes.body[0].filename).toBe('banner.jpg');
    expect(playlistRes.body[0].type).toBe('image');
  });
});
```

- [ ] **Step 4: Jalankan seluruh test suite**

Run: `npx vitest run`
Expected: PASS semua unit dan integration tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/start-kiosk.bat scripts/setup-autostart.bat tests/integration.test.js
git commit -m "feat: add windows kiosk launcher, autostart setup script, and integration tests"
```
