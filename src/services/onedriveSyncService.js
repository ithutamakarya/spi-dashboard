import fs from 'fs';
import path from 'path';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { defaultConfigManager } from '../config/configManager.js';
import { defaultMediaService } from './mediaService.js';

export class OneDriveSyncService {
  constructor(configManager, mediaService) {
    this.configManager = configManager;
    this.mediaService = mediaService;
    this.timer = null;
    this.isSyncing = false;
  }

  _getGraphClient(onedriveConfig) {
    const { tenantId, clientId, clientSecret } = onedriveConfig || {};
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
      return { success: false, syncedFiles: 0, errors: ['Proses sinkronisasi sedang berjalan.'] };
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
            if (fs.existsSync(tempPath)) {
              try {
                fs.unlinkSync(tempPath);
              } catch {
                // Ignore unlink error
              }
            }
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

export const defaultOneDriveSyncService = new OneDriveSyncService(defaultConfigManager, defaultMediaService);
