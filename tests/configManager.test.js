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
