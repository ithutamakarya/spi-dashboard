# Design Specification: OneDrive Media Kiosk for TV (Mini PC)

- **Date:** 2026-10-16
- **Status:** Draft / Pending User Review
- **Author:** Antigravity & User

---

## 1. Overview & Objectives

Aplikasi ini adalah micro-app digital signage / kiosk media player mandiri (*self-hosted*) yang dirancang untuk dijalankan di Mini PC (Windows 10/11) yang terhubung ke TV via HDMI. 

Aplikasi secara otomatis menyinkronkan media (foto dan video) dari folder Microsoft OneDrive for Business organisasi menggunakan Microsoft Graph API, mengunduhnya ke penyimpanan lokal Mini PC, dan memutarnya secara terus menerus dalam mode kiosk layar penuh (fullscreen) tanpa memerlukan intervensi manusia (unattended 24/7).

Pengguna dan staf dapat mengonfigurasi tata letak (layout), teks pengumuman berjalan (*running text*), dan pengaturan pemutaran melalui Web Admin Dashboard yang dapat diakses dari browser laptop atau smartphone yang berada dalam jaringan lokal (LAN) yang sama.

---

## 2. Hardware & Environment Context

- **Perangkat Keras:** Mini PC (Intel N100 / sejenisnya atau Mini PC komersial) yang terhubung langsung ke TV / Monitor Kiosk via HDMI.
- **Sistem Operasi:** Windows 10 atau Windows 11.
- **Peramban Tampilan:** Microsoft Edge bawaan Windows yang dijalankan dalam native Kiosk Mode (`--kiosk`).
- **Jaringan:** Terhubung ke Local Area Network (LAN/Wi-Fi) untuk sinkronisasi cloud dan akses Web Admin. Tahan terhadap putus jaringan (offline resilient).

---

## 3. Architecture & High-Level Components

```
+-------------------------------------------------------------------------+
|                           Mini PC (Windows 10/11)                       |
|                                                                         |
|  +---------------------------+             +-------------------------+  |
|  |    Microsoft Edge Kiosk   |             |   Node.js Micro-Server  |  |
|  |    (Layar TV / Display)   |             |   (Port: 3000)          |  |
|  |                           |             |                         |  |
|  |  * Fullscreen Player      |<--- HTTP ---|  * Media & Static Server|  |
|  |  * Clock / Date Overlay   | (localhost) |  * Graph Sync Worker    |  |
|  |  * Running Text Marquee   |             |  * REST API Engine      |  |
|  +---------------------------+             +------------+------------+  |
|                                                         |               |
|  +---------------------------+                          |               |
|  |   Perangkat LAN (HP/PC)   |                          |               |
|  |   (Browser http://ip:3000)|<--- HTTP (LAN) ----------+               |
|  |  * Web Admin Dashboard    |                          |               |
|  +---------------------------+                          |               |
|                                            +------------+------------+  |
|                                            |   Local Storage System  |  |
|                                            |                         |  |
|                                            |  * ./media/ (Media Dir) |  |
|                                            |  * ./data/config.json   |  |
|                                            +------------+------------+  |
+---------------------------------------------------------|---------------+
                                                          |
                                                          v (HTTPS / Graph API)
                                            +-----------------------------+
                                            | Microsoft OneDrive (Cloud)  |
                                            | (Microsoft 365 Tenant)      |
                                            +-----------------------------+
```

### 3.1. Node.js Backend Server
- **Runtime:** Node.js (v18+ LTS).
- **Web Framework:** Express.js.
- **Microsoft Graph SDK:** `@azure/identity` (`ClientSecretCredential`) dan `@microsoft/microsoft-graph-client`.
- **Fitur Utama:**
  - **Media Server:** Menyajikan file media lokal dengan header `Accept-Ranges: bytes` untuk streaming video MP4/WebM yang stabil tanpa membebani memori.
  - **OneDrive Sync Worker:** Menjalankan sinkronisasi terjadwal (cron / `setInterval`) dan sinkronisasi instan (*on-demand*).
  - **REST API:** Menyediakan antarmuka untuk status sinkronisasi, daftar putar (playlist), dan manipulasi pengaturan.

### 3.2. Frontend Web Applications
Dibangun sebagai Single Page Application (SPA) ringan yang disajikan langsung oleh Node.js:
- **Tampilan Kiosk (`/kiosk`):** Ditujukan untuk layar TV. Mengatur rotasi gambar, pemutaran video otomatis, transisi crossfade, widget jam, dan running text.
- **Dashboard Admin (`/admin`):** Antarmuka responsif yang dilindungi PIN untuk pengaturan layout, running text, kredensial OneDrive, dan kontrol sinkronisasi.

### 3.3. Windows Kiosk Launcher
- **Skrip `start-kiosk.bat`:** Memastikan server Node.js aktif, menunggu endpoint server siap, lalu meluncurkan Microsoft Edge Kiosk ke URL `http://localhost:3000/kiosk`.
- **Integrasi Windows Startup:** Didukung untuk auto-launch saat booting Windows tanpa perlu login manual.

---

## 4. Detailed Component Specifications

### 4.1. Microsoft OneDrive Sync Service

#### Autentikasi (Client Credentials / Service Principal)
- Menggunakan Azure Entra ID App Registration dengan izin tipe **Application**: `Files.Read.All` (atau `Sites.Selected`).
- Parameter konfigurasi:
  - `tenantId`: Direktori (Tenant) ID Azure AD.
  - `clientId`: Aplikasi (Client) ID.
  - `clientSecret`: Kunci rahasia aplikasi.
  - `targetUserEmail`: Email pemilik OneDrive (misal: `display@perusahaan.com`) atau Drive ID.
  - `targetFolderPath`: Jalur folder spesifik di OneDrive (misal: `/SignageMedia` atau `/KioskTV`).

#### Siklus Sinkronisasi
1. **Pemeriksaan Daftar File:** Memanggil endpoint Microsoft Graph:
   `GET /users/{targetUserEmail}/drive/root:{targetFolderPath}:/children`
2. **Filter Ekstensi:** Memfilter hanya berkas media yang didukung:
   - Gambar: `.jpg`, `.jpeg`, `.png`, `.webp`
   - Video: `.mp4`, `.webm`
3. **Pemeriksaan Delta (eTag / LastModifiedDateTime):**
   - Jika file sudah ada di `./media` dengan ukuran dan waktu modifikasi yang cocok, file dilewati (hemat bandwidth).
   - Jika file baru atau diperbarui, diunduh secara atomik:
     1. Unduh ke `./media/<filename>.tmp`
     2. Verifikasi ukuran file selesai 100%
     3. Rename dari `<filename>.tmp` ke `<filename>`
4. **Pembersihan Berkas Terhapus (Pruning):**
   - File di `./media/` yang tidak lagi ada di folder OneDrive tujuan akan dihapus dari penyimpanan lokal Mini PC.
5. **Pencatatan Status:**
   - Menyimpan timestamp sinkronisasi terakhir, jumlah file yang aktif, status (SUCCESS/ERROR), dan pesan detail ke memory/file log.

---

### 4.2. Kiosk Media Player (`/kiosk`)

#### Alur Pemutaran Media (Playback Engine)
- **Polling Playlist:** Player secara berkala (setiap 30 detik) mengambil daftar media terbaru dari `/api/playlist` tanpa me-refresh halaman.
- **Rotasi Gambar:**
  - Ditampilkan selama durasi yang ditentukan (konfigurasi: `imageDurationSeconds`, default 10 detik).
  - Menggunakan 2 layer kontainer gambar bergantian dengan animasi transisi CSS *opacity crossfade* (1 detik) untuk mencegah layar berkedip putih/hitam.
- **Pemutaran Video:**
  - Video HTML5 (`<video>`) diputar hingga selesai menggunakan event listener `ended`.
  - Properti `muted` dapat diaktifkan/dinonaktifkan melalui konfigurasi.
  - Pemutar video memuat media berikutnya secara *preload* sebelum video saat ini selesai untuk transisi instan.
- **Mode Fit Media:**
  - `cover`: Memenuhi seluruh layar (memotong tepi jika rasio beda).
  - `contain`: Mempertahankan rasio aspek asli dengan latar belakang gelap / blurred.

#### Tata Letak & Overlay Widget
- **Mode Layout:**
  - **Pure Fullscreen:** Seluruh layar hanya untuk media.
  - **Fullscreen + Overlay:**
    - **Clock Widget:** Jam digital dan tanggal real-time di pojok kanan/kiri atas dengan efek bayangan (text-shadow) agar tetap terbaca di atas latar belakang terang.
    - **Running Text Ticker:** Bar semi-transparan di bagian bawah layar dengan teks berjalan (marquee CSS continuous loop). Kecepatan gerak dapat diatur (konfigurasi: `marqueeSpeed`).
- **Ergonomi Kiosk:**
  - CSS `cursor: none !important;` menyembunyikan kursor mouse.
  - Mengaktifkan Navigator `wakeLock.request('screen')` untuk mencegah Windows Display Sleep.
  - Handler `onerror` pada elemen media: jika ada file rusak, player otomatis melompat ke file berikutnya dalam 1 detik.
  - Layar Standby: Jika belum ada media, menampilkan splash screen informatif dengan URL Admin lokal.

---

### 4.3. Web Admin Dashboard (`/admin`)

#### Fitur & Navigasi
1. **Autentikasi PIN:**
   - Form input PIN sederhana untuk mengamankan akses admin dari jaringan lokal.
   - Session berbasis cookie / local storage token.
2. **Tab Tampilan (Display & Layout):**
   - Toggle: Tampilkan Jam & Tanggal.
   - Toggle: Tampilkan Running Text.
   - Input Text: Teks pengumuman berjalan.
   - Slider: Kecepatan teks berjalan (lambat, sedang, cepat).
   - Slider: Durasi tampilan foto/gambar (detik).
   - Toggle: Audio video (Mute / Unmute).
   - Dropdown: Mode ukuran media (`cover` / `contain`).
3. **Tab Koneksi OneDrive:**
   - Form: Tenant ID, Client ID, Client Secret, User Email, Folder Path.
   - Slider / Input: Interval sinkronisasi otomatis (dalam menit, misal 5–60 menit).
   - Tombol: "Test Koneksi" (menguji apakah kredensial valid tanpa menunggu siklus sync).
   - Tombol: "Sync Sekarang" (memicu proses sinkronisasi instan).
   - Kartu Status: Menampilkan status sync terakhir, waktu pelaksanaan, dan jumlah media.
4. **Tab Galeri Media:**
   - Grid thumbnail semua file yang saat ini tersimpan di `./media`.
   - Informasi ukuran file dan format.

---

## 5. Data Storage & API Design

### 5.1. Struktur Konfigurasi (`./data/config.json`)
```json
{
  "adminPin": "1234",
  "onedrive": {
    "tenantId": "",
    "clientId": "",
    "clientSecret": "",
    "targetUserEmail": "",
    "targetFolderPath": "/SignageMedia",
    "syncIntervalMinutes": 10,
    "lastSyncTime": null,
    "lastSyncStatus": "IDLE",
    "lastSyncError": null
  },
  "display": {
    "showClock": true,
    "showMarquee": true,
    "marqueeText": "Selamat Datang di Kantor Kami. Harap menjaga ketertiban dan kebersihan bersama.",
    "marqueeSpeed": "medium",
    "imageDurationSeconds": 10,
    "videoMuted": true,
    "mediaFit": "contain"
  }
}
```

### 5.2. REST Endpoints
- `GET /api/health` — Status kesehatan server Node.js.
- `GET /api/config/public` — Konfigurasi publik untuk player `/kiosk` (layout, running text, durasi media tanpa kredensial rahasia).
- `POST /api/auth/login` — Verifikasi PIN admin.
- `GET /api/admin/config` — Mendapatkan konfigurasi lengkap (memerlukan auth PIN).
- `PUT /api/admin/config` — Menyimpan pembaruan konfigurasi.
- `GET /api/playlist` — Daftar berkas media lokal yang aktif beserta metadata tipe dan URL.
- `POST /api/sync/trigger` — Menjalankan sinkronisasi OneDrive instan.
- `GET /api/sync/status` — Status proses sinkronisasi dan statistik berkas.

---

## 6. Windows Automation & Resilience

### 6.1. Startup Launcher (`start-kiosk.bat`)
```cmd
@echo off
title OneDrive TV Kiosk Launcher
cd /d "%~dp0"

echo [1/3] Menjalankan Backend Node.js...
start /b "" node server.js

echo [2/3] Menunggu Server Siap...
:wait_loop
timeout /t 1 /nobreak >nul
curl -s http://localhost:3000/api/health >nul
if errorlevel 1 goto wait_loop

echo [3/3] Membuka Microsoft Edge Kiosk...
start "" "msedge.exe" --kiosk "http://localhost:3000/kiosk" --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=Translate
```

### 6.2. Offline & Fault Tolerance Matrix
| Kejadian | Dampak | Penanganan Otomatis |
|---|---|---|
| Internet mati | OneDrive tidak dapat dihubungi | Player tetap memutar media dari cache `./media/`. Tidak ada pesan error di layar TV. Error dicatat di admin log. |
| Listrik padam / restart | Mini PC reboot | Skrip startup di folder `shell:startup` otomatis menyalakan server dan Edge Kiosk kembali saat Windows masuk desktop. |
| File video rusak | Pemutar video gagal render | Handler `onerror` langsung melompat (*skip*) ke media berikutnya dalam 1 detik. |
| Folder OneDrive kosong | Belum ada media terunduh | Menampilkan splash screen elegan dengan informasi IP lokal untuk mempermudah setup admin. |

---

## 7. Verification & Testing Strategy

1. **Uji Fungsionalitas Sinkronisasi:**
   - Menghubungkan ke folder uji OneDrive.
   - Menguji unduh file gambar dan video.
   - Menguji unduhan atomik (file tidak diputar sebelum 100% selesai).
   - Menguji penghapusan lokal saat file dihapus di OneDrive.
2. **Uji Pemutar Kiosk:**
   - Transisi gambar crossfade.
   - Pemutaran video MP4 hingga selesai dan berganti ke gambar berikutnya.
   - Pengujian toggle jam dan running text marquee.
3. **Uji Ketahanan (Resilience):**
   - Memutus koneksi internet dan memastikan pemutaran berlanjut 24 jam tanpa macet (*no memory leak*).
   - Pengujian penanganan file corrupt (file `.mp4` dummy rusak dilewati secara aman).
4. **Uji Windows Kiosk:**
   - Menjalankan `start-kiosk.bat` dan memastikan browser membuka layar penuh tanpa toolbar atau kursor yang mengganggu.
