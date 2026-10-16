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
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
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
