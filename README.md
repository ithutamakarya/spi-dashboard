# OneDrive Media Kiosk for TV (Digital Signage)

Aplikasi micro-app mandiri (*self-hosted*) untuk digital signage / kiosk TV yang berjalan secara lokal di Mini PC (Windows 10/11) yang terhubung ke TV via HDMI.

Aplikasi ini secara otomatis menyinkronkan berkas media (foto dan video) dari folder **Microsoft OneDrive for Business** menggunakan **Microsoft Graph API**, menyimpannya di penyimpanan lokal Mini PC, dan memutarnya tanpa henti dalam mode layar penuh (kiosk) dengan transisi mulus, tahan terhadap putus jaringan (*offline resilient*), serta dilengkapi **Web Admin Dashboard** yang dapat diakses melalui jaringan lokal (LAN).

---

## ✨ Fitur Utama

- **Otomatis & Unattended (24/7)**:
  - Menggunakan Azure Entra ID *Client Credentials Flow* (Service Principal) sehingga tidak memerlukan login interaktif manual di layar TV.
  - Unduhan cerdas (*delta sync*): Hanya mengunduh berkas baru atau yang mengalami perubahan (membandingkan ukuran dan timestamp).
  - *Stream download* langsung ke disk untuk video berukuran besar, mencegah penggunaan memori (*heap memory*) berlebih.
  - *Safe cache pruning*: Berkas yang dihapus di OneDrive akan dibersihkan dari penyimpanan lokal hanya jika proses sinkronisasi berhasil tanpa error.
- **Pemutar Media Kiosk TV (`/kiosk`)**:
  - **Foto / Gambar**: Format `.jpg`, `.jpeg`, `.png`, `.webp` dengan efek transisi *crossfade* dua layer yang halus tanpa kedip hitam/putih.
  - **Video**: Format `.mp4`, `.webm` diputar dengan akselerasi GPU native HTML5, deteksi otomatis selesai pemutaran (`onended`), dan opsi audio *mute* / *unmute*.
  - **Otomatisasi Error**: Jika berkas media rusak (*corrupt*), player otomatis melompat (*skip*) ke media berikutnya dalam 1 detik.
  - **Screen Wake Lock**: Mencegah layar Windows / TV masuk ke mode *sleep* atau mati.
  - **Bebas Kursor**: Kursor mouse otomatis disembunyikan di layar TV.
  - **Layar Standby**: Menampilkan petunjuk alamat IP lokal yang ramah jika belum ada media di folder.
- **Tata Letak (Layout) Fleksibel**:
  - **Mode Murni Fullscreen**: Menampilkan media secara penuh 100% tanpa gangguan elemen lain.
  - **Mode dengan Overlay**:
    - *Widget Jam & Tanggal*: Menampilkan waktu lokal real-time di pojok atas layar.
    - *Running Text (Marquee Ticker)*: Pita pengumuman/informasi berjalan di bagian bawah layar dengan kecepatan yang dapat diatur.
- **Web Admin Dashboard di Jaringan Lokal (`/admin`)**:
  - Dapat diakses dari browser HP atau laptop di jaringan Wi-Fi/LAN yang sama (`http://<ip-minipc>:3000/admin`).
  - Dilindungi keamanan PIN (PIN default: `1234`, dapat diubah sewaktu-waktu).
  - Fitur:
    - Pengaturan layout (toggle jam, toggle running text, durasi per foto, mode fit `cover` / `contain`, toggle audio video).
    - Editor teks pengumuman berjalan (*running text*) dan pilihan kecepatan (lambat, sedang, cepat).
    - Konfigurasi kredensial Microsoft OneDrive, tombol **Uji Koneksi**, dan tombol **⚡ Sync Sekarang**.
    - Galeri thumbnail media lokal yang aktif diputar.
- **Tahan Gangguan Jaringan (Offline Resilient)**:
  - Jika koneksi internet terputus atau API Microsoft Graph bermasalah, TV tetap memutar media lokal yang sudah tersimpan tanpa memunculkan pesan error di layar TV.
- **Otomatisasi Windows 10/11**:
  - Disediakan skrip `scripts\start-kiosk.bat` untuk menjalankan server di background dan membuka Microsoft Edge dalam mode native Kiosk Fullscreen.
  - Disediakan skrip `scripts\setup-autostart.bat` untuk otomatisasi peluncuran saat Mini PC menyala/reboot.

---

## 🖥️ Kebutuhan Sistem

- **Perangkat Keras**: Mini PC (Windows 10 atau Windows 11) terhubung ke TV via HDMI.
- **Runtime**: [Node.js](https://nodejs.org/) versi 18 LTS atau lebih baru.
- **Peramban**: Microsoft Edge (bawaan Windows 10/11).
- **Akun Cloud**: Microsoft 365 (OneDrive for Business / SharePoint).

---

## ⚙️ Persiapan Azure Entra ID (Microsoft Graph API)

Aplikasi membutuhkan pendaftaran aplikasi di Azure / Entra ID agar dapat mengunduh berkas dari OneDrive secara otomatis:

1. Buka [Microsoft Entra Admin Center](https://entra.microsoft.com/) atau [Azure Portal](https://portal.azure.com/).
2. Masuk ke menu **App registrations** > **New registration**:
   - Beri nama aplikasi (contoh: `TV-Signage-Kiosk`).
   - Pilih *Supported account types*: **Accounts in this organizational directory only** (Single tenant).
   - Klik **Register**.
3. Catat nilai berikut dari halaman Overview:
   - **Application (client) ID**
   - **Directory (tenant) ID**
4. Masuk ke menu **Certificates & secrets** > **Client secrets** > **New client secret**:
   - Berikan deskripsi dan masa berlaku.
   - Klik **Add**, lalu **segera salin nilai `Value`** (Client Secret).
5. Masuk ke menu **API permissions** > **Add a permission** > **Microsoft Graph**:
   - Pilih **Application permissions** (bukan *Delegated permissions*).
   - Cari dan centang: `Files.Read.All`.
   - Klik **Add permissions**.
   - Klik tombol **Grant admin consent for [Nama Organisasi]**.

---

## 🚀 Instalasi & Menjalankan Aplikasi

### 1. Unduh / Clone Repositori
```bash
git clone <url-repo-anda>
cd spi-dashboard
```

### 2. Pasang Dependensi
```bash
npm install
```

### 3. Menjalankan Mode Pengujian / Development
Untuk memverifikasi seluruh komponen bekerja:
```bash
# Menjalankan unit & integration test
npm test

# Menjalankan server lokal
npm start
```

### 4. Menjalankan di Layar TV (Kiosk Mode)
Jalankan file batch berikut di Mini PC:
```cmd
scripts\start-kiosk.bat
```
Skrip ini akan:
1. Menjalankan server Node.js di latar belakang (port 3000).
2. Menunggu hingga server siap (`http://localhost:3000/api/health`).
3. Membuka Microsoft Edge dalam mode Kiosk Layar Penuh ke `http://localhost:3000/kiosk`.

---

## 📱 Mengakses Web Admin Dashboard

Buka browser dari perangkat mana pun di jaringan lokal yang sama (misal laptop kerja atau ponsel):
- **Alamat URL**: `http://<IP-MINI-PC>:3000/admin`
  *(atau `http://localhost:3000/admin` langsung di Mini PC)*
- **PIN Bawaan**: `1234`

### Langkah Awal di Dashboard:
1. Masuk ke tab **☁️ Integrasi OneDrive**:
   - Masukkan **Tenant ID**, **Client ID**, dan **Client Secret**.
   - Masukkan **Email Akun M365** pemilik folder OneDrive (contoh: `display-tv@perusahaan.com`).
   - Masukkan **Path Folder** tempat meletakkan media (contoh: `/SignageMedia`).
   - Klik tombol **Uji Koneksi** untuk memastikan data terhubung.
   - Klik **Simpan Pengaturan OneDrive**.
   - Klik tombol **⚡ Sync Sekarang** untuk mengunduh media perdana.
2. Masuk ke tab **🎨 Tampilan & Teks**:
   - Atur teks berjalan (*running text*), kecepatan, dan durasi slide gambar sesuai kebutuhan.
   - Ganti PIN Admin standar ke PIN rahasia Anda.

---

## 🔄 Otomatisasi Booting Windows (Auto-start)

Agar aplikasi dan tampilan TV langsung aktif otomatis saat Mini PC dihidupkan atau setelah listrik padam:

1. Di Mini PC, klik kanan file `scripts\setup-autostart.bat` dan pilih **Run as administrator** (atau jalankan langsung). Skrip ini akan membuat shortcut di folder startup Windows:
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OneDriveKiosk.lnk`
2. Konfigurasikan Windows agar melakukan **Auto-Login** tanpa meminta password saat menyala:
   - Tekan `Win + R`, ketik `netplwiz` lalu tekan Enter.
   - Hapus centang pada *"Users must enter a user name and password to use this computer"*, lalu masukkan password akun Windows Anda untuk konfirmasi.

---

## 📁 Struktur Direktori

```text
spi-dashboard/
├── data/                  # Penyimpanan konfigurasi lokal (config.json)
├── docs/                  # Spesifikasi desain & rencana implementasi
│   └── superpowers/
│       ├── specs/         # Dokumen desain detail
│       └── plans/         # Dokumen rencana implementasi
├── media/                 # Folder penyimpanan media lokal (hasil sync OneDrive)
├── public/                # Antarmuka web frontend
│   ├── admin/             # Web Admin Dashboard (index.html, admin.css, admin.js)
│   └── kiosk/             # Pemutar Kiosk TV (index.html, kiosk.css, kiosk.js)
├── scripts/               # Skrip otomatisasi Windows
│   ├── start-kiosk.bat    # Peluncur background server & Edge Kiosk
│   └── setup-autostart.bat# Pendaftar shortcut Windows Startup
├── src/                   # Kode backend Node.js
│   ├── config/            # ConfigManager (data/config.json handler)
│   ├── services/          # MediaService & OneDriveSyncService (Graph API)
│   └── server.js          # Express app, REST API & HTTP Range media server
├── tests/                 # Unit & integration test suites (Vitest)
└── package.json           # Dependensi & skrip npm
```

---

## 🔒 Lisensi & Keamanan
- Kredensial rahasia (*Client Secret* & PIN) hanya disimpan secara lokal di file `data/config.json` dan tidak pernah diekspos melalui endpoint publik `/api/config/public`.
- Folder `data/`, `media/`, dan file sementara diabaikan oleh Git melalui `.gitignore`.
