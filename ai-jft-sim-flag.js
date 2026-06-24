/* ═══════════════════════════════════════════════════════════
   MNN Learning — AI JFT Simulation Feature Flag
   ai-jft-sim-flag.js — Phase 1

   TUJUAN:
   Kontrol visibilitas & akses 🤖 AI JFT Simulation via Firestore,
   MENGIKUTI POLA YANG SAMA dengan ai-sensei-flag.js (AI_FLAG).
   File ini BERDIRI SENDIRI — tidak mengimpor, memanggil, atau
   mengubah AI_FLAG / ai-sensei-flag.js sama sekali.

   FIRESTORE SCHEMA (dokumen YANG SAMA dipakai AI Sensei,
   hanya field baru ditambahkan — tidak menyentuh field lain):
   config/appSettings
   └── aiJftSimulationEnabled:     boolean  (default: false)
   └── aiJftSimulationMaintenance: boolean  (default: false)

   LOGIC (identik dengan AI_FLAG):
   - role = "admin" → selalu bisa akses, terlepas dari flag (ADMIN TEST MODE)
   - role lain + aiJftSimulationEnabled = true  → bisa akses
   - role lain + aiJftSimulationEnabled = false → tidak tampil (UI disembunyikan total)
   - aiJftSimulationMaintenance = true → non-admin diblokir
   ═══════════════════════════════════════════════════════════ */

'use strict';

const AI_JFT_FLAG = (() => {

    // ─────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────
    let _config       = null;
    let _configLoaded  = false;
    let _fetchPromise  = null;

    // Fallback aman jika Firestore tidak bisa dibaca → fitur tersembunyi
    const SAFE_FALLBACK = {
        aiJftSimulationEnabled:     false,
        aiJftSimulationMaintenance: false,
    };

    // ─────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────
    function _isAdmin() {
        return window.AUTH?.user?.role === 'admin';
    }
    function _isGuest() {
        return !window.AUTH?.user || window.AUTH?.user?.isGuest === true;
    }
    function _fbAvailable() {
        return typeof _fbDb !== 'undefined' && _fbDb !== null;
    }

    // ─────────────────────────────────────────────────────
    // FETCH CONFIG — Firestore config/appSettings
    // (dokumen yang sama dengan AI Sensei — dibaca ulang via
    //  query terpisah, TIDAK pernah ditulis oleh modul ini)
    // ─────────────────────────────────────────────────────
    async function fetchConfig() {
        if (_configLoaded && _config) return _config;
        if (_fetchPromise) return _fetchPromise;

        if (!_fbAvailable()) {
            console.warn('[AI_JFT_FLAG] _fbDb tidak tersedia — pakai fallback aman');
            _config = { ...SAFE_FALLBACK };
            _configLoaded = true;
            return _config;
        }

        _fetchPromise = (async () => {
            try {
                console.log('[AI_JFT_FLAG] Membaca config/appSettings dari Firestore...');
                const snap = await _fbDb.collection('config').doc('appSettings').get();

                if (!snap.exists) {
                    console.warn('[AI_JFT_FLAG] config/appSettings belum ada. Pakai fallback aman.',
                                 '\n→ Tambahkan field aiJftSimulationEnabled:true di Firestore Console untuk mengaktifkan.');
                    _config = { ...SAFE_FALLBACK };
                } else {
                    const data = snap.data();
                    _config = {
                        aiJftSimulationEnabled:     data.aiJftSimulationEnabled     === true,
                        aiJftSimulationMaintenance: data.aiJftSimulationMaintenance === true,
                    };
                    console.log('[AI_JFT_FLAG] Config loaded:', JSON.stringify(_config));
                }
                _configLoaded = true;
                return _config;
            } catch (e) {
                console.error('[AI_JFT_FLAG] ❌ Fetch config error:', e.code || '', e.message, '— pakai fallback aman');
                _config = { ...SAFE_FALLBACK };
                _configLoaded = true;
                return _config;
            } finally {
                _fetchPromise = null;
            }
        })();

        return _fetchPromise;
    }

    /** Force refresh — berguna setelah admin mengubah flag di Firestore Console */
    function refresh() {
        _config = null;
        _configLoaded = false;
        _fetchPromise = null;
        return fetchConfig();
    }

    // ─────────────────────────────────────────────────────
    // ACCESS CONTROL
    // ─────────────────────────────────────────────────────
    /**
     * @returns {Promise<{allowed:boolean, reason:string, isAdmin:boolean, config:object}>}
     */
    async function checkAccess() {
        const config  = await fetchConfig();
        const isAdmin = _isAdmin();
        const isGuest = _isGuest();

        console.log('[AI_JFT_FLAG] checkAccess() —',
                    'role:', window.AUTH?.user?.role || 'unknown',
                    '| isAdmin:', isAdmin, '| isGuest:', isGuest,
                    '| config:', JSON.stringify(config));

        if (isGuest) {
            return { allowed: false, reason: 'login', isAdmin: false, config };
        }

        // ADMIN TEST MODE — selalu aktif, tidak peduli flag/maintenance
        if (isAdmin) {
            console.log('[AI_JFT_FLAG] ✅ Admin — akses diberikan tanpa syarat (admin test mode)');
            return { allowed: true, reason: 'admin', isAdmin: true, config };
        }

        if (config.aiJftSimulationMaintenance) {
            console.log('[AI_JFT_FLAG] 🚧 Maintenance mode — akses non-admin ditolak');
            return { allowed: false, reason: 'maintenance', isAdmin: false, config };
        }

        if (!config.aiJftSimulationEnabled) {
            console.log('[AI_JFT_FLAG] 🚫 aiJftSimulationEnabled = false — akses non-admin ditolak');
            return { allowed: false, reason: 'disabled', isAdmin: false, config };
        }

        console.log('[AI_JFT_FLAG] ✅ Akses diberikan — aiJftSimulationEnabled = true');
        return { allowed: true, reason: 'enabled', isAdmin: false, config };
    }

    // ─────────────────────────────────────────────────────
    // CARD VISIBILITY — tampilkan/sembunyikan card di hub Simulasi Ujian
    // Dipanggil dari navigateTo('simulasi') setiap kali halaman dibuka,
    // sehingga toggle flag di Firestore Console langsung terasa tanpa
    // perlu update aplikasi.
    // ─────────────────────────────────────────────────────
    async function updateCardVisibility() {
        const card = document.getElementById('aijs-entry-card');
        if (!card) return;

        // Sembunyikan dulu sambil cek — mencegah flash konten ke user yang tidak berhak
        card.style.display = 'none';

        const result = await checkAccess();

        if (result.allowed) {
            card.style.display = '';
            console.log('[AI_JFT_FLAG] Card AI JFT Simulation: TAMPIL', result.isAdmin ? '(admin)' : '(enabled)');
        } else {
            card.style.display = 'none';
            console.log('[AI_JFT_FLAG] Card AI JFT Simulation: DISEMBUNYIKAN — reason:', result.reason);
        }
    }

    // ─────────────────────────────────────────────────────
    // TOAST — pesan blokir ringan (gaya sama dengan AI_FLAG)
    // ─────────────────────────────────────────────────────
    function showBlockedToast(reason) {
        document.getElementById('aijs-flag-toast')?.remove();

        const messages = {
            maintenance: '🚧 AI JFT Simulation sedang dalam pemeliharaan.',
            disabled:    '🤖 AI JFT Simulation belum tersedia saat ini.',
            login:       '🔐 Silakan login untuk menggunakan AI JFT Simulation.',
        };
        const msg = messages[reason] || '🤖 AI JFT Simulation tidak tersedia.';

        const toast = document.createElement('div');
        toast.id = 'aijs-flag-toast';
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = `
            position: fixed;
            bottom: calc(72px + env(safe-area-inset-bottom, 0px));
            left: 50%;
            transform: translateX(-50%);
            background: rgba(30, 30, 40, 0.96);
            color: #f0f0f5;
            font-size: 13px;
            font-weight: 500;
            padding: 10px 18px;
            border-radius: 99px;
            border: 1px solid rgba(255,255,255,0.12);
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            z-index: 9999;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => { toast.style.opacity = '1'; });
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ─────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────
    return {
        fetchConfig,
        checkAccess,
        updateCardVisibility,
        showBlockedToast,
        refresh,
        isAdmin: _isAdmin,
    };

})();

window.AI_JFT_FLAG = AI_JFT_FLAG;

// Pre-fetch config segera setelah script load (warm-up cache, non-blocking)
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof _fbDb !== 'undefined') {
            AI_JFT_FLAG.fetchConfig().catch(() => {});
        }
    }, 1500);
});
