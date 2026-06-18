/**
 * MNN Learning — JFT Basic Simulation Integration Layer
 * [Kanadereal][Kanadereal098@gmail.com]
 *
 * File ini HANYA berisi kode integrasi (loader, routing bridge, UI hub).
 * TIDAK ADA logic simulator (soal/jawaban/scoring/timer/audio/grouped shuffle)
 * yang diubah — semua itu tetap 100% di dalam exam_engine_v9.js (verbatim).
 *
 * Tanggung jawab file ini:
 *  1. Fetch data JSON simulator (kanji_kotoba, expression, choukai, dokkai)
 *  2. Panggil window.MNNExamEngine.init() dengan konfigurasi yang sama
 *     seperti exam_demo.html (audioMap, imagePath, timerMinutes, dll)
 *  3. Jembatani navigasi "Kembali ke Beranda" milik engine → navigateTo('simulasi')
 *     via config.onBackToHome (hook resmi yang sudah disediakan engine)
 */

// ── Lokasi aset simulator (relatif terhadap root MNN Learning) ──────────────
const JFT_SIM_BASE = 'jft_simulation/';

const JFT_SIM_JSON_FILES = {
  kanji_kotoba: 'SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_kanji_kotoba.json',
  expression:   'SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_expression.json',
  choukai:      'SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_choukai.json',
  dokkai:       'SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_dokkai.json',
};

// Sama persis dengan audioMap di exam_demo.html — JANGAN diubah.
const JFT_SIM_AUDIO_MAP = {
  'Z_[05-03]': 'choukai/Z_[05-03]_kiku1.mp3',
  'Z_[06-07]': 'choukai/Z_[06-07]_kiku1.mp3',
  'Z_[06-10]': 'choukai/Z_[06-10]_kiku1.mp3',
  'Z_[06-13]': 'choukai/Z_[06-13]_kiku4.mp3',
  'Z_[07-04]': 'choukai/Z_[07-04]_kiku4.mp3',
  'Z_[08-06]': 'choukai/Z_[08-06]_kiku4.mp3',
  'Z_[09-06]': 'choukai/Z_[09-06]_kiku4.mp3',
  'Z_[09-08]': 'choukai/Z_[09-08]_kaiwa.mp3',
  'Z_[11-24]': 'choukai/Z_[11-24]_kiku3.mp3',
  'Z_[13-09]': 'choukai/Z_[13-09]_kiku3.mp3',
  'Z_[15-04]': 'choukai/Z_[15-04]_kiku2.mp3',
  'Z_[18-14]': 'choukai/Z_[18-14]_kiku2.mp3',
};

// Resolve audioMap paths relative to JFT_SIM_BASE so the engine (which builds
// its own <audio src> via encodeURI(rawPath)) fetches from the right folder.
function _jftSimResolveAudioMap() {
  const out = {};
  Object.keys(JFT_SIM_AUDIO_MAP).forEach(k => {
    out[k] = JFT_SIM_BASE + JFT_SIM_AUDIO_MAP[k];
  });
  return out;
}

let _jftSimData = null;
let _jftSimInited = false;
let _jftSimLoading = false;

// ── Fetch keempat JSON soal (sekali saja, lalu cache di memori) ─────────────
async function loadJFTSimData() {
  if (_jftSimData) return _jftSimData;
  const BASE = JFT_SIM_BASE + 'exam_files/';
  const entries = Object.entries(JFT_SIM_JSON_FILES);
  const results = await Promise.all(
    entries.map(([, fname]) =>
      fetch(BASE + fname).then(r => {
        if (!r.ok) throw new Error(fname + ' → HTTP ' + r.status);
        return r.json();
      })
    )
  );
  const data = {};
  entries.forEach(([key], i) => { data[key] = results[i]; });
  _jftSimData = data;
  return data;
}

// ── Inisialisasi / tampilkan halaman simulasi exam ──────────────────────────
async function initJFTExamPage() {
  const container = document.getElementById('jft-exam-container');
  if (!container) return;

  // Sudah pernah di-init → engine sudah pegang state-nya sendiri di DOM ini.
  // Jangan re-init (akan reset progres & re-shuffle soal).
  if (_jftSimInited) return;

  if (_jftSimLoading) return;
  _jftSimLoading = true;

  container.innerHTML = `
    <div class="jft-sim-loading">
      <div class="jft-sim-spinner"></div>
      <p>Memuat soal JFT Basic Simulation…</p>
    </div>`;

  try {
    const data = await loadJFTSimData();

    if (typeof window.MNNExamEngine === 'undefined') {
      throw new Error('MNNExamEngine tidak ditemukan (exam_engine_v9.js belum termuat)');
    }

    window.MNNExamEngine.init({
      container: '#jft-exam-container',
      package: 'V10',
      timerMinutes: 60,
      imagePath: JFT_SIM_BASE + 'assets/images/',
      audioMap: _jftSimResolveAudioMap(),
      data: data,

      // Hook resmi engine: tombol "← Kembali ke Beranda" di result screen
      // akan memanggil ini, bukan kembali ke start-screen internal engine.
      onBackToHome: () => {
        navigateTo('simulasi');
      },

      onComplete: (results) => {
        console.log('[MNN x JFT] Simulasi selesai:', results);
        // Simpan flag JFT selesai untuk Roadmap Progress
        try { localStorage.setItem('mnn_jft_sim_done', '1'); } catch(e) {}
        // Refresh roadmap jika tersedia
        if (typeof ROADMAP_MODULE !== 'undefined' && ROADMAP_MODULE.render) {
          setTimeout(ROADMAP_MODULE.render, 200);
        }
        // Track ke GAMIFY
        if (typeof GAMIFY !== 'undefined' && GAMIFY.trackActivity) {
          GAMIFY.trackActivity({ type: 'jft_complete', score: results.overallPct || 0 });
        }
      },
    });

    _jftSimInited = true;
  } catch (err) {
    console.error('[MNN x JFT] Gagal memuat simulator:', err);
    container.innerHTML = `
      <div class="jft-sim-error">
        <div class="jft-sim-error-icon">⚠️</div>
        <h3>Gagal Memuat Simulasi</h3>
        <p>Pastikan koneksi internet stabil, lalu coba lagi.</p>
        <p class="jft-sim-error-detail">${(err && err.message) ? err.message : err}</p>
        <button class="exam-sim-btn" onclick="_jftSimRetry()">↺ Coba Lagi</button>
      </div>`;
  } finally {
    _jftSimLoading = false;
  }
}

// Retry setelah error load (mis. offline saat pertama buka)
function _jftSimRetry() {
  _jftSimData = null;
  _jftSimInited = false;
  initJFTExamPage();
}

// ── Navigasi dari card "Mulai Simulasi" di hub Simulasi Ujian ───────────────
function startJFTSimulation() {
  if (typeof isPremiumUser === 'function' && !isPremiumUser()) {
    if (typeof showPremiumModal === 'function') showPremiumModal();
    return;
  }
  navigateTo('jft-exam');
}
