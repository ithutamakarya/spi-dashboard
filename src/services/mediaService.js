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
