/* ═══════════════════════════════════════════════════════════
   MNN Learning — AI Sensei Feature Flag
   ai-sensei-flag.js — Phase 1.1

   TUJUAN:
   Kontrol visibilitas & akses AI Sensei via Firestore,
   tanpa mengubah UI lain, sistem premium, atau cloudProgress.

   FIRESTORE SCHEMA:
   config/appSettings
   └── aiSenseiEnabled:     boolean  (default: false)
   └── aiSenseiMaintenance: boolean  (default: false)

   LOGIC:
   - role = "admin" → selalu bisa akses, terlepas dari flag
   - role lain + aiSenseiEnabled = true  → bisa akses
   - role lain + aiSenseiEnabled = false → tidak tampil
   - aiSenseiMaintenance = true → non-admin diblokir
   ═══════════════════════════════════════════════════════════ */

'use strict';

const AI_FLAG = (() => {

    // ─────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────
    let _config = null;          // cache config Firestore
    let _configLoaded = false;   // sudah pernah fetch?
    let _fetchPromise = null;    // dedupe concurrent fetch

    // Fallback aman jika Firestore tidak bisa dibaca
    const SAFE_FALLBACK = {
        aiSenseiEnabled:     false,
        aiSenseiMaintenance: false,
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
    // ─────────────────────────────────────────────────────

    /**
     * Baca config dari Firestore.
     * - Dedupe: concurrent call hanya trigger 1 fetch.
     * - Cache: setelah berhasil, tidak fetch ulang di session yang sama.
     *   (Admin bisa force-refresh dengan AI_FLAG.refresh())
     * - Fallback: jika dokumen tidak ada atau error → SAFE_FALLBACK.
     *
     * @returns {Promise<{aiSenseiEnabled, aiSenseiMaintenance}>}
     */
    async function fetchConfig() {
        // Kembalikan cache jika sudah ada
        if (_configLoaded && _config) {
            console.log('[AI_FLAG] Config dari cache:', JSON.stringify(_config));
            return _config;
        }

        // Dedupe — jika sedang fetch, tunggu promise yang sama
        if (_fetchPromise) {
            console.log('[AI_FLAG] Menunggu fetch yang sedang berjalan...');
            return _fetchPromise;
        }

        if (!_fbAvailable()) {
            console.warn('[AI_FLAG] _fbDb tidak tersedia — pakai fallback aman');
            _config = { ...SAFE_FALLBACK };
            _configLoaded = true;
            return _config;
        }

        _fetchPromise = (async () => {
            try {
                console.log('[AI_FLAG] Membaca config/appSettings dari Firestore...');
                const snap = await _fbDb
                    .collection('config')
                    .doc('appSettings')
                    .get();

                if (!snap.exists) {
                    console.warn('[AI_FLAG] config/appSettings belum ada di Firestore.',
                                 'Pakai fallback aman:', JSON.stringify(SAFE_FALLBACK),
                                 '\n→ Buat dokumen ini di Firestore Console untuk mengaktifkan AI Sensei.');
                    _config = { ...SAFE_FALLBACK };
                } else {
                    const data = snap.data();
                    _config = {
                        aiSenseiEnabled:     data.aiSenseiEnabled     === true,
                        aiSenseiMaintenance: data.aiSenseiMaintenance === true,
                    };
                    console.log('[AI_FLAG] Config loaded:', JSON.stringify(_config));
                }

                _configLoaded = true;
                return _config;

            } catch (e) {
                console.error('[AI_FLAG] ❌ Fetch config error:', e.code || '', e.message,
                              '— pakai fallback aman');
                _config = { ...SAFE_FALLBACK };
                _configLoaded = true; // jangan retry terus-menerus
                return _config;
            } finally {
                _fetchPromise = null;
            }
        })();

        return _fetchPromise;
    }

    /** Force refresh config — berguna untuk admin toggle live */
    function refresh() {
        _config = null;
        _configLoaded = false;
        _fetchPromise = null;
        console.log('[AI_FLAG] Cache dibersihkan — akan fetch ulang saat checkAccess()');
        return fetchConfig();
    }

    // ─────────────────────────────────────────────────────
    // ACCESS CONTROL
    // ─────────────────────────────────────────────────────

    /**
     * Cek apakah user boleh mengakses AI Sensei.
     *
     * @returns {Promise<{allowed: boolean, reason: string, isAdmin: boolean, config: object}>}
     */
    async function checkAccess() {
        const config = await fetchConfig();
        const isAdmin = _isAdmin();
        const isGuest = _isGuest();

        console.log('[AI_FLAG] checkAccess() —',
                    'role:', window.AUTH?.user?.role || 'unknown',
                    '| isAdmin:', isAdmin,
                    '| isGuest:', isGuest,
                    '| config:', JSON.stringify(config));

        // Guest tidak bisa akses
        if (isGuest) {
            return {
                allowed:  false,
                reason:   'login',
                isAdmin:  false,
                config,
            };
        }

        // Admin → selalu boleh, bahkan saat maintenance
        if (isAdmin) {
            console.log('[AI_FLAG] ✅ Admin — akses diberikan tanpa syarat');
            return {
                allowed: true,
                reason:  'admin',
                isAdmin: true,
                config,
            };
        }

        // Maintenance mode → non-admin diblokir
        if (config.aiSenseiMaintenance) {
            console.log('[AI_FLAG] 🚧 Maintenance mode — akses non-admin ditolak');
            return {
                allowed: false,
                reason:  'maintenance',
                isAdmin: false,
                config,
            };
        }

        // Feature flag off → sembunyikan dari non-admin
        if (!config.aiSenseiEnabled) {
            console.log('[AI_FLAG] 🚫 aiSenseiEnabled = false — akses non-admin ditolak');
            return {
                allowed: false,
                reason:  'disabled',
                isAdmin: false,
                config,
            };
        }

        // Lolos semua cek
        console.log('[AI_FLAG] ✅ Akses diberikan — aiSenseiEnabled = true');
        return {
            allowed: true,
            reason:  'enabled',
            isAdmin: false,
            config,
        };
    }

    // ─────────────────────────────────────────────────────
    // NAV VISIBILITY — tampilkan/sembunyikan icon nav
    // ─────────────────────────────────────────────────────

    /**
     * Update visibilitas tombol AI Sensei di bottom nav.
     * Dipanggil dari _enterApp() setelah auth resolved.
     */
    async function updateNavVisibility() {
        const navBtn = document.querySelector('.nav-item[data-page="ai-sensei"]');
        if (!navBtn) return;

        // Sementara sembunyikan sambil load config
        navBtn.style.display = 'none';

        const result = await checkAccess();

        if (result.allowed) {
            navBtn.style.display = '';
            console.log('[AI_FLAG] Nav AI Sensei: TAMPIL',
                        result.isAdmin ? '(admin)' : '(enabled)');
        } else {
            navBtn.style.display = 'none';
            console.log('[AI_FLAG] Nav AI Sensei: DISEMBUNYIKAN — reason:', result.reason);
        }
    }

    // ─────────────────────────────────────────────────────
    // TOAST — pesan blokir yang tidak mengganggu UI utama
    // ─────────────────────────────────────────────────────

    /**
     * Tampilkan toast kecil saat user mencoba akses tapi ditolak.
     * @param {'maintenance'|'disabled'|'login'|string} reason
     */
    function showBlockedToast(reason) {
        // Hapus toast lama jika masih ada
        document.getElementById('ai-flag-toast')?.remove();

        const messages = {
            maintenance: '🚧 AI Sensei sedang dalam pemeliharaan.',
            disabled:    '🤖 AI Sensei belum tersedia saat ini.',
            login:       '🔐 Silakan login untuk menggunakan AI Sensei.',
        };
        const msg = messages[reason] || '🤖 AI Sensei tidak tersedia.';

        const toast = document.createElement('div');
        toast.id = 'ai-flag-toast';
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

        // Fade in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => { toast.style.opacity = '1'; });
        });

        // Fade out + remove setelah 3 detik
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);

        console.log('[AI_FLAG] Toast ditampilkan — reason:', reason);
    }

    // ─────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────
    return {
        fetchConfig,
        checkAccess,
        updateNavVisibility,
        showBlockedToast,
        refresh,
        /** Shortcut: apakah user saat ini admin? */
        isAdmin: _isAdmin,
    };

})();

window.AI_FLAG = AI_FLAG;

// Pre-fetch config segera setelah script load
// (bukan blocking — hanya warm-up cache)
document.addEventListener('DOMContentLoaded', () => {
    // Tunggu sebentar sampai AUTH siap
    setTimeout(() => {
        if (typeof _fbDb !== 'undefined') {
            AI_FLAG.fetchConfig().catch(() => {});
        }
    }, 1500);
});
