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
    vi.restoreAllMocks();
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
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'abaikan.txt'), 'not-media');

    const remoteItems = [
      { name: 'tetap-ada.jpg', file: {}, size: 4, lastModifiedDateTime: '2026-01-01T00:00:00Z' }
    ];

    syncService._pruneLocalFiles(remoteItems);

    expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'hapus-saya.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'tetap-ada.jpg'))).toBe(true);
    // File non-media tidak dihapus oleh pruning
    expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'abaikan.txt'))).toBe(true);
  });

  it('testConnection mengembalikan error jika kredensial tidak lengkap', async () => {
    const result = await syncService.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Kredensial OneDrive belum lengkap');
  });

  it('testConnection berhasil saat Graph Client merespons dengan sukses', async () => {
    configMgr.saveConfig({
      onedrive: {
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        targetUserEmail: 'display@example.com',
        targetFolderPath: '/KioskMedia'
      }
    });

    const mockGet = vi.fn().mockResolvedValue({ value: [] });
    const mockTop = vi.fn().mockReturnValue({ get: mockGet });
    const mockApi = vi.fn().mockReturnValue({ top: mockTop });
    const mockClient = { api: mockApi };

    vi.spyOn(syncService, '_getGraphClient').mockReturnValue(mockClient);

    const result = await syncService.testConnection();

    expect(mockApi).toHaveBeenCalledWith('/users/display@example.com/drive/root:/KioskMedia:/children');
    expect(mockTop).toHaveBeenCalledWith(1);
    expect(result.success).toBe(true);
    expect(result.message).toContain('berhasil');
  });

  it('testConnection menggunakan root drive jika targetUserEmail tidak diisi', async () => {
    configMgr.saveConfig({
      onedrive: {
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        targetUserEmail: '',
        targetFolderPath: '/SignageMedia'
      }
    });

    const mockGet = vi.fn().mockResolvedValue({ value: [] });
    const mockTop = vi.fn().mockReturnValue({ get: mockGet });
    const mockApi = vi.fn().mockReturnValue({ top: mockTop });
    const mockClient = { api: mockApi };

    vi.spyOn(syncService, '_getGraphClient').mockReturnValue(mockClient);

    const result = await syncService.testConnection();
    expect(mockApi).toHaveBeenCalledWith('/drive/root:/SignageMedia:/children');
    expect(result.success).toBe(true);
  });

  it('mencegah proses sync ganda secara bersamaan (isSyncing)', async () => {
    syncService.isSyncing = true;
    const result = await syncService.sync();
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Proses sinkronisasi sedang berjalan.');
  });

  it('melakukan download file baru, skip file yang ukurannya sama, dan prune file lama', async () => {
    configMgr.saveConfig({
      onedrive: {
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1'
      }
    });

    // File lokal yang sudah ada dengan ukuran sama persis
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'sama.jpg'), '1234');
    // File lokal lama yang harus diprune
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'lama.jpg'), 'lama');

    const remoteItems = [
      {
        name: 'sama.jpg',
        file: {},
        size: 4,
        '@microsoft.graph.downloadUrl': 'https://download/sama.jpg'
      },
      {
        name: 'baru.mp4',
        file: {},
        size: 8,
        '@microsoft.graph.downloadUrl': 'https://download/baru.mp4'
      },
      {
        name: 'dokumen.pdf',
        file: {},
        size: 100,
        '@microsoft.graph.downloadUrl': 'https://download/dokumen.pdf'
      }
    ];

    const mockApi = vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ value: remoteItems })
    });
    vi.spyOn(syncService, '_getGraphClient').mockReturnValue({ api: mockApi });

    // Mock fetch global untuk unduhan file baru
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url === 'https://download/baru.mp4') {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(Buffer.from('videomp4'))
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    try {
      const result = await syncService.sync();

      expect(result.success).toBe(true);
      expect(result.syncedFiles).toBe(1); // Hanya baru.mp4 yang diunduh (sama.jpg di-skip, pdf diabaikan)
      expect(result.errors.length).toBe(0);

      // Verifikasi file baru ada
      expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'baru.mp4'))).toBe(true);
      expect(fs.readFileSync(path.join(TEST_MEDIA_DIR, 'baru.mp4'), 'utf8')).toBe('videomp4');

      // Verifikasi sama.jpg tetap ada
      expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'sama.jpg'))).toBe(true);

      // Verifikasi lama.jpg sudah dihapus (pruned)
      expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'lama.jpg'))).toBe(false);

      // Verifikasi config tersimpan dengan status SUCCESS
      const savedConfig = configMgr.loadConfig();
      expect(savedConfig.onedrive.lastSyncStatus).toBe('SUCCESS');
      expect(savedConfig.onedrive.lastSyncTime).toBeTruthy();
      expect(savedConfig.onedrive.lastSyncError).toBe(null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('menangani kegagalan download dengan menghapus .tmp dan mencatat error ke status WARNING', async () => {
    configMgr.saveConfig({
      onedrive: {
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'secret-1'
      }
    });

    const remoteItems = [
      {
        name: 'gagal.jpg',
        file: {},
        size: 50,
        '@microsoft.graph.downloadUrl': 'https://download/gagal.jpg'
      }
    ];

    const mockApi = vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ value: remoteItems })
    });
    vi.spyOn(syncService, '_getGraphClient').mockReturnValue({ api: mockApi });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    try {
      const result = await syncService.sync();

      expect(result.success).toBe(false);
      expect(result.syncedFiles).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('Gagal mengunduh gagal.jpg: HTTP 500');

      // Pastikan temp file tidak tersisa
      expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'gagal.jpg.tmp'))).toBe(false);
      expect(fs.existsSync(path.join(TEST_MEDIA_DIR, 'gagal.jpg'))).toBe(false);

      const savedConfig = configMgr.loadConfig();
      expect(savedConfig.onedrive.lastSyncStatus).toBe('WARNING');
      expect(savedConfig.onedrive.lastSyncError).toContain('HTTP 500');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('dapat memulai dan menghentikan scheduled sync', () => {
    vi.useFakeTimers();
    try {
      const syncSpy = vi.spyOn(syncService, 'sync').mockResolvedValue({ success: true, syncedFiles: 0, errors: [] });

      syncService.startScheduledSync(5);
      expect(syncService.timer).not.toBeNull();

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      syncService.stopScheduledSync();
      expect(syncService.timer).toBeNull();

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(syncSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
