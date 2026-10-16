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
    expect(mediaService.isSupportedMedia('animasi.WEBM')).toBe(true);
    expect(mediaService.isSupportedMedia('dokumen.pdf')).toBe(false);
    expect(mediaService.isSupportedMedia('file.tmp')).toBe(false);
    expect(mediaService.isSupportedMedia('')).toBe(false);
    expect(mediaService.isSupportedMedia(null)).toBe(false);
  });

  it('mengidentifikasi tipe media image atau video', () => {
    expect(mediaService.getMediaType('foto.jpg')).toBe('image');
    expect(mediaService.getMediaType('gambar.PNG')).toBe('image');
    expect(mediaService.getMediaType('foto.webp')).toBe('image');
    expect(mediaService.getMediaType('video.mp4')).toBe('video');
    expect(mediaService.getMediaType('video.webm')).toBe('video');
    expect(mediaService.getMediaType('data.csv')).toBe(null);
    expect(mediaService.getMediaType('')).toBe(null);
    expect(mediaService.getMediaType(null)).toBe(null);
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
    expect(playlist[0].size).toBeGreaterThan(0);
    expect(typeof playlist[0].mtime).toBe('string');
    expect(playlist[1].filename).toBe('b.jpg');
    expect(playlist[1].type).toBe('image');
    expect(playlist[1].url).toBe('/media/b.jpg');
  });

  it('mengabaikan subdirektori dan melakukan encode URL dengan benar jika ada spasi', () => {
    fs.mkdirSync(path.join(TEST_MEDIA_DIR, 'subfolder.jpg'));
    fs.writeFileSync(path.join(TEST_MEDIA_DIR, 'foto keluarga.png'), 'keluarga');

    const playlist = mediaService.getPlaylist();
    expect(playlist.length).toBe(1);
    expect(playlist[0].filename).toBe('foto keluarga.png');
    expect(playlist[0].url).toBe('/media/foto%20keluarga.png');
    expect(playlist[0].type).toBe('image');
  });
});
