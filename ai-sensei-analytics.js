/**
 * ai-sensei-analytics.js
 * ─────────────────────────────────────────────────────────────────────
 * Modul Analytics & Usage Tracking untuk AI Sensei.
 * Berdiri sendiri — tidak mengubah logika AI Sensei yang sudah berjalan.
 *
 * FIRESTORE STRUCTURE:
 *   users/{uid}/aiAnalytics   → agregat (1 dokumen per user)
 *   users/{uid}/aiUsageLogs   → log tiap sesi (1 dokumen per pesan)
 *   aiGlobalStats             → statistik global untuk admin dashboard
 *
 * CARA PAKAI:
 *   // Setelah AI menjawab sukses:
 *   AI_ANALYTICS.track(feature, creditsUsed, messageLength, answerLength, success);
 *
 *   // Admin dashboard:
 *   AI_ANALYTICS.getGlobalStats();
 *
 * PRINSIP:
 *   - Fire-and-forget: tidak pernah block UI
 *   - Batch write: analytics + log dalam 1 Firestore commit
 *   - Hanya tulis setelah AI response selesai
 *   - Semua error di-swallow agar tidak merusak fitur utama
 * ─────────────────────────────────────────────────────────────────────
 */

const AI_ANALYTICS = (() => {

    // ─────────────────────────────────────────────────────
    // KONSTANTA
    // ─────────────────────────────────────────────────────

    // Estimasi kasar token dari panjang karakter (4 char ≈ 1 token)
    const CHARS_PER_TOKEN = 4;

    // Threshold low credit — jika credit <= ini, tandai isLowCredit
    const LOW_CREDIT_THRESHOLD = 3;

    // Harga per credit untuk estimasi revenue (Rp)
    // 100 credit = Rp5.000 → Rp50/credit
    const CREDIT_PRICE_IDR = 50;

    // ─────────────────────────────────────────────────────
    // HELPER
    // ─────────────────────────────────────────────────────

    /** Ambil Firestore db dari Firebase global */
    function _db() {
        return typeof firebase !== 'undefined' ? firebase.firestore() : null;
    }

    /** Ambil UID user yang sedang login (null jika guest) */
    function _uid() {
        const uid = window.AUTH?.user?.uid;
        return (!uid || window.AUTH?.user?.isGuest) ? null : uid;
    }

    /** Ref dokumen aiAnalytics milik user */
    function _analyticsRef(uid) {
        const db = _db();
        if (!db || !uid) return null;
        return db.collection('users').doc(uid).collection('aiAnalytics').doc('summary');
    }

    /** Ref collection aiUsageLogs milik user */
    function _logsRef(uid) {
        const db = _db();
        if (!db || !uid) return null;
        return db.collection('users').doc(uid).collection('aiUsageLogs');
    }

    /** Ref dokumen global stats untuk admin */
    function _globalRef() {
        const db = _db();
        if (!db) return null;
        return db.collection('aiGlobalStats').doc('summary');
    }

    /**
     * Normalisasi nama fitur dari _detectFeature() ke featureType standar.
     * Cocokkan dengan field totalXxxQuestions di aiAnalytics.
     */
    function _normalizeFeature(featureName) {
        const map = {
            'Interview AI':        'interview',
            'Roleplay Percakapan': 'kaiwa',
            'Koreksi Kalimat':     'correction',
            'Bunpou':              'bunpou',
            'Kotoba':              'kotoba',
            'Pertanyaan Umum':     'general',
        };
        return map[featureName] || 'general';
    }

    /**
     * Mapping featureType ke field counter di aiAnalytics.
     * Dipakai untuk increment yang tepat.
     */
    function _featureToCounterField(featureType) {
        const map = {
            'interview':  'totalInterviewSessions',
            'kaiwa':      'totalKaiwaSessions',
            'correction': 'totalCorrectionRequests',
            'bunpou':     'totalBunpouQuestions',
            'kotoba':     'totalKotobaQuestions',
            'general':    'totalMessages', // general ikut totalMessages, tidak punya counter sendiri
        };
        return map[featureType] || null;
    }

    /**
     * Tentukan favoriteFeature berdasarkan field counter tertinggi.
     * Dipanggil client-side setelah update agar tidak perlu baca-tulis berulang.
     */
    function _calcFavoriteFeature(counters) {
        const candidates = [
            { key: 'totalInterviewSessions',  label: 'Interview AI' },
            { key: 'totalKaiwaSessions',       label: 'Roleplay Percakapan' },
            { key: 'totalCorrectionRequests',  label: 'Koreksi Kalimat' },
            { key: 'totalBunpouQuestions',     label: 'Bunpou' },
            { key: 'totalKotobaQuestions',     label: 'Kotoba' },
        ];
        let best = { label: 'Pertanyaan Umum', count: 0 };
        candidates.forEach(c => {
            const v = counters[c.key] || 0;
            if (v > best.count) best = { label: c.label, count: v };
        });
        return best.label;
    }

    // ─────────────────────────────────────────────────────
    // RETENTION HELPER
    // ─────────────────────────────────────────────────────

    /**
     * Kembalikan string tanggal YYYY-MM-DD dari timestamp (atau sekarang).
     */
    function _dateStr(ts) {
        const d = ts ? new Date(ts * 1000) : new Date();
        return d.toISOString().slice(0, 10);
    }

    /**
     * Hitung apakah user aktif dalam N hari terakhir.
     * @param {number} lastActiveSeconds - lastUsedAt.seconds dari Firestore
     * @param {number} days
     */
    function _isActiveWithin(lastActiveSeconds, days) {
        if (!lastActiveSeconds) return false;
        const now = Date.now() / 1000;
        return (now - lastActiveSeconds) <= days * 86400;
    }

    // ─────────────────────────────────────────────────────
    // CORE: TRACK
    // ─────────────────────────────────────────────────────

    /**
     * Rekam satu sesi penggunaan AI Sensei.
     * Dipanggil setelah AI response sukses/gagal.
     * Fire-and-forget — tidak mengembalikan Promise yang perlu di-await UI.
     *
     * @param {string}  featureName    - nama dari _detectFeature() e.g. "Kotoba"
     * @param {number}  creditsUsed    - kredit yang dipotong
     * @param {number}  messageLength  - panjang pesan user (karakter)
     * @param {number}  answerLength   - panjang jawaban AI (karakter), 0 jika gagal
     * @param {boolean} success        - apakah AI berhasil menjawab
     * @param {number}  currentBalance - saldo kredit tersisa setelah deduct
     */
    function track(featureName, creditsUsed, messageLength, answerLength, success, currentBalance) {
        // Fire-and-forget: tidak di-await agar tidak block UI
        _doTrack(featureName, creditsUsed, messageLength, answerLength, success, currentBalance)
            .catch(err => console.warn('[AI_ANALYTICS] track error (non-critical):', err.message));
    }

    async function _doTrack(featureName, creditsUsed, messageLength, answerLength, success, currentBalance) {
        const uid = _uid();
        if (!uid) return; // guest — skip

        const db          = _db();
        const analyticsRef = _analyticsRef(uid);
        const logsRef      = _logsRef(uid);
        const globalRef    = _globalRef();
        if (!db || !analyticsRef || !logsRef || !globalRef) return;

        const featureType       = _normalizeFeature(featureName);
        const estimatedTokens   = Math.round((messageLength + answerLength) / CHARS_PER_TOKEN);
        const now               = firebase.firestore.FieldValue.serverTimestamp();
        const inc               = firebase.firestore.FieldValue.increment;
        const isLow             = typeof currentBalance === 'number' && currentBalance <= LOW_CREDIT_THRESHOLD;

        // ── 1. Buat log entry baru (subcollection users/{uid}/aiUsageLogs) ──
        const logEntry = {
            createdAt:       now,
            featureType,
            creditsUsed:     creditsUsed || 0,
            messageLength:   messageLength || 0,
            estimatedTokens,
            success:         !!success,
        };

        // ── 2. Siapkan update untuk aiAnalytics (merge) ──
        const analyticsUpdate = {
            // Counter total pesan (setiap track = 1 pesan)
            totalMessages:        inc(1),
            totalCreditsUsed:     inc(creditsUsed || 0),
            totalTokensEstimated: inc(estimatedTokens),

            // Timestamp
            lastUsedAt:           now,
            lastUsedDate:         _dateStr(), // string YYYY-MM-DD untuk retention

            // Saldo saat ini
            currentCreditBalance: currentBalance || 0,

            // Low credit flag
            isLowCredit:          isLow,
        };

        // Increment counter fitur spesifik
        const counterField = _featureToCounterField(featureType);
        if (counterField && counterField !== 'totalMessages') {
            analyticsUpdate[counterField] = inc(1);
        }

        // firstUsedAt: hanya diset jika belum ada (set_merge tidak akan overwrite)
        // Kita handle dengan merge + conditional di bawah

        // ── 3. Update global stats ──
        const globalUpdate = {
            totalMessages:    inc(1),
            totalCreditsUsed: inc(creditsUsed || 0),
            lastUpdatedAt:    now,
            // Counter per fitur global
            ['feature_' + featureType]: inc(1),
        };

        // ── 4. Jalankan semua write secara paralel (tidak perlu batch karena doc berbeda) ──
        const writes = [
            // Log entry — add() = auto-ID baru
            logsRef.add(logEntry),

            // Analytics merge — update agregat
            analyticsRef.set(analyticsUpdate, { merge: true }),

            // Global stats merge
            globalRef.set(globalUpdate, { merge: true }),
        ];

        // firstUsedAt — cek dulu apakah sudah ada; kalau belum, set sekarang
        // Ini dilakukan terpisah untuk menghindari overwrite timestamp pertama
        try {
            const analyticsSnap = await analyticsRef.get();
            if (!analyticsSnap.exists || !analyticsSnap.data().firstUsedAt) {
                writes.push(
                    analyticsRef.set({ firstUsedAt: now }, { merge: true })
                );
            }
            // Hitung favoriteFeature dari data terbaru
            const currentData    = analyticsSnap.exists ? analyticsSnap.data() : {};
            const countersNow    = { ...currentData };
            if (counterField) countersNow[counterField] = (countersNow[counterField] || 0) + 1;
            const favoriteFeature = _calcFavoriteFeature(countersNow);
            writes.push(
                analyticsRef.set({ favoriteFeature }, { merge: true })
            );
        } catch (_) {
            // Non-critical — lanjut tanpa firstUsedAt dan favoriteFeature
        }

        await Promise.all(writes);

        console.log('[AI_ANALYTICS] Track OK:', featureType, '|', creditsUsed, 'cr |', estimatedTokens, 'tokens');
    }

    // ─────────────────────────────────────────────────────
    // RETENTION
    // ─────────────────────────────────────────────────────

    /**
     * Hitung dan simpan retention flags user saat ini.
     * Dipanggil saat user buka AI Sensei (dari init()).
     * Tidak perlu di-await — fire-and-forget.
     */
    function updateRetention() {
        _doUpdateRetention()
            .catch(err => console.warn('[AI_ANALYTICS] retention error (non-critical):', err.message));
    }

    async function _doUpdateRetention() {
        const uid = _uid();
        if (!uid) return;

        const analyticsRef = _analyticsRef(uid);
        if (!analyticsRef) return;

        const snap = await analyticsRef.get();
        if (!snap.exists) return;

        const data              = snap.data();
        const lastSec           = data.lastUsedAt?.seconds;
        const active1d          = _isActiveWithin(lastSec, 1);
        const active7d          = _isActiveWithin(lastSec, 7);
        const active30d         = _isActiveWithin(lastSec, 30);

        await analyticsRef.set({
            retention: {
                active1Day:  active1d,
                active7Day:  active7d,
                active30Day: active30d,
                lastChecked: firebase.firestore.FieldValue.serverTimestamp(),
            }
        }, { merge: true });

        console.log('[AI_ANALYTICS] Retention updated:', { active1d, active7d, active30d });
    }

    // ─────────────────────────────────────────────────────
    // TOP-UP ANALYTICS
    // ─────────────────────────────────────────────────────

    /**
     * Catat top-up credit (dipanggil dari adminAddCredit / adminSetCredit).
     * @param {string} targetUid
     * @param {number} amount - jumlah credit yang dibeli/ditambah
     * @param {string} type   - 'topup' | 'admin_set' | 'welcome_bonus' | dll
     */
    function trackTopUp(targetUid, amount, type = 'topup') {
        _doTrackTopUp(targetUid, amount, type)
            .catch(err => console.warn('[AI_ANALYTICS] trackTopUp error:', err.message));
    }

    async function _doTrackTopUp(targetUid, amount, type) {
        const db = _db();
        if (!db || !targetUid) return;

        const inc             = firebase.firestore.FieldValue.increment;
        const now             = firebase.firestore.FieldValue.serverTimestamp();
        const revenueEstimate = amount * CREDIT_PRICE_IDR;

        // Update analytics user
        const userRef = db.collection('users').doc(targetUid)
            .collection('aiAnalytics').doc('summary');
        await userRef.set({
            topUpCount:            inc(1),
            totalCreditsPurchased: inc(amount),
            totalRevenueEstimate:  inc(revenueEstimate),
            lastTopUpAt:           now,
        }, { merge: true });

        // Update global
        const globalRef = _globalRef();
        if (globalRef) {
            await globalRef.set({
                totalTopUpCount:       inc(1),
                totalCreditsPurchased: inc(amount),
                totalRevenueEstimate:  inc(revenueEstimate),
            }, { merge: true });
        }

        console.log('[AI_ANALYTICS] TopUp tracked:', amount, 'cr | est. Rp', revenueEstimate);
    }

    // ─────────────────────────────────────────────────────
    // ADMIN: GET GLOBAL STATS
    // ─────────────────────────────────────────────────────

    /**
     * Ambil statistik global untuk admin dashboard.
     * @returns {Promise<object>} data dari aiGlobalStats/summary
     */
    async function getGlobalStats() {
        const db = _db();
        if (!db) return null;
        try {
            const snap = await _globalRef().get();
            return snap.exists ? snap.data() : {};
        } catch (e) {
            console.error('[AI_ANALYTICS] getGlobalStats error:', e.message);
            return null;
        }
    }

    /**
     * Ambil Top 10 user aktif berdasarkan totalMessages.
     * Membutuhkan Firestore index: users/{uid}/aiAnalytics — totalMessages DESC
     * (Firestore tidak support cross-collection query langsung,
     *  jadi kita simpan snapshot di aiGlobalStats/topUsers)
     * @returns {Promise<Array>}
     */
    async function getTopUsers() {
        const db = _db();
        if (!db) return [];
        try {
            const snap = await db.collection('aiGlobalStats').doc('topUsers').get();
            return snap.exists ? (snap.data().users || []) : [];
        } catch (e) {
            console.error('[AI_ANALYTICS] getTopUsers error:', e.message);
            return [];
        }
    }

    /**
     * Ambil analytics milik user tertentu (untuk admin lihat user spesifik).
     * @param {string} targetUid
     * @returns {Promise<object|null>}
     */
    async function getUserAnalytics(targetUid) {
        const db = _db();
        if (!db || !targetUid) return null;
        try {
            const ref  = db.collection('users').doc(targetUid)
                .collection('aiAnalytics').doc('summary');
            const snap = await ref.get();
            return snap.exists ? snap.data() : null;
        } catch (e) {
            console.error('[AI_ANALYTICS] getUserAnalytics error:', e.message);
            return null;
        }
    }

    /**
     * Ambil usage logs milik user tertentu.
     * @param {string} targetUid
     * @param {number} limit - maks dokumen
     * @returns {Promise<Array>}
     */
    async function getUserLogs(targetUid, limit = 20) {
        const db = _db();
        if (!db || !targetUid) return [];
        try {
            const snap = await db.collection('users').doc(targetUid)
                .collection('aiUsageLogs')
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.error('[AI_ANALYTICS] getUserLogs error:', e.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────
    // ADMIN: UPDATE TOP USERS SNAPSHOT
    // ─────────────────────────────────────────────────────

    /**
     * Update snapshot topUsers di aiGlobalStats.
     * Dipanggil dari admin dashboard atau Cloud Function terjadwal.
     * Karena Firestore tidak support cross-collection aggregation,
     * kita scan semua user dari daftar yang di-pass admin.
     *
     * @param {string[]} uids - array UID yang ingin dibandingkan
     */
    async function refreshTopUsersSnapshot(uids = []) {
        const db = _db();
        if (!db || !uids.length) return;

        try {
            // Ambil analytics masing-masing UID secara paralel
            const results = await Promise.all(
                uids.map(async uid => {
                    const snap = await db.collection('users').doc(uid)
                        .collection('aiAnalytics').doc('summary').get();
                    if (!snap.exists) return null;
                    const d = snap.data();
                    return {
                        uid,
                        totalMessages:    d.totalMessages    || 0,
                        totalCreditsUsed: d.totalCreditsUsed || 0,
                        favoriteFeature:  d.favoriteFeature  || '-',
                        lastUsedDate:     d.lastUsedDate     || '-',
                    };
                })
            );

            const top10 = results
                .filter(Boolean)
                .sort((a, b) => b.totalMessages - a.totalMessages)
                .slice(0, 10);

            await db.collection('aiGlobalStats').doc('topUsers').set({
                users:       top10,
                updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
            });

            console.log('[AI_ANALYTICS] Top users snapshot updated:', top10.length, 'users');
            return top10;
        } catch (e) {
            console.error('[AI_ANALYTICS] refreshTopUsersSnapshot error:', e.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────

    return {
        // Dipanggil setelah tiap pesan AI
        track,

        // Dipanggil saat user buka AI Sensei
        updateRetention,

        // Dipanggil saat top-up / admin add credit
        trackTopUp,

        // Admin: ambil data
        getGlobalStats,
        getTopUsers,
        getUserAnalytics,
        getUserLogs,
        refreshTopUsersSnapshot,

        // Helper untuk testing
        _normalizeFeature,
    };

})();

window.AI_ANALYTICS = AI_ANALYTICS;
