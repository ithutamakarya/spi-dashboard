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
    const { pin } = req.body || {};
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
    if (req.body && req.body.onedrive && req.body.onedrive.syncIntervalMinutes) {
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
