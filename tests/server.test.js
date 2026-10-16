import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    expect(res.body.timestamp).toBeDefined();
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
    expect(valid.body.token).toBe('authenticated-admin-session');

    const invalid = await request(app).post('/api/auth/login').send({ pin: 'wrong' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error).toBeDefined();
  });

  it('GET /api/playlist mengembalikan daftar array media', async () => {
    const res = await request(app).get('/api/playlist');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/admin/config menolak request tanpa token dan menerima request dengan token valid', async () => {
    const unauth = await request(app).get('/api/admin/config');
    expect(unauth.status).toBe(401);
    expect(unauth.body.error).toMatch(/Token dibutuhkan/i);

    const badToken = await request(app)
      .get('/api/admin/config')
      .set('Authorization', 'Bearer invalid-token');
    expect(badToken.status).toBe(401);
    expect(badToken.body.error).toMatch(/Token tidak valid/i);

    const auth = await request(app)
      .get('/api/admin/config')
      .set('Authorization', 'Bearer authenticated-admin-session');
    expect(auth.status).toBe(200);
    expect(auth.body.adminPin).toBe('1234');
  });

  it('PUT /api/admin/config memperbarui konfigurasi dan memperbarui scheduled sync jika interval berubah', async () => {
    const spyStartSync = vi.spyOn(syncService, 'startScheduledSync').mockImplementation(() => {});

    const updateRes = await request(app)
      .put('/api/admin/config')
      .set('Authorization', 'Bearer authenticated-admin-session')
      .send({
        display: { marqueeText: 'Halo Dunia' },
        onedrive: { syncIntervalMinutes: 15 }
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.config.display.marqueeText).toBe('Halo Dunia');
    expect(spyStartSync).toHaveBeenCalledWith(15);
  });

  it('POST /api/sync/trigger memicu syncService.sync jika terautentikasi', async () => {
    vi.spyOn(syncService, 'sync').mockResolvedValue({ success: true, syncedFiles: 2, errors: [] });

    const unauth = await request(app).post('/api/sync/trigger');
    expect(unauth.status).toBe(401);

    const res = await request(app)
      .post('/api/sync/trigger')
      .set('Authorization', 'Bearer authenticated-admin-session');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.syncedFiles).toBe(2);
  });

  it('POST /api/sync/test memanggil syncService.testConnection jika terautentikasi', async () => {
    vi.spyOn(syncService, 'testConnection').mockResolvedValue({
      success: true,
      message: 'Koneksi ke Microsoft Graph API & OneDrive berhasil!'
    });

    const unauth = await request(app).post('/api/sync/test');
    expect(unauth.status).toBe(401);

    const res = await request(app)
      .post('/api/sync/test')
      .set('Authorization', 'Bearer authenticated-admin-session');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('berhasil');
  });

  it('GET /api/sync/status mengembalikan status sinkronisasi', async () => {
    const res = await request(app).get('/api/sync/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('isSyncing');
    expect(res.body).toHaveProperty('lastSyncTime');
    expect(res.body).toHaveProperty('lastSyncStatus');
    expect(res.body).toHaveProperty('lastSyncError');
    expect(res.body).toHaveProperty('mediaCount');
  });

  it('GET / me-redirect ke /kiosk', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/kiosk');
  });

  it('GET /media/:file mendukung pengiriman file dan range request', async () => {
    const mediaDir = path.join(TEST_DIR, 'media');
    fs.writeFileSync(path.join(mediaDir, 'test.jpg'), 'fake-image-binary-data-content');

    const res = await request(app).get('/media/test.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('GET /kiosk/index.html mengembalikan halaman HTML kiosk', async () => {
    const res = await request(app).get('/kiosk/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('TV Kiosk Display');
    expect(res.text).toContain('id="kiosk-container"');
    expect(res.text).toContain('id="video-player"');
    expect(res.text).toContain('id="clock-widget"');
    expect(res.text).toContain('id="marquee-widget"');
  });

  it('GET /kiosk/kiosk.css mengembalikan stylesheet kiosk', async () => {
    const res = await request(app).get('/kiosk/kiosk.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    expect(res.text).toContain('cursor: none');
    expect(res.text).toContain('.image-layer');
    expect(res.text).toContain('.marquee-bar');
  });

  it('GET /kiosk/kiosk.js mengembalikan skrip kiosk', async () => {
    const res = await request(app).get('/kiosk/kiosk.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('updateClock');
    expect(res.text).toContain('requestWakeLock');
    expect(res.text).toContain('fetchPlaylist');
  });
});
