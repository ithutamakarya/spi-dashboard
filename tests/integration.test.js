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
