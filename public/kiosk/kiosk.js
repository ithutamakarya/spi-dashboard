let playlist = null;
let currentIndex = -1;
let currentConfig = null;
let slideTimeout = null;
let activeLayer = 1;

const container = document.getElementById('kiosk-container');
const standbyScreen = document.getElementById('standby-screen');
const layer1 = document.getElementById('image-container-1');
const layer2 = document.getElementById('image-container-2');
const videoPlayer = document.getElementById('video-player');
const clockWidget = document.getElementById('clock-widget');
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const marqueeWidget = document.getElementById('marquee-widget');
const marqueeText = document.getElementById('marquee-text');

// 1. Clock Updates
function updateClock() {
  const now = new Date();
  clockTime.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  clockDate.textContent = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// 2. Wake Lock API
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock aktif.');
    } catch (e) {
      console.warn('Wake Lock error:', e.message);
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
requestWakeLock();

// 3. Fetch Config & Playlist
async function fetchConfig() {
  try {
    const res = await fetch('/api/config/public');
    if (!res.ok) return;
    currentConfig = await res.json();
    applyConfig(currentConfig.display);
  } catch (err) {
    console.warn('Gagal memuat config:', err.message);
  }
}

function applyConfig(display) {
  if (!display) return;
  // Clock Toggle
  if (display.showClock) {
    clockWidget.classList.remove('hidden');
  } else {
    clockWidget.classList.add('hidden');
  }

  // Marquee Toggle & Text
  if (display.showMarquee && display.marqueeText) {
    marqueeWidget.classList.remove('hidden');
    marqueeText.textContent = display.marqueeText;
    marqueeWidget.className = `marquee-bar marquee-speed-${display.marqueeSpeed || 'medium'}`;
  } else {
    marqueeWidget.classList.add('hidden');
  }

  // Media Fit
  const fitClass = display.mediaFit === 'cover' ? 'fit-cover' : '';
  const isVideoPlaying = !videoPlayer.classList.contains('hidden');
  const isStandby = !standbyScreen.classList.contains('hidden');
  const shouldShowImage = !isVideoPlaying && !isStandby;

  layer1.className = `image-layer ${fitClass} ${shouldShowImage && activeLayer === 1 ? 'active' : ''}`.trim();
  layer2.className = `image-layer ${fitClass} ${shouldShowImage && activeLayer === 2 ? 'active' : ''}`.trim();
  videoPlayer.className = `${fitClass} ${videoPlayer.classList.contains('hidden') ? 'hidden' : ''}`.trim();
  videoPlayer.muted = display.videoMuted !== false;
}

async function fetchPlaylist() {
  try {
    const res = await fetch('/api/playlist');
    if (!res.ok) return;
    const newPlaylist = await res.json();

    const isDifferent = JSON.stringify(newPlaylist) !== JSON.stringify(playlist);
    if (isDifferent) {
      playlist = newPlaylist;
      if (playlist.length === 0) {
        showStandby();
      } else if (currentIndex === -1) {
        playNext();
      }
    }
  } catch (err) {
    console.warn('Gagal memuat playlist:', err.message);
  }
}

function showStandby() {
  clearTimeout(slideTimeout);
  currentIndex = -1;
  videoPlayer.pause();
  standbyScreen.classList.remove('hidden');
  videoPlayer.classList.add('hidden');
  layer1.classList.remove('active');
  layer2.classList.remove('active');
  const port = window.location.port ? window.location.port : '3000';
  document.getElementById('admin-url-hint').textContent = `http://${window.location.hostname}:${port}/admin`;
}

// 4. Playback Engine
function playNext() {
  clearTimeout(slideTimeout);
  if (!playlist || playlist.length === 0) {
    showStandby();
    return;
  }

  standbyScreen.classList.add('hidden');
  currentIndex = (currentIndex + 1) % playlist.length;
  const item = playlist[currentIndex];

  if (item.type === 'video') {
    playVideo(item);
  } else {
    playImage(item);
  }
}

function playImage(item) {
  const nextLayer = activeLayer === 1 ? layer2 : layer1;
  const currentLayer = activeLayer === 1 ? layer1 : layer2;

  const img = new Image();
  img.onload = () => {
    videoPlayer.pause();
    videoPlayer.classList.add('hidden');
    nextLayer.style.backgroundImage = `url("${item.url}")`;
    nextLayer.classList.add('active');
    currentLayer.classList.remove('active');
    activeLayer = activeLayer === 1 ? 2 : 1;

    const duration = (currentConfig?.display?.imageDurationSeconds || 10) * 1000;
    slideTimeout = setTimeout(playNext, duration);
  };

  img.onerror = () => {
    console.warn('Gagal memuat gambar:', item.url);
    slideTimeout = setTimeout(playNext, 1000); // Skip corrupt file
  };

  img.src = item.url;
}

function playVideo(item) {
  clearTimeout(slideTimeout);
  layer1.classList.remove('active');
  layer2.classList.remove('active');
  videoPlayer.classList.remove('hidden');

  videoPlayer.src = item.url;
  videoPlayer.load();

  videoPlayer.onended = () => {
    playNext();
  };

  videoPlayer.onerror = () => {
    console.warn('Gagal memutar video:', item.url);
    slideTimeout = setTimeout(playNext, 1000); // Skip corrupt file
  };

  videoPlayer.play().catch(e => {
    console.warn('Autoplay video dicegah:', e.message);
    videoPlayer.muted = true;
    videoPlayer.play().catch(() => setTimeout(playNext, 1000));
  });
}

// Init & Periodic sync
fetchConfig();
fetchPlaylist();
setInterval(fetchConfig, 30000);
setInterval(fetchPlaylist, 30000);
