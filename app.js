/* ═══════════════════════════════════════════════════════
   MNN Learning — みんなの日本語
   app.js — Core application logic
   Contains: STATE, all UI functions, Firebase, auth,
             premium system, init() + update system
   Depends on: data.js (must load first)
   ═══════════════════════════════════════════════════════ */
// ═══════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════
const STATE = {
    currentPage: 'dashboard',
    activeBook: 'book1',
    currentLesson: 0,
    currentCard: 0,
    isFlipped: false,
    isDark: true,
    showFurigana: true,
    showRomaji: false,
    soundOn: false,
    learnedCards: new Set(),
    kanaProg: {},
    kanaHafal: {},
    currentTab: 'flashcard',
    kanaScript: 'both',
    kanaCats: { basic: true, dakuten: true, combo: true },
    quizData: [],
    quizIndex: 0,
    quizScore: 0,
    bunpouProgress: {},
    dailyChallenge: { date: '', items: [] },
    exDifficulty: 'easy',   // [SENTENCE_ENGINE] 'easy' | 'medium' | 'hard'
    save() {
        try {
            localStorage.setItem('mnn_learned', JSON.stringify([...this.learnedCards]));
            localStorage.setItem('mnn_dark', JSON.stringify(this.isDark));
            localStorage.setItem('mnn_furigana', JSON.stringify(this.showFurigana));
            localStorage.setItem('mnn_romaji', JSON.stringify(this.showRomaji));
            localStorage.setItem('mnn_sound', JSON.stringify(this.soundOn));
            localStorage.setItem('mnn_book', this.activeBook);
            localStorage.setItem('mnn_lesson', String(this.currentLesson));
            localStorage.setItem('mnn_kana_prog', JSON.stringify(this.kanaProg));
            localStorage.setItem('mnn_kana_hafal', JSON.stringify(this.kanaHafal));
            localStorage.setItem('mnn_bunpou_prog', JSON.stringify(this.bunpouProgress));
            localStorage.setItem('mnn_daily_challenge', JSON.stringify(this.dailyChallenge));
            localStorage.setItem('mnn_ex_diff', this.exDifficulty); // [SENTENCE_ENGINE]
        } catch(e){}
        // [PROGRESS_SYNC v2.7.4] backup ke Firestore setiap kali STATE disimpan
        try { if (window.PROGRESS_SYNC) window.PROGRESS_SYNC.push(); } catch(e) {}
    },
    load() {
        try {
            const l = localStorage.getItem('mnn_learned');
            if (l) this.learnedCards = new Set(JSON.parse(l));
            const d = localStorage.getItem('mnn_dark');
            if (d !== null) this.isDark = JSON.parse(d);
            const f = localStorage.getItem('mnn_furigana');
            if (f !== null) this.showFurigana = JSON.parse(f);
            const ro = localStorage.getItem('mnn_romaji');
            if (ro !== null) this.showRomaji = JSON.parse(ro);
            const sn = localStorage.getItem('mnn_sound');
            if (sn !== null) this.soundOn = JSON.parse(sn);
            const b = localStorage.getItem('mnn_book');
            if (b) this.activeBook = b;
            const li = localStorage.getItem('mnn_lesson');
            if (li) this.currentLesson = parseInt(li)||0;
            const kp = localStorage.getItem('mnn_kana_prog');
            if (kp) this.kanaProg = JSON.parse(kp);
            const kh = localStorage.getItem('mnn_kana_hafal');
            if (kh) this.kanaHafal = JSON.parse(kh);
            const bp = localStorage.getItem('mnn_bunpou_prog');
            if (bp) this.bunpouProgress = JSON.parse(bp);
            const dc = localStorage.getItem('mnn_daily_challenge');
            if (dc) this.dailyChallenge = JSON.parse(dc);
            const ed = localStorage.getItem('mnn_ex_diff'); // [SENTENCE_ENGINE]
            if (ed && ['easy','medium','hard'].includes(ed)) this.exDifficulty = ed;
        } catch(e){}
    }
};
// FIX v2.6.3: const STATE tidak otomatis jadi window.STATE di browser modern.
// Semua module (GAMIFY, MISSIONS, dll) akses via window.STATE — tanpa ini selalu undefined.
window.STATE = STATE;
// FIX v2.6.4: const DB tidak otomatis jadi window.DB — roadmap steps pakai window.DB
window.DB = DB;

// ═══════════════════════════════════════════════════════════
// PROGRESS_SYNC — Firestore cloud backup untuk semua progress
// [FIX v2.7.4] Root cause: localStorage domain-specific →
// ganti domain (Netlify→rawliet-app.uk) = semua progress hilang.
// Solusi: sync progress ke Firestore users/{uid}.progress
// ═══════════════════════════════════════════════════════════
const PROGRESS_SYNC = (() => {
    'use strict';

    // Keys yang di-backup ke Firestore (scalar / JSON strings)
    const KEYS = [
        'mnn_learned',
        'mnn_gamify',
        'mnn_missions_v1',
        'mnn_bunpou_prog',
        'mnn_kana_prog',
        'mnn_kana_hafal',
        'mnn_kanji_hafal',
        'mnn_calendar_v1',
        'mnn_review_v1',
        // [CLOUD_SAVE v3.0] tambahan keys
        'mnn_sessions_v1',
        'mnn_jft_sim_done',
        'mnn_book',
        'mnn_lesson',
        'mnn_daily_challenge',
        'mnn_ex_diff',
    ];

    let _pushTimer = null;
    const DEBOUNCE_MS = 6000; // 6 detik debounce supaya tidak spam Firestore

    function _getDb() {
        return (typeof _fbDb !== 'undefined' && _fbDb) ? _fbDb : null;
    }

    function _getUid() {
        return (window.AUTH && AUTH.user && !AUTH.user.isGuest && AUTH.user.uid)
            ? AUTH.user.uid : null;
    }

    // Kumpulkan semua progress dari localStorage (scalar keys)
    function _collectProgress() {
        const p = { updated: new Date().toISOString() };
        KEYS.forEach(k => {
            try {
                const v = localStorage.getItem(k);
                if (v !== null) p[k.replace(/[^a-zA-Z0-9]/g, '_')] = v; // store as raw JSON string
            } catch(e) {}
        });
        // [CLOUD_SAVE v3.0] Kumpulkan dynamic-key groups sebagai JSON objek
        try {
            const favs = {}, skips = {}, renshu = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.startsWith('kfav_'))          favs[k.slice(5)]    = '1';
                else if (k.startsWith('roadmap_skip_')) skips[k.slice(13)]  = '1';
                else if (k.startsWith('mnn_renshu_'))  renshu[k.slice(11)] = localStorage.getItem(k);
            }
            if (Object.keys(favs).length)   p['_kfav']          = JSON.stringify(favs);
            if (Object.keys(skips).length)  p['_roadmap_skips'] = JSON.stringify(skips);
            if (Object.keys(renshu).length) p['_renshu']        = JSON.stringify(renshu);
        } catch(e) {}
        return p;
    }

    // Push ke Firestore (debounced)
    function push() {
        clearTimeout(_pushTimer);
        _pushTimer = setTimeout(() => {
            const db = _getDb();
            const uid = _getUid();
            if (!db || !uid) return;
            const progress = _collectProgress();
            db.collection('users').doc(uid)
                .set({ progress }, { merge: true })
                .then(() => console.log('[PROGRESS_SYNC] Pushed to Firestore:', Object.keys(progress).length - 1, 'keys'))
                .catch(e => console.warn('[PROGRESS_SYNC] Push failed:', e.message));
        }, DEBOUNCE_MS);
    }

    // [CLOUD_SAVE v3.0] Migrasi paksa localStorage → Firestore (dipanggil jika Firestore kosong)
    function _migrateToCloud() {
        const db = _getDb();
        const uid = _getUid();
        if (!db || !uid) return;
        const progress = _collectProgress();
        // Hanya migrate jika ada data (lebih dari sekedar field 'updated')
        if (Object.keys(progress).length <= 1) return;
        db.collection('users').doc(uid)
            .set({ progress }, { merge: true })
            .then(() => console.log('[PROGRESS_SYNC] Auto-migration localStorage→Firestore selesai:', Object.keys(progress).length - 1, 'keys'))
            .catch(e => console.warn('[PROGRESS_SYNC] Auto-migration failed:', e.message));
    }

    // ── Smart merge helpers ──────────────────────────────
    // ── union array tanpa duplikat ──────────────────────────
    function _mergeArrays(localStr, cloudStr) {
        const a = JSON.parse(localStr || '[]') || [];
        const b = JSON.parse(cloudStr || '[]') || [];
        return [...new Set([...a, ...b])];
    }

    // ── merge mnn_bunpou_prog: { lessonKey: { read, practiced, lastStudied } }
    // Tiap key: ambil yang paling maju (read/practiced=true + lastStudied terbaru)
    function _mergeBunpouProg(localStr, cloudStr) {
        const a = JSON.parse(localStr || '{}') || {};
        const b = JSON.parse(cloudStr || '{}') || {};
        const result = { ...a };
        Object.keys(b).forEach(k => {
            if (!(k in result)) {
                result[k] = b[k];
            } else {
                const av = result[k] || {}, bv = b[k] || {};
                result[k] = {
                    read:      !!(av.read || bv.read),
                    practiced: !!(av.practiced || bv.practiced),
                    accuracy:  Math.max(Number(av.accuracy||0), Number(bv.accuracy||0)) || null,
                    lastStudied: (av.lastStudied && bv.lastStudied)
                        ? (av.lastStudied > bv.lastStudied ? av.lastStudied : bv.lastStudied)
                        : (av.lastStudied || bv.lastStudied || null),
                };
            }
        });
        return result;
    }

    // ── merge mnn_kana_prog: { 'あ': { seen, correct, streak } }
    // Tiap karakter: ambil yang punya correct lebih tinggi
    function _mergeKanaProg(localStr, cloudStr) {
        const a = JSON.parse(localStr || '{}') || {};
        const b = JSON.parse(cloudStr || '{}') || {};
        const result = { ...a };
        Object.keys(b).forEach(k => {
            if (!(k in result)) {
                result[k] = b[k];
            } else {
                const av = result[k] || {}, bv = b[k] || {};
                // Ambil yang correct lebih tinggi; tie → seen lebih tinggi
                if ((bv.correct||0) > (av.correct||0) ||
                    ((bv.correct||0) === (av.correct||0) && (bv.seen||0) > (av.seen||0))) {
                    result[k] = bv;
                }
            }
        });
        return result;
    }

    // ── merge mnn_kana_hafal: { 'あ': true, 'い': true, ... }
    // Union semua karakter yang sudah dihafal
    function _mergeKanaHafal(localStr, cloudStr) {
        const a = JSON.parse(localStr || '{}') || {};
        const b = JSON.parse(cloudStr || '{}') || {};
        return { ...a, ...b };
    }

    // ── merge mnn_kanji_hafal: bisa array atau object
    function _mergeKanjiHafal(localStr, cloudStr) {
        try {
            const a = JSON.parse(localStr), b = JSON.parse(cloudStr);
            if (Array.isArray(a) && Array.isArray(b)) return [...new Set([...a, ...b])];
            if (!Array.isArray(a) && !Array.isArray(b)) return { ...a, ...b };
            // mixed: convert ke object union
            const ao = Array.isArray(a) ? Object.fromEntries(a.map(x => [x,true])) : a;
            const bo = Array.isArray(b) ? Object.fromEntries(b.map(x => [x,true])) : b;
            return { ...ao, ...bo };
        } catch(e) { return JSON.parse(cloudStr||'{}'); }
    }

    // ── merge mnn_gamify: sesuai struktur _defaultData() di features.js
    // { totalEXP, level, currentStreak, bestStreak, lastActiveDate,
    //   unlockedAchievements[], selectedAvatarId,
    //   _vocabLearned, _grammarDone, _quizDone, _bestAccuracy }
    function _mergeGamify(localStr, cloudStr) {
        const a = JSON.parse(localStr || '{}') || {};
        const b = JSON.parse(cloudStr || '{}') || {};
        const result = { ...a };

        // Numerik: ambil tertinggi
        ['totalEXP','_vocabLearned','_grammarDone','_quizDone','_bestAccuracy','bestStreak'].forEach(f => {
            result[f] = Math.max(Number(a[f]||0), Number(b[f]||0));
        });

        // Level: recalculate dari totalEXP pakai formula asli (_expForLevel(n) = n*(n-1)/2 * 100)
        // JANGAN override — biarkan GAMIFY hitung sendiri dari totalEXP saat init
        // Tapi pastikan minimal nilai tertinggi dari keduanya
        result.level = Math.max(Number(a.level||1), Number(b.level||1));

        // Streak: ambil yang lebih besar, lastActiveDate ambil yang lebih baru
        result.currentStreak = Math.max(Number(a.currentStreak||0), Number(b.currentStreak||0));
        if (a.lastActiveDate && b.lastActiveDate) {
            result.lastActiveDate = a.lastActiveDate > b.lastActiveDate ? a.lastActiveDate : b.lastActiveDate;
        } else {
            result.lastActiveDate = a.lastActiveDate || b.lastActiveDate || '';
        }

        // unlockedAchievements: union array (field asli di _defaultData)
        const aAch = a.unlockedAchievements || a.achievements || [];
        const bAch = b.unlockedAchievements || b.achievements || [];
        result.unlockedAchievements = [...new Set([...aAch, ...bAch])];
        delete result.achievements; // hapus field lama yg salah nama

        // selectedAvatarId: pakai local (preferensi user device ini)
        result.selectedAvatarId = a.selectedAvatarId || b.selectedAvatarId || 'av-ninja';

        return result;
    }

    // ── merge mnn_missions_v1: { date: 'YYYY-MM-DD', missions: [...] }
    // Reset harian — ambil yang datenya hari ini, atau yang lebih baru
    function _mergeMissions(localStr, cloudStr) {
        const a = JSON.parse(localStr || '{}') || {};
        const b = JSON.parse(cloudStr || '{}') || {};
        const today = new Date().toISOString().slice(0,10);
        // Kalau salah satu = hari ini, pakai itu
        if (a.date === today && b.date !== today) return a;
        if (b.date === today && a.date !== today) return b;
        if (a.date === today && b.date === today) {
            // Keduanya hari ini — merge progress per mission (ambil tertinggi)
            const result = { date: today, missions: (a.missions || []).map((m, i) => {
                const bm = (b.missions || [])[i] || {};
                return {
                    ...m,
                    progress: Math.max(Number(m.progress||0), Number(bm.progress||0)),
                    claimed:  !!(m.claimed || bm.claimed),
                };
            })};
            return result;
        }
        // Keduanya bukan hari ini: ambil yang lebih baru
        return (a.date||'') > (b.date||'') ? a : b;
    }

    // ── merge mnn_calendar_v1: { 'YYYY-MM-DD': level 0-3 }
    // Union semua tanggal, tiap tanggal ambil level tertinggi
    function _mergeCalendar(localStr, cloudStr) {
        const a = JSON.parse(localStr || '{}') || {};
        const b = JSON.parse(cloudStr || '{}') || {};
        const result = { ...a };
        Object.keys(b).forEach(d => {
            result[d] = Math.max(Number(result[d]||0), Number(b[d]||0));
        });
        return result;
    }

    // ── merge mnn_sessions_v1: array of { type, ts, date }
    // Gabungkan semua sesi, dedup by ts (timestamp)
    function _mergeSessions(localStr, cloudStr) {
        const a = JSON.parse(localStr || '[]') || [];
        const b = JSON.parse(cloudStr || '[]') || [];
        const seen = new Set();
        const merged = [];
        [...a, ...b].forEach(s => {
            // ts adalah unique identifier per sesi
            const key = s.ts ? String(s.ts) : (s.date + '|' + s.type + '|' + JSON.stringify(s));
            if (!seen.has(key)) { seen.add(key); merged.push(s); }
        });
        // Jaga max 500 entries (sama dengan limit di features.js)
        return merged.length > 500 ? merged.slice(-500) : merged;
    }

    // ── merge mnn_review_v1: array of vocab objects dengan difficulty/wrongCount
    // Dedup by key = (kana||kanji||jp)§(arti), ambil difficulty + wrongCount tertinggi
    function _mergeReview(localStr, cloudStr) {
        const a = JSON.parse(localStr || '[]') || [];
        const b = JSON.parse(cloudStr || '[]') || [];
        const map = new Map();
        [...a, ...b].forEach(item => {
            const key = ((item.kana||item.kanji||item.jp||'') + '§' + (item.arti||''));
            if (!map.has(key)) {
                map.set(key, { ...item });
            } else {
                const ex = map.get(key);
                ex.difficulty  = Math.max(Number(ex.difficulty||1), Number(item.difficulty||1));
                ex.wrongCount  = Math.max(Number(ex.wrongCount||0), Number(item.wrongCount||0));
                ex.addedAt     = Math.min(Number(ex.addedAt||0), Number(item.addedAt||0)) || ex.addedAt;
            }
        });
        return [...map.values()];
    }

    // Pull dari Firestore → smart merge per tipe data → push hasil merge kembali ke Firestore
    function pull(firestoreData) {
        if (!firestoreData || !firestoreData.progress) {
            console.log('[PROGRESS_SYNC] Firestore kosong — cek localStorage untuk auto-migration');
            const hasLocal = KEYS.some(k => { try { return localStorage.getItem(k) !== null; } catch(e){ return false; } });
            if (hasLocal) {
                console.log('[PROGRESS_SYNC] localStorage ada — migrasikan ke Firestore');
                _migrateToCloud();
            }
            return false;
        }
        const p = firestoreData.progress;
        let merged = 0;

        KEYS.forEach(k => {
            const fsKey = k.replace(/[^a-zA-Z0-9]/g, '_');
            const cloudVal = p[fsKey];
            const localVal = localStorage.getItem(k);
            if (!cloudVal) return;
            try {
                let result;
                if (!localVal) {
                    result = cloudVal;
                } else {
                    switch(k) {
                        case 'mnn_learned':
                            result = JSON.stringify(_mergeArrays(localVal, cloudVal)); break;
                        case 'mnn_gamify':
                            result = JSON.stringify(_mergeGamify(localVal, cloudVal)); break;
                        case 'mnn_missions_v1':
                            result = JSON.stringify(_mergeMissions(localVal, cloudVal)); break;
                        case 'mnn_bunpou_prog':
                            result = JSON.stringify(_mergeBunpouProg(localVal, cloudVal)); break;
                        case 'mnn_kana_prog':
                            result = JSON.stringify(_mergeKanaProg(localVal, cloudVal)); break;
                        case 'mnn_kana_hafal':
                            result = JSON.stringify(_mergeKanaHafal(localVal, cloudVal)); break;
                        case 'mnn_kanji_hafal':
                            result = JSON.stringify(_mergeKanjiHafal(localVal, cloudVal)); break;
                        case 'mnn_calendar_v1':
                            result = JSON.stringify(_mergeCalendar(localVal, cloudVal)); break;
                        case 'mnn_sessions_v1':
                            result = JSON.stringify(_mergeSessions(localVal, cloudVal)); break;
                        case 'mnn_review_v1':
                            result = JSON.stringify(_mergeReview(localVal, cloudVal)); break;
                        case 'mnn_jft_sim_done':
                            result = (localVal || cloudVal) ? '1' : null; break;
                        case 'mnn_daily_challenge':
                            try {
                                const dcA = JSON.parse(localVal)||{}, dcB = JSON.parse(cloudVal)||{};
                                result = JSON.stringify((dcB.date && dcA.date && dcB.date > dcA.date) ? dcB : dcA);
                            } catch(e) { result = cloudVal; }
                            break;
                        default:
                            result = cloudVal;
                    }
                }
                if (result && result !== localVal) {
                    localStorage.setItem(k, result);
                    merged++;
                }
            } catch(e) { console.warn('[PROGRESS_SYNC] merge error', k, e.message); }
        });

        // Dynamic groups — union semua
        if (p['_kfav']) {
            try {
                const cloudFavs = JSON.parse(p['_kfav']);
                Object.keys(cloudFavs).forEach(id => { try { localStorage.setItem('kfav_' + id, '1'); } catch(e) {} });
                merged++;
                console.log('[PROGRESS_SYNC] Merged favorites:', Object.keys(cloudFavs).length);
            } catch(e) {}
        }
        if (p['_roadmap_skips']) {
            try {
                const cloudSkips = JSON.parse(p['_roadmap_skips']);
                Object.keys(cloudSkips).forEach(id => { try { localStorage.setItem('roadmap_skip_' + id, '1'); } catch(e) {} });
                merged++;
                console.log('[PROGRESS_SYNC] Merged roadmap skips:', Object.keys(cloudSkips).length);
            } catch(e) {}
        }
        if (p['_renshu']) {
            try {
                const cloudRenshu = JSON.parse(p['_renshu']);
                Object.entries(cloudRenshu).forEach(([k, cloudScore]) => {
                    try {
                        const localScore = localStorage.getItem('mnn_renshu_' + k);
                        if (!localScore) {
                            localStorage.setItem('mnn_renshu_' + k, cloudScore);
                        } else {
                            const lp = JSON.parse(localScore)||{}, cp = JSON.parse(cloudScore)||{};
                            if ((cp.pct||0) > (lp.pct||0)) localStorage.setItem('mnn_renshu_' + k, cloudScore);
                        }
                    } catch(e) {}
                });
                merged++;
                console.log('[PROGRESS_SYNC] Merged renshu scores:', Object.keys(cloudRenshu).length);
            } catch(e) {}
        }

        console.log('[PROGRESS_SYNC] Smart merge selesai —', merged, 'keys diupdate');
        try { if (window.STATE) window.STATE.load(); } catch(e) {}
        // Push hasil merge ke Firestore supaya semua device sinkron
        setTimeout(() => { try { push(); } catch(e) {} }, 1500);
        return merged > 0;
    }

    // Immediate push tanpa debounce (untuk logout)
    function pushNow() {
        clearTimeout(_pushTimer);
        const db = _getDb();
        const uid = _getUid();
        if (!db || !uid) return;
        const progress = _collectProgress();
        db.collection('users').doc(uid)
            .set({ progress }, { merge: true })
            .then(() => console.log('[PROGRESS_SYNC] pushNow complete'))
            .catch(e => console.warn('[PROGRESS_SYNC] pushNow failed:', e.message));
    }

    return { push, pull, pushNow };
})();
window.PROGRESS_SYNC = PROGRESS_SYNC;

// ═══════════════════════════════════════════════════════════
// DATA HELPERS
// ═══════════════════════════════════════════════════════════
function getLessons(book) { return DB[book] || []; }
function getLesson(book, idx) { return getLessons(book)[idx] || getLessons(book)[0]; }
function getCurrentLesson() { return getLesson(STATE.activeBook, STATE.currentLesson); }
// Cari objek lesson asli milik sebuah vocab dari Kotoba pool (v._book / v._lesson),
// supaya contoh kalimat (getVocabExample) mengambil bunpou dari pelajaran yang BENAR,
// bukan dari lesson yang sedang aktif di tab Materi.
function getLessonForVocab(v) {
    if (!v) return null;
    if (!v._book || v._book === 'master') return null; // master kotoba tidak terikat lesson/bunpou
    const lessons = DB[v._book] || [];
    return lessons.find(l => l.id === v._lesson) || null;
}
function getAllVocab() {
    // Lesson-based vocab for quiz/flashcard — includes master if ready
    const dbVocab = Object.values(DB).flat().flatMap(l => l.vocab||[]);
    const masterVocab = (window.MASTER_KOTOBA_READY && window.MASTER_KOTOBA)
        ? window.MASTER_KOTOBA : [];
    return [...dbVocab, ...masterVocab];
}
function totalVocab() { return getAllVocab().length; }
function learnedKey(v) { return (v.kana||v.kanji||'') + '||' + v.arti; }

// Auto-extract contoh kalimat dari bunpou lesson untuk vocab saat ini
// [SENTENCE_ENGINE v1.0] Diperluas: jika bunpou tidak ada contoh,
// fallback ke SENTENCE_ENGINE.generate() berdasarkan tipe kata.
function getVocabExample(w, lesson) {
    // 1. Jika vocab sudah punya field ex, langsung pakai
    if (w.ex) return { ex: w.ex, ex_romaji: w.ex_romaji||'', ex_id: w.ex_id||'' };

    // 2. Cari di bunpou.p yang mengandung kata vocab ini
    if (lesson && lesson.bunpou) {
        const target = w.kanji || w.kana;
        if (target && !target.startsWith('〜') && !target.startsWith('～')) {
            for (const b of lesson.bunpou) {
                if (!b.p) continue;
                const lines = b.p.split('\n');
                for (const line of lines) {
                    const m = line.match(/Contoh[:：]\s*(.+)/);
                    if (!m) continue;
                    const raw = m[1].trim();
                    if (!raw.includes(target.replace(/〜/g,'').replace(/～/g,''))) continue;
                    const paren = raw.match(/^([^（(]+)[（(]([^）)]+)[）)](.*)$/);
                    if (paren) {
                        return { ex: paren[1].trim(), ex_romaji: '', ex_id: paren[2].trim() };
                    }
                    return { ex: raw, ex_romaji: '', ex_id: '' };
                }
            }
        }
    }

    // 3. Tidak ada contoh kalimat di database — tampilkan placeholder
    // [SENTENCE_ENGINE dinonaktifkan sementara — hanya gunakan contoh dari DB]
    return { ex: 'Contoh kalimat belum tersedia.', ex_romaji: '', ex_id: '', source: 'empty' };
}

// ═══════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════
function applyTheme(isDark) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    const toggleDark = document.getElementById('toggle-dark');
    if (toggleDark) toggleDark.className = 'toggle-switch ' + (isDark ? 'on' : 'off');
}
function toggleTheme() {
    STATE.isDark = !STATE.isDark;
    applyTheme(STATE.isDark);
    STATE.save();
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgressRing() {
    const total = totalVocab();
    const learned = STATE.learnedCards.size;
    const pct = total ? Math.round((learned / total) * 100) : 0;
    const fill = document.getElementById('progress-ring-fill');
    if (fill) fill.style.strokeDashoffset = String(88 - (88 * pct / 100));
    const pctEl = document.getElementById('progress-pct');
    if (pctEl) pctEl.textContent = pct + '%';

    const pbFill = document.getElementById('progress-bar-fill');
    if (pbFill) pbFill.style.width = pct + '%';
    const pbPct = document.getElementById('progress-bar-pct');
    if (pbPct) pbPct.textContent = pct + '%';
    const pbSub = document.getElementById('progress-bar-sub');
    if (pbSub) pbSub.textContent = learned === 0 ? 'Mulai belajar flashcard ✨' :
        learned >= total ? '🎉 Semua kosakata sudah dihapal!' :
        `${pct}% selesai • ${total - learned} kata tersisa`;
    const statLearned = document.getElementById('stat-learned');
    if (statLearned) statLearned.textContent = learned;
    const statTotal = document.getElementById('stat-total');
    if (statTotal) statTotal.textContent = total;
}

// ═══════════════════════════════════════════════════════════
// FLASHCARD
// ═══════════════════════════════════════════════════════════
function renderFlashcard() {
    const lesson = getCurrentLesson();
    if (!lesson || !lesson.vocab.length) return;
    const vocab = lesson.vocab;
    const idx = Math.min(STATE.currentCard, vocab.length - 1);
    const w = vocab[idx];
    STATE.isFlipped = false;

    // Update scene cat
    const scene = document.getElementById('flashcard-scene');
    if (scene) scene.setAttribute('data-cat', w.cat || 'noun');

    const flipper = document.getElementById('flashcard-flipper');
    if (flipper) flipper.classList.remove('is-flipped');

    // Category tag
    const catTag = document.getElementById('card-cat-tag');
    if (catTag) {
        const catLabels = { noun: 'Kata Benda', verb: 'Kata Kerja', adj: 'Kata Sifat' };
        catTag.textContent = catLabels[w.cat] || 'Lainnya';
        catTag.className = 'card-category-tag ' + (w.cat === 'noun' ? 'tag-noun' : w.cat === 'verb' ? 'tag-verb' : w.cat === 'adj' ? 'tag-adj' : 'tag-other');
    }

    // Top counter — format "N 転"
    const topCounter = document.getElementById('fc-top-counter');
    if (topCounter) topCounter.textContent = (idx + 1) + ' 転';

    // ── FRONT: main text (kanji or kana, with furigana) ──
    const mainText = document.getElementById('card-main-text');
    if (mainText) {
        if (w.kanji && w.kana && STATE.showFurigana) {
            mainText.innerHTML = `<ruby>${w.kanji}<rt>${w.kana}</rt></ruby>`;
        } else if (w.kanji) {
            mainText.textContent = w.kanji;
        } else {
            mainText.textContent = w.kana;
        }
    }

    // ── BACK: furigana (kana) + romaji ──
    const cbFuri = document.getElementById('cb-furigana');
    if (cbFuri) cbFuri.textContent = w.kanji ? w.kana : w.kana;

    const cbRomaji = document.getElementById('cb-romaji');
    if (cbRomaji) {
        cbRomaji.textContent = w.romaji || '';
        cbRomaji.style.display = w.romaji ? '' : 'none';
    }

    // ── BACK: arti Indonesia (bold biru) ──
    const cbArtiId = document.getElementById('cb-arti-id');
    if (cbArtiId) cbArtiId.textContent = w.arti || '—';

    // ── BACK: arti English (optional field w.en) ──
    const cbArtiEn = document.getElementById('cb-arti-en');
    if (cbArtiEn) {
        cbArtiEn.textContent = w.en || '';
        cbArtiEn.style.display = w.en ? '' : 'none';
    }

    // ── BACK: contoh kalimat (field w.ex atau auto-extract dari bunpou) ──
    const exData = getVocabExample(w, lesson);
    const isEmpty = !!(exData && exData.source === 'empty');
    const hasEx = !!(exData && exData.ex);
    const divider = document.getElementById('cb-divider');
    const exWrap = document.getElementById('cb-example-wrap');
    if (divider) divider.style.display = hasEx ? '' : 'none';
    if (exWrap) exWrap.style.display = hasEx ? '' : 'none';
    if (hasEx) {
        const exJp = document.getElementById('cb-ex-jp');
        const exRomaji = document.getElementById('cb-ex-romaji');
        const exId = document.getElementById('cb-ex-id');
        if (exJp) {
            exJp.textContent = exData.ex;
            // Placeholder — muted & italic
            exJp.style.color     = isEmpty ? 'var(--text-muted)' : '';
            exJp.style.fontStyle = isEmpty ? 'italic' : '';
            exJp.style.fontSize  = isEmpty ? '13px' : '';
        }
        if (exRomaji) { exRomaji.textContent = exData.ex_romaji || ''; exRomaji.style.display = exData.ex_romaji ? '' : 'none'; }
        if (exId) { exId.textContent = isEmpty ? '' : (exData.ex_id || ''); exId.style.display = (exData.ex_id && !isEmpty) ? '' : 'none'; }

        // [SENTENCE_ENGINE dinonaktifkan] — sembunyikan badge pattern/difficulty
        const exMeta = document.getElementById('cb-ex-meta');
        if (exMeta) exMeta.style.display = 'none';
    }

    // Known badge
    const key = learnedKey(w);
    const isLearned = STATE.learnedCards.has(key);
    const badge = document.getElementById('card-known-badge');
    if (badge) badge.style.display = isLearned ? 'block' : 'none';

    // Star button
    _updateStarBtn(w);

    updateLearnedButton();
}

function _updateStarBtn(w) {
    const btn = document.getElementById('btn-star-fc');
    if (!btn) return;
    const key = learnedKey(w);
    const starred = STATE.learnedCards.has(key);
    btn.textContent = starred ? '★' : '☆';
    btn.classList.toggle('is-starred', starred);
}

// [SENTENCE_ENGINE] Ganti tingkat kesulitan contoh kalimat
// Dipanggil dari tombol difficulty di flashcard
function setExDifficulty(diff) {
    if (!['easy','medium','hard'].includes(diff)) return;
    STATE.exDifficulty = diff;
    STATE.save();
    // Update tampilan tombol difficulty
    ['easy','medium','hard'].forEach(d => {
        const btn = document.getElementById('ex-diff-' + d);
        if (btn) btn.classList.toggle('active', d === diff);
    });
    // Re-render flashcard agar contoh kalimat diperbarui
    renderFlashcard();
}

function shuffleFlashcard() {
    const lesson = getCurrentLesson();
    if (!lesson || !lesson.vocab.length) return;
    // Fisher-Yates shuffle on indices, pick a random card that's not current
    const len = lesson.vocab.length;
    if (len <= 1) return;
    let next;
    do { next = Math.floor(Math.random() * len); } while (next === STATE.currentCard);
    STATE.currentCard = next;
    renderFlashcard();
}

function flipCard() {
    STATE.isFlipped = !STATE.isFlipped;
    const flipper = document.getElementById('flashcard-flipper');
    if (flipper) flipper.classList.toggle('is-flipped', STATE.isFlipped);
}

function goNextCard() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    STATE.currentCard = (STATE.currentCard + 1) % lesson.vocab.length;
    renderFlashcard();
}

function goPrevCard() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    STATE.currentCard = (STATE.currentCard - 1 + lesson.vocab.length) % lesson.vocab.length;
    renderFlashcard();
}

function updateLearnedButton() {
    const lesson = getCurrentLesson();
    if (!lesson || !lesson.vocab.length) return;
    const w = lesson.vocab[STATE.currentCard];
    const key = learnedKey(w);
    const isLearned = STATE.learnedCards.has(key);
    const btn = document.getElementById('btn-mark-learned');
    if (btn) {
        btn.textContent = isLearned ? '✓ Sudah Hafal' : '○ Tandai Sudah Hafal';
        btn.className = 'btn-mark-learned' + (isLearned ? ' is-learned' : '');
    }
}

function toggleLearnedCard() {
    const lesson = getCurrentLesson();
    if (!lesson || !lesson.vocab.length) return;
    const w = lesson.vocab[STATE.currentCard];
    const key = learnedKey(w);
    if (STATE.learnedCards.has(key)) {
        STATE.learnedCards.delete(key);
    } else {
        STATE.learnedCards.add(key);
    }
    STATE.save();
    renderFlashcard();
    updateProgressRing();
    renderChapterListHome();
    // FIX v2.6.2: Update vocab DB counter on dashboard in real-time
    if (typeof renderVocabDbCard === 'function') renderVocabDbCard();
}

// ═══════════════════════════════════════════════════════════
// VOCAB LIST
// ═══════════════════════════════════════════════════════════
function renderVocabList(filter) {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    const container = document.getElementById('vocab-list');
    if (!container) return;
    let list = lesson.vocab;
    if (filter) {
        const q = filter.toLowerCase();
        list = list.filter(v =>
            v.kana.includes(q) || v.arti.toLowerCase().includes(q) ||
            (v.kanji && v.kanji.includes(q)) || (v.romaji && v.romaji.toLowerCase().includes(q))
        );
    }
    const cntEl = document.getElementById('vocab-count');
    if (cntEl) cntEl.textContent = list.length + ' kata';
    container.innerHTML = list.map(v => {
        const key = learnedKey(v);
        const learned = STATE.learnedCards.has(key);
        const hasKanji = v.kanji && v.kanji.length > 0;
        const mainWord = hasKanji ? v.kanji : v.kana;
        const furigana  = (hasKanji && v.kana && STATE.showFurigana) ? v.kana : '';
        return `<div class="vocab-item${learned?' is-learned':''}">
          <div class="vocab-japanese">
            <div class="vocab-furigana">${furigana}</div>
            <div class="vocab-kana">${escHTML(mainWord)}</div>
            <div class="vocab-romaji">${STATE.showRomaji ? escHTML(v.romaji||'') : ''}</div>
          </div>
          <div class="vocab-divider"></div>
          <div class="vocab-meaning">${escHTML(v.arti)}</div>
          <div class="vocab-learned-dot"></div>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// BUNPOU (GRAMMAR) — with Reibun + Per-bunpou Mini Renshu
// ═══════════════════════════════════════════════════════════

// Extract reibun (例) entries from a bunpou.p text
function extractReibun(text) {
    const items = [];
    const lines = text.split('\n');
    lines.forEach(line => {
        // Match lines with 例: or 例文: or lines containing Japanese kanji+kana patterns prefixed by 例
        const m = line.match(/例[:：]?\s*(.*)/);
        if (!m) return;
        let raw = m[1].trim();
        if (!raw || raw.length < 3) return;

        // Extract (translation) from parentheses
        const trMatch = raw.match(/[（(]([^)）]{3,})[)）]/);
        const arti = trMatch ? trMatch[1].trim() : '';

        // Strip translation and ruby notation [...]
        let jp = raw
            .replace(/[（(][^)）]*[)）]/g, '')
            .replace(/\[.*?\]/g, '')
            .trim()
            .replace(/。+$/, '').trim();

        if (!jp || jp.length < 3) return;

        // Build romaji from the raw text after jp (after the closing paren)
        const afterParen = raw.replace(/[（(][^)）]*[)）]/g, '').replace(/\[.*?\]/g, '').trim();

        items.push({ jp, arti });
    });
    return items;
}



// ═══════════════════════════════════════════════════════════
// FURIGANA UNTUK JUDUL GRAMMAR (BUNPOU TITLE)
// Algoritma kiri-ke-kanan: cari match terpanjang di posisi
// paling kiri agar tidak terjadi double-nesting ruby tag.
// ═══════════════════════════════════════════════════════════
function addFuriganaToGrammarTitle(rawTitle) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const ruby = (k, r) => `${esc(k)}<span class="furi-paren">（${esc(r)}）</span>`;

    // MAP: pola (string) → hasil HTML. Urutan tidak kritis karena
    // algoritma memilih match terpanjang di setiap posisi.
    const MAP = [
        // ── Kata khusus dengan furigana ganda ────────────────────
        ['何歳（おいくつ）',      ruby('何歳','なんさい・おいくつ')],
        // ── Kata Kerja + okurigana (terpanjang duluan) ───────────
        ['伝えていただけませんか', ruby('伝','つた')+'えていただけませんか'],
        ['書いてあります',        ruby('書','か')+'いてあります'],
        ['忘れました',           ruby('忘','わす')+'れました'],
        ['知っていますか',        ruby('知','し')+'っていますか'],
        ['思っています',         ruby('思','おも')+'っています'],
        ['言っていました',        ruby('言','い')+'っていました'],
        ['散歩します',           ruby('散歩','さんぽ')+'します'],
        ['終わります',           ruby('終','お')+'わります'],
        ['曲がります',           ruby('曲','ま')+'がります'],
        ['聞こえます',           ruby('聞','き')+'こえます'],
        ['思います',             ruby('思','おも')+'います'],
        ['言いました',           ruby('言','い')+'いました'],
        ['走ります',             ruby('走','はし')+'ります'],
        ['帰ります',             ruby('帰','かえ')+'ります'],
        ['歩きます',             ruby('歩','ある')+'きます'],
        ['渡ります',             ruby('渡','わた')+'ります'],
        ['乗ります',             ruby('乗','の')+'ります'],
        ['登ります',             ruby('登','のぼ')+'ります'],
        ['降ります',             ruby('降','お')+'ります'],
        ['座ります',             ruby('座','すわ')+'ります'],
        ['着きます',             ruby('着','つ')+'きます'],
        ['借ります',             ruby('借','か')+'ります'],
        ['習います',             ruby('習','なら')+'います'],
        ['行きます',             ruby('行','い')+'きます'],
        ['来ます',               ruby('来','き')+'ます'],
        ['見えます',             ruby('見','み')+'えます'],
        ['教えます',             ruby('教','おし')+'えます'],
        ['貸します',             ruby('貸','か')+'します'],
        ['出ます',               ruby('出','で')+'ます'],
        ['入ります',             ruby('入','はい')+'ります'],
        ['読みます',             ruby('読','よ')+'みます'],
        ['欲しいです',           ruby('欲','ほ')+'しいです'],
        ['寂しい',               ruby('寂','さび')+'しい'],
        // ── Istilah tata bahasa & kata benda ─────────────────────
        ['可能形',               ruby('可能形','かのうけい')],
        ['意向形',               ruby('意向形','いこうけい')],
        ['謙譲語',               ruby('謙譲語','けんじょうご')],
        ['受身形',               ruby('受身形','うけみけい')],
        ['使役形',               ruby('使役形','しえきけい')],
        ['命令形',               ruby('命令形','めいれいけい')],
        ['禁止形',               ruby('禁止形','きんしけい')],
        ['疑問詞',               ruby('疑問詞','ぎもんし')],
        ['自動詞',               ruby('自動詞','じどうし')],
        ['他動詞',               ruby('他動詞','たどうし')],
        ['何歳',                 ruby('何歳','なんさい')],
        ['何か',                 ruby('何','なに')+'か'],
        ['誰か',                 ruby('誰','だれ')+'か'],
        ['誰の',                 ruby('誰','だれ')+'の'],
        ['趣味',                 ruby('趣味','しゅみ')],
        ['時間',                 ruby('時間','じかん')],
        ['約束',                 ruby('約束','やくそく')],
        ['用事',                 ruby('用事','ようじ')],
        ['意味',                 ruby('意味','いみ')],
        ['予定',                 ruby('予定','よてい')],
        ['安心',                 ruby('安心','あんしん')],
        ['場合',                 ruby('場合','ばあい')],
        ['目上',                 ruby('目上','めうえ')],
        ['目下',                 ruby('目下','めした')],
        ['中で',                 ruby('中','なか')+'で'],
        ['人が',                 ruby('人','ひと')+'が'],
        ['人に',                 ruby('人','ひと')+'に'],
        ['私が',                 ruby('私','わたし')+'が'],
        ['私に',                 ruby('私','わたし')+'に'],
        ['私は',                 ruby('私','わたし')+'は'],
        ['何ですか',             ruby('何','なん')+'ですか'],
        ['何/どこ',              ruby('何','なに')+'/どこ'],
        ['何',                   ruby('何','なに')],
        ['誰',                   ruby('誰','だれ')],
        ['等',                   ruby('等','など')],
        ['回',                   ruby('回','かい')],
    ];

    // Algoritma kiri-ke-kanan: pilih match terpanjang di posisi terkiri
    let result = '';
    let pos = 0;
    while (pos < rawTitle.length) {
        let bestIdx = rawTitle.length, bestLen = 0, bestTo = '';
        for (const [from, to] of MAP) {
            const idx = rawTitle.indexOf(from, pos);
            if (idx === -1) continue;
            // Pilih match yang lebih kiri; jika sama posisi, pilih yang lebih panjang
            if (idx < bestIdx || (idx === bestIdx && from.length > bestLen)) {
                bestIdx = idx; bestLen = from.length; bestTo = to;
            }
        }
        if (bestLen === 0) {
            // Tidak ada match lagi — sisa string
            result += esc(rawTitle.slice(pos));
            break;
        }
        // Teks sebelum match → escape
        result += esc(rawTitle.slice(pos, bestIdx));
        // Match → ruby HTML (sudah di-escape di dalam MAP)
        result += bestTo;
        pos = bestIdx + bestLen;
    }
    return result;
}

// ═══════════════════════════════════════════════════════════
// FURIGANA UNTUK TEKS BUNPOU (PENJELASAN, CONTOH, FUNGSI)
// Fungsi umum: menambahkan furigana ke teks bebas (bukan hanya judul)
// ═══════════════════════════════════════════════════════════
function addFuriganaToText(rawText) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const ruby = (k, r) => `${esc(k)}<span class="furi-paren">（${esc(r)}）</span>`;

    // MAP komprehensif: kanji → furigana
    // Urutan: kata majemuk/panjang LEBIH DULU supaya tidak tertimpa kata pendek
    const MAP = [
        // ── Kata majemuk khusus ──────────────────────────────────
        ['使用禁止',      ruby('使用禁止','しようきんし')],
        ['携帯電話',      ruby('携帯電話','けいたいでんわ')],
        ['上野公園',      ruby('上野公園','うえのこうえん')],
        ['大阪城',        ruby('大阪城','おおさかじょう')],
        ['東京駅',        ruby('東京駅','とうきょうえき')],
        ['水曜日',        ruby('水曜日','すいようび')],
        ['金曜日',        ruby('金曜日','きんようび')],
        ['月曜日',        ruby('月曜日','げつようび')],
        ['木曜日',        ruby('木曜日','もくようび')],
        ['火曜日',        ruby('火曜日','かようび')],
        ['土曜日',        ruby('土曜日','どようび')],
        ['日曜日',        ruby('日曜日','にちようび')],
        ['新幹線',        ruby('新幹線','しんかんせん')],
        ['図書館',        ruby('図書館','としょかん')],
        ['会議室',        ruby('会議室','かいぎしつ')],
        ['事務所',        ruby('事務所','じむしょ')],
        ['市役所',        ruby('市役所','しやくしょ')],
        ['申し訳',        ruby('申し訳','もうしわけ')],
        ['日本語',        ruby('日本語','にほんご')],
        ['日本人',        ruby('日本人','にほんじん')],
        ['日本',          ruby('日本','にほん')],
        ['東京',          ruby('東京','とうきょう')],
        ['大丈夫',        ruby('大丈夫','だいじょうぶ')],
        ['大人',          ruby('大人','おとな')],
        ['友達',          ruby('友達','ともだち')],
        ['両親',          ruby('両親','りょうしん')],
        ['子供',          ruby('子供','こども')],
        ['彼女',          ruby('彼女','かのじょ')],
        ['恋人',          ruby('恋人','こいびと')],
        ['先生',          ruby('先生','せんせい')],
        ['社員',          ruby('社員','しゃいん')],
        ['社長',          ruby('社長','しゃちょう')],
        ['部長',          ruby('部長','ぶちょう')],
        ['田中',          ruby('田中','たなか')],
        ['学校',          ruby('学校','がっこう')],
        ['学生',          ruby('学生','がくせい')],
        ['教室',          ruby('教室','きょうしつ')],
        ['会社',          ruby('会社','かいしゃ')],
        ['病院',          ruby('病院','びょういん')],
        ['受付',          ruby('受付','うけつけ')],
        ['一緒に',        ruby('一緒','いっしょ')+'に'],
        ['一番',          ruby('一番','いちばん')],
        ['一回でも',      ruby('一回','いっかい')+'でも'],
        ['一回',          ruby('一回','いっかい')],
        ['仕事',          ruby('仕事','しごと')],
        ['勉強',          ruby('勉強','べんきょう')],
        ['漢字',          ruby('漢字','かんじ')],
        ['英語',          ruby('英語','えいご')],
        ['書道',          ruby('書道','しょどう')],
        ['読書',          ruby('読書','どくしょ')],
        ['音楽',          ruby('音楽','おんがく')],
        ['映画',          ruby('映画','えいが')],
        ['運動',          ruby('運動','うんどう')],
        ['旅行',          ruby('旅行','りょこう')],
        ['散歩',          ruby('散歩','さんぽ')],
        ['料理',          ruby('料理','りょうり')],
        ['食事',          ruby('食事','しょくじ')],
        ['買い物',        ruby('買','か')+'い'+ruby('物','もの')],
        ['入院',          ruby('入院','にゅういん')],
        ['出張',          ruby('出張','しゅっちょう')],
        ['準備',          ruby('準備','じゅんび')],
        ['連絡',          ruby('連絡','れんらく')],
        ['相談',          ruby('相談','そうだん')],
        ['予約',          ruby('予約','よやく')],
        ['予定',          ruby('予定','よてい')],
        ['約束',          ruby('約束','やくそく')],
        ['趣味',          ruby('趣味','しゅみ')],
        ['用事',          ruby('用事','ようじ')],
        ['用意',          ruby('用意','ようい')],
        ['意味',          ruby('意味','いみ')],
        ['言葉',          ruby('言葉','ことば')],
        ['説明',          ruby('説明','せつめい')],
        ['書類',          ruby('書類','しょるい')],
        ['道具',          ruby('道具','どうぐ')],
        ['信号',          ruby('信号','しんごう')],
        ['場合',          ruby('場合','ばあい')],
        ['事故',          ruby('事故','じこ')],
        ['安心',          ruby('安心','あんしん')],
        ['便利',          ruby('便利','べんり')],
        ['簡単',          ruby('簡単','かんたん')],
        ['特別',          ruby('特別','とくべつ')],
        ['有名',          ruby('有名','ゆうめい')],
        ['上手',          ruby('上手','じょうず')],
        ['親切',          ruby('親切','しんせつ')],
        ['元気',          ruby('元気','げんき')],
        ['健康',          ruby('健康','けんこう')],
        ['暗記',          ruby('暗記','あんき')],
        ['全部',          ruby('全部','ぜんぶ')],
        ['性格',          ruby('性格','せいかく')],
        ['独身',          ruby('独身','どくしん')],
        ['結婚',          ruby('結婚','けっこん')],
        ['景色',          ruby('景色','けしき')],
        ['他動詞',        ruby('他動詞','たどうし')],
        ['自動詞',        ruby('自動詞','じどうし')],
        ['受身',          ruby('受身','うけみ')],
        ['目上',          ruby('目上','めうえ')],
        ['目下',          ruby('目下','めした')],
        ['時間',          ruby('時間','じかん')],
        ['今日',          ruby('今日','きょう')],
        ['今朝',          ruby('今朝','けさ')],
        ['昨日',          ruby('昨日','きのう')],
        ['明日',          ruby('明日','あした')],
        ['先月',          ruby('先月','せんげつ')],
        ['来月',          ruby('来月','らいげつ')],
        ['毎日',          ruby('毎日','まいにち')],
        ['毎朝',          ruby('毎朝','まいあさ')],
        ['毎晩',          ruby('毎晩','まいばん')],
        ['午後',          ruby('午後','ごご')],
        ['夕飯',          ruby('夕飯','ゆうはん')],
        ['電車',          ruby('電車','でんしゃ')],
        ['電話',          ruby('電話','でんわ')],
        ['鉛筆',          ruby('鉛筆','えんぴつ')],
        ['野菜',          ruby('野菜','やさい')],
        ['果物',          ruby('果物','くだもの')],
        ['携帯',          ruby('携帯','けいたい')],
        ['歩道',          ruby('歩道','ほどう')],
        ['部屋',          ruby('部屋','へや')],
        ['公園',          ruby('公園','こうえん')],
        ['図書',          ruby('図書','としょ')],
        ['中部',          ruby('中部','ちゅうぶ')],
        // ── Kata Kerja (verb forms) ───────────────────────────────
        ['食べます',      ruby('食','た')+'べます'],
        ['食べました',    ruby('食','た')+'べました'],
        ['食べません',    ruby('食','た')+'べません'],
        ['食べたい',      ruby('食','た')+'べたい'],
        ['食べる',        ruby('食','た')+'べる'],
        ['食べ',          ruby('食','た')+'べ'],
        ['飲みます',      ruby('飲','の')+'みます'],
        ['飲まない',      ruby('飲','の')+'まない'],
        ['飲む',          ruby('飲','の')+'む'],
        ['行きます',      ruby('行','い')+'きます'],
        ['行きました',    ruby('行','い')+'きました'],
        ['行きません',    ruby('行','い')+'きません'],
        ['行きたい',      ruby('行','い')+'きたい'],
        ['行かない',      ruby('行','い')+'かない'],
        ['行く',          ruby('行','い')+'く'],
        ['来ます',        ruby('来','き')+'ます'],
        ['来ました',      ruby('来','き')+'ました'],
        ['来ない',        ruby('来','こ')+'ない'],
        ['来て',          ruby('来','き')+'て'],
        ['来ると',        ruby('来','く')+'ると'],
        ['来る',          ruby('来','く')+'る'],
        ['見ます',        ruby('見','み')+'ます'],
        ['見ません',      ruby('見','み')+'ません'],
        ['見えます',      ruby('見','み')+'えます'],
        ['見せる',        ruby('見','み')+'せる'],
        ['見せない',      ruby('見','み')+'せない'],
        ['読みます',      ruby('読','よ')+'みます'],
        ['読む',          ruby('読','よ')+'む'],
        ['書きます',      ruby('書','か')+'きます'],
        ['書いた',        ruby('書','か')+'いた'],
        ['書いて',        ruby('書','か')+'いて'],
        ['書く',          ruby('書','か')+'く'],
        ['書けます',      ruby('書','か')+'けます'],
        ['話して',        ruby('話','はな')+'して'],
        ['話している',    ruby('話','はな')+'している'],
        ['聞きます',      ruby('聞','き')+'きます'],
        ['聞かない',      ruby('聞','き')+'かない'],
        ['聞く',          ruby('聞','き')+'く'],
        ['起きます',      ruby('起','お')+'きます'],
        ['起きました',    ruby('起','お')+'きました'],
        ['起きない',      ruby('起','お')+'きない'],
        ['起きる',        ruby('起','お')+'きる'],
        ['起きて',        ruby('起','お')+'きて'],
        ['帰ります',      ruby('帰','かえ')+'ります'],
        ['帰りましょ',    ruby('帰','かえ')+'りましょ'],
        ['帰ると',        ruby('帰','かえ')+'ると'],
        ['出かけます',    ruby('出','で')+'かけます'],
        ['出かけません',  ruby('出','で')+'かけません'],
        ['出ます',        ruby('出','で')+'ます'],
        ['出して',        ruby('出','だ')+'して'],
        ['出来ます',      ruby('出来','でき')+'ます'],
        ['出来た',        ruby('出来','でき')+'た'],
        ['出来なくても',  ruby('出来','でき')+'なくても'],
        ['歩きます',      ruby('歩','ある')+'きます'],
        ['歩いて',        ruby('歩','ある')+'いて'],
        ['走ります',      ruby('走','はし')+'ります'],
        ['降ります',      ruby('降','お')+'ります'],
        ['降ったら',      ruby('降','ふ')+'ったら'],
        ['乗ります',      ruby('乗','の')+'ります'],
        ['渡ると',        ruby('渡','わた')+'ると'],
        ['曲がります',    ruby('曲','ま')+'がります'],
        ['着きます',      ruby('着','つ')+'きます'],
        ['座ってもいい',  ruby('座','すわ')+'ってもいい'],
        ['座ってはいけ',  ruby('座','すわ')+'ってはいけ'],
        ['座って',        ruby('座','すわ')+'って'],
        ['立ちます',      ruby('立','た')+'ちます'],
        ['立たない',      ruby('立','た')+'たない'],
        ['立つ',          ruby('立','た')+'つ'],
        ['入ります',      ruby('入','はい')+'ります'],
        ['入らないで',    ruby('入','はい')+'らないで'],
        ['借ります',      ruby('借','か')+'ります'],
        ['借りて',        ruby('借','か')+'りて'],
        ['借りた',        ruby('借','か')+'りた'],
        ['借りない',      ruby('借','か')+'りない'],
        ['借りる',        ruby('借','か')+'りる'],
        ['貸します',      ruby('貸','か')+'します'],
        ['習います',      ruby('習','なら')+'います'],
        ['教えます',      ruby('教','おし')+'えます'],
        ['覚えます',      ruby('覚','おぼ')+'えます'],
        ['覚えた',        ruby('覚','おぼ')+'えた'],
        ['覚えない',      ruby('覚','おぼ')+'えない'],
        ['覚えて',        ruby('覚','おぼ')+'えて'],
        ['覚える',        ruby('覚','おぼ')+'える'],
        ['忘れない',      ruby('忘','わす')+'れない'],
        ['忘れる',        ruby('忘','わす')+'れる'],
        ['忘れました',    ruby('忘','わす')+'れました'],
        ['知っています',  ruby('知','し')+'っています'],
        ['知っていますか',ruby('知','し')+'っていますか'],
        ['思います',      ruby('思','おも')+'います'],
        ['思っています',  ruby('思','おも')+'っています'],
        ['言いました',    ruby('言','い')+'いました'],
        ['言います',      ruby('言','い')+'います'],
        ['言葉',          ruby('言葉','ことば')],
        ['呼ばない',      ruby('呼','よ')+'ばない'],
        ['呼ぶ',          ruby('呼','よ')+'ぶ'],
        ['待たない',      ruby('待','ま')+'たない'],
        ['待つ',          ruby('待','ま')+'つ'],
        ['持ちます',      ruby('持','も')+'ちます'],
        ['使います',      ruby('使','つか')+'います'],
        ['働く',          ruby('働','はたら')+'く'],
        ['泳がない',      ruby('泳','およ')+'がない'],
        ['泳ぐ',          ruby('泳','およ')+'ぐ'],
        ['浴びます',      ruby('浴','あ')+'びます'],
        ['浴びない',      ruby('浴','あ')+'びない'],
        ['浴びる',        ruby('浴','あ')+'びる'],
        ['浴びて',        ruby('浴','あ')+'びて'],
        ['浴びた',        ruby('浴','あ')+'びた'],
        ['寝ない',        ruby('寝','ね')+'ない'],
        ['寝る',          ruby('寝','ね')+'る'],
        ['寝坊',          ruby('寝坊','ねぼう')],
        ['泊まる',        ruby('泊','と')+'まる'],
        ['洗って',        ruby('洗','あら')+'って'],
        ['洗いましょ',    ruby('洗','あら')+'いましょ'],
        ['閉めます',      ruby('閉','し')+'めます'],
        ['閉めた',        ruby('閉','し')+'めた'],
        ['閉めて',        ruby('閉','し')+'めて'],
        ['開けます',      ruby('開','あ')+'けます'],
        ['押して',        ruby('押','お')+'して'],
        ['止まる',        ruby('止','と')+'まる'],
        ['置いている',    ruby('置','お')+'いている'],
        ['置いてくれ',    ruby('置','お')+'いてくれ'],
        ['片付',          ruby('片付','かたづ')],
        ['取らない',      ruby('取','と')+'らない'],
        ['取る',          ruby('取','と')+'る'],
        ['切りました',    ruby('切','き')+'りました'],
        ['繰り',          ruby('繰','く')+'り'],
        ['直さない',      ruby('直','なお')+'さない'],
        ['直す',          ruby('直','なお')+'す'],
        ['調べて',        ruby('調','しら')+'べて'],
        ['終わります',    ruby('終','お')+'わります'],
        ['終わりました',  ruby('終','お')+'わりました'],
        ['始まりました',  ruby('始','はじ')+'まりました'],
        ['伝えて',        ruby('伝','つた')+'えて'],
        ['過ぎます',      ruby('過','す')+'ぎます'],
        ['過ぎない',      ruby('過','す')+'ぎない'],
        ['過ぎる',        ruby('過','す')+'ぎる'],
        ['過ぎた',        ruby('過','す')+'ぎた'],
        ['落ちます',      ruby('落','お')+'ちます'],
        ['落ちない',      ruby('落','お')+'ちない'],
        ['落ちる',        ruby('落','お')+'ちる'],
        ['落ちた',        ruby('落','お')+'ちた'],
        ['足ります',      ruby('足','た')+'ります'],
        ['足りない',      ruby('足','た')+'りない'],
        ['足りる',        ruby('足','た')+'りる'],
        ['足りた',        ruby('足','た')+'りた'],
        ['住んでいます',  ruby('住','す')+'んでいます'],
        ['泊まるとき',    ruby('泊','と')+'まるとき'],
        ['遅れました',    ruby('遅','おく')+'れました'],
        ['通る',          ruby('通','とお')+'る'],
        ['通って',        ruby('通','とお')+'って'],
        ['返して',        ruby('返','かえ')+'して'],
        ['連絡して',      ruby('連絡','れんらく')+'して'],
        ['登ります',      ruby('登','のぼ')+'ります'],
        ['歩きます',      ruby('歩','ある')+'きます'],
        ['散歩します',    ruby('散歩','さんぽ')+'します'],
        ['運動します',    ruby('運動','うんどう')+'します'],
        ['買います',      ruby('買','か')+'います'],
        ['買いました',    ruby('買','か')+'いました'],
        ['買いたい',      ruby('買','か')+'いたい'],
        ['買って',        ruby('買','か')+'って'],
        ['買いに',        ruby('買','か')+'いに'],
        ['買い',          ruby('買','か')+'い'],
        ['貯めます',      ruby('貯','た')+'めます'],
        ['結婚して',      ruby('結婚','けっこん')+'して'],
        ['遊んで',        ruby('遊','あそ')+'んで'],
        ['離れます',      ruby('離','はな')+'れます'],
        ['込んでいます',  ruby('込','こ')+'んでいます'],
        ['申します',      ruby('申','もう')+'します'],
        ['申して',        ruby('申','もう')+'して'],
        ['辞めます',      ruby('辞','や')+'めます'],
        ['死なない',      ruby('死','し')+'なない'],
        ['死ぬ',          ruby('死','し')+'ぬ'],
        ['怒る',          ruby('怒','おこ')+'る'],
        ['吸います',      ruby('吸','す')+'います'],
        // ── Kata sifat ─────────────────────────────────────────
        ['静かじゃない',  ruby('静','しず')+'かじゃない'],
        ['静かでした',    ruby('静','しず')+'かでした'],
        ['静かです',      ruby('静','しず')+'かです'],
        ['静かに',        ruby('静','しず')+'かに'],
        ['静か',          ruby('静','しず')+'か'],
        ['美味しいです',  ruby('美味','おい')+'しいです'],
        ['美味しいでしょ',ruby('美味','おい')+'しいでしょ'],
        ['美味しい',      ruby('美味','おい')+'しい'],
        ['便利だと',      ruby('便利','べんり')+'だと'],
        ['便利だったら',  ruby('便利','べんり')+'だったら'],
        ['便利です',      ruby('便利','べんり')+'です'],
        ['便利な',        ruby('便利','べんり')+'な'],
        ['大丈夫です',    ruby('大丈夫','だいじょうぶ')+'です'],
        ['丈夫',          ruby('丈夫','じょうぶ')],
        ['元気',          ruby('元気','げんき')],
        ['不便でも',      ruby('不便','ふべん')+'でも'],
        ['高かった',      ruby('高','たか')+'かった'],
        ['高くても',      ruby('高','たか')+'くても'],
        ['高くない',      ruby('高','たか')+'くない'],
        ['高くなかった',  ruby('高','たか')+'くなかった'],
        ['高くなります',  ruby('高','たか')+'くなります'],
        ['高いです',      ruby('高','たか')+'いです'],
        ['高い',          ruby('高','たか')+'い'],
        ['楽になります',  ruby('楽','らく')+'になります'],
        ['楽しい',        ruby('楽','たの')+'しい'],
        ['嫌い',          ruby('嫌','きら')+'い'],
        ['好きです',      ruby('好','す')+'きです'],
        ['好き',          ruby('好','す')+'き'],
        ['欲しいです',    ruby('欲','ほ')+'しいです'],
        ['欲しかった',    ruby('欲','ほ')+'しかった'],
        ['欲しくない',    ruby('欲','ほ')+'しくない'],
        ['欲しくなかった',ruby('欲','ほ')+'しくなかった'],
        ['難しい',        ruby('難','むずか')+'しい'],
        ['難しかった',    ruby('難','むずか')+'しかった'],
        ['寒い',          ruby('寒','さむ')+'い'],
        ['暑いとき',      ruby('暑','あつ')+'いとき'],
        ['暑い',          ruby('暑','あつ')+'い'],
        ['辛い',          ruby('辛','から')+'い'],
        ['甘い',          ruby('甘','あま')+'い'],
        ['痛い',          ruby('痛','いた')+'い'],
        ['遅く',          ruby('遅','おそ')+'く'],
        ['早く',          ruby('早','はや')+'く'],
        ['寂しい',        ruby('寂','さび')+'しい'],
        ['赤い',          ruby('赤','あか')+'い'],
        ['晴れです',      ruby('晴','は')+'れです'],
        ['晴れだと',      ruby('晴','は')+'れだと'],
        ['晴れ',          ruby('晴','は')+'れ'],
        // ── Kata benda umum ──────────────────────────────────────
        ['私は',          ruby('私','わたし')+'は'],
        ['私が',          ruby('私','わたし')+'が'],
        ['私に',          ruby('私','わたし')+'に'],
        ['私の',          ruby('私','わたし')+'の'],
        ['私より',        ruby('私','わたし')+'より'],
        ['私',            ruby('私','わたし')],
        ['妹は',          ruby('妹','いもうと')+'は'],
        ['妹も',          ruby('妹','いもうと')+'も'],
        ['妹と',          ruby('妹','いもうと')+'と'],
        ['妹に',          ruby('妹','いもうと')+'に'],
        ['妹',            ruby('妹','いもうと')],
        ['母は',          ruby('母','はは')+'は'],
        ['母が',          ruby('母','はは')+'が'],
        ['母に',          ruby('母','はは')+'に'],
        ['母',            ruby('母','はは')],
        ['父は',          ruby('父','ちち')+'は'],
        ['父が',          ruby('父','ちち')+'が'],
        ['父',            ruby('父','ちち')],
        ['誰もいません',  ruby('誰','だれ')+'もいません'],
        ['誰がいちばん',  ruby('誰','だれ')+'がいちばん'],
        ['誰かいます',    ruby('誰','だれ')+'かいます'],
        ['誰のですか',    ruby('誰','だれ')+'のですか'],
        ['誰の',          ruby('誰','だれ')+'の'],
        ['誰',            ruby('誰','だれ')],
        ['何もありません',ruby('何','なに')+'もありません'],
        ['何もしません',  ruby('何','なに')+'もしません'],
        ['何ですか',      ruby('何','なん')+'ですか'],
        ['何歳',          ruby('何歳','なんさい')],
        ['何時間',        ruby('何時間','なんじかん')],
        ['何人ですか',    ruby('何人','なんにん')+'ですか'],
        ['何かあります',  ruby('何','なに')+'かあります'],
        ['何をしますか',  ruby('何','なに')+'をしますか'],
        ['何で',          ruby('何','なん')+'で'],
        ['何と',          ruby('何','なん')+'と'],
        ['何の',          ruby('何','なん')+'の'],
        ['何を',          ruby('何','なに')+'を'],
        ['何',            ruby('何','なに')],
        ['名前は',        ruby('名前','なまえ')+'は'],
        ['名前',          ruby('名前','なまえ')],
        ['先月',          ruby('先月','せんげつ')],
        ['来月',          ruby('来月','らいげつ')],
        ['今',            ruby('今','いま')],
        ['朝',            ruby('朝','あさ')],
        ['山が',          ruby('山','やま')+'が'],
        ['山です',        ruby('山','やま')+'です'],
        ['山',            ruby('山','やま')],
        ['川',            ruby('川','かわ')],
        ['海外に',        ruby('海外','かいがい')+'に'],
        ['海',            ruby('海','うみ')],
        ['雨が',          ruby('雨','あめ')+'が'],
        ['雨でも',        ruby('雨','あめ')+'でも'],
        ['雨',            ruby('雨','あめ')],
        ['雪',            ruby('雪','ゆき')],
        ['花です',        ruby('花','はな')+'です'],
        ['花はどうで',    ruby('花','はな')+'はどうで'],
        ['花',            ruby('花','はな')],
        ['猫がいます',    ruby('猫','ねこ')+'がいます'],
        ['猫',            ruby('猫','ねこ')],
        ['鳥',            ruby('鳥','とり')],
        ['犬',            ruby('犬','いぬ')],
        ['車です',        ruby('車','くるま')+'です'],
        ['車を',          ruby('車','くるま')+'を'],
        ['車',            ruby('車','くるま')],
        ['靴を',          ruby('靴','くつ')+'を'],
        ['靴',            ruby('靴','くつ')],
        ['薬',            ruby('薬','くすり')],
        ['傘',            ruby('傘','かさ')],
        ['本',            ruby('本','ほん')],
        ['机の',          ruby('机','つくえ')+'の'],
        ['机',            ruby('つくえ','つくえ')],
        ['壁',            ruby('壁','かべ')],
        ['窓',            ruby('窓','まど')],
        ['水',            ruby('水','みず')],
        ['氷が',          ruby('氷','こおり')+'が'],
        ['氷',            ruby('氷','こおり')],
        ['橋を',          ruby('橋','はし')+'を'],
        ['橋',            ruby('橋','はし')],
        ['金が',          ruby('金','かね')+'が'],
        ['金があった',    ruby('金','かね')+'があった'],
        ['金があります',  ruby('金','かね')+'があります'],
        ['金をあげます',  ruby('金','かね')+'をあげます'],
        ['金をもらいます',ruby('金','かね')+'をもらいます'],
        ['金',            ruby('金','かね')],
        ['円',            ruby('円','えん')],
        ['駅の',          ruby('駅','えき')+'の'],
        ['駅',            ruby('駅','えき')],
        ['髪',            ruby('髪','かみ')],
        ['背が',          ruby('背','せ')+'が'],
        ['頭',            ruby('頭','あたま')],
        ['手を',          ruby('手','て')+'を'],
        ['手伝い',        ruby('手伝','てつだ')+'い'],
        ['手当',          ruby('手当','てあて')],
        ['手',            ruby('手','て')],
        ['毛',            ruby('毛','け')],
        ['色',            ruby('色','いろ')],
        ['景色',          ruby('景色','けしき')],
        ['机',            ruby('机','つくえ')],
        ['役に',          ruby('役','やく')+'に'],
        ['役',            ruby('役','やく')],
        ['内',            ruby('内','うち')],
        ['前に',          ruby('前','まえ')+'に'],
        ['前',            ruby('前','まえ')],
        ['上に',          ruby('上','うえ')+'に'],
        ['上',            ruby('上','うえ')],
        ['下に',          ruby('下','した')+'に'],
        ['下',            ruby('下','した')],
        ['中に',          ruby('中','なか')+'に'],
        ['中で',          ruby('中','なか')+'で'],
        ['中',            ruby('中','なか')],
        ['隣に',          ruby('隣','となり')+'に'],
        ['隣',            ruby('隣','となり')],
        ['所',            ruby('所','ところ')],
        ['先',            ruby('先','さき')],
        ['人は',          ruby('人','ひと')+'は'],
        ['人に',          ruby('人','ひと')+'に'],
        ['人が',          ruby('人','ひと')+'が'],
        ['人です',        ruby('人','ひと')+'です'],
        ['人',            ruby('人','ひと')],
        ['食べ物',        ruby('食','た')+'べ'+ruby('物','もの')],
        ['物が',          ruby('物','もの')+'が'],
        ['物は',          ruby('物','もの')+'は'],
        ['物に',          ruby('物','もの')+'に'],
        ['物',            ruby('物','もの')],
        ['全部',          ruby('全部','ぜんぶ')],
        ['時',            ruby('時','とき')],
        ['分',            ruby('分','ふん')],
        ['歳',            ruby('歳','さい')],
        ['年に',          ruby('年','ねん')+'に'],
        ['年',            ruby('年','ねん')],
        ['方',            ruby('方','かた')],
        ['屋',            ruby('屋','や')],
        ['客様',          ruby('客様','きゃくさま')],
        ['部屋',          ruby('部屋','へや')],
        ['雑誌',          ruby('雑誌','ざっし')],
        ['説明書',        ruby('説明書','せつめいしょ')],
        ['健康',          ruby('健康','けんこう')],
        ['生活',          ruby('生活','せいかつ')],
        ['木の',          ruby('木','き')+'の'],
        ['木',            ruby('木','き')],
        ['日',            ruby('日','ひ')],
        ['月',            ruby('月','つき')],
        ['安',            ruby('安','やす')],
        ['最近',          ruby('最近','さいきん')],
        ['失礼ですが',    ruby('失礼','しつれい')+'ですが'],
        ['失礼',          ruby('失礼','しつれい')],
        ['特別',          ruby('特別','とくべつ')],
        ['無理',          ruby('無理','むり')],
        ['必要です',      ruby('必要','ひつよう')+'です'],
        ['必要',          ruby('必要','ひつよう')],
        ['準備して',      ruby('準備','じゅんび')+'して'],
        ['相談して',      ruby('相談','そうだん')+'して'],
        ['説明して',      ruby('説明','せつめい')+'して'],
        ['作った',        ruby('作','つく')+'った'],
        ['作って',        ruby('作','つく')+'って'],
        ['作る',          ruby('作','つく')+'る'],
        ['建てる',        ruby('建','た')+'てる'],
        ['合う',          ruby('合','あ')+'う'],
        ['会いました',    ruby('会','あ')+'いました'],
        ['会いません',    ruby('会','あ')+'いません'],
        ['会う',          ruby('会','あ')+'う'],
        ['会ったり',      ruby('会','あ')+'ったり'],
        ['会わない',      ruby('会','あ')+'わない'],
        ['会',            ruby('会','かい')],
    ];

    // Algoritma sama: kiri-ke-kanan, match terpanjang di posisi terkiri
    const esc2 = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let result = '';
    let pos = 0;
    while (pos < rawText.length) {
        let bestIdx = rawText.length, bestLen = 0, bestTo = '';
        for (const [from, to] of MAP) {
            const idx = rawText.indexOf(from, pos);
            if (idx === -1) continue;
            if (idx < bestIdx || (idx === bestIdx && from.length > bestLen)) {
                bestIdx = idx; bestLen = from.length; bestTo = to;
            }
        }
        if (bestLen === 0) {
            result += esc2(rawText.slice(pos));
            break;
        }
        result += esc2(rawText.slice(pos, bestIdx));
        result += bestTo;
        pos = bestIdx + bestLen;
    }
    return result;
}

function renderBunpou() {
    const lesson = getCurrentLesson();
    const container = document.getElementById('bunpou-list');
    if (!container || !lesson) return;

    // ── HARD GATE: lesson-level access check ──────────────────────────────
    // renderBunpou is called from switchSubTab which is reachable even after
    // navigateTo resets to lesson 0. Re-check here so premium grammar content
    // is NEVER rendered regardless of how the call was triggered.
    if (!canAccess('lesson', lesson.id)) {
        container.innerHTML = renderPremiumGateHTML(
            '📖 Tata Bahasa (文法)',
            'Grammar pelajaran ini tersedia untuk member Premium.\nUpgrade untuk akses semua 50 pelajaran.'
        );
        console.warn('[ACCESS BLOCKED] renderBunpou — lesson', lesson.id, 'requires premium');
        return;
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!lesson.bunpou || !lesson.bunpou.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📖</div><div class="empty-state-text">Belum ada catatan tata bahasa untuk pelajaran ini.</div></div>';
        return;
    }

    const lessonKey = (bi) => `${STATE.activeBook}_${lesson.id}_${bi}`;

    let openIdx = -1;
    let openReibunIdx = new Set();
    let openCreatorIdx = new Set();
    let openNotesTab = {};    // bi -> tab string
    let creatorInputs = {};   // bi -> string
    let creatorFeedback = {}; // bi -> { ok, msg } | undefined

    function getProgress(bi) {
        return STATE.bunpouProgress[lessonKey(bi)] || { read: false, practiced: false, accuracy: null, lastStudied: null };
    }

    function markRead(bi) {
        const key = lessonKey(bi);
        const prev = STATE.bunpouProgress[key] || {};
        if (!prev.read) {
            STATE.bunpouProgress[key] = { ...prev, read: true, lastStudied: new Date().toISOString().slice(0,10) };
            STATE.save();
        }
    }

    function getDifficulty(jp) {
        const len = (jp || '').length;
        if (len < 16) return { label: 'Mudah', cls: 'diff-easy' };
        if (len < 30) return { label: 'Sedang', cls: 'diff-medium' };
        return { label: 'Sulit', cls: 'diff-hard' };
    }

    function buildGrammarNotes(b) {
        const title = b.title || '';
        const p = b.p || '';
        const lines = p.split('\n');

        // STRUKTUR: title + first non-example line
        const strukturDesc = lines.filter(l => !l.match(/例[:：]/) && l.trim()).slice(0,2).join('\n') || '—';
        const struktur = `<div style="margin-bottom:8px"><span style="font-family:'Noto Sans JP',sans-serif;font-size:15px;font-weight:700;background:rgba(196,181,253,.12);padding:3px 10px;border-radius:7px;color:var(--accent-primary)">${addFuriganaToGrammarTitle(title.replace(/[（(][^)）]*[)）]/g,'').trim())}</span></div><div>${addFuriganaToText(strukturDesc).replace(/\n/g,'<br>')}</div>`;

        // FUNGSI: extract main explanation (lines before first 例:)
        const beforeExample = [];
        for (const line of lines) {
            if (line.match(/例[:：]/)) break;
            if (line.trim()) beforeExample.push(line.trim());
        }
        const fungsi = beforeExample.map(l => addFuriganaToText(l)).join('<br>') || addFuriganaToText(lines[0] || '');

        // KESALAHAN UMUM: pattern-based hints
        const mistakes = [];
        if (title.includes('て')) mistakes.push('❌ Lupa mengubah kata kerja ke bentuk て sebelum menambahkan akhiran.');
        if (title.includes('た')) mistakes.push('❌ Menggunakan bentuk kamus (る/る) bukan bentuk lampau (た).');
        if (title.includes('ない')) mistakes.push('❌ Lupa menggunakan bentuk negatif ない dengan benar.');
        if (title.includes('に') && title.includes('で')) mistakes.push('❌ Membingungkan partikel に (tujuan/waktu) dan で (tempat aktivitas/alat).');
        if (title.includes('は') && title.match(/が/)) mistakes.push('❌ Mengganti は dengan が atau sebaliknya — keduanya punya fungsi berbeda.');
        if (title.includes('の')) mistakes.push('❌ Menggunakan の di semua konteks, padahal fungsinya spesifik per situasi.');
        if (!mistakes.length) {
            mistakes.push('💡 Perhatikan urutan kata dalam kalimat Jepang: Subjek → Objek → Predikat (SOV).');
            mistakes.push('💡 Partikel tidak boleh dihilangkan meski terasa natural di bahasa Indonesia.');
        }

        // GRAMMAR MIRIP: scan DB for related patterns
        const similar = [];
        const coreTitle = (t) => t.replace(/[〜～]/g,'').replace(/[（(][^)）]*[)）]/g,'').trim().slice(0,6);
        const core = coreTitle(title);
        const allLessons = Object.values(DB).flat();
        for (const l of allLessons) {
            for (const bg of (l.bunpou || [])) {
                if (bg === b) continue;
                const bcore = coreTitle(bg.title || '');
                if (core.length >= 2 && bcore.length >= 2) {
                    let shared = 0;
                    for (const c of core) { if (bcore.includes(c)) shared++; }
                    if (shared >= 2 && similar.length < 3) {
                        similar.push({ title: bg.title, lesson: l.title });
                    }
                }
            }
            if (similar.length >= 3) break;
        }

        return { struktur, fungsi, mistakes, similar };
    }

    function validateCreator(input, b) {
        // Delegate to Grammar Pattern Engine (grammar_validator.js)
        if (typeof GRAMMAR_VALIDATOR !== 'undefined') {
            const result = GRAMMAR_VALIDATOR.validate(input.trim(), b.title || '');
            if (!result) return null;
            // Map new {status, msg} → legacy {ok, msg} shape used by UI
            return { ok: result.status === 'valid', msg: result.msg };
        }
        // Fallback if engine not loaded (should not happen in normal deploy)
        const inp = input.trim();
        if (!inp) return null;
        if (!/[あ-んア-ンー一-龯]/.test(inp)) {
            return { ok: false, msg: '⚠️ Ketik kalimat dalam huruf Jepang (hiragana / katakana / kanji).' };
        }
        return { ok: false, msg: '⚠️ Grammar validator tidak tersedia.' };
    }

    const render = () => {
        container.innerHTML = lesson.bunpou.map((b, bi) => {
            const reibuns = extractReibun(b.p || '');
            const isOpen = openIdx === bi;
            const prog = getProgress(bi);
            const notesTab = openNotesTab[bi] || 'struktur';
            const isCreatorOpen = openCreatorIdx.has(bi);

            // Progress pills row
            const progPills = `
              <div class="grammar-prog-row">
                <span class="grammar-prog-pill${prog.read ? ' gpp-done' : ''}">📖 ${prog.read ? 'Sudah Dibaca' : 'Belum Dibaca'}</span>
                <span class="grammar-prog-pill${prog.practiced ? ' gpp-done' : ''}">✏️ ${prog.practiced ? 'Sudah Latihan' : 'Belum Latihan'}</span>
                ${(prog.accuracy !== null && prog.accuracy !== undefined) ? `<span class="grammar-prog-pill gpp-done">🎯 Akurasi ${prog.accuracy}%</span>` : ''}
                ${prog.lastStudied ? `<span class="grammar-prog-pill gpp-date">📅 ${prog.lastStudied}</span>` : ''}
              </div>`;

            if (!isOpen) {
                return `<div class="grammar-item" id="gi-${bi}">
                  <div class="grammar-header" onclick="toggleGrammar(${bi})">
                    <span>📌 ${addFuriganaToGrammarTitle(b.title)}</span>
                    <div style="display:flex;align-items:center;gap:8px">
                      ${prog.read ? '<span style="font-size:11px;color:var(--accent-verb)">✓ Dibaca</span>' : ''}
                      <span style="font-size:11px;color:var(--text-muted)">▼</span>
                    </div>
                  </div>
                  ${(prog.read || prog.practiced) ? progPills : ''}
                </div>`;
            }

            // Build grammar notes
            const notes = buildGrammarNotes(b);
            let notesContent = '';
            if (notesTab === 'struktur') {
                notesContent = `<div class="bnotes-panel">${notes.struktur}</div>`;
            } else if (notesTab === 'fungsi') {
                notesContent = `<div class="bnotes-panel">${notes.fungsi}</div>`;
            } else if (notesTab === 'kesalahan') {
                notesContent = `<div class="bnotes-panel"><div style="display:flex;flex-direction:column;gap:7px">${notes.mistakes.map(m=>`<div style="padding:7px 10px;background:rgba(248,113,113,.06);border-left:3px solid var(--accent-danger);border-radius:0 8px 8px 0;font-size:12px;line-height:1.6">${m}</div>`).join('')}</div></div>`;
            } else {
                notesContent = notes.similar.length
                    ? `<div class="bnotes-panel">${notes.similar.map(s=>`<div style="padding:8px 10px;background:var(--bg-elevated);border-radius:8px;margin-bottom:6px"><div style="font-size:12px;font-weight:700;color:var(--text-primary)">${addFuriganaToGrammarTitle(s.title)}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHTML(s.lesson)}</div></div>`).join('')}</div>`
                    : `<div class="bnotes-panel" style="color:var(--text-muted);font-size:12px">Tidak ada grammar serupa yang terdeteksi otomatis dari database.</div>`;
            }

            // Creator feedback HTML
            const fb = creatorFeedback[bi];
            const creatorFbHtml = fb !== undefined
                ? `<div class="reibun-creator-feedback ${fb?.ok ? 'rcf-ok' : 'rcf-warn'}">${fb?.msg || ''}</div>`
                : '';

            return `<div class="grammar-item" id="gi-${bi}">
              <div class="grammar-header" onclick="toggleGrammar(${bi})">
                <span>📌 ${addFuriganaToGrammarTitle(b.title)}</span>
                <span style="font-size:11px;color:var(--text-muted);display:inline-block;transform:rotate(180deg)">▼</span>
              </div>
              <div class="grammar-body">
                ${progPills}

                <!-- ① Grammar Notes -->
                <div class="bnotes-tab-row">
                  <button class="bnotes-tab${notesTab==='struktur'?' active':''}" onclick="bNotesTab(${bi},'struktur')">📐 Struktur</button>
                  <button class="bnotes-tab${notesTab==='fungsi'?' active':''}" onclick="bNotesTab(${bi},'fungsi')">💡 Fungsi</button>
                  <button class="bnotes-tab${notesTab==='kesalahan'?' active':''}" onclick="bNotesTab(${bi},'kesalahan')">⚠️ Kesalahan</button>
                  <button class="bnotes-tab${notesTab==='mirip'?' active':''}" onclick="bNotesTab(${bi},'mirip')">🔀 Mirip</button>
                </div>
                <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:12px;min-height:56px">
                  ${notesContent}
                </div>

                <!-- Full explanation collapsible -->
                <details style="margin-bottom:12px">
                  <summary style="font-size:12px;font-weight:700;color:var(--text-muted);cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px">
                    <span>📄</span><span>Penjelasan Lengkap</span><span style="margin-left:auto">›</span>
                  </summary>
                  <div style="font-size:13px;color:var(--text-secondary);line-height:1.95;padding-top:8px;border-top:1px solid var(--border);margin-top:6px">${addFuriganaToText(b.p||'').replace(/\n/g,'<br>')}</div>
                </details>

                <!-- ② Reibun (例文) with difficulty -->
                ${reibuns.length ? `
                <div class="reibun-section">
                  <div class="reibun-header" onclick="toggleReibun(${bi})">
                    <span class="reibun-header-label">📝 例文 — Kalimat Contoh (${reibuns.length})</span>
                    <span class="reibun-toggle-icon${openReibunIdx.has(bi)?' open':''}">▼</span>
                  </div>
                  <div class="reibun-body${openReibunIdx.has(bi)?' open':''}" id="reibun-body-${bi}">
                    ${reibuns.map((r,ri) => {
                        const diff = getDifficulty(r.jp);
                        return `<div class="reibun-item">
                          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                            <span class="reibun-num">例 ${String(ri+1).padStart(2,'0')}</span>
                            <span class="diff-badge ${diff.cls}">${diff.label}</span>
                          </div>
                          <div class="reibun-jp">${addFuriganaToText(r.jp)}。</div>
                          ${r.arti ? `
                          <button class="reibun-reveal-btn" id="reibun-btn-${bi}-${ri}" onclick="toggleReibunArti(${bi},${ri})">👁 Lihat arti</button>
                          <div class="reibun-arti" id="reibun-arti-${bi}-${ri}">🇮🇩 ${escHTML(r.arti)}</div>` : ''}
                        </div>`;
                    }).join('')}
                  </div>
                </div>` : ''}

                <!-- ③ Reibun Creator -->
                <div class="reibun-creator">
                  <div class="reibun-creator-header" onclick="toggleCreator(${bi})">
                    <span style="font-size:15px">✍️</span>
                    <span class="reibun-creator-label">Reibun Creator — Buat Kalimatmu</span>
                    <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${isCreatorOpen?'▲':'▼'}</span>
                  </div>
                  ${isCreatorOpen ? `
                  <div class="reibun-creator-body">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Tulis kalimatmu menggunakan grammar <b style="color:var(--accent-primary)">${escHTML(b.title.split(' ')[0])}</b>:</div>
                    <input class="reibun-creator-input" id="creator-input-${bi}"
                      placeholder="例: わたしは〜" value="${escHTML(creatorInputs[bi] || '')}"
                      oninput="creatorOnInput(${bi}, this.value)"
                      onkeydown="if(event.key==='Enter')creatorCheck(${bi})"
                    />
                    <div style="display:flex;gap:8px">
                      <button class="btn-ghost" style="flex:1;height:40px;font-size:12px" onclick="creatorClear(${bi})">↺ Hapus</button>
                      <button class="btn-primary-full" style="flex:2;height:40px;font-size:13px" onclick="creatorCheck(${bi})">✓ Cek Kalimat</button>
                    </div>
                    ${creatorFbHtml}
                  </div>` : ''}
                </div>

                <!-- Latihan button -->
                <button class="bunpou-drill-btn" style="margin-top:10px" onclick="startBunpouDrill(${bi});markPracticed(${bi})">
                  ✏️ Latihan Bunpou ini — Tebak Partikel & Isi Kalimat
                </button>
              </div>
            </div>`;
        }).join('');
    };

    window.toggleGrammar = (bi) => {
        const wasOpen = openIdx === bi;
        openIdx = wasOpen ? -1 : bi;
        if (!wasOpen) markRead(bi);
        render();
    };
    window.toggleReibun = (bi) => {
        openReibunIdx.has(bi) ? openReibunIdx.delete(bi) : openReibunIdx.add(bi);
        render();
    };
    window.toggleReibunArti = (bi, ri) => {
        const el = document.getElementById(`reibun-arti-${bi}-${ri}`);
        const btn = document.getElementById(`reibun-btn-${bi}-${ri}`);
        if (!el) return;
        el.classList.toggle('show');
        if (btn) btn.textContent = el.classList.contains('show') ? '🙈 Tutup arti' : '👁 Lihat arti';
    };
    window.toggleCreator = (bi) => {
        openCreatorIdx.has(bi) ? openCreatorIdx.delete(bi) : openCreatorIdx.add(bi);
        render();
    };
    window.bNotesTab = (bi, tab) => {
        openNotesTab[bi] = tab;
        render();
    };
    window.creatorOnInput = (bi, val) => { creatorInputs[bi] = val; };
    window.creatorCheck = (bi) => {
        const inp = document.getElementById(`creator-input-${bi}`);
        const val = inp ? inp.value : (creatorInputs[bi] || '');
        creatorInputs[bi] = val;
        creatorFeedback[bi] = validateCreator(val, lesson.bunpou[bi]);
        render();
        // scroll feedback into view
        setTimeout(() => document.getElementById(`creator-input-${bi}`)?.scrollIntoView({block:'nearest'}), 50);
    };
    window.creatorClear = (bi) => {
        creatorInputs[bi] = '';
        creatorFeedback[bi] = undefined;
        render();
    };
    window.startBunpouDrill = (bunpouIdx) => {
        const lesson = getCurrentLesson();
        if (!lesson || !lesson.bunpou[bunpouIdx]) return;
        switchSubTab('renshu');
        startRenshuBunpouFocus(lesson.bunpou[bunpouIdx]);
    };
    window.markPracticed = (bi) => {
        const key = lessonKey(bi);
        const prev = STATE.bunpouProgress[key] || {};
        STATE.bunpouProgress[key] = { ...prev, practiced: true, lastStudied: new Date().toISOString().slice(0,10) };
        STATE.save();
    };
    render();
}

function escHTML(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ═══════════════════════════════════════════════════════════
// HINT TOGGLE (Isi Kalimat & Vocab)
// ═══════════════════════════════════════════════════════════
window.toggleDrillHint = () => {
    const hint = document.getElementById('drill-hint-text');
    const btn  = document.getElementById('hint-eye-btn');
    if (!hint) return;
    const visible = hint.style.display !== 'none';
    hint.style.display = visible ? 'none' : '';
    if (btn) btn.textContent = visible ? '🙈 Lihat Hint' : '🙉 Sembunyikan Hint';
};

// ═══════════════════════════════════════════════════════════
// DAILY VOCAB REVIEW
// ═══════════════════════════════════════════════════════════
let _dvrOffset = 0;
let _dvrPoolCache = [];
let _dvrLastDate = '';

function renderDailyChallenge() {
    const el = document.getElementById('daily-challenge-container');
    if (!el) return;

    const today = new Date().toISOString().slice(0,10);

    // Reset offset jika hari baru (set kata mulai dari awal setiap hari)
    if (_dvrLastDate !== today) {
        _dvrOffset = 0;
        _dvrLastDate = today;
    }

    // Collect all vocab from book1 (free lessons), and book2 if premium
    const allLearnable = [];
    ['book1','book2'].forEach(book => {
        if (book === 'book2' && !isPremiumUser()) return;
        (DB[book] || []).forEach(lesson => {
            (lesson.vocab || []).forEach(v => {
                if (!isLessonLocked || !isLessonLocked(lesson.id)) {
                    allLearnable.push({ ...v, _lessonTitle: lesson.title, _book: book });
                }
            });
        });
    });

    // Prefer learned words for review; fallback to any available
    const learnedVocab = allLearnable.filter(v => STATE.learnedCards && STATE.learnedCards.has(learnedKey(v)));
    const pool = learnedVocab.length >= 4 ? learnedVocab : allLearnable;

    // Update cache pool agar tombol Ganti bisa pakai pool terbaru
    _dvrPoolCache = pool;

    if (!pool.length) {
        el.innerHTML = `<div class="dvr-card"><div class="dvr-header"><span class="dvr-title">\u{1F4D6} Review Vocab Hari Ini</span></div><div class="dvr-empty">Mulai belajar kosakata dulu, lalu kamu bisa review di sini!</div></div>`;
        return;
    }

    // Seed daily selection by date (consistent same day, changes next day)
    const seed = today.split('-').reduce((a,b)=>a*31+parseInt(b),0);
    const seededShuffle = (arr, extraSeed) => {
        const a = [...arr]; let s = ((seed + (extraSeed || 0)) & 0xFFFFFFFF) >>> 0;
        for (let i = a.length-1; i>0; i--) { s=(s*1664525+1013904223)>>>0; const j=s%(i+1); [a[i],a[j]]=[a[j],a[i]]; }
        return a;
    };
    // Gunakan _dvrOffset sebagai extra seed agar set berbeda setiap klik Ganti
    const picks = seededShuffle(pool, _dvrOffset).slice(0, 6);

    el.innerHTML = `
      <div class="dvr-card">
        <div class="dvr-header">
          <span class="dvr-title">\u{1F4D6} Review Vocab Hari Ini</span>
          <span style="font-size:10px;color:var(--text-muted)">${today}</span>
        </div>
        <div class="dvr-subtitle">${learnedVocab.length >= 4 ? 'Ketuk kartu untuk lihat artinya \u2014 uji ingatanmu!' : 'Ketuk kartu untuk lihat artinya. Yuk mulai hafal!'}</div>
        <div class="dvr-words">
          ${picks.map((v, i) => {
            const kanji = v.kanji && v.kanji !== v.kana ? v.kanji : '';
            const reading = v.kana || '';
            const display = kanji || reading;
            const ruby = kanji ? reading : '';
            return `<div class="dvr-chip" id="dvr-chip-${i}" onclick="revealDVR(${i})">
              <div class="dvr-chip-jp">${escHTML(display)}</div>
              ${ruby ? `<div class="dvr-chip-rt">${escHTML(ruby)}</div>` : ''}
              <div class="dvr-chip-meaning">${escHTML(v.arti)}</div>
            </div>`;
          }).join('')}
        </div>
        <button class="dvr-cta" id="dvr-ganti-btn">\u{1F504} Ganti Set Kata Baru</button>
      </div>`;

    window.revealDVR = (i) => {
        const chip = document.getElementById('dvr-chip-' + i);
        if (chip) chip.classList.toggle('revealed');
    };

    // Tombol Ganti: increment offset lalu re-render (offset persisten di luar fungsi)
    const gantiBtn = document.getElementById('dvr-ganti-btn');
    if (gantiBtn) gantiBtn.onclick = () => {
        _dvrOffset = (_dvrOffset + 1337) % 99991; // increment seed, hasilkan shuffle berbeda
        renderDailyChallenge();
    };
}

window.openDailyChallenge = undefined;

// ═══════════════════════════════════════════════════════════
// CHAPTER PICKER
// ═══════════════════════════════════════════════════════════
function renderChapterPicker() {
    const picker = document.getElementById('chapter-picker');
    if (!picker) return;
    const lessons = getLessons(STATE.activeBook);
    // ── ACCESS CONTROL: tandai lesson premium sebagai disabled ──
    picker.innerHTML = lessons.map((l, i) => {
        const locked = !canAccess('lesson', l.id);
        const label = locked ? `\uD83D\uDD12 ${l.title} [PREMIUM]` : `${l.title} \u2014 ${l.topic}`;
        return `<option value="${i}"${i===STATE.currentLesson?' selected':''}${locked?' disabled':''}>${label}</option>`;
    }).join('');
    // Jika lesson aktif terkunci (misal setelah logout), reset ke lesson 1
    const curLesson = lessons[STATE.currentLesson];
    if (curLesson && !canAccess('lesson', curLesson.id)) {
        STATE.currentLesson = 0;
        picker.value = '0';
    }
}

function renderBookPicker() {
    const picker = document.getElementById('book-picker');
    if (picker) picker.value = STATE.activeBook;
}

function switchChapter(idx) {
    // ── ACCESS CONTROL GATE ──
    const lessons = getLessons(STATE.activeBook);
    const lessonId = lessons[idx]?.id;
    if (!_requireAccess('lesson', lessonId, 'switchChapter')) {
        // Reset picker ke lesson yang sebelumnya valid
        const picker = document.getElementById('chapter-picker');
        if (picker) picker.value = String(STATE.currentLesson);
        return;
    }
    STATE.currentLesson = idx;
    STATE.currentCard = 0;
    STATE.save();
    renderFlashcard();
    renderVocabList();
    renderBunpou();
    updateHeaderChapter();
}

function switchBook(book) {
    // Buku II is premium content
    if (book === 'book2' && !isPremiumUser()) {
        showPremiumModal();
        // Revert book picker
        const picker = document.getElementById('book-picker');
        if (picker) picker.value = STATE.activeBook;
        return;
    }
    // ── ACCESS CONTROL: Buku II semua lesson adalah premium (>3) ──
    const firstLesson = (DB[book] || [])[0];
    if (firstLesson && !canAccess('lesson', firstLesson.id)) {
        showPremiumModal();
        // Reset book picker ke pilihan sebelumnya
        const picker = document.getElementById('book-picker');
        if (picker) picker.value = STATE.activeBook;
        return;
    }
    STATE.activeBook = book;
    STATE.currentLesson = 0;
    STATE.currentCard = 0;
    STATE.save();
    renderChapterPicker();
    renderBookPicker();
    renderChapterListHome();
    switchChapter(0);
    navigateTo('materi');
}

// switchBookHome: ganti buku dari halaman Home TANPA navigasi ke materi
function switchBookHome(book) {
    if (book === 'book2' && !isPremiumUser()) {
        showPremiumModal();
        return;
    }
    const firstLesson = (DB[book] || [])[0];
    if (firstLesson && !canAccess('lesson', firstLesson.id)) {
        showPremiumModal();
        return;
    }
    STATE.activeBook = book;
    STATE.currentLesson = 0;
    STATE.currentCard = 0;
    STATE.save();
    renderChapterListHome();
    renderChapterPicker();
    renderBookPicker();
    // Update visual active state tombol buku
    document.querySelectorAll('.book-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById('btn-book' + (book === 'book1' ? '1' : '2'));
    if (activeBtn) activeBtn.classList.add('active');
}

function updateHeaderChapter() {
    const lesson = getCurrentLesson();
    const el = document.getElementById('header-chapter');
    if (el && lesson) el.textContent = lesson.title + ' — ' + lesson.topic;
}

// ═══════════════════════════════════════════════════════════
// CHAPTER LIST (Dashboard)
// ═══════════════════════════════════════════════════════════
function renderChapterListHome() {
    const container = document.getElementById('chapter-list-home');
    if (!container) return;
    const lessons = getLessons(STATE.activeBook);
    container.innerHTML = lessons.map((l, i) => {
        const locked = isLessonLocked(l.id);
        const learnedInLesson = l.vocab.filter(v => STATE.learnedCards.has(learnedKey(v))).length;
        const pct = l.vocab.length ? Math.round((learnedInLesson / l.vocab.length) * 100) : 0;
        const isCurrent = (i === STATE.currentLesson);
        const clickFn = locked ? 'showPremiumModal()' : `openChapterFromDashboard(${i})`;
        return `<div class="chapter-card${isCurrent&&!locked?' active':''}${locked?' locked':''}" onclick="${clickFn}" style="${locked?'opacity:.55;':''}">
          <div class="chapter-num" style="background:${l.color}22;color:${l.color}">${locked?'🔒':l.id}</div>
          <div class="chapter-info">
            <div class="chapter-title">${escHTML(l.title)}</div>
            <div class="chapter-topic">${locked ? '<span style="color:var(--accent-adj);font-size:10px;font-weight:700">👑 PREMIUM</span>' : escHTML(l.topic)+' • '+pct+'% hafal'}</div>
          </div>
          <span class="chapter-arrow">${locked?'›':'›'}</span>
        </div>`;
    }).join('');
}

function openChapterFromDashboard(idx) {
    const lessons = getLessons(STATE.activeBook);
    const lessonId = lessons[idx]?.id;
    // ── ACCESS CONTROL GATE ──
    if (!_requireAccess('chapter', lessonId, 'openChapterFromDashboard')) return;
    STATE.currentLesson = idx;
    STATE.currentCard = 0;
    STATE.currentTab = 'flashcard';
    renderChapterPicker();
    renderFlashcard();
    renderVocabList();
    renderBunpou();
    updateHeaderChapter();
    navigateTo('materi');
    switchSubTab('flashcard');
}

// ═══════════════════════════════════════════════════════════
// SUB TABS (Materi page)
// ═══════════════════════════════════════════════════════════
function switchSubTab(tab) {
    STATE.currentTab = tab;
    ['flashcard','kosakata','bunpou','renshu'].forEach(t => {
        const el = document.getElementById('tab-' + t);
        if (el) el.style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('.sub-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'bunpou') {
        // Gate: if current lesson is premium-locked, renderBunpou handles it internally.
        // Call unconditionally — the hard gate inside renderBunpou shows locked UI.
        renderBunpou();
    }
    if (tab === 'kosakata') renderVocabList(document.getElementById('filter-input')?.value || '');
    if (tab === 'renshu') renderRenshuHome();
}

// ═══════════════════════════════════════════════════════════
// AI SENSEI
// ═══════════════════════════════════════════════════════════
const AI_QUICK = [
    'Jelaskan bunpou utama pelajaran ini',
    'Buat 3 contoh kalimat dari pelajaran ini',
    'Apa perbedaan は dan が?',
    'Kapan pakai て-form?',
    'Bedakan で dan に',
];

function updateAiContext() {
    const lesson = getCurrentLesson();
    const ctx = document.getElementById('ai-context-text');
    if (ctx && lesson) ctx.textContent = `Tanya apapun tentang ${lesson.title} — kosakata, bunpou, atau cara penggunaan.`;
    const qb = document.getElementById('ai-quick-btns');
    if (qb) {
        qb.innerHTML = AI_QUICK.map(q =>
            `<button class="ai-quick-btn" onclick="aiAsk(${JSON.stringify(q)})">${escHTML(q)}</button>`
        ).join('');
    }
}

// ── OpenRouter: Settings helpers ──────────────────────────
// ── AI Sensei via Netlify Function proxy ─────────────────
async function aiAsk(question) {
    const inp = document.getElementById('ai-input');
    const q   = question || (inp ? inp.value : '');
    if (!q.trim()) return;
    if (inp) inp.value = q;

    const model = document.getElementById('ai-model-select')?.value || 'google/gemini-2.0-flash-001';

    document.getElementById('ai-loading').style.display = '';
    document.getElementById('ai-answer').style.display  = 'none';

    const lesson = getCurrentLesson();
    const sys = `Kamu adalah sensei bahasa Jepang yang membantu pelajar Indonesia belajar Minna no Nihongo.
Pelajar sedang belajar ${lesson.title} (${lesson.topic}).
Pola tata bahasa pelajaran ini: ${(lesson.bunpou||[]).map(b=>b.title).join(', ')}.
Berikan jawaban dalam bahasa Indonesia. Sertakan contoh kalimat Jepang beserta artinya. Gunakan format yang rapi dan mudah dibaca.`;

    try {
        const res = await fetch('/api/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: sys },
                    { role: 'user',   content: q   }
                ]
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const ans = data?.choices?.[0]?.message?.content || 'Maaf, tidak bisa menjawab saat ini.';
        document.getElementById('ai-answer-text').textContent = ans;
        document.getElementById('ai-answer').style.display = '';
    } catch(e) {
        document.getElementById('ai-answer-text').textContent = '❌ ' + (e.message || 'Terjadi kesalahan koneksi.');
        document.getElementById('ai-answer').style.display = '';
    }
    document.getElementById('ai-loading').style.display = 'none';
    if (inp) inp.value = '';
}

// ═══════════════════════════════════════════════════════════
// QUIZ
// ═══════════════════════════════════════════════════════════
function startQuiz() {
    // ── ACCESS CONTROL GATE — 'all' means premium content included ──
    if (!isPremium()) { showPremiumModal(); return; }
    const allVocab = getAllVocab();
    if (allVocab.length < 4) return;
    const pool = shuffle(allVocab).slice(0, 10);
    STATE.quizData = pool.map(v => {
        const wrong = shuffle(allVocab.filter(x => x.arti !== v.arti)).slice(0, 3).map(x => x.arti);
        return { ...v, opts: shuffle([v.arti, ...wrong]) };
    });
    STATE.quizIndex = 0;
    STATE.quizScore = 0;
    restoreQuizUI();
    renderQuizQuestion();
}

function restoreQuizUI() {
    const wrap = document.getElementById('quiz-card-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <button class="btn-ghost" style="font-size:11px;padding:5px 10px" onclick="backToQuizChapterSelect()">← Ganti Bab</button>
        <span class="score-badge" id="quiz-score-badge">Soal 1</span>
        <span style="font-size:13px;color:var(--text-muted)">✓ <strong id="quiz-score-num" style="color:var(--text-primary)">0</strong></span>
      </div>
      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" id="quiz-prog-fill" style="width:0%"></div>
      </div>
      <div class="quiz-question" id="quiz-question-wrap">
        <div class="quiz-jp" id="quiz-jp">—</div>
        <div class="quiz-subtext" id="quiz-sub">Apa arti kata ini?</div>
      </div>
      <div class="quiz-options" id="quiz-options"></div>`;
}

function backToQuizChapterSelect() {
    const sel = document.getElementById('quiz-chapter-select');
    const wrap = document.getElementById('quiz-card-wrap');
    if (sel) sel.style.display = '';
    if (wrap) wrap.style.display = 'none';
}

function renderQuizQuestion() {
    if (STATE.quizIndex >= STATE.quizData.length) { renderQuizResult(); return; }
    const q = STATE.quizData[STATE.quizIndex];
    const badgeEl = document.getElementById('quiz-score-badge');
    if (badgeEl) badgeEl.textContent = `Soal ${STATE.quizIndex+1} / ${STATE.quizData.length}`;
    const scoreEl = document.getElementById('quiz-score-num');
    if (scoreEl) scoreEl.textContent = STATE.quizScore;
    const progFill = document.getElementById('quiz-prog-fill');
    if (progFill) progFill.style.width = (STATE.quizIndex/STATE.quizData.length*100)+'%';
    const jpEl = document.getElementById('quiz-jp');
    if (jpEl) {
        if (q.kanji && q.kana) {
            // Respect furigana toggle — show ruby only when furigana is ON
            if (STATE.showFurigana) {
                jpEl.innerHTML = `<ruby>${escHTML(q.kanji)}<rt>${escHTML(q.kana)}</rt></ruby>`;
            } else {
                jpEl.textContent = q.kanji;
            }
        } else {
            jpEl.textContent = q.kana || '—';
        }
    }
    const subEl = document.getElementById('quiz-sub');
    // Respect romaji toggle — only show romaji hint when romaji is ON
    if (subEl) subEl.textContent = (q.romaji && STATE.showRomaji) ? `(${q.romaji})` : 'Apa arti kata ini?';
    const optsEl = document.getElementById('quiz-options');
    if (optsEl) {
        optsEl.innerHTML = q.opts.map(opt =>
            `<button class="quiz-option" onclick="handleQuizAnswer(this,'${escAttr(opt)}','${escAttr(q.arti)}')">${escHTML(opt)}</button>`
        ).join('');
    }
}

function escAttr(s) { return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

function playQuizSound(correct) {
    if (!window._soundOn) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        if (correct) {
            osc.frequency.setValueAtTime(523, ctx.currentTime);       // C5
            osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1); // E5
            osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2); // G5
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
        } else {
            osc.frequency.setValueAtTime(330, ctx.currentTime);
            osc.frequency.setValueAtTime(220, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
        }
    } catch(e) {}
}

function handleQuizAnswer(btn, selected, correct) {
    const optsEl = document.getElementById('quiz-options');
    if (!optsEl) return;
    optsEl.querySelectorAll('.quiz-option').forEach(b => b.onclick = null);
    const isRight = selected === correct;
    optsEl.querySelectorAll('.quiz-option').forEach(b => {
        if (b.textContent === correct) b.classList.add('correct');
        else if (b === btn && !isRight) b.classList.add('wrong');
    });
    if (isRight) STATE.quizScore++;
    playQuizSound(isRight);
    setTimeout(() => { STATE.quizIndex++; renderQuizQuestion(); }, 900);
}

function renderQuizResult() {
    const score = STATE.quizScore;
    const total = STATE.quizData.length;
    const emoji = score >= 9 ? '🏆' : score >= 7 ? '🎯' : score >= 5 ? '💪' : '📚';
    const msg   = score >= 9 ? 'Luar biasa! Sangat bagus!' :
                  score >= 7 ? 'Kerja bagus! Terus berlatih!' :
                  score >= 5 ? 'Bagus! Ulangi yang keliru ya.' :
                               'Semangat! Pelajari flashcard dulu.';
    const wrap = document.getElementById('quiz-card-wrap');
    if (wrap) {
        wrap.innerHTML = `
          <div class="quiz-result">
            <span class="result-emoji">${emoji}</span>
            <div class="result-score">${score}<span style="font-size:22px;color:var(--text-muted)">/${total}</span></div>
            <div class="result-label">${escHTML(msg)}</div>
            <div style="height:8px;background:var(--border-strong);border-radius:99px;overflow:hidden;margin-bottom:20px">
              <div style="height:100%;width:${Math.round((score/total)*100)}%;
                background:${score>=7?'var(--accent-success)':score>=5?'var(--accent-adj)':'var(--accent-danger)'};
                border-radius:99px;transition:width .6s ease"></div>
            </div>
            <button class="btn-primary-full" onclick="startVocabQuiz()">🔄 Coba Lagi</button>
            <button class="btn-ghost" style="margin-top:8px;align-self:center" onclick="backToQuizChapterSelect()">← Pilih Bab Lain</button>
          </div>`;
    }
}

// ═══════════════════════════════════════════════════════════
// KANA TRAINER
// ═══════════════════════════════════════════════════════════
function updateKanaStats() {
    const container = document.getElementById('kana-stats');
    if (!container) return;
    const allKana = Object.values(KANA_D).flatMap(s => Object.values(s).flat());
    const mastered = allKana.filter(x => kanaIsHafal(x.c)).length;
    const seen = Object.keys(STATE.kanaProg).length;
    const cards = kanaGetCards(STATE.kanaScript, STATE.kanaCats).length;
    container.innerHTML = [
        { val: mastered, label: 'Hafal', color: 'var(--accent-verb)' },
        { val: seen, label: 'Pernah Dilihat', color: 'var(--accent-adj)' },
        { val: cards, label: 'Kartu Aktif', color: 'var(--accent-primary)' },
    ].map(s => `<div class="stat-card">
      <div class="stat-value" style="color:${s.color}">${s.val}</div>
      <div class="stat-label">${escHTML(s.label)}</div>
    </div>`).join('');
}

function startKanaMode(mode) {
    const panel = document.getElementById('kana-panel');
    if (!panel) return;
    panel.style.display = '';
    const cards = kanaGetCards(STATE.kanaScript, STATE.kanaCats);
    if (!cards.length) { panel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔤</div><div class="empty-state-text">Tidak ada kartu. Pilih aksara dan kategori.</div></div>'; return; }

    if (mode === 'flash') renderKanaFlash(panel, cards);
    else if (mode === 'quiz-choice') renderKanaQuiz(panel, cards, 'choice');
    else if (mode === 'quiz-type') renderKanaQuiz(panel, cards, 'type');
    else if (mode === 'chart') renderKanaChart(panel);
    else if (mode === 'progress') renderKanaProgress(panel);
}

function renderKanaFlash(panel, cards) {
    const deck = shuffle(cards);
    let idx = 0;
    let flipped = false;
    const render = () => {
        const card = deck[idx % deck.length];
        const isHafal = !!(STATE.kanaHafal && STATE.kanaHafal[card.c]);
        panel.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <button class="btn-ghost" onclick="closeKanaPanel()">← Kembali</button>
            <span style="font-size:13px;color:var(--text-muted)">${idx%deck.length+1}/${deck.length}</span>
          </div>
          <div style="height:4px;background:var(--border-strong);border-radius:99px;overflow:hidden;margin-bottom:14px">
            <div style="width:${((idx%deck.length)/deck.length)*100}%;height:100%;background:var(--accent-kana);border-radius:99px;transition:width .3s"></div>
          </div>
          <div class="kana-flashcard" id="kana-fc" onclick="kanaFlip()">
            <span class="card-known-badge" style="display:${isHafal?'block':'none'}">✓ Hafal</span>
            <div class="kana-big">${card.c}</div>
            ${flipped ? `<div class="kana-rom-reveal">${card.r}</div>` : ''}
            <div style="position:absolute;bottom:12px;font-size:10px;color:var(--text-muted)">${flipped?'← ketuk kembali':'ketuk untuk lihat romaji →'}</div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn-nav" onclick="kfPrev()" style="flex:1">‹ Prev</button>
            <button class="btn-mark-learned${isHafal?' is-learned':''}" onclick="kanaToggleHafal()" style="flex:2">${isHafal?'✓ Sudah Hafal':'○ Tandai Hafal'}</button>
            <button class="btn-nav" onclick="kfNext()" style="flex:1">Next ›</button>
          </div>`;
    };
    window.kanaFlip = () => { flipped = !flipped; render(); };
    // v3.0.11: manual "Sudah Hafal" toggle — marks/unmarks the current kana
    // as memorized and updates the Hafal counter shown above the trainer.
    window.kanaToggleHafal = () => {
        const card = deck[idx % deck.length];
        if (!STATE.kanaHafal) STATE.kanaHafal = {};
        if (STATE.kanaHafal[card.c]) delete STATE.kanaHafal[card.c];
        else STATE.kanaHafal[card.c] = true;
        STATE.save();
        updateKanaStats();
        render();
    };
    window.kfNext = () => { flipped = false; idx++; render(); };
    window.kfPrev = () => { flipped = false; idx = Math.max(0, idx - 1); render(); };
    window.kfShuffle = () => { flipped = false; idx = 0; deck.sort(()=>Math.random()-.5); render(); };
    render();
}

function renderKanaQuiz(panel, cards, mode) {
    const deck = shuffle(cards);
    let idx = 0, ok = 0, no = 0, sel = null, inp = '', checked = false;
    const allR = deck.map(x => x.r);
    const getOpts = (card) => {
        const wrong = shuffle([...new Set(allR.filter(r => r !== card.r))]).slice(0,3);
        return shuffle([card.r, ...wrong]);
    };
    // Pre-generate opts for each card so shuffle order stays stable on re-render
    const deckOpts = deck.map(card => getOpts(card));
    const renderKanaQuizResult = () => {
        const total = deck.length;
        const pct = total ? Math.round((ok/total)*100) : 0;
        const emoji = pct >= 90 ? '🏆' : pct >= 70 ? '🎯' : pct >= 50 ? '💪' : '📚';
        const msg   = pct >= 90 ? 'Luar biasa! Hafal semua!' :
                      pct >= 70 ? 'Kerja bagus! Terus berlatih!' :
                      pct >= 50 ? 'Bagus! Ulangi yang keliru ya.' :
                                   'Semangat! Pelajari flashcard dulu.';
        const modeFn = mode === 'choice' ? 'quiz-choice' : 'quiz-type';
        panel.innerHTML = `
          <div class="quiz-result">
            <span class="result-emoji">${emoji}</span>
            <div class="result-score">${ok}<span style="font-size:22px;color:var(--text-muted)">/${total}</span></div>
            <div class="result-label">${escHTML(msg)}</div>
            <div style="height:8px;background:var(--border-strong);border-radius:99px;overflow:hidden;margin-bottom:20px">
              <div style="height:100%;width:${pct}%;
                background:${pct>=70?'var(--accent-success)':pct>=50?'var(--accent-adj)':'var(--accent-danger)'};
                border-radius:99px;transition:width .6s ease"></div>
            </div>
            <button class="btn-primary-full" style="background:var(--accent-kana);box-shadow:none" onclick="startKanaMode('${modeFn}')">🔄 Ulangi</button>
            <button class="btn-ghost" style="margin-top:8px;align-self:center" onclick="closeKanaPanel()">← Kembali</button>
          </div>`;
    };
    const render = () => {
        // FIX v3.0.9: previously idx kept incrementing forever and wrapped
        // around via `idx % deck.length`, so the quiz never ended — ok/no
        // counters could exceed the deck size (e.g. 211/208) and cards from
        // the start of the deck silently got an extra updateKanaProg() bump
        // on every extra lap. Show a result screen once the deck is done.
        if (idx >= deck.length) { renderKanaQuizResult(); return; }
        const card = deck[idx % deck.length];
        const opts = deckOpts[idx % deck.length];
        if (mode === 'choice') {
            panel.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <button class="btn-ghost" onclick="closeKanaPanel()">← Kembali</button>
                <div style="display:flex;gap:14px;font-size:13px;color:var(--text-muted)">
                  <span>✓ <b style="color:var(--text-primary)">${ok}</b></span>
                  <span>✗ <b style="color:var(--text-primary)">${no}</b></span>
                </div>
              </div>
              <div style="height:4px;background:var(--border-strong);border-radius:99px;overflow:hidden;margin-bottom:14px">
                <div style="width:${((idx%deck.length)/deck.length)*100}%;height:100%;background:var(--accent-kana);border-radius:99px"></div>
              </div>
              <div style="text-align:center;padding:20px 0 10px">
                <div style="font-size:88px;font-weight:300;font-family:'Noto Sans JP',serif;color:var(--text-primary);line-height:1">${card.c}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-transform:uppercase;letter-spacing:.1em">${card.script} · ${card.cat}</div>
              </div>
              <div class="kana-quiz-opts">
                ${opts.map(opt => {
                    let cls = 'kana-quiz-opt';
                    if (sel) { if (opt === card.r) cls += ' k-correct'; else if (opt === sel) cls += ' k-wrong'; }
                    return `<button class="${cls}" onclick="kqChoice('${escAttr(opt)}','${escAttr(card.r)}')" ${sel?'disabled':''}>${escHTML(opt)}</button>`;
                }).join('')}
              </div>`;
        } else {
            panel.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <button class="btn-ghost" onclick="closeKanaPanel()">← Kembali</button>
                <div style="display:flex;gap:14px;font-size:13px;color:var(--text-muted)">
                  <span>✓ <b style="color:var(--text-primary)">${ok}</b></span>
                  <span>✗ <b style="color:var(--text-primary)">${no}</b></span>
                </div>
              </div>
              <div style="text-align:center;padding:20px 0 10px">
                <div style="font-size:88px;font-weight:300;font-family:'Noto Sans JP',serif;color:var(--text-primary);line-height:1">${card.c}</div>
              </div>
              <input class="kana-type-input${checked?(inp.toLowerCase()===card.r?' k-ok':' k-no'):''}" id="kana-type-inp" value="${escAttr(inp)}" placeholder="Ketik romaji..." autocomplete="off" autocorrect="off" oninput="kqTypeInput(this.value)" onkeydown="if(event.key==='Enter')kqTypeCheck()" />
              ${checked ? `<div style="text-align:center;margin-top:10px;font-size:15px;font-weight:700;color:${inp.toLowerCase()===card.r?'var(--accent-verb)':'var(--accent-danger)'}">
                ${inp.toLowerCase()===card.r?'✓ Benar!':'✗ Jawaban: '+escHTML(card.r)}
              </div>` : ''}
              <button class="btn-primary-full" style="margin-top:12px;background:var(--accent-kana);box-shadow:none" onclick="kqTypeCheck()">${checked?'Lanjut →':'Cek Jawaban'}</button>`;
            // FIX v3.0.11: tapping "Cek Jawaban"/"Lanjut →" moves focus to the
            // button, which dismisses the mobile keyboard. Re-focus the text
            // input right after re-rendering so the keyboard stays open and
            // the user can keep typing/pressing Enter without manually
            // tapping the field again each round.
            requestAnimationFrame(() => {
                const inpEl = document.getElementById('kana-type-inp');
                if (inpEl) {
                    inpEl.focus();
                    const len = inpEl.value.length;
                    inpEl.setSelectionRange(len, len);
                }
            });
        }
    };
    window.kqChoice = (opt, correct) => {
        if (sel) return;
        sel = opt;
        const got = opt === correct;
        if (got) ok++; else no++;
        updateKanaProg(deck[idx%deck.length].c, got);
        playQuizSound(got);
        render();
        setTimeout(() => { sel = null; idx++; render(); }, 900);
    };
    window.kqTypeInput = (v) => { inp = v; };
    window.kqTypeCheck = () => {
        const card = deck[idx%deck.length];
        if (checked) { checked = false; inp = ''; sel = null; idx++; render(); return; }
        checked = true;
        const got = inp.trim().toLowerCase() === card.r.toLowerCase();
        if (got) ok++; else no++;
        updateKanaProg(card.c, got);
        playQuizSound(got);
        render();
    };
    render();
}

function renderKanaChart(panel) {
    let tab = 'hiragana';
    const catNames = { basic:'Dasar', dakuten:'Dakuten (bersuara)', combo:'Kombinasi' };
    const cols = { basic: 5, dakuten: 5, combo: 3 };
    const render = () => {
        panel.innerHTML = `
          <button class="btn-ghost" onclick="closeKanaPanel()" style="margin-bottom:14px">← Kembali</button>
          <div class="kana-tab-row" style="margin-bottom:14px">
            <button class="kana-tab${tab==='hiragana'?' active':''}" onclick="kcTab('hiragana')">Hiragana</button>
            <button class="kana-tab${tab==='katakana'?' active':''}" onclick="kcTab('katakana')">Katakana</button>
          </div>
          ${Object.entries(KANA_D[tab]).map(([cat, items]) => `
            <div style="margin-bottom:18px">
              <div class="kana-cat-label"><span>${catNames[cat]}</span></div>
              <div class="kana-grid${cat==='combo'?' combo-grid':''}">
                ${items.map(x => `<div class="kana-cell">
                  <div class="kana-cell-char">${x.c}</div>
                  <div class="kana-cell-rom">${x.r}</div>
                </div>`).join('')}
              </div>
            </div>`).join('')}`;
    };
    window.kcTab = (t) => { tab = t; render(); };
    render();
}

function renderKanaProgress(panel) {
    let tab = 'hiragana';
    const catNames = { basic:'Dasar', dakuten:'Dakuten (bersuara)', combo:'Kombinasi' };
    const cols = { basic: 5, dakuten: 5, combo: 3 };
    const render = () => {
        panel.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <button class="btn-ghost" onclick="closeKanaPanel()">← Kembali</button>
            <button class="btn-ghost" onclick="if(confirm('Reset progress kana?')){STATE.kanaProg={};STATE.kanaHafal={};STATE.save();updateKanaStats();renderKanaProgress(document.getElementById('kana-panel'))}">Reset</button>
          </div>
          <div class="kana-tab-row" style="margin-bottom:14px">
            <button class="kana-tab${tab==='hiragana'?' active':''}" onclick="kpTab('hiragana')">Hiragana</button>
            <button class="kana-tab${tab==='katakana'?' active':''}" onclick="kpTab('katakana')">Katakana</button>
          </div>
          ${Object.entries(KANA_D[tab]).map(([cat, items]) => {
            const mst = items.filter(x => kanaIsHafal(x.c)).length;
            return `<div style="margin-bottom:18px">
              <div class="kana-cat-label"><span>${catNames[cat]}</span><span>${mst}/${items.length}</span></div>
              <div class="kana-grid${cat==='combo'?' combo-grid':''}">
                ${items.map(x => {
                    const p = STATE.kanaProg[x.c];
                    const m = kanaIsHafal(x.c);
                    const s = p && p.seen > 0 && !m;
                    return `<div class="kana-cell${m?' mastered':s?' seen':''}">
                      <div class="kana-cell-char">${x.c}</div>
                      <div class="kana-cell-rom">${x.r}</div>
                    </div>`;
                }).join('')}
              </div>
            </div>`;
          }).join('')}`;
    };
    window.kpTab = (t) => { tab = t; render(); };
    render();
}

function updateKanaProg(c, got) {
    const prev = STATE.kanaProg[c] || { seen: 0, correct: 0, streak: 0 };
    STATE.kanaProg[c] = {
        seen: prev.seen + 1,
        correct: prev.correct + (got ? 1 : 0),
        // FIX v3.0.9: reset streak on a wrong answer, increment on correct.
        // Used by kanaIsMastered() so consistent recent performance is
        // recognized even if old wrong answers still drag the lifetime ratio down.
        streak: got ? (prev.streak || 0) + 1 : 0,
    };
    STATE.save();
    updateKanaStats();
}

function closeKanaPanel() {
    const panel = document.getElementById('kana-panel');
    if (panel) panel.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════
function renderGlobalSearch(q) {
    const container = document.getElementById('global-search-results');
    if (!container) return;
    if (!q) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">Ketik untuk mulai mencari kosakata di semua pelajaran.</div></div>';
        return;
    }
    const allLessons = Object.values(DB).flat();
    const allVocab = allLessons.flatMap(l => l.vocab.map(v => ({...v, lessonTitle: l.title, lessonId: l.id})));
    const ql = q.toLowerCase();
    const results = allVocab.filter(v =>
        v.kana.includes(q) || v.arti.toLowerCase().includes(ql) ||
        (v.kanji && v.kanji.includes(q)) || (v.romaji && v.romaji.toLowerCase().includes(ql))
    ).slice(0, 40);

    if (!results.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">😕</div><div class="empty-state-text">Tidak ditemukan untuk "${escHTML(q)}"</div></div>`;
        return;
    }
    container.innerHTML = results.map(v => `
      <div class="vocab-item" style="cursor:pointer" onclick="goToLesson(${v.lessonId})">
        <div class="vocab-japanese">
          <div class="vocab-kana">${v.kanji ? `<ruby>${escHTML(v.kanji)}<rt>${escHTML(v.kana)}</rt></ruby>` : escHTML(v.kana)}</div>
          <div class="vocab-romaji">${STATE.showRomaji ? escHTML(v.romaji||'') : ''}</div>
        </div>
        <div class="vocab-divider"></div>
        <div style="flex:1">
          <div class="vocab-meaning">${escHTML(v.arti)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escHTML(v.lessonTitle)}</div>
        </div>
      </div>`).join('');
}

function goToLesson(lessonId) {
    // Find which book and index this lesson belongs to
    let found = false;
    ['book1','book2'].forEach(book => {
        if (found) return;
        const lessons = getLessons(book);
        const idx = lessons.findIndex(l => l.id === lessonId);
        if (idx >= 0) {
            STATE.activeBook = book;
            STATE.currentLesson = idx;
            STATE.currentCard = 0;
            STATE.currentTab = 'kosakata';
            found = true;
            renderChapterPicker();
            renderBookPicker();
            renderFlashcard();
            renderVocabList();
            updateHeaderChapter();
            navigateTo('materi');
            switchSubTab('kosakata');
        }
    });
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
const KANJI=[
// ── SET 1 ──
[1,1,'一','いち','satu'],
[2,1,'二','に','dua'],
[3,1,'三','さん','tiga'],
[4,1,'四','よん・し','empat'],
[5,1,'五','ご','lima'],
[6,1,'六','ろく','enam'],
[7,1,'七','なな・しち','tujuh'],
[8,1,'八','はち','delapan'],
[9,1,'九','きゅう','sembilan'],
[10,1,'十','じゅう','sepuluh'],
[11,1,'月曜日','げつようび','Senin'],
[12,1,'火曜日','かようび','Selasa'],
[13,1,'水曜日','すいようび','Rabu'],
[14,1,'木曜日','もくようび','Kamis'],
[15,1,'金曜日','きんようび','Jumat'],
[16,1,'土曜日','どようび','Sabtu'],
[17,1,'日曜日','にちようび','Minggu'],
[18,1,'四月','しがつ','April'],
[19,1,'九月','くがつ','September'],
[20,1,'七月','しちがつ','Juli'],
[21,1,'一つ','ひとつ','1 buah'],
[22,1,'一人','ひとり','1 orang'],
[23,1,'二人','ふたり','2 orang'],
[24,1,'四人','よにん','4 orang'],
[25,1,'四時','よじ','jam 4'],
[26,1,'一日','ついたち','tanggal 1'],
[27,1,'二日','ふつか','tanggal 2'],
[28,1,'日','ひ','hari'],
[29,1,'月','つき','bulan'],
[30,1,'年','とし','tahun'],
[31,1,'五年','ごねん','5 tahun'],
[32,1,'水','みず','air'],
[33,1,'木','き','pohon'],
[34,1,'お金','おかね','uang'],
[35,1,'土','つち','tanah'],
[36,1,'火','ひ','api'],
[37,1,'一ヶ月','いっかげつ','satu bulan'],
[38,1,'五ヶ月','ごかげつ','lima bulan'],
[39,1,'今','いま','sekarang'],
[40,1,'今月','こんげつ','bulan ini'],
[41,1,'今年','ことし','tahun ini'],
[42,1,'今日','きょう','hari ini'],
[43,1,'昨日','きのう','kemarin'],
[44,1,'一分','いっぷん','1 menit'],
[45,1,'何曜日','なんようび','hari apa'],
[46,1,'何日','なんにち','tanggal berapa'],
[47,1,'何月','なんがつ','bulan apa'],
[48,1,'何年','なんねん','berapa tahun'],
[49,1,'何','なん・なに','apa'],
[50,1,'何人','なんにん','berapa orang'],
[51,1,'何時','なんじ','jam berapa'],
[52,1,'何分','なんふん','menit berapa'],
[53,1,'中','なか','dalam, tengah'],
[54,1,'外','そと','luar'],
[55,1,'後ろ','うしろ','belakang'],
[56,1,'前','まえ','depan, sebelum'],
[57,1,'左','ひだり','kiri'],
[58,1,'右','みぎ','kanan'],
[59,1,'手','て','tangan'],
[60,1,'口','くち','mulut'],
[61,1,'耳','みみ','telinga'],
[62,1,'紙','かみ','kertas'],
[63,1,'下','した','bawah'],
[64,1,'上','うえ','atas'],
[65,1,'毎日','まいにち','setiap hari'],
[66,1,'毎月','まいつき','setiap bulan'],
[67,1,'毎年','まいとし','setiap tahun'],
[68,1,'以外','いがい','selain'],
[69,1,'朝','あさ','pagi hari'],
[70,1,'朝食','ちょうしょく','sarapan'],
[71,1,'今朝','けさ','tadi pagi'],
[72,1,'昼','ひる','siang'],
[73,1,'今夜','こんや','malam ini'],
[74,1,'夜','よる','malam'],
[75,1,'夜中','よなか','tengah malam'],
[76,1,'昼食','ちゅうしょく','makan siang'],
[77,1,'間','あいだ','antara'],
[78,1,'間に合う','まにあう','tepat waktu'],
[79,1,'中','なか','tengah'],
[80,1,'一年中','いちねんじゅう','sepanjang tahun'],
[81,1,'国','くに','negara'],
[82,1,'外国','がいこく','luar negeri'],
[83,1,'中国','ちゅうごく','Cina'],
[84,1,'下手','へた','tidak mahir'],
[85,1,'上手','じょうず','pandai'],
[86,1,'午後','ごご','sore'],
[87,1,'後','あと','setelah, nanti'],
[88,1,'午前','ごぜん','pagi (a.m.)'],
// ── SET 2 ──
[89,2,'三分','さんぷん','3 menit'],
[90,2,'上着','うわぎ','jaket'],
[91,2,'電車','でんしゃ','kereta'],
[92,2,'車','くるま','mobil'],
[93,2,'大きい','おおきい','besar'],
[94,2,'小さい','ちいさい','kecil'],
[95,2,'新しい','あたらしい','baru'],
[96,2,'百','ひゃく','seratus'],
[97,2,'千','せん','seribu'],
[98,2,'万','まん','sepuluh ribu'],
[99,2,'大学','だいがく','universitas'],
[100,2,'北','きた','utara'],
[101,2,'南','みなみ','selatan'],
[102,2,'東','ひがし','timur'],
[103,2,'西','にし','barat'],
[104,2,'道','みち','jalan'],
[105,2,'雨','あめ','hujan'],
[106,2,'駅','えき','stasiun'],
[107,2,'高い','たかい','mahal, tinggi'],
[108,2,'安い','やすい','murah'],
[109,2,'長い','ながい','panjang'],
[110,2,'来週','らいしゅう','minggu depan'],
[111,2,'今週','こんしゅう','minggu ini'],
[112,2,'先週','せんしゅう','minggu lalu'],
[113,2,'空','そら','langit'],
[114,2,'山','やま','gunung'],
[115,2,'川','かわ','sungai'],
[116,2,'病院','びょういん','rumah sakit'],
[117,2,'夕方','ゆうがた','sore hari'],
[118,2,'体','からだ','badan'],
[119,2,'休み','やすみ','libur'],
[120,2,'行く','いく','pergi'],
[121,2,'帰る','かえる','pulang'],
[122,2,'来る','くる','datang'],
[123,2,'古い','ふるい','lama, tua'],
[124,2,'名前','なまえ','nama'],
[125,2,'生活','せいかつ','kehidupan'],
[126,2,'入る','はいる','masuk'],
[127,2,'人','ひと','orang'],
[128,2,'時間','じかん','waktu'],
[129,2,'花','はな','bunga'],
[130,2,'少し','すこし','sedikit'],
[131,2,'買い物','かいもの','belanjaan'],
[132,2,'物','もの','barang'],
[133,2,'会う','あう','bertemu'],
[134,2,'買う','かう','membeli'],
[135,2,'書く','かく','menulis'],
[136,2,'聞く','きく','mendengar'],
[137,2,'取る','とる','mengambil'],
[138,2,'食べる','たべる','makan'],
[139,2,'飲む','のむ','minum'],
[140,2,'話す','はなす','berbicara'],
[141,2,'言う','いう','berkata'],
[142,2,'新聞','しんぶん','koran'],
[143,2,'電気','でんき','lampu, listrik'],
[144,2,'天気','てんき','cuaca'],
[145,2,'高校','こうこう','SMA'],
[146,2,'中学校','ちゅうがっこう','SMP'],
[147,2,'小学校','しょうがっこう','SD'],
[148,2,'海','うみ','laut'],
[149,2,'出す','だす','mengeluarkan'],
[150,2,'早い','はやい','cepat, awal'],
[151,2,'映画','えいが','film'],
[152,2,'会社','かいしゃ','perusahaan'],
[153,2,'先生','せんせい','guru'],
[154,2,'先','さき','duluan, ujung'],
[155,2,'生まれる','うまれる','lahir'],
[156,2,'会話','かいわ','percakapan'],
[157,2,'大切','たいせつ','penting'],
[158,2,'母','はは','ibu (milik sendiri)'],
[159,2,'お母さん','おかあさん','ibu (orang lain)'],
[160,2,'父','ちち','ayah (milik sendiri)'],
[161,2,'お父さん','おとうさん','ayah (orang lain)'],
[162,2,'兄','あに','abang (milik sendiri)'],
[163,2,'お兄さん','おにいさん','abang (orang lain)'],
[164,2,'姉','あね','kakak pr (milik sendiri)'],
[165,2,'お姉さん','おねえさん','kakak pr (orang lain)'],
[166,2,'弟','おとうと','adik laki-laki'],
[167,2,'妹','いもうと','adik perempuan'],
[168,2,'男の子','おとこのこ','anak laki-laki'],
[169,2,'女','おんな','perempuan'],
[170,2,'子供','こども','anak-anak'],
[171,2,'多い','おおい','banyak'],
[172,2,'来年','らいねん','tahun depan'],
[173,2,'去年','きょねん','tahun lalu'],
[174,2,'先月','せんげつ','bulan lalu'],
[175,2,'来月','らいげつ','bulan depan'],
[176,2,'半分','はんぶん','setengah'],
// ── SET 3 ──
[177,3,'一週間','いっしゅうかん','1 minggu'],
[178,3,'学校','がっこう','sekolah'],
[179,3,'同じ','おなじ','sama'],
[180,3,'円','えん','yen'],
[181,3,'白い','しろい','putih'],
[182,3,'赤い','あかい','merah'],
[183,3,'肉','にく','daging'],
[184,3,'店','みせ','toko'],
[185,3,'足','あし','kaki'],
[186,3,'待つ','まつ','menunggu'],
[187,3,'本','ほん','buku'],
[188,3,'机','つくえ','meja'],
[189,3,'魚','さかな','ikan'],
[190,3,'社長','しゃちょう','direktur'],
[191,3,'長男','ちょうなん','putra sulung'],
[192,3,'長女','ちょうじょ','putri sulung'],
[193,3,'高校生','こうこうせい','siswa SMA'],
[194,3,'安全','あんぜん','aman'],
[195,3,'有名','ゆうめい','terkenal'],
[196,3,'入り口','いりぐち','pintu masuk'],
[197,3,'出口','でぐち','pintu keluar'],
[198,3,'目','め','mata'],
[199,3,'友達','ともだち','teman'],
[200,3,'友人','ゆうじん','sahabat'],
[201,3,'私','わたし','saya'],
[202,3,'富士山','ふじさん','Gunung Fuji'],
[203,3,'元気','げんき','sehat, bersemangat'],
[204,3,'病気','びょうき','sakit'],
[205,3,'気持ち','きもち','perasaan'],
[206,3,'漢字','かんじ','tulisan kanji'],
[207,3,'英語','えいご','bahasa Inggris'],
[208,3,'日本語','にほんご','bahasa Jepang'],
[209,3,'歌う','うたう','bernyanyi'],
[210,3,'歌','うた','lagu, nyanyian'],
[211,3,'料理','りょうり','masakan'],
[212,3,'写真','しゃしん','foto'],
[213,3,'旅行','りょこう','perjalanan'],
[214,3,'音','おと','suara, bunyi'],
[215,3,'音楽','おんがく','musik'],
[216,3,'楽しい','たのしい','menyenangkan'],
[217,3,'一度','いちど','satu kali'],
[218,3,'仕事','しごと','pekerjaan'],
[219,3,'神社','じんじゃ','kuil Shinto'],
[220,3,'家','いえ','rumah'],
[221,3,'家族','かぞく','keluarga'],
[222,3,'自動車','じどうしゃ','mobil'],
[223,3,'動く','うごく','bergerak'],
[224,3,'立つ','たつ','berdiri'],
[225,3,'勉強','べんきょう','belajar'],
[226,3,'強い','つよい','kuat'],
[227,3,'電話','でんわ','telepon'],
[228,3,'花火','はなび','kembang api'],
[229,3,'大雨','おおあめ','hujan lebat'],
[230,3,'小雨','こさめ','gerimis'],
[231,3,'時計','とけい','jam (benda)'],
[232,3,'手紙','てがみ','surat'],
[233,3,'読む','よむ','membaca'],
[234,3,'後で','あとで','nanti, setelah ini'],
[235,3,'東京','とうきょう','Tokyo'],
[236,3,'住む','すむ','tinggal'],
[237,3,'出る','でる','keluar'],
[238,3,'外国人','がいこくじん','orang asing'],
[239,3,'毎週','まいしゅう','tiap minggu'],
[240,3,'知る','しる','mengetahui'],
[241,3,'一本','いっぽん','1 batang'],
[242,3,'今晩','こんばん','malam ini'],
[243,3,'見る','みる','melihat'],
[244,3,'誕生日','たんじょうび','ulang tahun'],
[245,3,'傘','かさ','payung'],
[246,3,'好き','すき','suka'],
[247,3,'部屋','へや','kamar'],
[248,3,'歩く','あるく','berjalan'],
[249,3,'彼女','かのじょ','dia (perempuan)'],
[250,3,'彼','かれ','dia (laki-laki)'],
[251,3,'果物','くだもの','buah'],
[252,3,'送る','おくる','mengirim'],
[253,3,'教える','おしえる','mengajar'],
[254,3,'借りる','かりる','meminjam'],
[255,3,'貸す','かす','meminjamkan'],
[256,3,'荷物','にもつ','barang bawaan'],
[257,3,'消しゴム','けしごむ','penghapus'],
[258,3,'悪い','わるい','jelek, buruk'],
[259,3,'忙しい','いそがしい','sibuk'],
[260,3,'黒い','くろい','hitam'],
[261,3,'青い','あおい','biru'],
[262,3,'楽しい','たのしい','senang'],
[263,3,'寒い','さむい','dingin'],
[264,3,'暑い','あつい','panas'],
// ── SET 4 ──
[265,4,'近い','ちかい','dekat'],
[266,4,'犬','いぬ','anjing'],
[267,4,'猫','ねこ','kucing'],
[268,4,'兄弟','きょうだい','saudara'],
[269,4,'甘い','あまい','manis'],
[270,4,'秋','あき','musim gugur'],
[271,4,'春','はる','musim semi'],
[272,4,'冬','ふゆ','musim dingin'],
[273,4,'夏','なつ','musim panas'],
[274,4,'明日','あした','besok'],
[275,4,'終わる','おわる','selesai'],
[276,4,'強い','つよい','kuat'],
[277,4,'弱い','よわい','lemah'],
[278,4,'降る','ふる','turun (hujan/salju)'],
[279,4,'雪','ゆき','salju'],
[280,4,'お茶','おちゃ','teh'],
[281,4,'米','こめ','beras'],
[282,4,'ご飯','ごはん','nasi, makan'],
[283,4,'森','もり','hutan'],
[284,4,'林','はやし','hutan kecil'],
[285,4,'森林','しんりん','rimba'],
[286,4,'町','まち','kota'],
[287,4,'牛','うし','sapi'],
[288,4,'牛乳','ぎゅうにゅう','susu sapi'],
[289,4,'牛肉','ぎゅうにく','daging sapi'],
[290,4,'鳥','とり','burung'],
[291,4,'風','かぜ','angin'],
[292,4,'場所','ばしょ','tempat'],
[293,4,'近所','きんじょ','tetangga'],
[294,4,'所','ところ','tempat'],
[295,4,'全部','ぜんぶ','semuanya'],
[296,4,'門','もん','gerbang'],
[297,4,'お寺','おてら','kuil Buddha'],
[298,4,'港','みなと','pelabuhan'],
[299,4,'空港','くうこう','bandara'],
[300,4,'島','しま','pulau'],
[301,4,'村','むら','desa'],
[302,4,'頭','あたま','kepala'],
[303,4,'顔','かお','wajah'],
[304,4,'首','くび','leher'],
[305,4,'力','ちから','kekuatan'],
[306,4,'広い','ひろい','luas'],
[307,4,'明るい','あかるい','terang'],
[308,4,'暗い','くらい','gelap'],
[309,4,'最近','さいきん','akhir-akhir ini'],
[310,4,'遠い','とおい','jauh'],
[311,4,'問題','もんだい','soal, masalah'],
[312,4,'宿題','しゅくだい','tugas (PR)'],
[313,4,'質問','しつもん','pertanyaan'],
[314,4,'答える','こたえる','menjawab'],
[315,4,'試験','しけん','ujian'],
[316,4,'文法','ぶんぽう','tata bahasa'],
[317,4,'考える','かんがえる','berpikir'],
[318,4,'教室','きょうしつ','ruang kelas'],
[319,4,'習う','ならう','belajar (dari guru)'],
[320,4,'練習','れんしゅう','latihan'],
[321,4,'店員','てんいん','pegawai toko'],
[322,4,'屋','や','toko (akhiran)'],
[323,4,'本屋','ほんや','toko buku'],
[324,4,'図書館','としょかん','perpustakaan'],
[325,4,'地図','ちず','peta'],
[326,4,'食堂','しょくどう','kantin'],
[327,4,'思う','おもう','berpikir, merasa'],
[328,4,'作る','つくる','membuat'],
[329,4,'使う','つかう','memakai'],
[330,4,'住所','じゅうしょ','alamat'],
[331,4,'絵','え','gambar, lukisan'],
[332,4,'辞書','じしょ','kamus'],
[333,4,'辞める','やめる','berhenti'],
[334,4,'生きる','いきる','hidup'],
[335,4,'親','おや','orang tua'],
[336,4,'両親','りょうしん','kedua orang tua'],
[337,4,'親切','しんせつ','ramah, baik hati'],
[338,4,'切る','きる','memotong'],
[339,4,'心','こころ','hati, perasaan'],
[340,4,'心配','しんぱい','khawatir'],
[341,4,'声','こえ','suara'],
[342,4,'開ける','あける','membuka'],
[343,4,'開く','ひらく','membuka'],
[344,4,'開店','かいてん','buka toko'],
[345,4,'閉じる','とじる','menutup'],
[346,4,'短い','みじかい','pendek'],
[347,4,'形','かたち','bentuk'],
[348,4,'便利','べんり','praktis, nyaman'],
[349,4,'簡単な','かんたんな','mudah'],
[350,4,'寝る','ねる','tidur'],
[351,4,'起きる','おきる','bangun'],
[352,4,'働く','はたらく','bekerja'],
];

const KANJI_SET_LABELS = [
  'Semua · 352 Kanji',
  'Set 1 · N5 Dasar 1 (88)',
  'Set 2 · N5 Dasar 2 (88)',
  'Set 3 · N4 Lanjut 1 (88)',
  'Set 4 · N4 Lanjut 2 (88)',
];

// ════════════════════════════════════════════════════════
// QUIZ HUB STATE
// ════════════════════════════════════════════════════════
const QUIZ_HUB = {
    activeTab: 'vocab',
    quizBook: 'all',
    selectedChapters: new Set(['all']),  // 'all' or lesson ids
};

function switchQuizHub(tab, el) {
    QUIZ_HUB.activeTab = tab;
    document.querySelectorAll('.quiz-hub-tab').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    const vocabPanel = document.getElementById('quiz-vocab-panel');
    const kanjiPanel = document.getElementById('quiz-kanji-panel');
    if (tab === 'vocab') {
        if (vocabPanel) vocabPanel.style.display = 'flex';
        if (kanjiPanel) kanjiPanel.style.display = 'none';
    } else {
        if (vocabPanel) vocabPanel.style.display = 'none';
        if (kanjiPanel) { kanjiPanel.style.display = 'flex'; renderKanjiPanel(); }
    }
}

// ════════════════════════════════════════════════════════
// VOCAB QUIZ — Chapter selector
// ════════════════════════════════════════════════════════
function setQuizBook(book, el) {
    QUIZ_HUB.quizBook = book;
    document.querySelectorAll('.quiz-book-tab').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    QUIZ_HUB.selectedChapters = new Set(['all']);
    renderQuizChapterList();
}

function renderQuizChapterList() {
    const list = document.getElementById('quiz-chapter-list');
    if (!list) return;
    const lessons = QUIZ_HUB.quizBook === 'all'
        ? [...(DB.book1||[]), ...(DB.book2||[])]
        : (DB[QUIZ_HUB.quizBook] || []);
    const allUnlocked = isPremium();

    list.innerHTML = `
      <div class="quiz-chapter-item${QUIZ_HUB.selectedChapters.has('all') && allUnlocked ?' selected':''}" onclick="${allUnlocked ? "setQuizChapter('all')" : 'showPremiumModal()'}">
        <span class="quiz-chapter-num">${allUnlocked ? '✨' : '🔒'}</span>
        <span class="quiz-chapter-title">Semua Pelajaran${allUnlocked ? '' : ' <span style=\"font-size:10px;color:#f59e0b;font-weight:700\">👑 PREMIUM</span>'}</span>
        <span class="quiz-chapter-count">${lessons.reduce((n,l)=>n+(l.vocab||[]).length,0)} kata</span>
        <span class="quiz-chapter-check">✓</span>
      </div>
      ${lessons.map(l => {
        const locked = !canAccess('chapter', l.id);
        const key = l.id+l.title;
        const clickFn = locked ? 'showPremiumModal()' : `setQuizChapter('${key}','${(l.title+'|'+(l.topic||'')).replace(/'/g,'')}')`;
        const isSelected = !locked && QUIZ_HUB.selectedChapters.has(key);
        return `
      <div class="quiz-chapter-item${isSelected ?' selected':''}" onclick="${clickFn}" style="${locked?'opacity:.6;':''}">
        <span class="quiz-chapter-num">${locked ? '🔒' : l.id}</span>
        <span class="quiz-chapter-title">${escHTML(l.title)}${locked ? ' <span style=\"font-size:10px;color:#f59e0b;font-weight:700\">👑</span>' : (l.topic?' — '+escHTML(l.topic.slice(0,25)):'')}</span>
        <span class="quiz-chapter-count">${(l.vocab||[]).length} kata</span>
        <span class="quiz-chapter-check">✓</span>
      </div>`;
      }).join('')}`;
}

function setQuizChapter(id) {
    if (id === 'all') {
        QUIZ_HUB.selectedChapters = new Set(['all']);
    } else {
        QUIZ_HUB.selectedChapters.delete('all');
        if (QUIZ_HUB.selectedChapters.has(id)) QUIZ_HUB.selectedChapters.delete(id);
        else QUIZ_HUB.selectedChapters.add(id);
        if (!QUIZ_HUB.selectedChapters.size) QUIZ_HUB.selectedChapters.add('all');
    }
    renderQuizChapterList();
}

function startVocabQuiz() {
    // ── ACCESS CONTROL GATE ──
    if (!_requireAccess('quiz', QUIZ_HUB.selectedChapters, 'startVocabQuiz')) return;

    const lessons = QUIZ_HUB.quizBook === 'all'
        ? [...(DB.book1||[]), ...(DB.book2||[])]
        : (DB[QUIZ_HUB.quizBook] || []);

    let pool;
    if (QUIZ_HUB.selectedChapters.has('all')) {
        pool = lessons.flatMap(l => (l.vocab||[]).map(v => ({...v, _lesson: l.title})));
    } else {
        pool = lessons
            .filter(l => QUIZ_HUB.selectedChapters.has(l.id+l.title))
            .flatMap(l => (l.vocab||[]).map(v => ({...v, _lesson: l.title})));
    }

    const allVocab = lessons.flatMap(l => l.vocab || []);
    if (pool.length < 4) {
        alert('Pilih pelajaran dengan minimal 4 kosakata!');
        return;
    }

    // Hide chapter select, show quiz area
    const sel = document.getElementById('quiz-chapter-select');
    const wrap = document.getElementById('quiz-card-wrap');
    if (sel) sel.style.display = 'none';
    if (wrap) wrap.style.display = '';

    const deck = renshuShuffle(pool).slice(0, Math.min(15, pool.length));
    STATE.quizData = deck.map(v => {
        const wrong = renshuShuffle(allVocab.filter(x => x.arti !== v.arti)).slice(0, 3).map(x => x.arti);
        return { ...v, opts: renshuShuffle([v.arti, ...wrong]) };
    });
    STATE.quizIndex = 0;
    STATE.quizScore = 0;
    restoreQuizUI();
    renderQuizQuestion();
}

function startQuiz() {
    // Legacy: start quiz with all vocab — requires premium (all chapters)
    if (!isPremium()) { showPremiumModal(); return; }
    const sel = document.getElementById('quiz-chapter-select');
    const wrap = document.getElementById('quiz-card-wrap');
    QUIZ_HUB.selectedChapters = new Set(['all']);
    startVocabQuiz();
}

function initQuizPage() {
    // Show chapter select, hide quiz area
    const sel = document.getElementById('quiz-chapter-select');
    const wrap = document.getElementById('quiz-card-wrap');
    if (sel) sel.style.display = '';
    if (wrap) wrap.style.display = 'none';
    // Reset to vocab tab
    switchQuizHub('vocab', document.querySelector('[data-hub="vocab"]'));
    renderQuizChapterList();
}

// ════════════════════════════════════════════════════════
// KANJI LEARN PANEL
// ════════════════════════════════════════════════════════
const KANJI_STATE = {
    set: 0, mode: 'flash', idx: 0,
    hafal: new Set(), flipped: false,
    cards: [],
    shuffled: false,       // apakah mode acak aktif
    shuffledDeck: [],      // salinan deck yang sudah diacak
};

function initKanjiHafal() {
    try {
        const s = localStorage.getItem('mnn_kanji_hafal');
        if (s) KANJI_STATE.hafal = new Set(JSON.parse(s));
    } catch(e) {}
}
function saveKanjiHafal() {
    try { localStorage.setItem('mnn_kanji_hafal', JSON.stringify([...KANJI_STATE.hafal])); } catch(e) {}
    // [CLOUD_SAVE] sync kanji hafal ke Firestore
    try { if (window.PROGRESS_SYNC) window.PROGRESS_SYNC.push(); } catch(e) {}
}

function filterKanjiCards() {
    KANJI_STATE.cards = KANJI_STATE.set > 0
        ? KANJI.filter(k => k[1] === KANJI_STATE.set)
        : [...KANJI];
    if (KANJI_STATE.idx >= KANJI_STATE.cards.length) KANJI_STATE.idx = 0;
}

function renderKanjiPanel() {
    const panel = document.getElementById('quiz-kanji-panel');
    if (!panel) return;
    initKanjiHafal();
    filterKanjiCards();

    const total = KANJI_STATE.cards.length;
    const hafalCount = KANJI_STATE.cards.filter(k => KANJI_STATE.hafal.has(k[0])).length;
    const pct = total ? Math.round((hafalCount/total)*100) : 0;

    panel.innerHTML = `
      <!-- Set selector -->
      <div class="kanji-set-tabs" id="kanji-set-tabs">
        ${KANJI_SET_LABELS.map((lbl,i) =>
          `<button class="kanji-set-tab${KANJI_STATE.set===i?' active':''}" onclick="setKanjiSet(${i})">${lbl}</button>`
        ).join('')}
      </div>

      <!-- Mode selector -->
      <div class="kanji-mode-tabs" style="flex-wrap:wrap;gap:6px">
        <button class="kanji-mode-tab${KANJI_STATE.mode==='flash'?' active':''}" onclick="setKanjiMode('flash')">🃏 Flashcard</button>
        <button class="kanji-mode-tab${KANJI_STATE.mode==='list'?' active':''}" onclick="setKanjiMode('list')">📋 Daftar</button>
        <button class="kanji-mode-tab${KANJI_STATE.mode==='hafal'?' active':''}" onclick="setKanjiMode('hafal')">✅ Hafal</button>
        <button class="kanji-mode-tab${KANJI_STATE.mode==='tes'?' active':''}" style="background:${KANJI_STATE.mode==='tes'?'rgba(251,146,60,.18)':'var(--bg-elevated)'};border-color:${KANJI_STATE.mode==='tes'?'var(--accent-adj)':'var(--border-strong)'};color:${KANJI_STATE.mode==='tes'?'var(--accent-adj)':'var(--text-secondary)'}" onclick="setKanjiMode('tes')">🎯 Tes</button>
      </div>

      <!-- Progress bar -->
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="flex:1;height:6px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent-verb);border-radius:99px;transition:width .5s ease"></div>
        </div>
        <span style="font-size:11px;color:var(--text-muted);font-weight:700;white-space:nowrap">${hafalCount}/${total} (${pct}%)</span>
      </div>

      <!-- Content area -->
      <div id="kanji-content" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow-y:auto">
      </div>`;

    renderKanjiContent();
}

function setKanjiSet(s) {
    // ── ACCESS CONTROL GATE: only set 0 (N5 Part 1) is free ──
    if (!_requireAccess('kanji', s, 'setKanjiSet')) return;
    KANJI_STATE.set = s;
    KANJI_STATE.idx = 0;
    KANJI_STATE.shuffled = false;     // reset acak saat ganti set
    KANJI_STATE.shuffledDeck = [];
    filterKanjiCards();
    renderKanjiPanel();
}

function setKanjiMode(m) {
    KANJI_STATE.mode = m;
    KANJI_STATE.idx = 0;
    KANJI_STATE.flipped = false;
    // Pertahankan mode acak saat kembali ke flash, reset saat pindah mode lain
    if (m !== 'flash') { KANJI_STATE.shuffled = false; KANJI_STATE.shuffledDeck = []; }
    renderKanjiPanel();
}

function renderKanjiContent() {
    const el = document.getElementById('kanji-content');
    if (!el) return;
    if (KANJI_STATE.mode === 'flash') renderKanjiFlash(el);
    else if (KANJI_STATE.mode === 'list') renderKanjiList(el);
    else if (KANJI_STATE.mode === 'tes') renderKanjiTes(el);
    else renderKanjiHafalView(el);
}

function renderKanjiFlash(el) {
    // Gunakan deck diacak jika mode acak aktif
    const cards = KANJI_STATE.shuffled ? KANJI_STATE.shuffledDeck : KANJI_STATE.cards;
    if (!cards.length) { el.innerHTML = '<div class=\"empty-state\"><div class=\"empty-state-icon\">🀄</div><div class=\"empty-state-text\">Tidak ada kartu.</div></div>'; return; }
    const k = cards[KANJI_STATE.idx];
    const isH = KANJI_STATE.hafal.has(k[0]);
    const totalCards = cards.length;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);background:var(--bg-elevated);padding:3px 9px;border-radius:6px;letter-spacing:.06em">SET ${k[1]}</span>
        <span style="font-size:13px;color:var(--text-muted);font-weight:600">${KANJI_STATE.idx+1} / ${totalCards}</span>
        ${isH ? '<span style="font-size:10px;font-weight:800;color:var(--accent-verb);background:rgba(52,211,153,.1);padding:3px 9px;border-radius:6px">✓ HAFAL</span>' : '<span></span>'}
      </div>
      <div class="kanji-card-scene" id="kanji-scene" onclick="flipKanjiCard()" style="height:260px;flex:0 0 260px">
        <div class="kanji-card-inner${KANJI_STATE.flipped?' flipped':''}" id="kanji-inner">
          <div class="kanji-face front">
            <div class="kanji-char">${k[2]}</div>
            <div class="kanji-flip-hint">タップしてめくる</div>
          </div>
          <div class="kanji-face back" style="gap:6px;justify-content:center">
            <div style="font-family:'Noto Sans JP',sans-serif;font-size:44px;font-weight:800;color:var(--text-primary);line-height:1.1">${k[2]}</div>
            ${STATE.showFurigana
              ? `<div style="font-family:'Noto Sans JP',sans-serif;font-size:18px;color:var(--accent-primary);font-weight:600">${k[3]}</div>`
              : ''}
            <div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--text-muted);text-transform:uppercase;margin-top:4px">ARTI (INDONESIA)</div>
            <div style="font-size:20px;font-weight:700;color:var(--accent-primary);text-align:center">${k[4]}</div>
          </div>
        </div>
      </div>
      <div class="kanji-nav-row">
        <button class="kanji-btn-prev" onclick="prevKanji()">← 前へ</button>
        <button class="kanji-btn-hafal${isH?' active':''}" onclick="toggleKanjiHafal()">${isH?'★ Hafal':'☆ Tandai Hafal'}</button>
        <button class="kanji-btn-next" onclick="nextKanji()">次へ →</button>
      </div>
      <div style="text-align:center;margin-top:8px">
        <button onclick="toggleKanjiAcak()"
          style="font-size:11px;padding:5px 16px;border-radius:8px;cursor:pointer;font-weight:700;
                 border:1.5px solid ${KANJI_STATE.shuffled?'var(--accent-primary)':'var(--border)'};
                 background:${KANJI_STATE.shuffled?'rgba(139,92,246,.12)':'transparent'};
                 color:${KANJI_STATE.shuffled?'var(--accent-primary)':'var(--text-muted)'}">
          🎲 ${KANJI_STATE.shuffled ? 'Acak ON' : 'Acak'}
        </button>
      </div>`;
}
function renderKanjiList(el) {
    el.innerHTML = KANJI_STATE.cards.map((k,i) => `
      <div class="kanji-list-item${KANJI_STATE.hafal.has(k[0])?' is-hafal':''}" onclick="KANJI_STATE.idx=${i};KANJI_STATE.mode='flash';KANJI_STATE.flipped=false;renderKanjiPanel()">
        <div class="kanji-list-kj">${k[2]}</div>
        <div class="kanji-list-info">
          <div class="kanji-list-rd">${k[3]}</div>
          <div class="kanji-list-mn">${k[4]}</div>
        </div>
        <span style="font-size:9px;color:var(--text-muted);background:var(--bg-elevated);padding:2px 6px;border-radius:5px;font-weight:700">SET ${k[1]}</span>
        ${KANJI_STATE.hafal.has(k[0]) ? '<span class="kanji-list-chk">✓</span>' : ''}
      </div>`).join('');
}

function renderKanjiHafalView(el) {
    const hafalCards = KANJI_STATE.cards.filter(k => KANJI_STATE.hafal.has(k[0]));
    const total = KANJI_STATE.cards.length;
    el.innerHTML = `
      <div style="text-align:center;padding:16px;background:var(--bg-card);border-radius:16px;border:1px solid var(--border)">
        <div style="font-size:36px;font-weight:800;color:var(--accent-verb)">${hafalCards.length}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">dari ${total} kartu sudah dihafal</div>
        ${hafalCards.length > 0 ? '<button onclick="resetKanjiHafal()" style="margin-top:10px;font-size:11px;color:var(--accent-danger);background:none;border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:5px 12px;cursor:pointer">🗑 Reset Progress</button>' : ''}
      </div>
      ${hafalCards.map((k,i) => `
        <div class="kanji-list-item is-hafal">
          <div class="kanji-list-kj">${k[2]}</div>
          <div class="kanji-list-info">
            <div class="kanji-list-rd">${k[3]}</div>
            <div class="kanji-list-mn">${k[4]}</div>
          </div>
          <span class="kanji-list-chk">✓</span>
        </div>`).join('')}
      ${!hafalCards.length ? '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Belum ada kanji yang ditandai hafal.</div></div>' : ''}`;
}

function flipKanjiCard() {
    KANJI_STATE.flipped = !KANJI_STATE.flipped;
    const inner = document.getElementById('kanji-inner');
    if (inner) inner.classList.toggle('flipped', KANJI_STATE.flipped);
}
function nextKanji() {
    const deck = KANJI_STATE.shuffled ? KANJI_STATE.shuffledDeck : KANJI_STATE.cards;
    KANJI_STATE.idx = (KANJI_STATE.idx + 1) % deck.length;
    KANJI_STATE.flipped = false;
    renderKanjiContent();
}
function prevKanji() {
    const deck = KANJI_STATE.shuffled ? KANJI_STATE.shuffledDeck : KANJI_STATE.cards;
    KANJI_STATE.idx = (KANJI_STATE.idx - 1 + deck.length) % deck.length;
    KANJI_STATE.flipped = false;
    renderKanjiContent();
}
function toggleKanjiHafal() {
    const deck = KANJI_STATE.shuffled ? KANJI_STATE.shuffledDeck : KANJI_STATE.cards;
    const id = deck[KANJI_STATE.idx]?.[0];
    if (!id) return;
    if (KANJI_STATE.hafal.has(id)) KANJI_STATE.hafal.delete(id);
    else KANJI_STATE.hafal.add(id);
    saveKanjiHafal();
    renderKanjiPanel();
}
function toggleKanjiAcak() {
    KANJI_STATE.shuffled = !KANJI_STATE.shuffled;
    if (KANJI_STATE.shuffled) {
        // Buat salinan deck yang diacak menggunakan renshuShuffle
        KANJI_STATE.shuffledDeck = renshuShuffle([...KANJI_STATE.cards]);
    } else {
        KANJI_STATE.shuffledDeck = [];
    }
    KANJI_STATE.idx = 0;
    KANJI_STATE.flipped = false;
    renderKanjiContent();
}
// ════════════════════════════════════════════════════════
// KANJI TES MODE
// ════════════════════════════════════════════════════════
const KANJI_TES = {
    deck: [], idx: 0, score: 0, answered: false,
    total: 0, wrongList: [],
    qtype: 'kj-to-id', // 'kj-to-id' | 'id-to-kj' | 'rd-to-kj' | 'mix'
};

function startKanjiTes(qtype) {
    // ── ACCESS CONTROL GATE ──
    if (!_requireAccess('kanji', KANJI_STATE.set, 'startKanjiTes')) return;
    const cards = KANJI_STATE.cards;
    if (cards.length < 4) return;
    KANJI_TES.qtype   = qtype || 'mix';
    KANJI_TES.deck    = renshuShuffle([...cards]).slice(0, Math.min(20, cards.length));
    KANJI_TES.idx     = 0;
    KANJI_TES.score   = 0;
    KANJI_TES.wrongList = [];
    KANJI_TES.answered = false;
    KANJI_TES.total   = KANJI_TES.deck.length;
    const el = document.getElementById('kanji-content');
    if (el) renderKanjiTesQuestion(el);
}

function makeKanjiQuestion(k, qtype, allCards) {
    const type = qtype === 'mix'
        ? ['kj-to-id','id-to-kj','rd-to-kj'][Math.floor(Math.random()*3)]
        : qtype;

    const pool = allCards.filter(x => x[0] !== k[0]);
    const wrong3 = renshuShuffle(pool).slice(0,3);

    if (type === 'kj-to-id') {
        // Show kanji → pick Indonesian meaning
        return {
            type, prompt: k[2], promptSub: k[3],
            promptLabel: 'Apa arti kanji ini?',
            answer: k[4],
            opts: renshuShuffle([k[4], ...wrong3.map(x=>x[4])]),
            kanji: k[2], reading: k[3], meaning: k[4]
        };
    } else if (type === 'id-to-kj') {
        // Show meaning → pick kanji
        return {
            type, prompt: k[4], promptSub: k[3],
            promptLabel: 'Pilih kanji yang tepat:',
            answer: k[2],
            opts: renshuShuffle([k[2], ...wrong3.map(x=>x[2])]),
            kanji: k[2], reading: k[3], meaning: k[4]
        };
    } else {
        // Show reading (hiragana) → pick kanji
        return {
            type, prompt: k[3], promptSub: k[4],
            promptLabel: 'Pilih kanji untuk bacaan ini:',
            answer: k[2],
            opts: renshuShuffle([k[2], ...wrong3.map(x=>x[2])]),
            kanji: k[2], reading: k[3], meaning: k[4]
        };
    }
}

function renderKanjiTes(el) {
    const setLbl = KANJI_SET_LABELS[KANJI_STATE.set] || 'Semua';
    const total  = KANJI_STATE.cards.length;
    el.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text-primary)">🎯 Tes Kanji</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${setLbl} · ${total} kartu tersedia</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <p style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase">Mode Pertanyaan</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="kanji-mode-tab" style="height:auto;padding:12px 14px;text-align:left;display:flex;align-items:center;gap:10px;border-radius:14px" onclick="startKanjiTes('mix')">
              <span style="font-size:20px">🔀</span>
              <div><div style="font-weight:700;color:var(--text-primary)">Campur (Rekomendasi)</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Kanji→Arti, Arti→Kanji, Bacaan→Kanji</div></div>
            </button>
            <button class="kanji-mode-tab" style="height:auto;padding:12px 14px;text-align:left;display:flex;align-items:center;gap:10px;border-radius:14px" onclick="startKanjiTes('kj-to-id')">
              <span style="font-size:20px">🈯</span>
              <div><div style="font-weight:700;color:var(--text-primary)">Kanji → Arti</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Lihat kanji, pilih arti Indonesia</div></div>
            </button>
            <button class="kanji-mode-tab" style="height:auto;padding:12px 14px;text-align:left;display:flex;align-items:center;gap:10px;border-radius:14px" onclick="startKanjiTes('id-to-kj')">
              <span style="font-size:20px">🔤</span>
              <div><div style="font-weight:700;color:var(--text-primary)">Arti → Kanji</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Lihat arti, pilih kanji yang tepat</div></div>
            </button>
            <button class="kanji-mode-tab" style="height:auto;padding:12px 14px;text-align:left;display:flex;align-items:center;gap:10px;border-radius:14px" onclick="startKanjiTes('rd-to-kj')">
              <span style="font-size:20px">📖</span>
              <div><div style="font-weight:700;color:var(--text-primary)">Bacaan → Kanji</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Lihat hiragana, pilih kanji yang tepat</div></div>
            </button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);text-align:center">Setiap sesi: 20 soal acak dari set yang aktif</div>
      </div>`;
}

function renderKanjiTesQuestion(el) {
    const { deck, idx, score, total } = KANJI_TES;
    if (idx >= total) { renderKanjiTesResult(el); return; }

    const k = deck[idx];
    const q = makeKanjiQuestion(k, KANJI_TES.qtype, KANJI_STATE.cards);
    KANJI_TES.answered = false;
    const pct = Math.round((idx / total) * 100);

    const isKanji = (s) => /[一-龯぀-ゟ゠-ヿ]/.test(s);

    el.innerHTML = `
      <!-- Progress -->
      <div style="flex-shrink:0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;color:var(--text-muted);font-weight:600">Soal ${idx+1} / ${total}</span>
          <span style="font-size:12px;font-weight:700;color:var(--accent-verb)">✓ ${score}</span>
          <button class="btn-ghost" style="font-size:11px;padding:4px 10px" onclick="renderKanjiTes(document.getElementById('kanji-content'))">✕ Berhenti</button>
        </div>
        <div style="height:5px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent-primary);border-radius:99px;transition:width .4s ease"></div>
        </div>
      </div>

      <!-- Prompt card -->
      <div style="background:var(--bg-card);border:1.5px solid var(--border);border-radius:20px;padding:24px 20px;text-align:center;flex-shrink:0">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">${escHTML(q.promptLabel)}</div>
        <div style="font-family:'Noto Sans JP',sans-serif;font-size:${isKanji(q.prompt)?'60':'22'}px;font-weight:700;color:var(--text-primary);line-height:1.2">${escHTML(q.prompt)}</div>
        ${(() => {
          // FIX v3.0.9: for 'kj-to-id' and 'id-to-kj', promptSub is the kanji's
          // FURIGANA reading — it must respect the furigana toggle just like
          // the dedicated q.reading branch below. Previously the else-branch
          // rendered q.promptSub unconditionally, so furigana still showed
          // even when STATE.showFurigana was OFF.
          if (q.type === 'rd-to-kj') {
            // promptSub here is the Indonesian meaning hint, not furigana — always show.
            return `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">${escHTML(q.promptSub)}</div>`;
          }
          if (!STATE.showFurigana) return '';
          const reading = q.type === 'kj-to-id' ? q.reading : q.promptSub;
          return reading
            ? `<div style="font-family:'Noto Sans JP',sans-serif;font-size:14px;color:var(--text-muted);margin-top:6px">${escHTML(reading)}</div>`
            : '';
        })()}
        ${q.type === 'kj-to-id' && q.meaning && STATE.showRomaji
          ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;font-style:italic">${escHTML(q.meaning)}</div>`
          : ''}
      </div>

      <!-- Options -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;flex-shrink:0" id="kanji-tes-opts">
        ${q.opts.map((opt,i) => `
          <button id="kto-${i}" onclick="answerKanjiTes(${i},'${escAttr(opt)}','${escAttr(q.answer)}')"
            style="padding:14px 10px;border-radius:16px;border:1.5px solid var(--border-strong);background:var(--bg-card);
                   font-family:'Noto Sans JP',sans-serif;font-size:${isKanji(opt)?'22':'13'}px;font-weight:700;
                   color:var(--text-primary);cursor:pointer;transition:all .15s;min-height:60px;line-height:1.3;
                   word-break:break-word;text-align:center">
            ${escHTML(opt)}
          </button>`).join('')}
      </div>

      <!-- Feedback -->
      <div id="kanji-tes-fb" style="display:none;padding:12px 16px;border-radius:14px;text-align:center;font-size:13px;font-weight:700"></div>

      <!-- Next button -->
      <button id="kanji-tes-next" onclick="nextKanjiTes()" style="display:none"
        class="btn-primary-full">
        ${idx + 1 >= total ? '📊 Lihat Hasil' : 'Soal Berikutnya →'}
      </button>`;
}

function answerKanjiTes(i, selected, correct) {
    if (KANJI_TES.answered) return;
    KANJI_TES.answered = true;
    const isRight = selected === correct;
    if (isRight) KANJI_TES.score++;
    else KANJI_TES.wrongList.push(KANJI_TES.deck[KANJI_TES.idx]);

    // Color all buttons
    document.querySelectorAll('#kanji-tes-opts button').forEach((btn, bi) => {
        btn.onclick = null;
        const txt = btn.textContent.trim();
        if (txt === correct) {
            btn.style.background = 'rgba(52,211,153,.18)';
            btn.style.borderColor = 'rgba(52,211,153,.5)';
            btn.style.color = 'var(--accent-verb)';
        } else if (bi === i && !isRight) {
            btn.style.background = 'rgba(248,113,113,.15)';
            btn.style.borderColor = 'rgba(248,113,113,.4)';
            btn.style.color = 'var(--accent-danger)';
        }
    });

    const fb = document.getElementById('kanji-tes-fb');
    if (fb) {
        fb.style.display = '';
        fb.style.background = isRight ? 'rgba(52,211,153,.12)' : 'rgba(248,113,113,.12)';
        fb.style.border = isRight ? '1px solid rgba(52,211,153,.3)' : '1px solid rgba(248,113,113,.3)';
        fb.style.color = isRight ? 'var(--accent-verb)' : 'var(--accent-danger)';
        const k = KANJI_TES.deck[KANJI_TES.idx];
        fb.innerHTML = isRight
            ? `✓ 正解！ ${k[2]} (${k[3]}) = ${k[4]}`
            : `✗ Jawaban benar: <span style="font-family:'Noto Sans JP',sans-serif;font-size:16px">${correct}</span>`;
    }

    playQuizSound(isRight);

    const nb = document.getElementById('kanji-tes-next');
    if (nb) nb.style.display = '';
}

function nextKanjiTes() {
    KANJI_TES.idx++;
    const el = document.getElementById('kanji-content');
    if (el) renderKanjiTesQuestion(el);
}

function renderKanjiTesResult(el) {
    const { score, total, wrongList } = KANJI_TES;
    const pct   = Math.round((score / total) * 100);
    const emoji = pct >= 90 ? '🏆' : pct >= 70 ? '🎯' : pct >= 50 ? '💪' : '📚';
    const color = pct >= 70 ? 'var(--accent-verb)' : pct >= 50 ? 'var(--accent-adj)' : 'var(--accent-danger)';
    const msg   = pct >= 90 ? 'Luar biasa! Hafal semua!' :
                  pct >= 70 ? 'Bagus! Terus berlatih!' :
                  pct >= 50 ? 'Lumayan, ulangi yang salah!' : 'Pelajari flashcard dulu ya!';

    el.innerHTML = `
      <div style="text-align:center;padding:20px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:20px;display:flex;flex-direction:column;align-items:center;gap:10px">
        <span style="font-size:48px">${emoji}</span>
        <div style="font-size:48px;font-weight:800;color:${color};line-height:1">${score}<span style="font-size:20px;color:var(--text-muted)">/${total}</span></div>
        <div style="font-size:13px;color:var(--text-secondary)">${msg}</div>
        <div style="width:100%;height:8px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width .6s ease"></div>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">${pct}% benar</div>
        <div style="display:flex;gap:8px;width:100%;margin-top:4px">
          <button class="btn-primary-full" style="flex:2" onclick="startKanjiTes('${KANJI_TES.qtype}')">🔄 Ulangi</button>
          <button class="btn-ghost" style="flex:1" onclick="renderKanjiTes(document.getElementById('kanji-content'))">← Menu</button>
        </div>
      </div>
      ${wrongList.length ? `
      <div>
        <p style="font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">❌ Yang Salah (${wrongList.length})</p>
        ${wrongList.map(k => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);border-radius:12px;margin-bottom:6px">
            <span style="font-family:'Noto Sans JP',sans-serif;font-size:26px;font-weight:700;color:var(--text-primary);width:40px;text-align:center">${k[2]}</span>
            <div>
              <div style="font-size:12px;color:var(--accent-primary);font-weight:600">${k[3]}</div>
              <div style="font-size:12px;color:var(--text-secondary)">${k[4]}</div>
            </div>
            <span style="margin-left:auto;font-size:9px;background:var(--bg-elevated);color:var(--text-muted);padding:2px 6px;border-radius:5px;font-weight:700">SET ${k[1]}</span>
          </div>`).join('')}
      </div>` : ''}`;
}

function resetKanjiHafal() {
    if (!confirm('Reset semua progress hafal kanji set ini?')) return;
    KANJI_STATE.cards.forEach(k => KANJI_STATE.hafal.delete(k[0]));
    saveKanjiHafal();
    renderKanjiPanel();
}

// ════════════════════════════════════════════════════════
// PROFILE / AUTH SYSTEM (Local — dasar login/logout)
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// ══ CENTRALIZED ACCESS CONTROL — CANNOT BE BYPASSED ══
// ════════════════════════════════════════════════════════
const GUEST_KEY   = 'mnn_guest';
const PREMIUM_KEY = 'mnn_premium';

// ════════════════════════════════════════════════════════
// CENTRALIZED PREMIUM CHECK — Firestore-only, no localStorage
// ════════════════════════════════════════════════════════
// isPremiumUser() is the ONLY function that determines premium access.
// Rules:
//   - AUTH_STATE must be "authenticated" (Firebase confirmed + Firestore fetched)
//   - AUTH.user.isPremium must be explicitly true (set by Firestore fetch)
//   - Guest mode is NEVER premium
//   - localStorage CANNOT grant premium
//   - location.protocol / file:// / content:// NEVER affects access
// Log: PREMIUM_STATE_FINAL is emitted after every auth state transition.
function isPremiumUser() {
    // ── SINGLE SOURCE OF TRUTH: AUTH.user from Firestore ONLY ──
    // No caching. No local variables. No snapshots.
    // Every call reads live from AUTH.user.isPremium.
    if (AUTH_STATE !== "authenticated") return false;  // must be Firebase+Firestore confirmed
    if (window._guestMode === true)     return false;  // guests never premium
    if (!AUTH.user)                     return false;  // no user object
    if (AUTH.user.isGuest === true)     return false;  // explicit guest flag
    const result = AUTH.user.isPremium === true;       // Firestore-confirmed, no cache
    console.log('[PREMIUM_CHECK_REALTIME] →', result,
                '| [AUTH_USER_STATE] AUTH_STATE:', AUTH_STATE,
                ', AUTH.user.isPremium:', AUTH.user?.isPremium,
                ', uid:', AUTH.user?.uid,
                ', _guestMode:', window._guestMode,
                '| [FIRESTORE_SOURCE_OF_TRUTH] value reflects last Firestore write');
    return result;
}

// Legacy aliases — all point to isPremiumUser() for consistency
function getAccessLevel() { return isPremiumUser() ? 'premium' : 'free'; }
function isGuest()        { return window._guestMode === true; }
function isPremium()      { return isPremiumUser(); }  // backward compat

// ── Rule definitions ─────────────────────────────────
const ACCESS_RULES = {
    // Chapters: free = 1-3 only
    chapter: (id) => isPremium() || id <= 3,
    // Lesson: free = lesson 1-3 only
    lesson:  (id) => isPremium() || id <= 3,
    // Quiz: free = only chapters 1-3
    quiz:    (chapterIds) => {
        if (isPremium()) return true;
        if (!chapterIds || chapterIds.size === 0) return false;
        if (chapterIds.has('all')) return false; // 'all' includes premium content
        // Only allow if ALL selected chapters are free (id <= 3)
        // chapterIds contains strings like "1Pelajaran 1"
        for (const key of chapterIds) {
            const num = parseInt(key);
            if (isNaN(num) || num > 3) return false;
        }
        return true;
    },
    // Kanji: free = N5 Part 1 only (set index 0)
    kanji:   (setIndex) => isPremium() || setIndex === 0,
    // Kana: fully free
    kana:    () => true,
};

// ── canAccess: single gate function ──────────────────
function canAccess(feature, param) {
    const rule = ACCESS_RULES[feature];
    if (!rule) return isPremium(); // unknown feature → require premium
    return rule(param);
}

function isLessonLocked(lessonId) {
    return !canAccess('lesson', lessonId);
}

// ════════════════════════════════════════════════════════
// renderPremiumGateHTML — inline locked-state UI
// Used inside feature panels when isPremiumUser() = false
// ════════════════════════════════════════════════════════
function renderPremiumGateHTML(featureName, desc) {
    return `<div style="
        display:flex;flex-direction:column;align-items:center;
        text-align:center;padding:36px 20px;gap:14px;
        background:var(--bg-card);border:1.5px dashed var(--border-strong);
        border-radius:20px;margin:8px 0;
    ">
        <div style="font-size:40px">👑</div>
        <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${featureName}</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6;white-space:pre-line">${desc}</div>
        <button onclick="showPremiumModal()" style="
            padding:12px 24px;border-radius:14px;border:none;
            background:var(--accent-primary);color:#0f0f1e;
            font-size:13px;font-weight:800;cursor:pointer;
            font-family:'DM Sans',sans-serif;
        ">👑 Upgrade Premium (Akses Full Materi)</button>
    </div>`;
}

// ════════════════════════════════════════════════════════
// ADMIN CONTACT CONFIG — update ADMIN_WA_NUMBER to real number
// Format: 62 + phone (no leading 0). Example: 6281234567890
// ════════════════════════════════════════════════════════
const ADMIN_WA_NUMBER = '6285601381064'; // 👉 GANTI dengan nomor WA admin yang sebenarnya
const ADMIN_IG_URL    = 'https://www.instagram.com/rawliet.id?igsh=MWV6Z2p4b3hidjk5NQ==';

// ── Member ID System ─────────────────────────────────────
// Format: MNN-XXXXXX (6-digit random number)
// Stored in: Firestore users/{uid}.memberId  +  localStorage fallback
// ─────────────────────────────────────────────────────────
function generateMemberId() {
    return 'MNN-' + Math.floor(100000 + Math.random() * 900000);
}

async function getOrCreateMemberId() {
    // 1. Already in memory
    if (AUTH.user && AUTH.user.memberId) return AUTH.user.memberId;

    // 2. localStorage fallback
    try {
        const cached = localStorage.getItem('mnn_member_id');
        if (cached) {
            if (AUTH.user) AUTH.user.memberId = cached;
            return cached;
        }
    } catch(e) {}

    // 3. Fetch from Firestore (logged-in, non-guest only)
    if (AUTH.user && !AUTH.user.isGuest && AUTH.user.uid && typeof _fbDb !== 'undefined') {
        try {
            const snap = await _fbDb.collection('users').doc(AUTH.user.uid).get();
            if (snap.exists && snap.data().memberId) {
                const mid = snap.data().memberId;
                AUTH.user.memberId = mid;
                try { localStorage.setItem('mnn_member_id', mid); } catch(e) {}
                console.log('[MEMBER_ID] Loaded from Firestore:', mid);
                return mid;
            }
        } catch(e) { console.warn('[MEMBER_ID] Firestore read failed:', e.message); }
    }

    // 4. Generate new ID
    const newId = generateMemberId();
    if (AUTH.user) AUTH.user.memberId = newId;
    try { localStorage.setItem('mnn_member_id', newId); } catch(e) {}
    console.log('[MEMBER_ID] Generated new ID:', newId);

    // 5. Save to Firestore (non-blocking, merge so isPremium is safe)
    if (AUTH.user && !AUTH.user.isGuest && AUTH.user.uid && typeof _fbDb !== 'undefined') {
        _fbDb.collection('users').doc(AUTH.user.uid)
            .set({ memberId: newId }, { merge: true })
            .then(() => console.log('[MEMBER_ID] Saved to Firestore:', newId))
            .catch(e => console.warn('[MEMBER_ID] Firestore save failed:', e.message));
    }
    return newId;
}

// ── Premium Modal ────────────────────────────────────────
// ── WhatsApp Upgrade Message Builder ─────────────────────
// Builds the pre-filled WA message from Firebase Auth data
function _buildUpgradeMessage(memberId, email) {
    return [
        'Hallo admin, saya ingin upgrade ke Premium MNN Learn🔥 .',
        '',
        'Data Pengguna:',
        `ID    : ${memberId}`,
        `Email : ${email}`,
        '',
        'Saya siap melanjutkan pembayaran. Mohon informasi cara pembayarannya.'
    ].join('\n');
}

// ── Payment Confirmation Message (Saya Sudah Bayar) ──────
function _buildPaymentConfirmMessage(memberId, email, name) {
    return [
        'Halo Admin MNN Learning 👋',
        '',
        'Saya sudah melakukan pembayaran Premium.',
        '',
        'Data saya:',
        `Nama      : ${name || '—'}`,
        `Email     : ${email}`,
        `Member ID : ${memberId}`,
        '',
        'Mohon verifikasi pembayaran saya.',
        '',
        'Terima kasih.'
    ].join('\n');
}

// ── Standalone CTA — dapat dipanggil dari mana saja ──────
// Digunakan oleh tombol "Upgrade Premium via WhatsApp" di luar modal
async function openWhatsAppUpgrade() {
    const btn = document.getElementById('wa-upgrade-cta-btn');
    const isRealUser = AUTH.user && !AUTH.user.isGuest && !window._guestMode;

    // Loading state
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Menyiapkan pesan...'; }

    let memberId = 'Guest';
    let email    = 'Guest';

    if (isRealUser) {
        email = AUTH.user?.email || 'unknown@email.com';
        try {
            memberId = await getOrCreateMemberId();
        } catch(e) {
            memberId = AUTH.user?.uid ? AUTH.user.uid.slice(0,8).toUpperCase() : 'UNKNOWN';
        }
    }

    const msg  = _buildUpgradeMessage(memberId, email);
    const url  = `https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener');

    // Restore button
    if (btn) { btn.disabled = false; btn.innerHTML = '<span style="font-size:18px">💬</span> Upgrade Premium via WhatsApp'; }
}

async function showPremiumModal() {
    const m = document.getElementById('premium-modal');
    if (!m) return;

    // Show modal immediately, populate identity async
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Reset scroll to top (the sheet is the last child of the modal overlay)
    requestAnimationFrame(() => {
        const sheet = m.lastElementChild;
        if (sheet) sheet.scrollTop = 0;
    });

    const midEl       = document.getElementById('pm-member-id');
    const emailEl     = document.getElementById('pm-email');
    const waBtn       = document.getElementById('pm-wa-btn');
    const confirmBtn  = document.getElementById('pm-confirm-btn');
    const guestNote   = document.getElementById('pm-guest-note');
    const msgPrev     = document.getElementById('pm-msg-preview');

    const isRealUser = AUTH.user && !AUTH.user.isGuest && !window._guestMode;

    if (isRealUser) {
        const email    = AUTH.user.email || 'unknown@email.com';
        const name     = AUTH.user.displayName || AUTH.user.email?.split('@')[0] || '—';
        if (emailEl)  emailEl.textContent = email;
        if (midEl)    midEl.textContent   = '...';
        if (guestNote) guestNote.style.display = 'none';

        try {
            const memberId = await getOrCreateMemberId();
            if (midEl) midEl.textContent = memberId;

            // Build pre-filled WA message — upgrade inquiry
            const msg = _buildUpgradeMessage(memberId, email);
            if (waBtn) {
                waBtn.href = `https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(msg)}`;
            }
            // Wire up confirm button — payment confirmation message
            if (confirmBtn) {
                const confirmMsg = _buildPaymentConfirmMessage(memberId, email, name);
                confirmBtn.onclick = () => {
                    closePremiumModal();
                    window.open(`https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(confirmMsg)}`, '_blank', 'noopener');
                };
            }
            // Show message preview in modal
            if (msgPrev) {
                msgPrev.textContent = msg;
                msgPrev.parentElement.style.display = 'flex';
            }
        } catch(e) {
            if (midEl) midEl.textContent = 'Error';
            if (waBtn) waBtn.href = `https://wa.me/${ADMIN_WA_NUMBER}`;
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    closePremiumModal();
                    window.open(`https://wa.me/${ADMIN_WA_NUMBER}`, '_blank', 'noopener');
                };
            }
        }
    } else {
        // Guest / not logged in
        const fallbackMsg = _buildUpgradeMessage('Guest', 'Guest');
        const confirmFallback = _buildPaymentConfirmMessage('—', '—', '—');
        if (midEl)    midEl.textContent   = 'Login diperlukan';
        if (emailEl)  emailEl.textContent = '—';
        if (guestNote) guestNote.style.display = 'flex';
        if (waBtn) {
            waBtn.href = `https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(fallbackMsg)}`;
        }
        if (confirmBtn) {
            confirmBtn.onclick = () => {
                closePremiumModal();
                window.open(`https://wa.me/${ADMIN_WA_NUMBER}?text=${encodeURIComponent(confirmFallback)}`, '_blank', 'noopener');
            };
        }
        if (msgPrev) {
            msgPrev.textContent = fallbackMsg;
            msgPrev.parentElement.style.display = 'flex';
        }
    }
}
function closePremiumModal() {
    const m = document.getElementById('premium-modal');
    if (!m) return;
    m.style.display = 'none';
    // Restore scroll
    document.body.style.overflow = '';
}

// ── Block helper: call at top of guarded functions ───
function _requireAccess(feature, param, label) {
    if (!canAccess(feature, param)) {
        showPremiumModal();
        console.warn(`[ACCESS BLOCKED] ${label || feature} — upgrade to Premium`);
        return false;
    }
    return true;
}

// ════════════════════════════════════════════════════════
// AUTH CHOICE SCREEN LOGIC
// ════════════════════════════════════════════════════════
let _acMode = 'login';

function showAuthChoice() {
    const el = document.getElementById('auth-choice');
    if (el) { el.style.display = 'flex'; }
    acShowChoices();
}

function hideAuthChoice() {
    const el = document.getElementById('auth-choice');
    if (el) el.style.display = 'none';
}

function acShowChoices() {
    document.getElementById('auth-choice-buttons').style.display = 'flex';
    document.getElementById('auth-choice-form').style.display    = 'none';
    document.getElementById('auth-choice-form').style.flexDirection = '';
}

function acShowForm(mode) {
    _acMode = mode;
    document.getElementById('auth-choice-buttons').style.display = 'none';
    const form = document.getElementById('auth-choice-form');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';

    const nameWrap    = document.getElementById('ac-name-wrap');
    const confirmWrap = document.getElementById('ac-confirm-wrap');
    const title       = document.getElementById('ac-form-title');
    const submit      = document.getElementById('ac-submit');
    const toggleLabel = document.getElementById('ac-toggle-label');
    const toggle      = document.getElementById('ac-toggle');
    const errEl       = document.getElementById('ac-error');
    if (errEl) errEl.style.display = 'none';
    const successEl   = document.getElementById('ac-success');
    if (successEl) successEl.style.display = 'none';
    const forgotWrap  = document.getElementById('ac-forgot-wrap');

    if (mode === 'register') {
        if (nameWrap)    nameWrap.style.display    = '';
        if (confirmWrap) confirmWrap.style.display = '';
        if (title)       title.textContent = 'Daftar Akun';
        if (submit)      submit.textContent = '✨ Buat Akun';
        if (toggleLabel) toggleLabel.textContent = 'Sudah punya akun?';
        if (toggle)      toggle.textContent = 'Masuk';
        if (forgotWrap)  forgotWrap.style.display = 'none';
        document.getElementById('ac-password')?.setAttribute('autocomplete','new-password');
    } else {
        if (nameWrap)    nameWrap.style.display    = 'none';
        if (confirmWrap) confirmWrap.style.display = 'none';
        if (title)       title.textContent = 'Masuk';
        if (submit)      submit.textContent = '🔐 Masuk';
        if (toggleLabel) toggleLabel.textContent = 'Belum punya akun?';
        if (toggle)      toggle.textContent = 'Daftar';
        if (forgotWrap)  forgotWrap.style.display = '';
        document.getElementById('ac-password')?.setAttribute('autocomplete','current-password');
    }
    setTimeout(() => document.getElementById('ac-email')?.focus(), 80);
}

function acToggleMode() {
    acShowForm(_acMode === 'login' ? 'register' : 'login');
}

function acShowError(msg) {
    const el = document.getElementById('ac-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    // Sembunyikan success jika ada
    const s = document.getElementById('ac-success');
    if (s) s.style.display = 'none';
}

function acShowSuccess(msg) {
    const el = document.getElementById('ac-success');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    // Sembunyikan error jika ada
    const e = document.getElementById('ac-error');
    if (e) e.style.display = 'none';
}

async function acForgotPassword() {
    const email = document.getElementById('ac-email')?.value?.trim();
    if (!email) {
        acShowError('Masukkan email kamu dulu, lalu tekan Lupa Password.');
        return;
    }
    const btn = document.querySelector('#ac-forgot-wrap button');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengirim...'; }
    try {
        await _fbAuth.sendPasswordResetEmail(email);
        acShowSuccess(`✅ Link reset password dikirim ke ${email}. Cek inbox atau folder spam.`);
    } catch(e) {
        acShowError(mapFirebaseError(e.code));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Lupa Password?'; }
    }
}

// ── Auth loading state ──────────────────────────────────
// acSetLoading(true)  → disable tombol, mulai safety timer
// acSetLoading(false) → clear timer ONLY (tidak reset form/button text)
//   Form/button reset dilakukan oleh:
//   - _enterApp()                 (login sukses)
//   - _acReleaseLoadingOnError()  (error)
//
// Safety timer rules:
//   - TIDAK fire jika _firebaseInitFired masih false (Firebase belum siap sama sekali)
//   - TIDAK fire jika AUTH_STATE sudah berubah dari "loading" (berarti auth selesai)
//   - TIDAK fire jika btn sudah re-enabled (berarti _enterApp atau error handler sudah jalan)
//   - Timeout 30s — cukup untuk koneksi lambat dan Firestore fetch sekaligus
function acSetLoading(on) {
    const btn = document.getElementById('ac-submit');
    if (!btn) return;
    btn.disabled = on;
    btn.style.opacity = on ? '0.65' : '';
    if (on) {
        btn.textContent = '⏳ Memproses...';
        clearTimeout(window._acLoadingTimer);
        window._acLoadingTimer = setTimeout(() => {
            // Guard 1: Firebase belum pernah fire sama sekali — bukan timeout, masih loading
            if (!_firebaseInitFired) return;
            // Guard 2: Button sudah di-release (sukses atau error sudah ditangani)
            if (!btn.disabled) return;
            // Guard 3: AUTH sudah resolved — berarti _enterApp() yang lambat, bukan network
            if (AUTH_STATE !== "loading") {
                // Silently release — onAuthStateChanged/enterApp sedang proses
                btn.disabled = false;
                btn.style.opacity = '';
                return;
            }
            // Benar-benar timeout: Firebase Auth dan Firestore tidak merespons dalam 30s
            console.warn('[AUTH] LOGIN_TIMEOUT_TRIGGERED — 30s elapsed, no Firebase response');
            _acReleaseLoadingOnError('⚠️ Koneksi lambat atau tidak ada internet. Coba lagi.');
        }, 30000); // 30s — tolerant of slow connections + Firestore
    } else {
        clearTimeout(window._acLoadingTimer);
    }
}

// Dipanggil HANYA saat ada error — reset UI ke state normal
function _acReleaseLoadingOnError(errMsg) {
    clearTimeout(window._acLoadingTimer);
    const btn = document.getElementById('ac-submit');
    if (btn) {
        btn.disabled = false;
        btn.style.opacity = '';
    }
    acShowForm(_acMode); // restore form dan button text
    if (errMsg) acShowError(errMsg);
}

async function acSubmit() {
    const email    = document.getElementById('ac-email')?.value?.trim();
    const password = document.getElementById('ac-password')?.value;
    const errEl    = document.getElementById('ac-error');
    if (errEl) errEl.style.display = 'none';

    if (!email)    { acShowError('Masukkan email kamu.'); return; }
    if (!password) { acShowError('Masukkan password kamu.'); return; }

    if (_acMode === 'register') {
        const name    = document.getElementById('ac-name')?.value?.trim();
        const confirm = document.getElementById('ac-confirm')?.value;
        if (!name)             { acShowError('Masukkan nama kamu.'); return; }
        if (password !== confirm) { acShowError('Password tidak cocok.'); return; }
        if (password.length < 6)  { acShowError('Password minimal 6 karakter.'); return; }
        acSetLoading(true);
        try {
            console.log('[AUTH] SIGNIN_REQUEST — mode: register | email:', email);
            const cred = await _fbAuth.createUserWithEmailAndPassword(email, password);
            await cred.user.updateProfile({ displayName: name });
            // Firebase Auth + profile update resolved → clear timer now.
            // onAuthStateChanged will fire → _enterApp() → release loading UI.
            clearTimeout(window._acLoadingTimer);
            const regErrEl = document.getElementById('ac-error');
            if (regErrEl) regErrEl.style.display = 'none';
            console.log('[AUTH] REGISTER_SUCCESS — Firebase Auth resolved, awaiting Firestore');
        } catch(e) {
            _acReleaseLoadingOnError(mapFirebaseError(e.code));
        }
    } else {
        acSetLoading(true);
        try {
            console.log('[AUTH] SIGNIN_REQUEST — mode: login | email:', email);
            await _fbAuth.signInWithEmailAndPassword(email, password);
            // Firebase Auth resolve = login berhasil.
            // Clear timer sekarang — Firestore fetch berjalan di onAuthStateChanged,
            // bukan bagian dari "timeout". _enterApp() yang akan release loading UI.
            clearTimeout(window._acLoadingTimer);
            // Clear error UI yang mungkin masih tampil dari percobaan sebelumnya
            const errEl = document.getElementById('ac-error');
            if (errEl) errEl.style.display = 'none';
            console.log('[AUTH] LOGIN_SUCCESS — Firebase Auth resolved, awaiting Firestore');
        } catch(e) {
            _acReleaseLoadingOnError(mapFirebaseError(e.code));
        }
    }
}

// ── Guest mode badge — show/hide in header ────────────────
// This is the ONLY place guest mode indicator is managed.
function _updateGuestBadge() {
    let badge = document.getElementById('guest-mode-badge');
    if (window._guestMode === true) {
        if (!badge) {
            // Create badge and insert into header-actions
            const headerActions = document.querySelector('.header-actions');
            if (headerActions) {
                badge = document.createElement('div');
                badge.id = 'guest-mode-badge';
                badge.title = 'Mode Tamu — Bab 1–3 Gratis';
                badge.style.cssText = [
                    'display:flex;align-items:center;gap:4px',
                    'padding:4px 9px;border-radius:99px',
                    'background:rgba(251,146,60,.15)',
                    'border:1px solid rgba(251,146,60,.35)',
                    'font-size:10px;font-weight:700;color:#fb923c',
                    'letter-spacing:.02em;cursor:pointer;flex-shrink:0',
                    'white-space:nowrap'
                ].join(';');
                badge.innerHTML = '👤 TAMU';
                badge.onclick = () => showPremiumModal();
                // Insert before the profile button
                const profileBtn = document.getElementById('btn-profile');
                if (profileBtn) {
                    headerActions.insertBefore(badge, profileBtn);
                } else {
                    headerActions.appendChild(badge);
                }
            }
        } else {
            badge.style.display = 'flex';
        }
    } else {
        if (badge) badge.style.display = 'none';
    }
}

function acEnterGuest() {
    // FIX: Don't await signOut — set guest state atomically first,
    // then fire signOut in background. onAuthStateChanged will fire
    // but guestFlag check prevents it from overriding guest state.
    try { localStorage.setItem(GUEST_KEY, '1'); } catch(e) {}
    window._guestMode = true;
    AUTH.user = { name: 'Tamu', email: '', avatar: '👤', isGuest: true, isPremium: false, joinedAt: new Date().toISOString() };
    _setAuthState("guest");
    // Sign out any Firebase session silently (non-blocking)
    _fbAuth.currentUser ? _fbAuth.signOut().catch(()=>{}) : Promise.resolve();
    hideAuthChoice();
    _hideSplash();
    updateProfileUI();
    _updateGuestBadge();      // FIX: show TAMU badge in header
    renderChapterListHome();
    renderChapterPicker();    // FIX: re-render chapter picker so locked chapters appear disabled
    // Re-render premium-gated pages so guest mode is reflected immediately.
    // Without this, the containers show stale pre-auth content.
    console.log('[AUTH] KOTOBA_RENDER — triggered from acEnterGuest');
    renderKotobaPage();
    console.log('[AUTH] GRAMMAR_RENDER — triggered from acEnterGuest');
    renderDailyChallenge();
    // FIX v2.6.1: Show upgrade CTA for guest users
    _syncUpgradeUI();
    console.log('[AUTH] GUEST MODE ENTERED');
}

// ════════════════════════════════════════════════════════
// FIREBASE INIT
// ════════════════════════════════════════════════════════
const firebaseConfig = {
    apiKey: "AIzaSyC7dgAO9-nOdK_p-Z7ZhJms03mjeT5m3eI",
    authDomain: "mnn-learn.firebaseapp.com",
    projectId: "mnn-learn",
    storageBucket: "mnn-learn.firebasestorage.app",
    messagingSenderId: "69394475221",
    appId: "1:69394475221:web:9e4f6c9dea5504f59d1a5c",
    measurementId: "G-L9EVXVYSSQ"
};
console.log('[AUTH] AUTH_INIT_START — initializing Firebase SDK');
firebase.initializeApp(firebaseConfig);
const _fbAuth = firebase.auth();
const _fbDb  = firebase.firestore();   // ← Firestore instance
// Session persistence: LOCAL (survive page refresh + app reopen)
_fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
console.log('[AUTH] Firebase SDK initialized');

// ════════════════════════════════════════════════════════
// AUTH OBJECT — backed by Firebase Auth
// Internal structure preserved. Firebase drives state.
// ════════════════════════════════════════════════════════
const AUTH = {
    user: null,   // { name, email, avatar, joinedAt, uid }

    // Populate AUTH.user dari Firebase User object (TANPA isPremium — diisi oleh Firestore)
    _setFromFB(fbUser) {
        if (!fbUser) { this.user = null; return; }
        const cached = this._loadCache();

        // ── STALE-FALSE PREVENTION ──────────────────────────────────────────────
        // During mid-session token refresh, onAuthStateChanged fires again while
        // AUTH_STATE is already "authenticated". If we reset isPremium to false here,
        // there is a race window (300ms–2s) where isPremiumUser() returns false while
        // Firestore is in-flight. Carry over the confirmed value; Firestore will
        // authoritatively overwrite it once the fetch completes.
        // On first login, this.user is null → prevIsPremium = false (correct default).
        const prevIsPremium = this.user?.isPremium === true;
        const prevMemberId  = this.user?.memberId || null;

        this.user = {
            uid:       fbUser.uid,
            email:     fbUser.email || '',
            name:      fbUser.displayName || cached?.name || fbUser.email?.split('@')[0] || 'Pengguna',
            avatar:    (fbUser.displayName || fbUser.email || 'P')[0].toUpperCase(),
            joinedAt:  fbUser.metadata?.creationTime || cached?.joinedAt || new Date().toISOString(),
            isPremium: prevIsPremium,  // carry over; Firestore fetch will authoritatively overwrite
            memberId:  prevMemberId || cached?.memberId || null,  // carry over; Firestore/getOrCreateMemberId will fill
        };
        console.log('[AUTH_USER_STATE] _setFromFB — uid:', fbUser.uid,
                    '| prevIsPremium carried:', prevIsPremium,
                    '| AUTH_STATE:', AUTH_STATE);
        // JANGAN simpan cache di sini — tunggu sampai isPremium diisi Firestore
    },

    // Fast localStorage cache — hanya untuk nama/avatar, BUKAN isPremium
    _saveCache() {
        try {
            if (this.user) {
                // Simpan tanpa isPremium — selalu fresh dari Firestore
                const { isPremium, ...safeUser } = this.user;
                localStorage.setItem('mnn_user', JSON.stringify(safeUser));
            }
        } catch(e) {}
    },
    _loadCache() {
        try {
            const s = localStorage.getItem('mnn_user');
            if (!s) return null;
            const data = JSON.parse(s);
            // SECURITY: isPremium is NEVER read from localStorage.
            // It is always fetched fresh from Firestore via onAuthStateChanged.
            // This delete is a belt-and-suspenders guard against stale cache.
            delete data.isPremium;
            return data;
        } catch(e) { return null; }
    },
    _clearCache() {
        try { localStorage.removeItem('mnn_user'); } catch(e) {}
    },

    // Legacy shims (kept so existing call-sites don't break)
    load() {
        // No-op: replaced by onAuthStateChanged below
        const cached = this._loadCache();
        if (cached) { this.user = cached; } // fast paint until Firebase resolves
    },
    save() { this._saveCache(); },

    // Logout via Firebase (or clear guest)
    logout() {
        clearTimeout(window._profileAuthTimer); // FIX: clear profile-sheet loading timer if mid-auth
        // [PROGRESS_SYNC v2.7.4] simpan progress sebelum logout
        try { if (window.PROGRESS_SYNC) window.PROGRESS_SYNC.pushNow(); } catch(e) {}
        if (window._guestMode) {
            window._guestMode = false;
            try { localStorage.removeItem('mnn_guest'); } catch(e) {}
            AUTH.user = null;
            AUTH._clearCache();
            updateProfileUI();
            closeProfileSheet();
            showAuthChoice();
        } else {
            // ONLY trigger signOut — onAuthStateChanged null-path handles ALL UI updates.
            // No setTimeout here: showAuthChoice() is now called inside the auth listener's
            // mid-session sign-out branch, eliminating the race condition.
            _fbAuth.signOut().catch(e => console.warn('[AUTH] signOut error:', e));
            console.log('[AUTH] SIGNOUT_TRIGGERED — awaiting onAuthStateChanged for UI update');
        }
    },

    isLoggedIn() { return !!this.user; }
};

// ════════════════════════════════════════════════════════
// onAuthStateChanged — Splash Gate + single source of truth
// [FIX] Expose AUTH ke window supaya PROGRESS_SYNC._getUid() bisa akses
window.AUTH = AUTH;

// ════════════════════════════════════════════════════════
// ── AUTH STATE MACHINE ─────────────────────────────────
// "loading"         → Firebase onAuthStateChanged has NOT fired yet
// "authenticated"   → Firebase user confirmed + Firestore fetched
// "guest"           → explicit guest mode
// "unauthenticated" → Firebase confirmed no user
//
// _firebaseInitFired: true setelah onAuthStateChanged pertama kali fire.
//   Digunakan oleh acSetLoading timer agar tidak fire "Koneksi lambat"
//   sebelum Firebase punya kesempatan merespons sama sekali.
let AUTH_STATE = "loading";    // public state
let _authResolved = false;     // legacy compat — mirrors AUTH_STATE !== "loading"
let _firebaseInitFired = false; // true setelah onAuthStateChanged fire pertama kali

function _setAuthState(state) {
    AUTH_STATE = state;
    _authResolved = (state !== "loading");
    console.log("[AUTH_STATE] →", state);
}

function _hideSplash() {
    const s = document.getElementById('splash');
    if (!s) return;
    // Smooth splash exit
    s.style.transition = 'opacity .45s cubic-bezier(.4,0,1,1)';
    s.style.opacity = '0';
    setTimeout(() => {
        s.remove();
        // Animate app content in after splash leaves
        document.body.style.opacity = '0';
        document.body.style.transition = 'none';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                document.body.style.transition = 'opacity .4s cubic-bezier(.2,0,.4,1)';
                document.body.style.opacity = '1';
            });
        });
    }, 420);
}

function _enterApp() {
    console.log('[AUTH] AUTH_READY — state:', AUTH_STATE, '| isPremium:', isPremiumUser());
    console.log('[AUTH] PREMIUM_STATE_FINAL — isPremiumUser():', isPremiumUser(),
                '| AUTH.user.isPremium:', AUTH.user?.isPremium);

    // ── 1. Release all loading/timer state ──
    clearTimeout(window._acLoadingTimer);
    clearTimeout(window._profileAuthTimer); // FIX: also clear profile-sheet auth timer
    const acBtn = document.getElementById('ac-submit');
    if (acBtn) {
        acBtn.disabled = false;
        acBtn.style.opacity = '';
        // Restore button text — prevents stale "⏳ Memproses..." if auth overlay reopens
        acBtn.textContent = _acMode === 'register' ? '✨ Buat Akun' : '🔐 Masuk';
    }
    setAuthLoading(false);  // second auth form (profile sheet)
    console.log('[AUTH] UI_RENDER — loading state cleared');

    // ── 2. Clear any stale error UI (e.g. from previous failed attempt) ──
    const acErr = document.getElementById('ac-error');
    if (acErr) { acErr.style.display = 'none'; acErr.textContent = ''; }
    const authErr = document.getElementById('auth-error');
    if (authErr) { authErr.style.display = 'none'; authErr.textContent = ''; }
    console.log('[AUTH] ERROR_CLEARED_AFTER_SUCCESS');

    // ── 3. Hide auth UI, show app ──
    hideAuthChoice();
    _hideSplash();

    // ── 4. Personalize greeting ──
    updateProfileUI();
    _updateGuestBadge();   // FIX: sync guest badge every time auth state resolves
    const greetEl = document.getElementById('dashboard-greeting-sub');
    if (greetEl && AUTH.isLoggedIn()) {
        const h = new Date().getHours();
        const sapaan = h < 11 ? 'おはよう' : h < 18 ? 'こんにちは' : 'こんばんは';
        greetEl.textContent = sapaan + '、' + AUTH.user.name + '！ Selamat belajar 👋';
    }

    // ── 5. Re-render ALL premium-gated sections with live isPremiumUser() ──
    _syncUpgradeUI();   // sync upgrade CTA visibility in Settings
    renderChapterListHome();
    renderChapterPicker();
    // Kotoba and Grammar Challenge must re-evaluate gate at render time
    console.log('[AUTH] KOTOBA_RENDER — triggered from _enterApp');
    renderKotobaPage();
    console.log('[AUTH] GRAMMAR_RENDER — triggered from _enterApp');
    renderDailyChallenge();

    // ── 6. Re-render profile sheet if it was open (covers mid-session re-login) ──
    const _profileSheet = document.getElementById('profile-sheet');
    if (_profileSheet?.classList.contains('open')) {
        renderProfilePanel(document.getElementById('profile-panel-inner'));
    }

    console.log('[AUTH] SOURCE_OF_TRUTH_TRIGGERED — all UI updates routed through auth listener');
    console.log('[AUTH] UI_UPDATED_BY_AUTH_LISTENER — state:', AUTH_STATE, '| isPremium:', isPremiumUser());
}

_fbAuth.onAuthStateChanged(async fbUser => {
    // Mark Firebase as having fired at least once — acSetLoading timer guard uses this
    _firebaseInitFired = true;

    console.log('[AUTH] STATE_CHANGED — fbUser:', fbUser ? fbUser.uid : 'null',
                '| authResolved:', _authResolved, '| AUTH_STATE:', AUTH_STATE);

    console.log('[AUTH] AUTH_INIT_START — fbUser:', fbUser ? fbUser.uid : 'null',
                '| authResolved:', _authResolved);

    const guestFlag = (() => { try { return localStorage.getItem('mnn_guest') === '1'; } catch(e) { return false; } })();

    if (fbUser) {
        console.log('[AUTH] FIREBASE USER DETECTED — uid:', fbUser.uid);

        // Clear guest state — Firebase user takes precedence
        window._guestMode = false;
        try { localStorage.removeItem('mnn_guest'); } catch(e) {}

        AUTH._setFromFB(fbUser);  // populate AUTH.user without isPremium

        // ── FIRESTORE SYNC: fetch isPremium from users/{uid} ──────────────────
        try {
            console.log('[AUTH] FIRESTORE_FETCH — starting fetch for users/' + fbUser.uid);
            console.log('[AUTH] Fetching Firestore users/' + fbUser.uid + '...');
            const snap = await _fbDb.collection('users').doc(fbUser.uid).get();
            if (snap.exists) {
                const data = snap.data();
                console.log('[AUTH] FIRESTORE FETCH DONE — data:', JSON.stringify(data));
                console.log('[FIRESTORE_SOURCE_OF_TRUTH] Writing isPremium:', data.isPremium === true,
                            '| raw value:', data.isPremium, '| uid:', fbUser.uid);
                AUTH.user.isPremium = data.isPremium === true;
                // Load memberId if it exists in Firestore
                if (data.memberId) {
                    AUTH.user.memberId = data.memberId;
                    try { localStorage.setItem('mnn_member_id', data.memberId); } catch(e) {}
                    console.log('[MEMBER_ID] Loaded from Firestore on auth:', data.memberId);
                }
                // [PROGRESS_SYNC v2.7.4] Restore progress dari Firestore cloud backup
                // Ini fix untuk progress hilang saat ganti domain / device baru
                try {
                    const restored = PROGRESS_SYNC.pull(data);
                    if (restored) console.log('[PROGRESS_SYNC] Progress restored from cloud backup');
                } catch(psErr) { console.warn('[PROGRESS_SYNC] pull error:', psErr.message); }
            } else {
                console.warn('[AUTH] FIRESTORE FETCH DONE — doc not found, isPremium = false');
                console.log('[FIRESTORE_SOURCE_OF_TRUTH] Doc not found — writing isPremium: false | uid:', fbUser.uid);
                AUTH.user.isPremium = false;
            }
        } catch (fsErr) {
            console.error('[AUTH] FIRESTORE FETCH GAGAL:', fsErr.message, '— fallback isPremium = false');
            console.log('[FIRESTORE_SOURCE_OF_TRUTH] Fetch error — writing isPremium: false | uid:', fbUser.uid);
            AUTH.user.isPremium = false;
        }

        console.log('[AUTH] FIRESTORE_USER_LOADED — isPremium:', AUTH.user.isPremium);
        console.log('[AUTH] USER_LOADED — uid:', AUTH.user.uid, '| name:', AUTH.user.name,
                    '| isPremium:', AUTH.user.isPremium, '| AUTH_STATE will →', _authResolved ? 'authenticated(mid)' : 'authenticated(first)');
        console.log('[AUTH] PREMIUM_STATE_FINAL — isPremiumUser():', isPremiumUser());

        // Save cache AFTER isPremium is set (isPremium itself excluded from cache)
        AUTH._saveCache();

        if (!_authResolved) {
            // ── First-time auth resolution: enter app ──
            _setAuthState("authenticated");
            console.log('[AUTH] AUTH_READY — entering app (first resolution)');
            _enterApp();  // handles all re-renders + error clear + loading release
            console.log('[AUTH] UI RENDER COMPLETE');
        } else {
            // ── Mid-session: re-login after logout or token refresh ──────────────
            // SINGLE RENDER PATH: _enterApp() is now the only place that updates UI.
            // No inline duplicates here — Firebase auth listener is the sole controller.
            _setAuthState("authenticated");
            console.log('[AUTH] SOURCE_OF_TRUTH_TRIGGERED — mid-session re-auth, routing to _enterApp');
            _enterApp();
            console.log('[AUTH] UI RENDER COMPLETE (mid-session via _enterApp)');
        }

    } else if (guestFlag && !fbUser) {
        // ── Guest mode ─────────────────────────────────────────────────────
        console.log('[AUTH] GUEST MODE — localStorage flag detected');
        window._guestMode = true;
        if (!AUTH.user || AUTH.user.uid) {
            AUTH.user = { name: 'Tamu', email: '', avatar: '👤', isGuest: true, isPremium: false, joinedAt: new Date().toISOString() };
        }
        if (!_authResolved) {
            _setAuthState("guest");
            console.log('[AUTH] AUTH_READY — guest mode');
            _enterApp();
        } else {
            // FIX: Mid-session re-entry into guest mode (e.g., after offline reconnect
            // or back-button from a premium page). Must still update UI.
            _setAuthState("guest");
            console.log('[AUTH] SOURCE_OF_TRUTH_TRIGGERED — mid-session guest re-entry');
            _enterApp();
        }

    } else {
        // ── No user, not guest → show auth screen ──────────────────────────
        console.log('[AUTH] AUTH_READY. No user — ' + (_authResolved ? 'logged out' : 'initial load'));
        window._guestMode = false;
        AUTH._setFromFB(null);
        AUTH._clearCache();
        if (!_authResolved) {
            _setAuthState("unauthenticated");
            // Release any in-flight loading state WITHOUT showing an error
            // (this is normal initial state, not a network failure)
            _acReleaseLoadingOnError(null);
            setAuthLoading(false);
            _hideSplash();
            setTimeout(showAuthChoice, 80);
        } else {
            // Mid-session sign-out — auth listener is the ONLY controller of post-logout UI.
            // showAuthChoice() is called HERE, not in AUTH.logout(). This eliminates the
            // race condition where logout()'s setTimeout raced with onAuthStateChanged.
            _setAuthState("unauthenticated");
            console.log('[AUTH] SOURCE_OF_TRUTH_TRIGGERED — mid-session sign-out');
            console.log('[AUTH] UI_UPDATED_BY_AUTH_LISTENER — post-signout cleanup');
            updateProfileUI();
            renderChapterListHome();
            renderKotobaPage();
            renderDailyChallenge();
            setTimeout(showAuthChoice, 80);
        }
    }
});

function updateProfileUI() {
    const btn    = document.getElementById('btn-profile');
    const icon   = document.getElementById('profile-avatar-icon');
    const dot    = document.getElementById('profile-online-dot');
    if (!btn) return;
    if (AUTH.isLoggedIn()) {
        btn.classList.add('is-logged-in');
        btn.style.background = window._guestMode ? '' : 'var(--accent-primary)';
        if (icon) {
            icon.textContent  = AUTH.user.avatar;
            icon.style.color  = window._guestMode ? '' : '#0f0f1e';
            icon.style.fontWeight = '800';
            icon.style.fontSize   = '14px';
        }
        if (dot) dot.style.display = window._guestMode ? 'none' : 'block';
    } else {
        btn.classList.remove('is-logged-in');
        btn.style.background = '';
        if (icon) { icon.textContent = '👤'; icon.style.color = ''; icon.style.fontWeight = ''; icon.style.fontSize = ''; }
        if (dot) dot.style.display = 'none';
    }
    // FIX: always sync guest badge whenever profile UI is updated
    if (typeof _updateGuestBadge === 'function') _updateGuestBadge();
}

function openProfileSheet() {
    const sheet = document.getElementById('profile-sheet');
    const panel = document.getElementById('profile-panel-inner');
    if (!sheet || !panel) return;
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderProfilePanel(panel);
}

function closeProfileSheet() {
    const sheet = document.getElementById('profile-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    document.body.style.overflow = '';
}

function renderProfilePanel(panel) {
    if (AUTH.isLoggedIn()) {
        const u = AUTH.user;
        const learnedCount = STATE.learnedCards ? STATE.learnedCards.size : 0;
        const totalVocab = getAllVocabCount();
        const pct = totalVocab ? Math.round((learnedCount/totalVocab)*100) : 0;
        const joined = u.joinedAt ? new Date(u.joinedAt).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '—';
        const isPrem = isPremiumUser();
        const memberIdText = (u.memberId) ? `<div style="font-size:10px;color:var(--text-muted);text-align:center;margin-top:-4px;font-family:monospace;letter-spacing:.04em">${escHTML(u.memberId)}</div>` : '';
        const premBadge = isPrem
            ? `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:99px;background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.35);font-size:11px;font-weight:700;color:#a78bfa">👑 Member Premium</div>`
            : `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:99px;background:rgba(251,146,60,.12);border:1px solid rgba(251,146,60,.3);font-size:11px;font-weight:700;color:#fb923c">🔓 Mode Gratis</div>`;
        // Use GAMIFY SVG avatar if available, fallback to text avatar
        const _gfyAvatarHtml = (typeof GAMIFY !== 'undefined' && GAMIFY.getAvatarSvg && GAMIFY.getSelectedAvatarId)
            ? `<div class="profile-avatar-big" style="font-size:0">${GAMIFY.getAvatarSvg(GAMIFY.getSelectedAvatarId())}</div>`
            : `<div class="profile-avatar-big">${escHTML(u.avatar)}</div>`;
        const upgradeCTA = isPrem ? '' : `
            <button class="profile-action-item" onclick="closeProfileSheet(); showPremiumModal();"
              style="background:linear-gradient(135deg,rgba(34,197,94,.1),rgba(22,163,74,.07));border:1.5px solid rgba(34,197,94,.3);border-radius:14px;margin-bottom:4px">
              <span class="profile-action-icon">👑</span>
              <div style="flex:1">
                <div class="profile-action-label" style="color:#22c55e">Upgrade Premium</div>
                <div class="profile-action-sub">50 Pelajaran · 767 Kosakata · 352 Kanji</div>
              </div>
              <span style="font-size:11px;color:#22c55e;font-weight:700">via WA →</span>
            </button>`;
        panel.innerHTML = `
          <div class="profile-sheet-handle"></div>
          ${_gfyAvatarHtml}
          <div class="profile-name">${escHTML(u.name)}</div>
          <div class="profile-email">${escHTML(u.email)}</div>
          ${memberIdText}
          <div style="margin-top:-4px">${premBadge}</div>
          <div class="profile-stats-row">
            <div class="profile-stat-box">
              <div class="profile-stat-val">${learnedCount}</div>
              <div class="profile-stat-lbl">Dipelajari</div>
            </div>
            <div class="profile-stat-box">
              <div class="profile-stat-val">${pct}%</div>
              <div class="profile-stat-lbl">Progress</div>
            </div>
            <div class="profile-stat-box">
              <div class="profile-stat-val">${totalVocab}</div>
              <div class="profile-stat-lbl">Total Kata</div>
            </div>
          </div>
          <!-- Gamification Stats -->
          <div id="gfy-profile-inject" style="width:100%"></div>
          <div class="profile-action-list">
            ${upgradeCTA}
            <button class="profile-action-item" onclick="renderProfileEdit(document.getElementById('profile-panel-inner'))">
              <span class="profile-action-icon">✏️</span>
              <div><div class="profile-action-label">Edit Profil</div><div class="profile-action-sub">Ubah nama & email</div></div>
            </button>
            <button class="profile-action-item" onclick="closeProfileSheet();navigateTo('kotoba')">
              <span class="profile-action-icon">📚</span>
              <div><div class="profile-action-label">Ensiklopedia Kosakata</div><div class="profile-action-sub">Semua kata dari Buku I & II</div></div>
            </button>
            <button class="profile-action-item danger" onclick="if(confirm('Yakin keluar?')){AUTH.logout();closeProfileSheet();}">
              <span class="profile-action-icon">🚪</span>
              <div><div class="profile-action-label">Keluar</div><div class="profile-action-sub">Logout dari akun ini</div></div>
            </button>
          </div>
          <p style="font-size:10px;color:var(--text-muted);text-align:center">Bergabung sejak ${joined}</p>`;
        // Inject gamification stats section
        const _gfyInj = panel.querySelector('#gfy-profile-inject');
        if (_gfyInj && typeof GAMIFY !== 'undefined') _gfyInj.innerHTML = GAMIFY.getProfileSection();
    } else {
        panel.innerHTML = `
          <div class="profile-sheet-handle"></div>
          <div class="profile-avatar-big">🎌</div>
          <div class="profile-name" id="auth-form-title">Masuk</div>
          <div class="profile-email" id="auth-form-sub" style="margin-top:-8px">Masuk untuk menyimpan progress belajarmu</div>

          <div class="profile-login-form" id="profile-login-form">
            <!-- Register-only field -->
            <div id="field-name-wrap" style="display:none">
              <input class="profile-input" id="login-name" placeholder="Nama lengkap kamu" autocomplete="name" />
            </div>
            <input class="profile-input" id="login-email" placeholder="Email" type="email" autocomplete="email" inputmode="email" />
            <div style="position:relative">
              <input class="profile-input" id="login-password" placeholder="Password" type="password" autocomplete="current-password" style="padding-right:44px" />
              <button onclick="togglePwdVisibility('login-password',this)"
                style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-muted)">👁</button>
            </div>
            <!-- Confirm password — register only -->
            <div id="field-confirm-wrap" style="display:none">
              <div style="position:relative">
                <input class="profile-input" id="login-confirm" placeholder="Konfirmasi password" type="password" autocomplete="new-password" style="padding-right:44px" />
                <button onclick="togglePwdVisibility('login-confirm',this)"
                  style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-muted)">👁</button>
              </div>
            </div>

            <!-- Error display -->
            <div id="auth-error" style="display:none;padding:10px 14px;border-radius:12px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);font-size:12px;color:var(--accent-danger);font-weight:600;text-align:center"></div>

            <!-- Submit button -->
            <button class="btn-primary-full" id="auth-submit-btn" onclick="doAuthSubmit()" style="margin-top:4px">
              🔐 Masuk
            </button>

            <!-- Toggle register/login -->
            <div style="text-align:center">
              <span style="font-size:12px;color:var(--text-muted)">Belum punya akun? </span>
              <button id="auth-toggle-btn" onclick="toggleAuthMode()"
                style="background:none;border:none;color:var(--accent-primary);font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif">
                Daftar sekarang
              </button>
            </div>
          </div>`;
        // Default mode = login
        window._authMode = window._authMode || 'login';
        applyAuthMode(window._authMode);
        setTimeout(() => document.getElementById('login-email')?.focus(), 100);
    }
}

function renderProfileEdit(panel) {
    const u = AUTH.user;
    panel.innerHTML = `
      <div class="profile-sheet-handle"></div>
      <div style="font-size:18px;font-weight:700;color:var(--text-primary);text-align:center">✏️ Edit Profil</div>
      <div class="profile-login-form">
        <input class="profile-input" id="edit-name" value="${escHTML(u.name)}" placeholder="Nama tampilan" autocomplete="name" />
        <div style="padding:10px 14px;border-radius:12px;background:var(--bg-elevated);border:1px solid var(--border)">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">Email (tidak bisa diubah)</div>
          <div style="font-size:13px;color:var(--text-secondary)">${escHTML(u.email || '—')}</div>
        </div>
        <button class="btn-primary-full" onclick="doEditSave()">💾 Simpan Nama</button>
        <button class="btn-ghost" style="width:100%;justify-content:center" onclick="renderProfilePanel(document.getElementById('profile-panel-inner'))">← Kembali</button>
      </div>`;
}

// ════════════════════════════════════════════════════════
// FIREBASE AUTH UI HELPERS
// ════════════════════════════════════════════════════════

function togglePwdVisibility(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

function applyAuthMode(mode) {
    window._authMode = mode;
    const nameWrap    = document.getElementById('field-name-wrap');
    const confirmWrap = document.getElementById('field-confirm-wrap');
    const title       = document.getElementById('auth-form-title');
    const sub         = document.getElementById('auth-form-sub');
    const submitBtn   = document.getElementById('auth-submit-btn');
    const toggleBtn   = document.getElementById('auth-toggle-btn');
    const pwdInput    = document.getElementById('login-password');
    const errEl       = document.getElementById('auth-error');
    if (errEl) errEl.style.display = 'none';

    if (mode === 'register') {
        if (nameWrap)    nameWrap.style.display    = '';
        if (confirmWrap) confirmWrap.style.display = '';
        if (title)       title.textContent = 'Daftar Akun';
        if (sub)         sub.textContent = 'Buat akun untuk menyimpan progress belajarmu';
        if (submitBtn)   submitBtn.textContent = '✨ Buat Akun';
        if (toggleBtn)   toggleBtn.textContent = 'Masuk ke akun yang sudah ada';
        if (pwdInput)    pwdInput.setAttribute('autocomplete','new-password');
    } else {
        if (nameWrap)    nameWrap.style.display    = 'none';
        if (confirmWrap) confirmWrap.style.display = 'none';
        if (title)       title.textContent = 'Masuk';
        if (sub)         sub.textContent = 'Masuk untuk menyimpan progress belajarmu';
        if (submitBtn)   submitBtn.textContent = '🔐 Masuk';
        if (toggleBtn)   toggleBtn.textContent = 'Daftar sekarang';
        if (pwdInput)    pwdInput.setAttribute('autocomplete','current-password');
    }
}

function toggleAuthMode() {
    const next = window._authMode === 'login' ? 'register' : 'login';
    applyAuthMode(next);
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
}

function setAuthLoading(loading) {
    const btn = document.getElementById('auth-submit-btn');
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
        btn.textContent = '⏳ Memproses...';
        btn.style.opacity = '0.7';
        // FIX: safety timeout — release button if Firebase hangs (APK WebView)
        clearTimeout(window._profileAuthTimer);
        window._profileAuthTimer = setTimeout(() => {
            if (!btn.disabled) return; // already released
            btn.disabled = false;
            btn.style.opacity = '';
            applyAuthMode(window._authMode);
            const errEl = document.getElementById('auth-error');
            if (errEl) {
                errEl.textContent = '⚠️ Koneksi lambat atau tidak ada internet. Coba lagi.';
                errEl.style.display = '';
            }
            console.warn('[AUTH] PROFILE_AUTH_TIMEOUT — 20s elapsed, releasing profile sheet button');
        }, 20000);
    } else {
        clearTimeout(window._profileAuthTimer);
        btn.style.opacity = '';
        applyAuthMode(window._authMode); // restore text
    }
}

function mapFirebaseError(code) {
    const map = {
        'auth/invalid-email':                    'Format email tidak valid.',
        'auth/user-not-found':                   'Akun tidak ditemukan. Coba daftar dulu.',
        'auth/wrong-password':                   'Password salah. Coba lagi.',
        'auth/email-already-in-use':             'Email sudah digunakan. Coba masuk.',
        'auth/weak-password':                    'Password minimal 6 karakter.',
        'auth/too-many-requests':                'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
        'auth/network-request-failed':           '⚠️ Tidak ada koneksi internet. Periksa jaringanmu.',
        'auth/invalid-credential':               'Email atau password salah.',
        'auth/user-disabled':                    'Akun ini dinonaktifkan. Hubungi admin.',
        'auth/operation-not-allowed':            'Login dinonaktifkan sementara. Coba lagi nanti.',
        'auth/requires-recent-login':            'Sesi kadaluarsa. Silakan masuk ulang.',
        'auth/popup-closed-by-user':             'Login dibatalkan. Coba lagi.',
        'auth/account-exists-with-different-credential': 'Email sudah digunakan dengan metode login lain.',
        'auth/missing-email':                    'Masukkan email kamu.',
        'auth/internal-error':                   '⚠️ Kesalahan server. Coba lagi dalam beberapa saat.',
    };
    return map[code] || 'Terjadi kesalahan. Coba lagi.';
}

async function doAuthSubmit() {
    const email    = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const errEl    = document.getElementById('auth-error');
    if (errEl) errEl.style.display = 'none';

    if (!email)    { showAuthError('Masukkan email kamu.'); return; }
    if (!password) { showAuthError('Masukkan password kamu.'); return; }

    if (window._authMode === 'register') {
        const name    = document.getElementById('login-name')?.value?.trim();
        const confirm = document.getElementById('login-confirm')?.value;
        if (!name)            { showAuthError('Masukkan nama kamu.'); return; }
        if (!confirm)         { showAuthError('Konfirmasi password kamu.'); return; }
        if (password !== confirm) { showAuthError('Password dan konfirmasi tidak cocok.'); return; }
        if (password.length < 6)  { showAuthError('Password minimal 6 karakter.'); return; }

        setAuthLoading(true);
        try {
            console.log('[AUTH] SIGNIN_REQUEST — mode: register (profile sheet) | email:', email);
            const cred = await _fbAuth.createUserWithEmailAndPassword(email, password);
            // Set displayName
            await cred.user.updateProfile({ displayName: name });
            // onAuthStateChanged fires → _enterApp() → ALL UI updates from auth listener only.
            // Do NOT touch UI here — loading release and sheet re-render happen in _enterApp().
            console.log('[AUTH] REGISTER_REQUEST_SENT — awaiting onAuthStateChanged for UI update');
        } catch(e) {
            setAuthLoading(false);
            showAuthError(mapFirebaseError(e.code));
        }

    } else {
        // LOGIN
        setAuthLoading(true);
        try {
            console.log('[AUTH] SIGNIN_REQUEST — mode: login (profile sheet) | email:', email);
            await _fbAuth.signInWithEmailAndPassword(email, password);
            // onAuthStateChanged fires → _enterApp() → ALL UI updates from auth listener only.
            // Do NOT touch UI here — loading release and sheet re-render happen in _enterApp().
            console.log('[AUTH] LOGIN_REQUEST_SENT — awaiting onAuthStateChanged for UI update');
        } catch(e) {
            setAuthLoading(false);
            showAuthError(mapFirebaseError(e.code));
        }
    }
}

// Legacy shim — kept so old call-sites (if any) don't break
function doLogin() { doAuthSubmit(); }

function doEditSave() {
    const name  = document.getElementById('edit-name')?.value?.trim();
    if (!name) return;
    // Update Firebase displayName (async, fire-and-forget)
    const fbUser = _fbAuth.currentUser;
    if (fbUser) {
        fbUser.updateProfile({ displayName: name }).then(() => {
            AUTH._setFromFB(_fbAuth.currentUser);
            AUTH._saveCache();
            updateProfileUI();
            renderProfilePanel(document.getElementById('profile-panel-inner'));
        }).catch(e => console.warn('[AUTH] updateProfile error:', e));
    } else {
        // Fallback for local-only (shouldn't normally happen)
        if (AUTH.user) {
            AUTH.user.name   = name;
            AUTH.user.avatar = name[0].toUpperCase();
            AUTH._saveCache();
        }
        updateProfileUI();
        renderProfilePanel(document.getElementById('profile-panel-inner'));
    }
}

function getAllVocabCount() {
    let n = 0;
    ['book1','book2'].forEach(b => { if (DB[b]) DB[b].forEach(l => { n += (l.vocab||[]).length; }); });
    if (window.MASTER_KOTOBA_READY) n += window.MASTER_KOTOBA.length;
    return n;
}

// ════════════════════════════════════════════════════════
// KOTOBA PAGE — Ensiklopedia Kosakata Lengkap
// v2.0: master_kotoba.json integration (1949 kata)
// ════════════════════════════════════════════════════════

// ── Global master data store ──────────────────────────
window.MASTER_KOTOBA      = [];   // loaded async from master_kotoba.json
window.MASTER_KOTOBA_READY = false;

// ── Kotoba flashcard state ────────────────────────────
const KOTOBA_STATE = {
    cat: 'all', book: 'all',
    flashMode: null,   // null | 'belajar' | 'review' | 'favorite'
    flashIdx: 0, flashPool: [], flashFlipped: false,
    page: 0, pageSize: 50,          // pagination
};

// ─── Favorites (localStorage) ────────────────────────
function kotobaFavKey(v) { return 'kfav_' + (v.id || v._id || (v.jp||v.kanji||v.kana) + v.arti); }

function isKotobaFav(v) {
    try { return !!localStorage.getItem(kotobaFavKey(v)); } catch(e) { return false; }
}
function toggleKotobaFav(v) {
    try {
        const k = kotobaFavKey(v);
        if (localStorage.getItem(k)) localStorage.removeItem(k);
        else localStorage.setItem(k, '1');
        // [CLOUD_SAVE v3.0] sync favorites ke Firestore
        try { if (window.PROGRESS_SYNC) window.PROGRESS_SYNC.push(); } catch(e) {}
    } catch(e) {}
}
function getAllFavIds() {
    const ids = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('kfav_')) ids.push(k.slice(5));
        }
    } catch(e) {}
    return new Set(ids);
}

// ── Load master_kotoba.json async ─────────────────────
async function loadMasterKotoba() {
    if (window.MASTER_KOTOBA_READY) return;
    try {
        const resp = await fetch('./master_kotoba.json');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const raw = await resp.json();

        // Dedup: build sets from existing DB vocab
        const existingIds  = new Set();
        const existingKeys = new Set();
        ['book1','book2'].forEach(bk => {
            if (!DB[bk]) return;
            DB[bk].forEach(lesson => {
                (lesson.vocab || []).forEach(v => {
                    if (v.id) existingIds.add(v.id);
                    existingKeys.add((v.kana||v.kanji||'') + '§' + (v.jp||v.kanji||v.kana||''));
                });
            });
        });

        window.MASTER_KOTOBA = raw.filter(item => {
            if (existingIds.has(item.id))  return false;
            const key = (item.kana||'') + '§' + (item.jp||'');
            if (existingKeys.has(key))     return false;
            return true;
        }).map(item => ({
            ...item,
            // Normalize: jp = kanji form, kana = reading, no romaji
            kanji : item.jp || '',
            kana  : item.kana || '',
            romaji: '',
            arti  : item.arti || '',
            _id   : item.id,
            _src  : 'master',
        }));

        window.MASTER_KOTOBA_READY = true;

        // Refresh kotoba page if it's currently open
        const kotobaSec = document.getElementById('page-kotoba');
        if (kotobaSec && kotobaSec.classList.contains('active')) {
            renderKotobaPage();
        }
        // Update subtitle count
        const sub = document.getElementById('kotoba-subtitle');
        if (sub) {
            const total = window.MASTER_KOTOBA.length + getAllVocabCount();
            sub.textContent = `${total.toLocaleString()} kata tersedia`;
        }
    } catch(err) {
        console.warn('[KOTOBA] Gagal load master_kotoba.json:', err);
        window.MASTER_KOTOBA_READY = true; // don't block UI
    }
}

// ── Categorization for master_kotoba items ────────────
function detectKotobaDetailCat(v) {
    const kana = v.kana || '';
    const jp   = v.jp || v.kanji || '';
    const arti = (v.arti || '').toLowerCase();

    // kata_kerja_3: suru/kuru verbs
    if (kana.endsWith('します') || kana.endsWith('する') ||
        kana === 'きます' || kana === 'くる') return 'kata_kerja_3';

    // kata_kerja (ます ending)
    if (kana.endsWith('ます')) {
        const stem = kana.slice(0, -2);
        // kata_kerja_3 compound: ends with します
        if (kana.endsWith('します')) return 'kata_kerja_3';
        // kata_kerja_2: ichidan - stem ends in i/e row vowel kana
        const g2 = ['き','ぎ','し','じ','ち','に','び','み','り','い','え','け','せ','て','ね','め','れ','べ','で'];
        const g1exc = ['かえります','はいります','はしります','きります','はります','おります'];
        if (g2.includes(stem.slice(-1)) && !g1exc.includes(kana)) return 'kata_kerja_2';
        return 'kata_kerja_1';
    }

    // kata_sifat_i: ends in い, not ない
    if ((jp.endsWith('い') || kana.endsWith('い')) &&
        !kana.endsWith('ない') && !kana.endsWith('たい')) {
        const na_na = ['きれい','ぎらい'];
        if (!na_na.some(n => kana.includes(n))) return 'kata_sifat_i';
    }

    // kata_sifat_na: known na-adj readings or markers
    const naList = ['きれい','べんり','しずか','にぎやか','ゆうめい','すき','きらい',
                    'じょうず','へた','たいせつ','しんせつ','げんき','たいへん','ひま',
                    'だいじょうぶ','かんたん','ていねい','りっぱ','まじめ','ざんねん',
                    'ふくざつ','らく','とくい','にがて','あんぜん','じゆう','とても'];
    if (naList.some(n => kana === n || kana.startsWith(n))) return 'kata_sifat_na';
    if (arti.includes('(な)') || arti.includes('na-adj') || arti.includes('(na)')) return 'kata_sifat_na';

    return 'kata_benda';
}

// Map detail cat → existing UI cat (verb/adj/noun/other)
function detailCatToUICat(dc) {
    if (dc.startsWith('kata_kerja')) return 'verb';
    if (dc.startsWith('kata_sifat')) return 'adj';
    if (dc === 'kata_benda')        return 'noun';
    return 'other';
}

// ── detectCat — backward compat for DB vocab ─────────
function detectCat(v) {
    if (v._src === 'master') return detailCatToUICat(detectKotobaDetailCat(v));
    if (v.cat)  return v.cat;
    const a = (v.arti || '').toLowerCase();
    const r = (v.romaji || '').toLowerCase();
    if (v.kana && (v.kana.endsWith('ます') || v.kana.endsWith('する'))) return 'verb';
    if (a.includes('ます→') || r.endsWith('masu') || r.endsWith('shimasu')) return 'verb';
    if (a.includes('(い-adj)') || a.includes('い-adj') || a.includes('(na)') || a.includes('-adj')) return 'adj';
    if (a.match(/\b(sifat|adj)\b/i)) return 'adj';
    return 'noun';
}

function catColor(cat) {
    return cat === 'verb' ? 'var(--accent-verb)' :
           cat === 'adj'  ? 'var(--accent-adj)'  :
           cat === 'noun' ? 'var(--accent-noun)'  : 'var(--text-muted)';
}
function catLabel(cat) {
    return cat === 'verb' ? '動' : cat === 'adj' ? '形' : cat === 'noun' ? '名' : '他';
}

// ── getKotobaAllVocab — merged DB + master (for kotoba page) ──
function getKotobaAllVocab() {
    const results = [];

    // 1. From lesson DB
    ['book1','book2'].forEach(bookKey => {
        if (!DB[bookKey]) return;
        DB[bookKey].forEach(lesson => {
            (lesson.vocab || []).forEach(v => {
                results.push({
                    ...v,
                    _book: bookKey, _lesson: lesson.id, _lessonTitle: lesson.title,
                    _cat: detectCat(v), _src: 'db',
                });
            });
        });
    });

    // 2. From master_kotoba.json (already deduped on load)
    if (window.MASTER_KOTOBA_READY) {
        window.MASTER_KOTOBA.forEach(v => {
            results.push({
                ...v,
                _book: 'master', _lesson: 0, _lessonTitle: 'Master Kotoba',
                _cat: detectCat(v), _src: 'master',
            });
        });
    }

    return results;
}

// Keep old getAllVocab usable for lesson-based systems
// (DO NOT rename — flashcard/quiz systems call this)

// ── Filter & search helpers ───────────────────────────
// ── Romaji → Hiragana converter (for search) ─────────
// Allows typing "tabemasu" to find "たべます" even when
// Android IME hasn't committed kana yet.
function romajiToHiragana(str) {
    const map = [
        // 3-char first (greedy)
        ['shi','し'],['chi','ち'],['tsu','つ'],['tchi','っち'],
        ['kya','きゃ'],['kyu','きゅ'],['kyo','きょ'],
        ['sha','しゃ'],['shu','しゅ'],['sho','しょ'],
        ['cha','ちゃ'],['chu','ちゅ'],['cho','ちょ'],
        ['tya','ちゃ'],['tyu','ちゅ'],['tyo','ちょ'],
        ['nya','にゃ'],['nyu','にゅ'],['nyo','にょ'],
        ['hya','ひゃ'],['hyu','ひゅ'],['hyo','ひょ'],
        ['mya','みゃ'],['myu','みゅ'],['myo','みょ'],
        ['rya','りゃ'],['ryu','りゅ'],['ryo','りょ'],
        ['gya','ぎゃ'],['gyu','ぎゅ'],['gyo','ぎょ'],
        ['ja','じゃ'], ['ju','じゅ'], ['jo','じょ'],
        ['jya','じゃ'],['jyu','じゅ'],['jyo','じょ'],
        ['bya','びゃ'],['byu','びゅ'],['byo','びょ'],
        ['pya','ぴゃ'],['pyu','ぴゅ'],['pyo','ぴょ'],
        // 2-char
        ['ka','か'],['ki','き'],['ku','く'],['ke','け'],['ko','こ'],
        ['sa','さ'],['si','し'],['su','す'],['se','せ'],['so','そ'],
        ['ta','た'],['ti','ち'],['te','て'],['to','と'],
        ['na','な'],['ni','に'],['nu','ぬ'],['ne','ね'],['no','の'],
        ['ha','は'],['hi','ひ'],['fu','ふ'],['hu','ふ'],['he','へ'],['ho','ほ'],
        ['ma','ま'],['mi','み'],['mu','む'],['me','め'],['mo','も'],
        ['ya','や'],['yu','ゆ'],['yo','よ'],
        ['ra','ら'],['ri','り'],['ru','る'],['re','れ'],['ro','ろ'],
        ['wa','わ'],['wi','ゐ'],['we','ゑ'],['wo','を'],
        ['ga','が'],['gi','ぎ'],['gu','ぐ'],['ge','げ'],['go','ご'],
        ['za','ざ'],['zi','じ'],['zu','ず'],['ze','ぜ'],['zo','ぞ'],
        ['da','だ'],['di','ぢ'],['du','づ'],['de','で'],['do','ど'],
        ['ba','ば'],['bi','び'],['bu','ぶ'],['be','べ'],['bo','ぼ'],
        ['pa','ぱ'],['pi','ぴ'],['pu','ぷ'],['pe','ぺ'],['po','ぽ'],
        ['ji','じ'],
        // 1-char vowels
        ['a','あ'],['i','い'],['u','う'],['e','え'],['o','お'],
        ['n','ん'],
    ];
    const s = str.toLowerCase();
    let result = '';
    let i = 0;
    while (i < s.length) {
        // Double consonant → っ (e.g. "tt" before consonant)
        if (i + 1 < s.length && s[i] !== 'n' && s[i] === s[i+1] &&
            'bcdfghjklmnpqrstvwxyz'.includes(s[i])) {
            result += 'っ';
            i++;
            continue;
        }
        let matched = false;
        for (const [rom, hira] of map) {
            if (s.slice(i, i + rom.length) === rom) {
                result += hira;
                i += rom.length;
                matched = true;
                break;
            }
        }
        if (!matched) { result += s[i]; i++; }
    }
    return result;
}

function kotobaMatchesSearch(v, query) {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    // Direct field matching
    if ((v.kana   || '').toLowerCase().includes(q)) return true;
    if ((v.kanji  || v.jp || '').toLowerCase().includes(q)) return true;
    if ((v.arti   || '').toLowerCase().includes(q)) return true;
    if ((v.romaji || '').toLowerCase().includes(q)) return true;
    // Katakana ↔ Hiragana normalization
    const qAsHira = q.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
    if ((v.kana || '').toLowerCase().includes(qAsHira)) return true;
    const qAsKata = q.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
    if ((v.kana || '').includes(qAsKata)) return true;
    // Romaji → Hiragana: "tabemasu" → "たべます"
    // Handles Android IME composing state (text still in romaji)
    const qHiraFromRomaji = romajiToHiragana(q);
    if (qHiraFromRomaji !== q) {
        if ((v.kana  || '').includes(qHiraFromRomaji)) return true;
        if ((v.kanji || v.jp || '').includes(qHiraFromRomaji)) return true;
    }
    return false;
}

// ── Verb group detection (unchanged) ─────────────────
function detectVerbGroup(v) {
    if (v.cat !== 'verb' && detectCat(v) !== 'verb') return null;
    const kana = v.kana || '';
    if (kana === 'します' || kana === 'きます') return 3;
    if (kana.endsWith('します')) return 3;
    if (!kana.endsWith('ます')) return null;
    const stem = kana.slice(0, -2);
    if (!stem) return null;
    const g2 = ['き','ぎ','し','じ','ち','に','び','み','り','い','え','け','せ','て','ね','へ','め','れ','べ','で','げ','ぜ','ぺ'];
    const g1exc = ['かえります','はいります','はしります','しります','きります','はります','おります','あびます'];
    if (g2.includes(stem.slice(-1))) {
        if (g1exc.some(e => kana === e)) return 1;
        return 2;
    }
    return 1;
}
function verbGroupLabel(group) {
    if (group === 1) return { label: 'G1', title: 'Golongan 1 (五段動詞)', color: 'var(--accent-verb)' };
    if (group === 2) return { label: 'G2', title: 'Golongan 2 (一段動詞)', color: '#60a5fa' };
    if (group === 3) return { label: 'G3', title: 'Golongan 3 (不規則動詞)', color: 'var(--accent-adj)' };
    return null;
}

// ── Render single vocab item ──────────────────────────
function renderKotobaItem(v, showLesson = false) {
    const mainWord = v.kanji || v.jp || v.kana;
    const furigana = ((v.kanji || v.jp) && v.kana && (v.kanji || v.jp) !== v.kana) ? v.kana : '';
    const cat      = v._cat || detectCat(v);
    const dotColor = catColor(cat);
    const catLbl   = catLabel(cat);
    const learned  = STATE.learnedCards && STATE.learnedCards.has(learnedKey(v));
    const isFav    = isKotobaFav(v);
    const favId    = JSON.stringify({ id: v._id || v.id, jp: v.jp || v.kanji, kana: v.kana, arti: v.arti });

    let groupBadge = '';
    if (cat === 'verb') {
        const grp = detectVerbGroup(v);
        if (grp) {
            const g = verbGroupLabel(grp);
            groupBadge = `<span style="font-size:8px;font-weight:800;color:${g.color};padding:1px 4px;border-radius:4px;background:${g.color}22;border:1px solid ${g.color}44;letter-spacing:.03em;white-space:nowrap" title="${g.title}">${g.label}</span>`;
        }
    }

    // Detail cat badge for master items
    let detailBadge = '';
    if (v._src === 'master') {
        const dc = detectKotobaDetailCat(v);
        const dcLabel = { kata_kerja_1:'KK-1', kata_kerja_2:'KK-2', kata_kerja_3:'KK-3',
                          kata_sifat_i:'KS-い', kata_sifat_na:'KS-な', kata_benda:'KB', lainnya:'他' };
        detailBadge = `<span style="font-size:7px;color:var(--text-muted);opacity:.6">${dcLabel[dc]||''}</span>`;
    }

    const starColor = isFav ? '#f59e0b' : 'var(--text-muted)';
    const starOp    = isFav ? '1' : '0.3';

    // Store vocab in global map — avoids JSON encoding inside HTML attribute
    const _kvid = 'kv_' + (v._id||v.id||Math.random().toString(36).slice(2));
    if (!window._kvmap) window._kvmap = {};
    window._kvmap[_kvid] = v;

    return `<div class="vocab-item${learned?' is-learned':''}" id="ki-${v._id||v.id||''}"
      data-kvid="${_kvid}" style="cursor:pointer"
      onclick="if(!event.target.closest('button'))showKotobaDetail(this.dataset.kvid)">
      <div class="vocab-japanese">
        <div class="vocab-furigana">${escHTML(furigana)}</div>
        <div class="vocab-kana">${escHTML(mainWord)}</div>
        <div class="vocab-romaji">${STATE.showRomaji ? escHTML(v.romaji||'') : ''}${(STATE.showRomaji && showLesson && v._lessonTitle) ? ` · <span style="color:var(--accent-primary);opacity:.7">${escHTML(v._lessonTitle)}</span>` : (!STATE.showRomaji && showLesson && v._lessonTitle) ? `<span style="color:var(--accent-primary);opacity:.7;font-size:10px">${escHTML(v._lessonTitle)}</span>` : ''}</div>
      </div>
      <div class="vocab-divider"></div>
      <div class="vocab-meaning">${escHTML(v.arti)}</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding-left:6px;flex-shrink:0">
        ${groupBadge || `<span style="font-size:9px;font-weight:800;color:${dotColor};width:16px;height:16px;border-radius:4px;background:${dotColor}22;display:flex;align-items:center;justify-content:center">${catLbl}</span>`}
        ${detailBadge}
        <button onclick="event.stopPropagation();toggleKotobaFavUI(this,'${favId.replace(/"/g,'&quot;')}')"
          style="background:none;border:none;cursor:pointer;font-size:13px;padding:1px;color:${starColor};opacity:${starOp};transition:opacity .15s"
          title="${isFav?'Hapus dari':'Tambah ke'} favorit">★</button>
        <div class="vocab-learned-dot" style="opacity:${learned?1:0}"></div>
      </div>
    </div>`;
}

// ── Kotoba Detail Bottom Sheet ────────────────────────
function showKotobaDetail(kvid) {
    const v = window._kvmap && window._kvmap[kvid];
    if (!v) return;

    const mainWord = v.kanji || v.jp || v.kana || '';
    const reading  = ((v.kanji || v.jp) && v.kana && (v.kanji||v.jp) !== v.kana) ? v.kana : '';

    // Verb conjugation data
    let verbEntry = null, verbForms = null, verbKanaForms = null;
    if (typeof VERB_ENGINE !== 'undefined') {
        verbEntry = VERB_ENGINE.lookup(v.kanji || v.kana);
        if (verbEntry) {
            verbForms     = VERB_ENGINE.conjugate(verbEntry.dict, verbEntry.type, verbEntry.label);
            verbKanaForms = VERB_ENGINE.deriveKanaForms(v.kana, verbEntry.type);
        }
    }

    let sheet = document.getElementById('kotoba-detail-sheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'kotoba-detail-sheet';
        document.body.appendChild(sheet);
    }

    // ── Overlay ───────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:flex;align-items:flex-end';

    // ── Panel ─────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText = 'width:100%;background:var(--bg-card);border-radius:20px 20px 0 0;padding:20px 18px 32px;max-height:85vh;overflow-y:auto;box-sizing:border-box';

    // Handle bar
    const handle = document.createElement('div');
    handle.style.cssText = 'width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 18px';
    panel.appendChild(handle);

    // ── Header: furigana + big word + romaji ──────────
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'text-align:center;margin-bottom:14px';

    const readingEl = document.createElement('div');
    readingEl.style.cssText = "font-family:'Noto Sans JP',sans-serif;font-size:13px;color:var(--text-muted);margin-bottom:2px;min-height:18px";
    readingEl.textContent = reading;

    const wordEl = document.createElement('div');
    wordEl.style.cssText = "font-family:'Noto Sans JP',sans-serif;font-size:38px;font-weight:700;color:var(--text-primary);line-height:1.2;transition:opacity .15s";
    wordEl.textContent = mainWord;

    const romajiEl = document.createElement('div');
    romajiEl.style.cssText = 'font-size:13px;color:var(--text-muted);margin-top:4px;font-style:italic';
    romajiEl.textContent = v.romaji || '';
    romajiEl.style.display = (v.romaji && STATE.showRomaji) ? 'block' : 'none';

    headerDiv.append(readingEl, wordEl, romajiEl);
    panel.appendChild(headerDiv);

    // ── Meaning box ───────────────────────────────────
    const meaningBox = document.createElement('div');
    meaningBox.style.cssText = 'background:var(--bg-secondary);border-radius:14px;padding:13px 16px;text-align:center;margin-bottom:10px';

    const meaningEl = document.createElement('div');
    meaningEl.style.cssText = 'font-size:17px;font-weight:700;color:var(--accent-primary);transition:opacity .15s';
    meaningEl.textContent = v.arti;

    const lessonEl = document.createElement('div');
    lessonEl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:5px';
    lessonEl.textContent   = v._lessonTitle ? '📘 ' + v._lessonTitle : '';
    lessonEl.style.display = v._lessonTitle ? 'block' : 'none';

    meaningBox.append(meaningEl, lessonEl);
    panel.appendChild(meaningBox);

    // ── Verb Engine: interactive rows ─────────────────
    if (verbForms) {
        const TYPE_LABELS = {
            'ichidan':        'Kelompok 2 · Ichidan · る動詞',
            'godan':          'Kelompok 1 · Godan · う動詞',
            'irregular-suru': 'Irregular · する',
            'irregular-kuru': 'Irregular · 来る (くる)',
        };

        const FORM_DEFS = [
            { key:'dict',  label:'辞書形',  color:'var(--text-secondary)', bg:'rgba(148,163,184,.12)', meaning:`${v.arti} (bentuk dasar)` },
            { key:'masu',  label:'ます形',  color:'var(--accent-primary)', bg:'rgba(99,102,241,.12)',  meaning:`${v.arti}` },
            { key:'masen', label:'ません形',color:'var(--accent-danger)',   bg:'rgba(239,68,68,.12)',   meaning:`tidak ${v.arti}` },
            { key:'nai',   label:'ない形',  color:'#f87171',               bg:'rgba(248,113,113,.12)', meaning:`tidak ${v.arti} (kasual)` },
            { key:'ta',    label:'た形',    color:'var(--accent-verb)',     bg:'rgba(16,185,129,.12)',  meaning:`(telah) ${v.arti}` },
            { key:'te',    label:'て形',    color:'#f59e0b',               bg:'rgba(245,158,11,.12)',  meaning:`${v.arti} (て形)` },
        ];

        const verbSection = document.createElement('div');
        verbSection.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:12px';

        // Label row
        const verbHeader = document.createElement('div');
        verbHeader.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap';
        verbHeader.innerHTML = `
            <span style="font-size:10px;font-weight:800;color:var(--accent-verb);letter-spacing:.05em">📖 BENTUK KATA KERJA</span>
            <span style="font-size:9px;color:var(--text-muted);background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:2px 7px;white-space:nowrap">${TYPE_LABELS[verbEntry.type]||verbEntry.type}</span>
            <span style="font-size:9px;color:var(--text-muted);opacity:.7">↓ ketuk bentuk untuk lihat detail</span>`;
        verbSection.appendChild(verbHeader);

        // 2-column grid
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px';

        let activeRow = null;

        FORM_DEFS.forEach(def => {
            const form     = verbForms[def.key];
            const kanaForm = verbKanaForms ? verbKanaForms[def.key] : '';
            if (!form) return;

            const row = document.createElement('div');
            // 6 items in 2-col grid = 3 rows, all equal — no spanning
            row.style.cssText = `background:var(--bg-card-hover);border:1.5px solid var(--border);
                border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;
                align-items:center;cursor:pointer;transition:border-color .15s,background .15s,transform .1s`;

            row.innerHTML = `
                <span style="font-size:9px;color:var(--text-muted);font-weight:700;flex-shrink:0">${def.label}</span>
                <span style="font-family:'Noto Sans JP',sans-serif;font-size:15px;font-weight:700;color:${def.color};margin-left:6px">${form}</span>`;

            // Default: highlight ます形
            if (def.key === 'masu') {
                row.style.borderColor = def.color;
                row.style.background  = def.bg;
                activeRow = row;
            }

            // Tap handler
            row.addEventListener('click', () => {
                // Dehighlight previous
                if (activeRow) {
                    activeRow.style.borderColor = 'var(--border)';
                    activeRow.style.background  = 'var(--bg-card-hover)';
                }
                // Highlight this
                row.style.borderColor = def.color;
                row.style.background  = def.bg;
                activeRow = row;

                // Animate flash on word
                wordEl.style.opacity  = '0';
                meaningEl.style.opacity = '0';
                setTimeout(() => {
                    // Update big word
                    wordEl.textContent = form;

                    // Update reading: show kana if different from kanji form
                    if (kanaForm && kanaForm !== form) {
                        readingEl.textContent = kanaForm;
                    } else {
                        readingEl.textContent = '';
                    }
                    // Romaji: hide for conjugated forms
                    romajiEl.style.display = 'none';

                    // Update meaning
                    meaningEl.textContent = def.meaning;
                    // Hide lesson tag while browsing forms
                    lessonEl.style.display = 'none';

                    wordEl.style.opacity  = '1';
                    meaningEl.style.opacity = '1';
                }, 100);
            });

            // Touch ripple feel
            row.addEventListener('pointerdown', () => { row.style.transform = 'scale(.97)'; });
            row.addEventListener('pointerup',   () => { row.style.transform = 'scale(1)'; });
            row.addEventListener('pointerleave',() => { row.style.transform = 'scale(1)'; });

            grid.appendChild(row);
        });

        verbSection.appendChild(grid);
        panel.appendChild(verbSection);
    }

    // ── Action buttons ────────────────────────────────
    const actionsDiv = document.createElement('div');
    actionsDiv.style.cssText = 'display:flex;gap:8px;margin-top:16px';

    const favBtn = document.createElement('button');
    const isFav  = isKotobaFav(v);
    favBtn.style.cssText = `flex:1;padding:12px 8px;border-radius:12px;border:1px solid var(--border);background:transparent;font-size:13px;font-weight:700;cursor:pointer;color:${isFav?'#f59e0b':'var(--text-muted)'}`;
    favBtn.textContent = isFav ? '★ Favorit' : '☆ Favorit';
    favBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleKotobaFav(v);
        const nowFav = isKotobaFav(v);
        favBtn.style.color = nowFav ? '#f59e0b' : 'var(--text-muted)';
        favBtn.textContent = nowFav ? '★ Favorit' : '☆ Favorit';
        if (KOTOBA_STATE.flashMode === 'favorite') startKotobaFlash('favorite');
    });

    const flashBtn = document.createElement('button');
    flashBtn.style.cssText = 'flex:2;padding:12px;border-radius:12px;border:none;background:var(--accent-primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer';
    flashBtn.textContent = '📖 Flashcard Kata Ini';
    flashBtn.addEventListener('click', e => {
        e.stopPropagation();
        closeKotobaDetail();
        KOTOBA_STATE.flashMode    = 'belajar';
        KOTOBA_STATE.flashPool    = [v];
        KOTOBA_STATE.flashIdx     = 0;
        KOTOBA_STATE.flashFlipped = false;
        renderKotobaFlash();
        const flashEl = document.getElementById('kotoba-flash-panel');
        if (flashEl) setTimeout(() => flashEl.scrollIntoView({behavior:'smooth', block:'start'}), 80);
    });

    // ── Tombol Tandai Hafal ───────────────────────────
    // Memungkinkan pengguna menandai hafal langsung dari tabel Kotoba,
    // sekaligus mentrigger misi harian "Pelajari 10 kosakata baru".
    const hafalBtn = document.createElement('button');
    const _initLearned = !!(STATE.learnedCards && STATE.learnedCards.has(learnedKey(v)));
    function _setHafalBtnState(isLearned) {
        hafalBtn.style.cssText = `flex:1.5;padding:12px 8px;border-radius:12px;border:1.5px solid ${isLearned ? 'rgba(52,211,153,.4)' : 'var(--border)'};background:${isLearned ? 'rgba(52,211,153,.14)' : 'transparent'};color:${isLearned ? 'var(--accent-verb)' : 'var(--text-secondary)'};font-size:13px;font-weight:700;cursor:pointer;transition:all .15s`;
        hafalBtn.textContent = isLearned ? '✓ Hafal' : '○ Hafal';
    }
    _setHafalBtnState(_initLearned);
    hafalBtn.addEventListener('click', e => {
        e.stopPropagation();
        const key = learnedKey(v);
        if (!STATE.learnedCards) STATE.learnedCards = new Set();
        const _szBefore = STATE.learnedCards.size;
        if (STATE.learnedCards.has(key)) {
            STATE.learnedCards.delete(key);
        } else {
            STATE.learnedCards.add(key);
        }
        STATE.save();
        const isNowLearned = STATE.learnedCards.has(key);
        // Track misi harian vocab hanya saat kata baru ditambahkan (bukan di-untoggle)
        if (STATE.learnedCards.size > _szBefore && typeof MISSIONS !== 'undefined') {
            MISSIONS.incrementProgress('vocab', 1);
        }
        _setHafalBtnState(isNowLearned);
        // Refresh dot pada baris tabel Kotoba
        const rowEl = document.getElementById('ki-' + (v._id || v.id || ''));
        if (rowEl) {
            rowEl.classList.toggle('is-learned', isNowLearned);
            const dot = rowEl.querySelector('.vocab-learned-dot');
            if (dot) dot.style.opacity = isNowLearned ? '1' : '0';
        }
        // Refresh counter dashboard & progress ring
        if (typeof renderVocabDbCard   === 'function') renderVocabDbCard();
        if (typeof updateProgressRing  === 'function') updateProgressRing();
        if (typeof renderChapterListHome === 'function') renderChapterListHome();
    });

    actionsDiv.append(favBtn, hafalBtn, flashBtn);
    panel.appendChild(actionsDiv);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'width:100%;margin-top:10px;padding:11px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:13px;cursor:pointer';
    closeBtn.textContent = 'Tutup';
    closeBtn.addEventListener('click', closeKotobaDetail);
    panel.appendChild(closeBtn);

    overlay.addEventListener('click', closeKotobaDetail);
    panel.addEventListener('click', e => e.stopPropagation());
    overlay.appendChild(panel);

    sheet.innerHTML = '';
    sheet.appendChild(overlay);
    sheet.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeKotobaDetail() {
    const s = document.getElementById('kotoba-detail-sheet');
    if (s) s.style.display = 'none';
    document.body.style.overflow = '';
}

function toggleKotobaFavUI(btn, favJson) {
    try {
        const v = JSON.parse(favJson);
        toggleKotobaFav(v);
        const isFav = isKotobaFav(v);
        btn.style.color   = isFav ? '#f59e0b' : 'var(--text-muted)';
        btn.style.opacity = isFav ? '1' : '0.3';
        btn.title         = (isFav ? 'Hapus dari' : 'Tambah ke') + ' favorit';
        // If in favorite flash mode, refresh
        if (KOTOBA_STATE.flashMode === 'favorite') startKotobaFlash('favorite');
    } catch(e) {}
}

// ── MAIN RENDER ───────────────────────────────────────
function setKotobaFilter(cat, el) {
    KOTOBA_STATE.cat  = cat;
    KOTOBA_STATE.page = 0;
    document.querySelectorAll('.kotoba-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderKotobaPage();
}

function setKotobaBook(book, el) {
    KOTOBA_STATE.book = book;
    KOTOBA_STATE.page = 0;
    document.querySelectorAll('.kotoba-book-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    renderKotobaPage();
}

function renderKotobaPage() {
    window._kvmap = {}; // reset vocab tap map on each render
    const listEl   = document.getElementById('kotoba-list');
    const countEl  = document.getElementById('kotoba-count');
    const subEl    = document.getElementById('kotoba-subtitle');
    const searchEl = document.getElementById('kotoba-search');
    const sortEl   = document.getElementById('kotoba-sort');
    if (!listEl) return;

    const isFullAccess = isPremiumUser();
    if (!isFullAccess) {
        if (searchEl) { searchEl.disabled = true; searchEl.placeholder = '🔒 Upgrade untuk cari semua kosakata'; }
        if (sortEl)   sortEl.disabled = true;
    } else {
        if (searchEl) { searchEl.disabled = false; searchEl.placeholder = '🔍 Cari kata (Jepang / Indonesia / Kana)...'; }
        if (sortEl)   sortEl.disabled = false;
    }

    const query = (searchEl && !searchEl.disabled ? searchEl.value.trim().toLowerCase() : '');
    const sort  = sortEl && !sortEl.disabled ? sortEl.value : 'lesson';

    // If not loaded yet, show spinner
    if (!window.MASTER_KOTOBA_READY) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-text">Memuat database kosakata...</div></div>`;
        return;
    }

    let vocab = getKotobaAllVocab();

    // v2.5: JLPT filter
    if (typeof JLPT_MODULE !== 'undefined' && JLPT_MODULE.getActiveFilter() !== 'all') {
        vocab = vocab.filter(v => JLPT_MODULE.matchesFilter(v));
    }

    // Access control
    if (!isFullAccess) {
        vocab = vocab.filter(v => v._src === 'db' && v._book === 'book1' && v._lesson <= 3);
    } else {
        // Book filter
        if (KOTOBA_STATE.book === 'book1')  vocab = vocab.filter(v => v._book === 'book1');
        else if (KOTOBA_STATE.book === 'book2')  vocab = vocab.filter(v => v._book === 'book2');
        else if (KOTOBA_STATE.book === 'master') vocab = vocab.filter(v => v._src === 'master');
        // 'all' includes everything
    }

    // Category filter
    if (KOTOBA_STATE.cat !== 'all') {
        vocab = vocab.filter(v => {
            if (KOTOBA_STATE.cat === 'other') return !['verb','adj','noun'].includes(v._cat);
            return v._cat === KOTOBA_STATE.cat;
        });
    }

    // Real-time search (jp + kana + arti, case insensitive)
    if (query) {
        vocab = vocab.filter(v => kotobaMatchesSearch(v, query));
        KOTOBA_STATE.page = 0; // reset page on new search
    }

    // Sort
    if (isFullAccess) {
        if (sort === 'az') vocab.sort((a,b) => (a.kana||a.kanji||'').localeCompare(b.kana||b.kanji||''));
        else if (sort === 'za') vocab.sort((a,b) => (b.kana||b.kanji||'').localeCompare(a.kana||a.kanji||''));
        else {
            // lesson sort: DB first (book1→book2 by lesson), then master
            vocab.sort((a,b) => {
                if (a._src === 'db' && b._src === 'master') return -1;
                if (a._src === 'master' && b._src === 'db')  return  1;
                if (a._src === 'db' && b._src === 'db')
                    return a._book.localeCompare(b._book) || (a._lesson - b._lesson);
                return 0;
            });
        }
    } else {
        vocab.sort((a,b) => a._lesson - b._lesson);
    }

    const totalFiltered = vocab.length;

    // ── Pagination ──────────────────────────────────────
    const page     = KOTOBA_STATE.page || 0;
    const pageSize = KOTOBA_STATE.pageSize;
    const sliced   = vocab.slice(0, (page + 1) * pageSize);
    const hasMore  = sliced.length < totalFiltered;

    // Update count & subtitle
    if (countEl) {
        const masterCount = window.MASTER_KOTOBA.length;
        const dbCount     = getAllVocabCount();
        countEl.textContent = totalFiltered.toLocaleString() +
            (isFullAccess ? '' : `/${getAllVocabCount()}`) + ' kata';
    }
    if (subEl) {
        if (isFullAccess) {
            const dbC  = vocab.filter(v=>v._src==='db').length;
            const mkC  = vocab.filter(v=>v._src==='master').length;
            subEl.textContent = `Pelajaran: ${dbC} kata  ·  Master DB: ${mkC} kata`;
        } else {
            subEl.textContent = 'Bab 1–3 Gratis · 👑 Upgrade untuk semua kata';
        }
    }

    if (!sliced.length) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">Tidak ada kata yang cocok.</div></div>`;
        return;
    }

    // Render with group headers (lesson sort only)
    let html = '';
    const isLessonSort = !isFullAccess || sort === 'lesson';
    let lastGroup = '';

    sliced.forEach(v => {
        if (isLessonSort) {
            let group;
            if (v._src === 'master') {
                group = '📖 Master Kosakata';
            } else {
                group = (v._book === 'book1' ? 'Buku I' : 'Buku II') + ' — ' + (v._lessonTitle || '');
            }
            if (group !== lastGroup) {
                lastGroup = group;
                html += `<div class="kotoba-group-header">${escHTML(group)}</div>`;
            }
        }
        html += renderKotobaItem(v, !isLessonSort);
    });

    // Load more button
    if (hasMore) {
        html += `<button onclick="kotobaLoadMore()" style="width:100%;margin-top:10px;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--accent-primary);font-size:13px;font-weight:700;cursor:pointer">
            ⬇ Tampilkan lebih banyak (${totalFiltered - sliced.length} kata lagi)
        </button>`;
    }

    // Free user upsell
    if (!isFullAccess) {
        html += `<div style="margin:16px 0 8px;padding:14px 16px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:12px;text-align:center">
            <div style="font-size:13px;font-weight:700;color:#f59e0b;margin-bottom:4px">👑 Upgrade Premium</div>
            <div style="font-size:12px;color:var(--text-muted)">Akses 1.949 kata + pencarian & flashcard lengkap.</div>
        </div>`;
    }

    listEl.innerHTML = html;
}

function kotobaLoadMore() {
    KOTOBA_STATE.page = (KOTOBA_STATE.page || 0) + 1;
    renderKotobaPage();
}

// ── KOTOBA FLASHCARD MODE ─────────────────────────────
function buildFlashPool(mode) {
    let vocab = getKotobaAllVocab();
    if (mode === 'belajar') {
        // Unlearned first, random order
        const learned = vocab.filter(v => STATE.learnedCards && STATE.learnedCards.has(learnedKey(v)));
        const fresh   = vocab.filter(v => !STATE.learnedCards || !STATE.learnedCards.has(learnedKey(v)));
        vocab = [...shuffleArr(fresh), ...shuffleArr(learned)];
    } else if (mode === 'review') {
        // Only learned items
        vocab = vocab.filter(v => STATE.learnedCards && STATE.learnedCards.has(learnedKey(v)));
        vocab = shuffleArr(vocab);
        if (!vocab.length) return null;
    } else if (mode === 'favorite') {
        const favIds = getAllFavIds();
        vocab = vocab.filter(v => {
            const k = kotobaFavKey(v).slice(5); // remove 'kfav_'
            return favIds.has(k);
        });
        vocab = shuffleArr(vocab);
        if (!vocab.length) return null;
    } else {
        vocab = shuffleArr(vocab);
    }
    return vocab;
}

function shuffleArr(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function startKotobaFlash(mode) {
    const pool = buildFlashPool(mode);
    if (!pool) {
        alert(mode === 'review'   ? '⚠️ Belum ada kata yang sudah dipelajari.'
            : mode === 'favorite' ? '⚠️ Belum ada kata favorit. Tandai bintang ★ dulu!'
            : '⚠️ Tidak ada data kosakata.');
        return;
    }
    KOTOBA_STATE.flashMode    = mode;
    KOTOBA_STATE.flashPool    = pool;
    KOTOBA_STATE.flashIdx     = 0;
    KOTOBA_STATE.flashFlipped = false;
    renderKotobaFlash();
}

function stopKotobaFlash() {
    KOTOBA_STATE.flashMode = null;
    KOTOBA_STATE.flashPool = [];
    renderKotobaFlashPanel('');
}

// ── KOTOBA FLASHCARD — redesain ala Materi (kartu besar, prev/next, shuffle, hafal, review) ──
function renderKotobaFlash() {
    const pool = KOTOBA_STATE.flashPool;
    if (!pool.length) {
        renderKotobaFlashPanel(`<div class="empty-state"><div class="empty-state-icon">📚</div><div class="empty-state-text">Tidak ada kartu untuk mode ini.</div>
            <button onclick="stopKotobaFlash()" style="margin-top:10px;padding:8px 18px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);font-size:12px;cursor:pointer">✕ Tutup</button>
        </div>`);
        return;
    }
    // Jaga idx tetap valid (wrap)
    if (KOTOBA_STATE.flashIdx >= pool.length) KOTOBA_STATE.flashIdx = 0;
    if (KOTOBA_STATE.flashIdx < 0) KOTOBA_STATE.flashIdx = pool.length - 1;

    const idx     = KOTOBA_STATE.flashIdx;
    const v       = pool[idx];
    const total   = pool.length;
    const flipped = KOTOBA_STATE.flashFlipped;
    const cat     = v._cat || detectCat(v);
    const catLabels  = { noun:'Kata Benda', verb:'Kata Kerja', adj:'Kata Sifat' };
    const catTagCls  = cat === 'noun' ? 'tag-noun' : cat === 'verb' ? 'tag-verb' : cat === 'adj' ? 'tag-adj' : 'tag-other';
    const catTagLbl  = catLabels[cat] || 'Lainnya';

    const mainWord = v.kanji || v.jp || v.kana;
    const reading  = (v.kanji || v.jp) && v.kana && (v.kanji||v.jp) !== v.kana ? v.kana : '';
    const learned  = STATE.learnedCards && STATE.learnedCards.has(learnedKey(v));
    const isFav    = isKotobaFav(v);
    const modeLabel = { belajar:'📖 Belajar', review:'🔄 Review', favorite:'⭐ Favorit', random:'🎲 Acak' };

    // FRONT: kanji/kana, dengan furigana ala <ruby> jika toggle furigana aktif
    let frontMain;
    if (reading && STATE.showFurigana) {
        frontMain = `<ruby>${escHTML(mainWord)}<rt>${escHTML(reading)}</rt></ruby>`;
    } else {
        frontMain = escHTML(mainWord);
    }

    // BACK: contoh kalimat — logika sama dengan Materi (getVocabExample: w.ex → bunpou → placeholder)
    // PENTING: pakai lesson ASLI milik kata ini (v._book/_lesson), bukan lesson yang sedang
    // aktif di tab Materi — sebelumnya ini menyebabkan hampir semua kata di Kotoba tidak
    // pernah menemukan contoh kalimatnya karena bunpou yang dicocokkan salah pelajaran.
    const vocabLesson = (typeof getLessonForVocab === 'function') ? getLessonForVocab(v) : null;
    const exData = (typeof getVocabExample === 'function') ? getVocabExample(v, vocabLesson) : { ex: v.ex||'', ex_romaji: v.ex_romaji||'', ex_id: v.ex_id||'' };
    const exIsEmpty = !!(exData && exData.source === 'empty');
    const hasEx = !!(exData && exData.ex);
    const exJpStyle = exIsEmpty ? 'color:var(--text-muted);font-style:italic;font-size:13px' : '';
    const exHtml = hasEx ? `
        <div class="cb-divider"></div>
        <div class="cb-example-wrap">
          <div class="cb-ex-jp" style="${exJpStyle}">${escHTML(exData.ex)}</div>
          ${(exData.ex_romaji && !exIsEmpty) ? `<div class="cb-ex-romaji">${escHTML(exData.ex_romaji)}</div>` : ''}
          ${(exData.ex_id && !exIsEmpty) ? `<div class="cb-ex-id">${escHTML(exData.ex_id)}</div>` : ''}
        </div>` : '';

    const html = `
    <div class="kotoba-flash-wrap" style="margin-bottom:12px">
      <!-- Header — status pill compact (auto-width, bukan bar full-width) -->
      <div style="display:flex;align-items:center;margin-bottom:6px">
        <div style="display:inline-flex;align-items:center;gap:7px;padding:5px 5px 5px 12px;border-radius:99px;background:rgba(196,181,253,.12);border:1px solid rgba(196,181,253,.22);white-space:nowrap">
          <span style="font-size:11px;font-weight:700;color:var(--accent-primary)">${modeLabel[KOTOBA_STATE.flashMode]||''}</span>
          <span style="width:1px;height:11px;background:var(--border-strong);flex-shrink:0"></span>
          <span style="font-size:11px;font-weight:600;color:var(--text-secondary)">${idx+1} / ${total}</span>
          <button onclick="stopKotobaFlash()" aria-label="Tutup flashcard" style="display:flex;align-items:center;justify-content:center;flex-shrink:0;width:18px;height:18px;border-radius:50%;border:none;background:var(--border-strong);color:var(--text-secondary);font-size:10px;line-height:1;cursor:pointer;padding:0">✕</button>
        </div>
      </div>
      <!-- Progress bar -->
      <div style="height:3px;background:var(--border);border-radius:99px;overflow:hidden;margin-bottom:8px">
        <div style="height:3px;background:var(--accent-primary);width:${Math.round(((idx+1)/total)*100)}%;transition:width .3s"></div>
      </div>
      <!-- Card -->
      <div class="flashcard-scene" id="kt-flashcard-scene" data-cat="${cat}">
        <div class="flashcard-flipper${flipped?' is-flipped':''}" id="kt-flashcard-flipper" role="button" aria-label="Flashcard — klik untuk membalik" tabindex="0" onclick="kotobaFlipCard()">
          <!-- FRONT -->
          <div class="card-face card-front">
            <span class="card-category-tag ${catTagCls}">${catTagLbl}</span>
            <span class="card-known-badge" style="display:${learned?'block':'none'}">✓ Hafal</span>
            <div class="card-kanji-wrap">
              <div class="card-main-text">${frontMain}</div>
            </div>
            <span class="card-hint-mazii">タップしてめくる</span>
          </div>
          <!-- BACK -->
          <div class="card-face card-back">
            <div class="cb-furigana">${escHTML(reading || mainWord)}</div>
            <div class="cb-romaji" style="display:${(v.romaji && STATE.showRomaji)?'block':'none'}">${escHTML(v.romaji||'')}</div>
            <div class="cb-arti-label">ARTI (INDONESIA / INGGRIS)</div>
            <div class="cb-arti-id">${escHTML(v.arti||'—')}</div>
            <div class="cb-arti-en" style="display:${v.en?'block':'none'}">${escHTML(v.en||'')}</div>
            ${exHtml}
            ${typeof VERB_ENGINE !== 'undefined' ? VERB_ENGINE.renderPanel(v.jp || v.kanji || v.kana) : ''}
          </div>
        </div>
      </div>
      <!-- Controls: ← 前へ | シャッフル | ★ | 次へ → -->
      <div class="fc-controls-mazii">
        <button class="fc-btn-mazii" onclick="kotobaFlashNav(-1)" aria-label="Kartu sebelumnya">← 前へ</button>
        <button class="fc-btn-mazii" onclick="kotobaFlashShuffle()" aria-label="Shuffle kartu">シャッフル</button>
        <button class="fc-btn-mazii fc-btn-star${isFav?' is-starred':''}" id="kt-btn-star" onclick="kotobaFlashToggleFav()" aria-label="Favorit" style="${isFav?'color:#f59e0b':''}">★</button>
        <button class="fc-btn-mazii" onclick="kotobaFlashNav(1)" aria-label="Kartu berikutnya">次へ →</button>
      </div>
      <!-- Tandai Hafal + TTS + Review -->
      <div class="mark-row" style="margin-top:6px">
        <button class="btn-mark-learned${learned?' is-learned':''}" id="kt-btn-learned" onclick="kotobaFlashToggleLearned()">${learned?'✓ Sudah Hafal':'○ Tandai Sudah Hafal'}</button>
        <button class="btn-nav btn-tts" onclick="kotobaFlashTTS()" aria-label="Dengarkan pengucapan" style="flex:0 0 48px">🔊</button>
        <button class="btn-quick-review" onclick="kotobaFlashQuickReview()">⚡ Review</button>
      </div>
    </div>`;
    renderKotobaFlashPanel(html);
}

function renderKotobaFlashPanel(html) {
    const el = document.getElementById('kotoba-flash-panel');
    if (el) el.innerHTML = html;
}

// Balik kartu — toggle class langsung (animasi flip), tanpa render ulang seluruh panel
function kotobaFlipCard() {
    KOTOBA_STATE.flashFlipped = !KOTOBA_STATE.flashFlipped;
    const flipper = document.getElementById('kt-flashcard-flipper');
    if (flipper) flipper.classList.toggle('is-flipped', KOTOBA_STATE.flashFlipped);
}

// Navigasi prev (-1) / next (+1) — siklik
function kotobaFlashNav(dir) {
    const pool = KOTOBA_STATE.flashPool;
    if (!pool.length) return;
    KOTOBA_STATE.flashIdx = (KOTOBA_STATE.flashIdx + dir + pool.length) % pool.length;
    KOTOBA_STATE.flashFlipped = false;
    renderKotobaFlash();
}

// Acak ulang urutan kartu pada pool aktif
function kotobaFlashShuffle() {
    if (!KOTOBA_STATE.flashPool.length) return;
    KOTOBA_STATE.flashPool = shuffleArr(KOTOBA_STATE.flashPool);
    KOTOBA_STATE.flashIdx = 0;
    KOTOBA_STATE.flashFlipped = false;
    renderKotobaFlash();
}

// Tandai / batalkan status hafal untuk kartu aktif
function kotobaFlashToggleLearned() {
    const v = KOTOBA_STATE.flashPool[KOTOBA_STATE.flashIdx];
    if (!v) return;
    const k = learnedKey(v);
    if (!STATE.learnedCards) STATE.learnedCards = new Set();
    if (STATE.learnedCards.has(k)) STATE.learnedCards.delete(k);
    else STATE.learnedCards.add(k);
    STATE.save();
    if (typeof renderVocabDbCard === 'function') renderVocabDbCard();
    if (typeof updateProgressRing === 'function') updateProgressRing();
    if (typeof renderChapterListHome === 'function') renderChapterListHome();
    renderKotobaFlash();
}

// Toggle favorit untuk kartu aktif
function kotobaFlashToggleFav() {
    const v = KOTOBA_STATE.flashPool[KOTOBA_STATE.flashIdx];
    if (!v) return;
    toggleKotobaFav({ id: v._id || v.id, jp: v.jp || v.kanji, kana: v.kana, arti: v.arti });
    renderKotobaFlash();
}

// Baca kartu aktif dengan Web Speech API (ja-JP)
function kotobaFlashTTS() {
    const v = KOTOBA_STATE.flashPool[KOTOBA_STATE.flashIdx];
    if (!v) return;
    const text = v.kanji || v.jp || v.kana || '';
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'ja-JP';
    utt.rate = 0.85;
    window.speechSynthesis.speak(utt);
}

// Lompat ke kartu yang belum hafal secara acak (dalam pool aktif)
function kotobaFlashQuickReview() {
    const pool = KOTOBA_STATE.flashPool;
    if (!pool.length) return;
    const unlearned = pool.map((w, i) => ({ w, i }))
        .filter(({ w }) => !(STATE.learnedCards && STATE.learnedCards.has(learnedKey(w))));
    if (!unlearned.length) { alert('Semua kartu sudah hafal! 🎉'); return; }
    const pick = unlearned[Math.floor(Math.random() * unlearned.length)];
    KOTOBA_STATE.flashIdx = pick.i;
    KOTOBA_STATE.flashFlipped = false;
    renderKotobaFlash();
}

// ── Init ──────────────────────────────────────────────
function initKotobaPage() {
    // Load master data (async, non-blocking)
    if (!window.MASTER_KOTOBA_READY) {
        loadMasterKotoba().then(() => renderKotobaPage());
    }
    renderKotobaPage();

    // FIX v2.6.5 (revised): IME-aware search with debounce for Android Gboard
    // Android does not reliably fire compositionstart, so guard-based approach fails.
    // Strategy: debounce input 200ms + immediate fire on compositionend.
    const _ks = document.getElementById('kotoba-search');
    if (_ks && !_ks._imeFixed) {
        _ks._imeFixed = true;
        let _ksTimer = null;
        _ks.addEventListener('compositionend', () => {
            clearTimeout(_ksTimer);
            // Small delay so input value is fully updated before reading
            setTimeout(renderKotobaPage, 30);
        });
        _ks.addEventListener('input', () => {
            clearTimeout(_ksTimer);
            _ksTimer = setTimeout(renderKotobaPage, 200);
        });
    }
}


function navigateTo(page) {
    // ── ACCESS CONTROL: Simulasi Ujian is premium-only ──
    if (page === 'simulasi' || page === 'jft-exam') {
        if (!isPremiumUser()) { showPremiumModal(); return; }
    }
    STATE.currentPage = page;
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === 'page-' + page);
    });
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === page);
    });
    if (page === 'materi') {
        // ── ACCESS CONTROL: pastikan lesson aktif tidak premium ──
        const _materiLessons = getLessons(STATE.activeBook);
        const _activeLessonId = _materiLessons[STATE.currentLesson]?.id;
        if (_activeLessonId && !canAccess('lesson', _activeLessonId)) {
            STATE.currentLesson = 0;
            STATE.currentCard = 0;
        }
        renderFlashcard();
        renderVocabList();
        renderChapterPicker();
        renderBookPicker();
        switchSubTab(STATE.currentTab);
    }
    if (page === 'dashboard') {
        renderChapterListHome();
        updateProgressRing();
        renderDailyChallenge();
        updateRoadmapMenuCard();
        const greetEl = document.getElementById('dashboard-greeting-sub');
        if (greetEl && AUTH.isLoggedIn()) {
            const h = new Date().getHours();
            const sapaan = h < 11 ? 'おはよう' : h < 15 ? 'こんにちは' : h < 18 ? 'こんにちは' : 'こんばんは';
            greetEl.textContent = sapaan + '、' + AUTH.user.name + '！ Selamat belajar 👋';
        }
    }
    if (page === 'quiz') {
        initQuizPage();
    }
    if (page === 'kana') {
        updateKanaStats();
    }
    if (page === 'kotoba') {
        // initKotobaPage calls renderKotobaPage which has gate inside
        initKotobaPage();
    }
    // v2.5 new pages
    if (page === 'roadmap') {
        if (typeof ROADMAP_MODULE !== 'undefined') setTimeout(ROADMAP_MODULE.render, 50);
    }
    if (page === 'stats') {
        if (typeof STATS_MODULE !== 'undefined') setTimeout(STATS_MODULE.renderPage, 50);
    }
    if (page === 'review') {
        if (typeof REVIEW_QUEUE !== 'undefined') setTimeout(REVIEW_QUEUE.renderList, 50);
    }
    // ── v2.7: Simulasi Ujian (JFT Basic Full Simulation) ──
    if (page === 'jft-exam') {
        if (typeof initJFTExamPage === 'function') initJFTExamPage();
    }
}

// ═══════════════════════════════════════════════════════════
// ✏️ RENSHU — Latihan Module
// ═══════════════════════════════════════════════════════════

// ── localStorage helper ─────────────────────────────────
function renshuKey(mode) {
    return 'mnn_renshu_' + STATE.activeBook + '_' + STATE.currentLesson + '_' + mode;
}
function renshuSaveBest(mode, score, total) {
    try {
        const k = renshuKey(mode);
        const prev = JSON.parse(localStorage.getItem(k) || 'null');
        const pct  = total ? Math.round((score / total) * 100) : 0;
        if (!prev || pct > prev.pct) {
            localStorage.setItem(k, JSON.stringify({ score, total, pct }));
            // [CLOUD_SAVE v3.0] sync renshu score ke Firestore
            try { if (window.PROGRESS_SYNC) window.PROGRESS_SYNC.push(); } catch(e) {}
        }
    } catch(e) {}
}
function renshuGetBest(mode) {
    try {
        return JSON.parse(localStorage.getItem(renshuKey(mode)) || 'null');
    } catch(e) { return null; }
}

// ── Utility ─────────────────────────────────────────────
function renshuShuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── Home: pilih mode ─────────────────────────────────────
function renderRenshuHome() {
    const panel = document.getElementById('renshu-panel');
    if (!panel) return;
    const lesson = getCurrentLesson();
    if (!lesson) return;

    // ── PREMIUM GATE ──
    if (isLessonLocked(lesson.id)) {
        panel.innerHTML = renderPremiumGateHTML(
            '✏️ Renshū',
            'Latihan interaktif untuk bab ini tersedia di Premium.\nUpgrade untuk akses semua mode latihan.'
        );
        return;
    }

    // Determine available modes based on lesson content
    const hasBunpou  = lesson.bunpou && lesson.bunpou.length > 0;
    const hasVocab   = lesson.vocab && lesson.vocab.length >= 3;
    const hasVerbs   = lesson.vocab.some(v => v.cat === 'verb' || (v.arti && (v.arti.includes('ます') || v.arti.includes('kan') || v.romaji?.endsWith('masu'))));
    const isEarlyLes = lesson.id <= 5;

    // Build mode list dynamically per chapter
    const modes = [
        { id:'partikel', icon:'🎯', title:'Tebak Partikel',
          desc: hasBunpou ? `Pilih partikel untuk ${lesson.vocab.length} contoh kalimat ${lesson.topic}` : 'Pilih partikel yang tepat dalam kalimat',
          available: hasBunpou },
        { id:'susun',    icon:'🧩', title:'Susun Kalimat',
          desc: hasBunpou ? `Rangkai kata dari pola ${lesson.bunpou[0]?.title?.slice(0,20)}…` : 'Susun kata acak menjadi kalimat',
          available: hasBunpou },
        { id:'isi',      icon:'✍️', title:'Isi Kalimat',
          desc: `Ketik terjemahan ${lesson.vocab.length} kata kosakata ${lesson.title}`,
          available: hasVocab },
        { id:'vocab',    icon:'📖', title:'Indonesia → Jepang',
          desc: `Terjemahkan ${Math.min(10,lesson.vocab.length)} kata pilihan acak ke Jepang`,
          available: hasVocab },
        { id:'matching', icon:'🔗', title:'Pasangkan Kata',
          desc: `Cocokkan ${Math.min(8,lesson.vocab.length)} kata Jepang dengan artinya`,
          available: hasVocab && lesson.vocab.length >= 4 },
        { id:'soal',     icon:'📝', title:'Kuis Bergambar Soal',
          desc: `Soal pilihan ganda acak dari ${lesson.vocab.length} kosakata ${lesson.topic}`,
          available: hasVocab && lesson.vocab.length >= 4 },
    ];

    const availableModes = modes.filter(m => m.available);

    panel.innerHTML = `
      <div style="margin-bottom:16px">
        <p class="section-label" style="margin-bottom:4px">Latihan Interaktif</p>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:17px;font-weight:700;color:var(--text-primary)">✏️ Renshū — ${escHTML(lesson.title)}</h3>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:3px">
          ${lesson.topic} · ${lesson.vocab.length} kosakata · ${(lesson.bunpou||[]).length} pola grammar
        </p>
      </div>
      <div class="renshu-modes">
        ${availableModes.map(m => {
            const best = renshuGetBest(m.id);
            return `<button class="renshu-mode-btn" onclick="renshuStart('${m.id}')">
              <span class="renshu-mode-icon">${m.icon}</span>
              <div class="renshu-mode-info">
                <div class="renshu-mode-title">${m.title}</div>
                <div class="renshu-mode-desc">${escHTML(m.desc)}</div>
                ${best ? `<div style="margin-top:5px"><span class="renshu-best-score">🏆 Terbaik: ${best.score}/${best.total} (${best.pct}%)</span></div>` : ''}
              </div>
              <span class="renshu-mode-arrow">›</span>
            </button>`;
        }).join('')}
      </div>`;
}

// ── Dispatcher ──────────────────────────────────────────
function renshuStart(mode) {
    if (mode === 'partikel') startRenshuPartikel();
    else if (mode === 'susun')    startRenshuSusun();
    else if (mode === 'isi')      startRenshuIsi();
    else if (mode === 'vocab')    startRenshuVocab();
    else if (mode === 'matching') startRenshuMatching();
    else if (mode === 'soal')     startRenshuSoal();
}

// ════════════════════════════════════════════════════════
// LATIHAN 4 — KOSAKATA → JEPANG (Indonesia ke Jepang)
// ════════════════════════════════════════════════════════
function startRenshuVocab() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    const vocab = lesson.vocab.filter(v => v.kana && v.romaji && v.arti);
    if (!vocab.length) {
        document.getElementById('renshu-panel').innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
          </div>
          <div class="empty-state"><div class="empty-state-icon">📖</div>
          <div class="empty-state-text">Tidak ada kosakata di pelajaran ini.</div></div>`;
        return;
    }

    const deck = renshuShuffle(vocab).slice(0, 10).map(v => ({
        q: v.arti,
        answer: v.kana,
        romaji: v.romaji,
        kanji: v.kanji || '',
        hint: `ヒント: ${v.romaji}`,
        tr: ''
    }));

    let idx = 0, score = 0, checked = false, currentInput = '';
    const total = deck.length;
    const panel = document.getElementById('renshu-panel');

    const render = () => {
        if (idx >= total) { renderRenshuResult('vocab', score, total, startRenshuVocab); return; }
        const q = deck[idx];
        checked = false; currentInput = '';
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row">📖 Kosakata → Jepang</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">Soal ${idx+1} dari ${total}</span>
              <span class="renshu-score-badge">✓ ${score} / ${total}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(idx/total)*100}%"></div>
            </div>
          </div>
          <div class="renshu-question-card">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Kata dalam Bahasa Indonesia:</div>
            <div style="font-size:28px;font-weight:800;color:var(--text-primary);text-align:center;line-height:1.3">${escHTML(q.q)}</div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Ketik dalam romaji atau kana:</div>
          <input class="renshu-fill-input" id="rv-input"
            placeholder="Ketik romaji..."
            autocomplete="off" autocorrect="off" autocapitalize="off"
            spellcheck="false" inputmode="text" lang="en"
            oninput="rvOnInput(this.value)"
            onkeydown="if(event.key==='Enter'&&!checked)rvCheck()" />
          ${q.hint ? `<div class="hint-eye-wrap"><button class="hint-eye-btn" id="hint-eye-btn" onclick="toggleDrillHint()">🙈 Lihat Hint</button><div class="hint-text" id="drill-hint-text" style="display:none">${escHTML(q.hint)}</div></div>` : ''}
          <div class="ri-answer-hint" id="rv-answer-hint"></div>
          <button class="btn-primary-full" id="rv-btn" onclick="rvCheck()">Cek Jawaban</button>`;
        document.getElementById('rv-input')?.focus();
    };

    window.rvOnInput = (v) => { currentInput = v; };
    window.rvCheck = () => {
        if (checked) { idx++; render(); return; }
        const q = deck[idx];
        const inp = document.getElementById('rv-input');
        const val = inp ? inp.value.trim() : currentInput.trim();
        const correctKana   = normalizeAnswer(q.answer);
        const correctRomaji = normalizeAnswer(q.romaji);
        const correctKanji  = normalizeAnswer(q.kanji);
        const userVal       = normalizeAnswer(val);
        const isRight = userVal === correctKana ||
                        (correctRomaji && userVal === correctRomaji) ||
                        (correctKanji && correctKanji.length > 0 && userVal === correctKanji);
        checked = true;
        if (isRight) score++;
        if (inp) {
            inp.readOnly = true;
            inp.className = 'renshu-fill-input ' + (isRight ? 'is-correct' : 'is-wrong');
        }
        const ansHint = document.getElementById('rv-answer-hint');
        if (ansHint) {
            ansHint.className = 'ri-answer-hint ' + (isRight ? 'correct' : 'wrong');
            if (isRight) {
                ansHint.textContent = `✓ Benar! ${q.answer}${q.romaji ? ' (' + q.romaji + ')' : ''}`;
            } else {
                ansHint.innerHTML = `✗ Jawaban yang benar:<br><span style="font-family:'Noto Sans JP',sans-serif;font-size:18px">${escHTML(q.answer)}</span>${q.romaji ? `<br><span style="font-size:12px;opacity:.8">(${escHTML(q.romaji)})</span>` : ''}`;
            }
        }
        const btn = document.getElementById('rv-btn');
        if (btn) btn.textContent = idx + 1 >= total ? 'Lihat Hasil →' : 'Soal Berikutnya →';
    };
    render();
}

// ════════════════════════════════════════════════════════
// LATIHAN 1 — TEBAK PARTIKEL (Cumulative + Multi-blank)
// ════════════════════════════════════════════════════════

// Semua partikel yang diperkenalkan per bab (kumulatif)
const PARTICLE_BY_LESSON = {
    1:  ['は','も','の'],
    2:  ['は','も','の'],
    3:  ['は','も','の','が'],
    4:  ['は','も','の','が','に','と','から','まで'],
    5:  ['は','も','の','が','に','と','から','まで','へ','で'],
    6:  ['は','も','の','が','に','と','から','まで','へ','で','を'],
    7:  ['は','も','の','が','に','と','から','まで','へ','で','を'],
    8:  ['は','も','の','が','に','と','から','まで','へ','で','を','が'],
    default: ['は','が','を','に','で','と','へ','も','の','から','まで'],
};

function getActiveParticles(lessonId) {
    const maxId = Math.min(lessonId, 8);
    let set = new Set();
    for (let i = 1; i <= maxId; i++) {
        const arr = PARTICLE_BY_LESSON[i] || PARTICLE_BY_LESSON.default;
        arr.forEach(p => set.add(p));
    }
    return [...set];
}

// Extract partikel questions from a single lesson's bunpou
function extractPartikelFromLesson(lesson, activeParticles) {
    const questions = [];
    const PARTICLES = activeParticles;
    (lesson.bunpou || []).forEach(b => {
        const lines = (b.p || '').split('\n');
        lines.forEach(line => {
            if (!line.match(/例[:：]?|Contoh:/)) return;
            let jp = line.replace(/例[:：]?\s*|Contoh:\s*/,'').split('。')[0].trim();
            // Remove translation in parens
            const trm = jp.match(/[（(]([^)）]+)[)）]/);
            const tr = trm ? trm[1] : '';
            jp = jp.replace(/[（(][^)）]*[)）]/g,'').trim();
            if (!jp || jp.length < 4) return;

            // Find ALL particles in sentence
            const found = [];
            PARTICLES.forEach(p => {
                let pos = 0;
                while (true) {
                    const i = jp.indexOf(p, pos);
                    if (i < 1) break;
                    found.push({ p, i });
                    pos = i + p.length;
                }
            });
            if (!found.length) return;

            // Single blank question
            found.forEach(({p, i}) => {
                const before = jp.slice(0, i);
                const after  = jp.slice(i + p.length);
                if (!before.trim()) return;
                const wrong = renshuShuffle(PARTICLES.filter(x => x !== p)).slice(0, 3);
                questions.push({
                    type: 'single',
                    before, answer: p, after,
                    opts: renshuShuffle([p, ...wrong]),
                    full: jp, translation: tr,
                    lessonTitle: lesson.title
                });
            });

            // Double blank question (if sentence has 2+ particles, lessonId >= 5)
            if (found.length >= 2 && lesson.id >= 5) {
                const [a, b2] = found.slice(0, 2);
                const seg1before = jp.slice(0, a.i);
                const seg1after  = jp.slice(a.i + a.p.length, b2.i);
                const seg2after  = jp.slice(b2.i + b2.p.length);
                if (seg1before.trim() && seg1after.trim()) {
                    const wrongA = renshuShuffle(PARTICLES.filter(x => x !== a.p)).slice(0,3);
                    const wrongB = renshuShuffle(PARTICLES.filter(x => x !== b2.p)).slice(0,3);
                    questions.push({
                        type: 'double',
                        seg1before, seg1after, seg2after,
                        answer1: a.p, answer2: b2.p,
                        opts1: renshuShuffle([a.p, ...wrongA]),
                        opts2: renshuShuffle([b2.p, ...wrongB]),
                        full: jp, translation: tr,
                        lessonTitle: lesson.title
                    });
                }
            }
        });
    });
    return questions;
}

function startRenshuPartikel() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    const panel = document.getElementById('renshu-panel');

    const lessons = getLessons(STATE.activeBook);
    const currentIdx = STATE.currentLesson;
    const activeParticles = getActiveParticles(lesson.id);

    // Collect from current + previous chapters (cumulative)
    // More past chapters = more variety. Always include current chapter.
    const allQuestions = [];
    const lookback = Math.min(currentIdx, lesson.id >= 8 ? 5 : lesson.id >= 5 ? 3 : 1);
    for (let i = Math.max(0, currentIdx - lookback); i <= currentIdx; i++) {
        const l = lessons[i];
        if (!l) continue;
        const qs = extractPartikelFromLesson(l, activeParticles);
        // Tag with weight: current lesson gets 2x chance
        qs.forEach(q => {
            allQuestions.push(q);
            if (i === currentIdx) allQuestions.push(q); // duplicate for weight
        });
    }

    // Fallback: vocab-based sentences if not enough
    if (allQuestions.length < 4) {
        const verbs = lesson.vocab.filter(v => v.cat === 'verb' || v.arti.includes('pergi') || v.arti.includes('makan') || v.arti.includes('minum'));
        const nouns  = lesson.vocab.filter(v => !verbs.includes(v));
        nouns.slice(0, 8).forEach(v => {
            const word = v.kanji || v.kana;
            if (!word) return;
            // Sentence patterns based on lesson id
            const patterns = lesson.id <= 3
                ? [{ before: word, answer:'は', after:'なんですか', tr:`${v.arti} itu apa?` }]
                : lesson.id <= 5
                ? [
                    { before: word, answer:'は', after:'なんですか', tr:`${v.arti} itu apa?` },
                    { before: '学校', answer:'に', after:`${word}があります`, tr:`Di sekolah ada ${v.arti}` },
                  ]
                : [
                    { before: word, answer:'を', after:'みます', tr:`Melihat ${v.arti}` },
                    { before: '友達', answer:'と', after:`${word}を買います`, tr:`Membeli ${v.arti} bersama teman` },
                    { before: word, answer:'が', after:'ほしいです', tr:`Ingin ${v.arti}` },
                  ];
            patterns.forEach(pat => {
                const wrong = renshuShuffle(activeParticles.filter(x => x !== pat.answer)).slice(0,3);
                allQuestions.push({
                    type: 'single',
                    before: pat.before, answer: pat.answer, after: pat.after,
                    opts: renshuShuffle([pat.answer, ...wrong]),
                    full: pat.before + pat.answer + pat.after,
                    translation: pat.tr,
                    lessonTitle: lesson.title
                });
            });
        });
    }

    if (!allQuestions.length) {
        panel.innerHTML = `<div class="renshu-back-row"><button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button></div>
          <div class="empty-state"><div class="empty-state-icon">📖</div><div class="empty-state-text">Belum ada contoh kalimat bunpou di pelajaran ini.</div></div>`;
        return;
    }

    // Mix: 70% single, 30% double (if available)
    const singles = allQuestions.filter(q => q.type === 'single');
    const doubles = allQuestions.filter(q => q.type === 'double');
    let deck = renshuShuffle(singles).slice(0, lesson.id >= 5 ? 7 : 8);
    if (doubles.length && lesson.id >= 5) {
        deck = [...deck.slice(0, 6), ...renshuShuffle(doubles).slice(0, 2)];
        deck = renshuShuffle(deck);
    }

    runRenshuPartikel(deck);
}

function extractTranslation(text, jp) {
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.includes(jp)) {
            const m = line.match(/[（(]([^)）]+)[)）]/);
            if (m) return m[1];
        }
    }
    return '';
}

function runRenshuPartikel(deck) {
    let idx = 0, score = 0, answered = false;
    let doubleState = {}; // for double-blank: { sel1, sel2, locked1, locked2 }
    const total = deck.length;
    const panel = document.getElementById('renshu-panel');

    const render = () => {
        if (idx >= total) {
            renderRenshuResult('partikel', score, total, runRenshuPartikel.bind(null, renshuShuffle(deck)));
            return;
        }
        const q = deck[idx];
        answered = false;
        doubleState = { sel1: null, sel2: null, locked: false };

        if (q.type === 'double') {
            renderDoubleBlank(q);
        } else {
            renderSingleBlank(q);
        }
    };

    function renderSingleBlank(q) {
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row">🎯 Tebak Partikel</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">Soal ${idx+1} dari ${total}</span>
              <span class="renshu-score-badge">✓ ${score} / ${total}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(idx/total)*100}%"></div>
            </div>
          </div>
          ${q.lessonTitle ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase">📚 ${escHTML(q.lessonTitle)}</div>` : ''}
          <div class="renshu-question-card">
            <div class="renshu-question-text">
              ${STATE.showFurigana ? addFuriganaToText(q.before) : escHTML(q.before)}<span class="renshu-question-blank" id="rq-blank">___</span>${STATE.showFurigana ? addFuriganaToText(q.after) : escHTML(q.after)}
            </div>
            ${q.translation ? `<div class="renshu-translation">💡 ${escHTML(q.translation)}</div>` : ''}
          </div>
          <div class="renshu-particle-opts" id="rq-opts">
            ${q.opts.map(opt =>
              `<button class="renshu-opt-btn" data-opt="${escAttr(opt)}" onclick="rqAnswer('${escAttr(opt)}','${escAttr(q.answer)}')">${escHTML(opt)}</button>`
            ).join('')}
          </div>
          <div class="renshu-feedback" id="rq-feedback"></div>
          <button class="btn-primary-full" id="rq-next" style="display:none" onclick="rqNext()">
            ${idx + 1 >= total ? 'Lihat Hasil →' : 'Soal Berikutnya →'}
          </button>`;
        answered = false;
    }

    function renderDoubleBlank(q) {
        const ds = doubleState;
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row" style="background:rgba(251,146,60,.1);color:var(--accent-adj);border:1px solid rgba(251,146,60,.2);padding:3px 10px;border-radius:99px;font-size:10px">⚡ Dua Partikel</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">Soal ${idx+1} dari ${total}</span>
              <span class="renshu-score-badge">✓ ${score} / ${total}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(idx/total)*100}%"></div>
            </div>
          </div>
          ${q.lessonTitle ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase">📚 ${escHTML(q.lessonTitle)}</div>` : ''}
          <div class="renshu-question-card">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;text-align:center">Pilih dua partikel yang tepat:</div>
            <div class="renshu-question-text">
              ${STATE.showFurigana ? addFuriganaToText(q.seg1before) : escHTML(q.seg1before)}<span class="renshu-question-blank${ds.sel1?' filled':''}" id="rq-blank1">${ds.sel1 || '①'}</span>${STATE.showFurigana ? addFuriganaToText(q.seg1after) : escHTML(q.seg1after)}<span class="renshu-question-blank${ds.sel2?' filled':''}" id="rq-blank2">${ds.sel2 || '②'}</span>${STATE.showFurigana ? addFuriganaToText(q.seg2after) : escHTML(q.seg2after)}
            </div>
            ${q.translation ? `<div class="renshu-translation">💡 ${escHTML(q.translation)}</div>` : ''}
          </div>
          ${!ds.sel1 ? `
          <div style="font-size:11px;color:var(--accent-primary);font-weight:700;margin-bottom:6px;text-align:center">① Pilih partikel pertama:</div>
          <div class="renshu-particle-opts" id="rq-opts1">
            ${q.opts1.map(opt => `<button class="renshu-opt-btn" onclick="rqDouble1('${escAttr(opt)}')">${escHTML(opt)}</button>`).join('')}
          </div>` : !ds.sel2 ? `
          <div style="font-size:11px;color:var(--accent-adj);font-weight:700;margin-bottom:6px;text-align:center">② Pilih partikel kedua:</div>
          <div class="renshu-particle-opts" id="rq-opts2">
            ${q.opts2.map(opt => `<button class="renshu-opt-btn" onclick="rqDouble2('${escAttr(opt)}')">${escHTML(opt)}</button>`).join('')}
          </div>` : `
          <div class="renshu-feedback ${(ds.sel1===q.answer1&&ds.sel2===q.answer2)?'correct':'wrong'}" style="display:block" id="rq-double-fb">
            ${(ds.sel1===q.answer1&&ds.sel2===q.answer2)
              ? '✓ Benar! 完璧！'
              : `✗ Jawaban: ①「${q.answer1}」②「${q.answer2}」`}
          </div>
          <button class="btn-primary-full" id="rq-next" onclick="rqNext()">
            ${idx + 1 >= total ? 'Lihat Hasil →' : 'Soal Berikutnya →'}
          </button>`}`;
    }

    window.rqAnswer = (selected, correct) => {
        if (answered) return;
        answered = true;
        const isRight = selected === correct;
        if (isRight) score++;
        const blank = document.getElementById('rq-blank');
        if (blank) {
            blank.textContent = correct;
            blank.style.color = isRight ? 'var(--accent-verb)' : 'var(--accent-danger)';
            blank.style.borderBottomColor = isRight ? 'var(--accent-verb)' : 'var(--accent-danger)';
        }
        const optsEl = document.getElementById('rq-opts');
        if (optsEl) {
            optsEl.querySelectorAll('.renshu-opt-btn').forEach(btn => {
                btn.onclick = null;
                const txt = btn.textContent.trim();
                if (txt === correct) btn.classList.add(isRight && txt === selected ? 'is-correct' : 'is-reveal');
                else if (txt === selected && !isRight) btn.classList.add('is-wrong');
            });
        }
        const fb = document.getElementById('rq-feedback');
        if (fb) {
            fb.className = 'renshu-feedback ' + (isRight ? 'correct' : 'wrong');
            fb.textContent = isRight ? '✓ Benar! 素晴らしい！' : `✗ Jawaban yang benar: 「${correct}」`;
        }
        playQuizSound(isRight);
        const nextBtn = document.getElementById('rq-next');
        if (nextBtn) nextBtn.style.display = '';
    };

    window.rqDouble1 = (opt) => {
        if (doubleState.sel1) return;
        doubleState.sel1 = opt;
        renderDoubleBlank(deck[idx]);
    };
    window.rqDouble2 = (opt) => {
        if (doubleState.sel2) return;
        doubleState.sel2 = opt;
        const q = deck[idx];
        const isRight = doubleState.sel1 === q.answer1 && opt === q.answer2;
        if (isRight) score++;
        playQuizSound(isRight);
        renderDoubleBlank(q);
    };

    window.rqNext = () => { idx++; render(); };
    render();
}

// ════════════════════════════════════════════════════════
// LATIHAN 2 — SUSUN KALIMAT
// ════════════════════════════════════════════════════════
function startRenshuSusun() {
    const lesson = getCurrentLesson();
    if (!lesson) return;

    const sentences = [];

    // Extract full sentences from bunpou examples
    (lesson.bunpou || []).forEach(b => {
        const text = b.p || '';
        const lines = text.split('\n');
        lines.forEach(line => {
            if (!line.includes('例')) return;
            const cleaned = line.replace(/例[:：]?\s*/, '').trim();
            // Extract Japanese part (before the parenthetical translation)
            const jp = cleaned.replace(/[（(][^)）]*[)）]/g, '').replace(/\[.*?\]/g,'').trim();
            // Extract translation
            const trm = cleaned.match(/[（(]([^)）]+)[)）]/);
            const tr  = trm ? trm[1] : '';

            if (!jp || jp.length < 6) return;

            // Simple tokenizer: split on は,が,を,に,で,と,へ,も,の,から,まで,です,ます,した,ません
            const tokens = tokenizeJP(jp);
            if (tokens.length >= 3 && tokens.length <= 8) {
                sentences.push({ jp, tokens, tr });
            }
        });
    });

    const deck = renshuShuffle(sentences).slice(0, 6);

    if (!deck.length) {
        document.getElementById('renshu-panel').innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
          </div>
          <div class="empty-state"><div class="empty-state-icon">🧩</div>
          <div class="empty-state-text">Belum ada contoh kalimat yang bisa dipecah untuk pelajaran ini.</div></div>`;
        return;
    }

    runRenshuSusun(deck);
}

function tokenizeJP(sentence) {
    // Split on common grammatical boundaries keeping delimiters attached
    const parts = [];
    const clean = sentence.replace(/。/g,'').trim();
    // Simple regex-based split: break before particles and after verb endings
    const regex = /[^\s。、？！]+/g;
    let m;
    while ((m = regex.exec(clean)) !== null) {
        // Further split long chunks on particles
        const chunk = m[0];
        const sub = chunk.split(/(は|が|を|に|で|と|へ|も|の|から|まで)/).filter(Boolean);
        parts.push(...sub);
    }
    return parts.filter(p => p && p.trim().length > 0).map(p => p.trim());
}

function runRenshuSusun(deck) {
    let idx = 0, score = 0;
    const total = deck.length;
    const panel = document.getElementById('renshu-panel');
    let userAnswer = [], pool = [];

    const render = () => {
        if (idx >= total) { renderRenshuResult('susun', score, total, runRenshuSusun.bind(null, renshuShuffle(deck))); return; }
        const q = deck[idx];
        pool = renshuShuffle([...q.tokens]);
        userAnswer = [];
        renderSusunUI(q, false);
    };

    function renderSusunUI(q, checked) {
        const isRight = checked && userAnswer.join('') === q.tokens.join('');
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row">🧩 Susun Kalimat</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">Soal ${idx+1} dari ${total}</span>
              <span class="renshu-score-badge">✓ ${score} / ${total}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(idx/total)*100}%"></div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Susun kata-kata berikut menjadi kalimat yang benar:</div>
          ${q.tr ? `<div style="background:rgba(196,181,253,.08);border:1px solid rgba(196,181,253,.15);border-radius:10px;padding:8px 12px;font-size:13px;color:var(--text-secondary);margin-bottom:10px">💡 ${escHTML(q.tr)}</div>` : ''}
          <div class="renshu-zone-label">Jawaban kamu:</div>
          <div class="renshu-word-pool answer-zone" id="rs-answer">
            ${userAnswer.map((w,i) =>
              `<div class="renshu-word-chip in-answer" onclick="rsRemoveWord(${i})">${STATE.showFurigana ? addFuriganaToText(w) : escHTML(w)}</div>`
            ).join('')}
          </div>
          <div class="renshu-zone-label" style="margin-top:10px">Kata tersedia:</div>
          <div class="renshu-word-pool" id="rs-pool">
            ${pool.map((w,i) =>
              `<div class="renshu-word-chip${userAnswer.includes(w) && !pool.slice(0,i).includes(w) ? ' disabled' : ''}"
                onclick="rsPickWord('${escAttr(w)}',${i})">${STATE.showFurigana ? addFuriganaToText(w) : escHTML(w)}</div>`
            ).join('')}
          </div>
          ${checked ? `
            <div class="renshu-feedback ${isRight ? 'correct' : 'wrong'}" style="display:block">
              ${isRight ? '✓ Benar! 素晴らしい！' : '✗ Jawaban benar: ' + (STATE.showFurigana ? addFuriganaToText(q.tokens.join(' ')) : escHTML(q.tokens.join(' ')))}
            </div>` : ''}
          ${checked
            ? `<button class="btn-primary-full" onclick="rsSusunNext()">
                ${idx + 1 >= total ? 'Lihat Hasil →' : 'Soal Berikutnya →'}
               </button>`
            : `<div style="display:flex;gap:8px;margin-top:6px">
                <button class="btn-ghost" onclick="rsClearAnswer()" style="flex:1">↺ Ulangi</button>
                <button class="btn-primary-full" onclick="rsSusunCheck()" style="flex:2">Cek Jawaban</button>
               </div>`
          }`;
    }

    window.rsPickWord = (w, poolIdx) => {
        if (userAnswer.filter(x=>x===w).length >= pool.filter(x=>x===w).length) return;
        userAnswer.push(w);
        renderSusunUI(deck[idx], false);
    };
    window.rsRemoveWord = (ansIdx) => {
        userAnswer.splice(ansIdx, 1);
        renderSusunUI(deck[idx], false);
    };
    window.rsClearAnswer = () => {
        userAnswer = [];
        renderSusunUI(deck[idx], false);
    };
    window.rsSusunCheck = () => {
        const q = deck[idx];
        const isRight = userAnswer.join('') === q.tokens.join('');
        if (isRight) score++;
        playQuizSound(isRight);
        renderSusunUI(q, true);
    };
    window.rsSusunNext = () => { idx++; render(); };
    render();
}

// ════════════════════════════════════════════════════════
// LATIHAN 3 — ISI KALIMAT (Fill in the Blank — context-aware per bab)
// ════════════════════════════════════════════════════════
function startRenshuIsi() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    const panel = document.getElementById('renshu-panel');

    const vocab = lesson.vocab.filter(v => v.kana && v.arti && v.romaji);
    if (vocab.length < 2) {
        panel.innerHTML = `<div class="renshu-back-row"><button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button></div>
          <div class="empty-state"><div class="empty-state-icon">✍️</div><div class="empty-state-text">Tidak ada kosakata cukup untuk pelajaran ini.</div></div>`;
        return;
    }

    // Lesson-aware templates: more patterns as lesson progresses
    function makeTemplates(v, lessonId) {
        const word = v.kanji || v.kana;
        const base = [
            { q: `${v.arti} = ___ (bahasa Jepang)`, answer: v.kana, romaji: v.romaji, kanji: v.kanji||'', hint: v.romaji, tr: `Kata Jepang untuk "${v.arti}"` },
            { q: `「${word}」artinya apa dalam Bahasa Indonesia? (Ketik artinya)`, answer: v.arti, romaji: v.arti, kanji: v.arti, hint: null, tr: word },
        ];
        if (lessonId >= 3) base.push(
            { q: `Romaji dari 「${word}」adalah ___`, answer: v.romaji, romaji: v.romaji, kanji: v.kanji||'', hint: `Huruf pertama: ${v.romaji[0]}`, tr: `Cara baca romaji dari ${word}` }
        );
        if (lessonId >= 5 && v.cat === 'verb') base.push(
            { q: `Bentuk negatif から 「${word}」 = ___ません`, answer: v.kana.replace('ます',''), romaji: v.romaji.replace('masu',''), kanji:'', hint: `Hapus ます dari ${word}`, tr:`Bentuk negatif ${v.arti}` }
        );
        if (lessonId >= 6) {
            const bunpouSample = lesson.bunpou && lesson.bunpou[0];
            if (bunpouSample) base.push(
                { q: `Pola: ${bunpouSample.title.slice(0,30)}\nIsi bagian kosong: ___ (kosakata dari pelajaran ini)`, answer: v.kana, romaji: v.romaji, kanji: v.kanji||'', hint: v.romaji, tr: `Gunakan: ${v.arti}` }
            );
        }
        return base;
    }

    const shuffled = renshuShuffle(vocab).slice(0, 8);
    const deck = shuffled.map(v => {
        const tpls = makeTemplates(v, lesson.id);
        return tpls[Math.floor(Math.random() * tpls.length)];
    });

    runRenshuIsi(deck, lesson.id);
}

function normalizeAnswer(s) {
    return (s || '').trim().toLowerCase()
        .replace(/[~〜]/g, '')             // hilangkan tanda ~ / 〜 (placeholder grammar)
        .replace(/\([^)]*\)/g, '')         // hilangkan catatan dalam kurung, misal "(umur)"
        .replace(/ー/g,'').replace(/っ/g,'').replace(/ッ/g,'')
        .replace(/[.,;、。]/g, '')          // hilangkan tanda baca sisa
        .replace(/\s+/g, ' ')
        .trim();
}

// Pecah jawaban yang berisi beberapa alternatif/sinonim, misal:
// "tidak, bukan" → ["tidak","bukan"]; "Sdr./Bpk./Ibu ~" → ["sdr","bpk","ibu"]
function answerVariants(raw) {
    if (!raw) return [];
    return String(raw)
        .split(/\s*(?:,|\/|・|\bor\b|\batau\b)\s*/i)
        .map(normalizeAnswer)
        .filter(Boolean);
}

// Jawaban dianggap benar jika cocok dengan SALAH SATU alternatif
// dari q.answer, q.romaji, atau q.kanji (tidak perlu exact match penuh).
function isAnswerAccepted(userVal, q) {
    const norm = normalizeAnswer(userVal);
    if (!norm) return false;
    const candidates = [
        ...answerVariants(q.answer),
        ...(q.romaji ? answerVariants(q.romaji) : []),
        ...(q.kanji  ? answerVariants(q.kanji)  : []),
    ];
    return candidates.includes(norm);
}

function runRenshuIsi(deck, lessonId) {
    let idx = 0, score = 0;
    const total = deck.length;
    const panel = document.getElementById('renshu-panel');
    let currentInput = '', checked = false;

    const render = () => {
        if (idx >= total) { renderRenshuResult('isi', score, total, () => startRenshuIsi()); return; }
        const q = deck[idx];
        checked = false; currentInput = '';
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row">✍️ Isi Kalimat</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">Soal ${idx+1} dari ${total}</span>
              <span class="renshu-score-badge">✓ ${score} / ${total}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(idx/total)*100}%"></div>
            </div>
          </div>
          <div class="renshu-question-card">
            <div class="renshu-question-text" style="font-size:17px;white-space:pre-wrap">${escHTML(q.q)}</div>
            ${q.tr ? `<div class="renshu-translation" style="margin-top:8px">💡 ${escHTML(q.tr)}</div>` : ''}
          </div>
          <div style="position:relative;margin-bottom:6px">
            <input class="renshu-fill-input" id="ri-input"
              placeholder="Ketik jawabanmu (romaji / kana / arti)..."
              autocomplete="off" autocorrect="off" autocapitalize="off"
              spellcheck="false" inputmode="text" lang="en"
              oninput="riOnInput(this.value)"
              onkeydown="if(event.key==='Enter'&&!checked)riCheck()" />
          </div>
          ${q.hint ? `
          <div class="hint-eye-wrap">
            <button class="hint-eye-btn" id="hint-eye-btn" onclick="toggleDrillHint()">🙈 Lihat Hint</button>
            <div class="hint-text" id="drill-hint-text" style="display:none">💡 ${escHTML(q.hint)}</div>
          </div>` : ''}
          <div class="ri-answer-hint" id="ri-answer-hint"></div>
          <button class="btn-primary-full" id="ri-btn" onclick="riCheck()">✓ Cek Jawaban</button>`;

        setTimeout(() => document.getElementById('ri-input')?.focus(), 80);
    };

    window.riOnInput = (v) => { currentInput = v; };
    window.riCheck = () => {
        if (checked) { idx++; render(); return; }
        const q = deck[idx];
        const inp = document.getElementById('ri-input');
        const val = inp ? inp.value.trim() : currentInput.trim();

        const isRight = isAnswerAccepted(val, q);

        checked = true;
        if (isRight) score++;
        playQuizSound(isRight);

        if (inp) { inp.value = val; inp.readOnly = true; inp.className = 'renshu-fill-input ' + (isRight ? 'is-correct' : 'is-wrong'); }

        const ansHint = document.getElementById('ri-answer-hint');
        if (ansHint) {
            ansHint.className = 'ri-answer-hint ' + (isRight ? 'correct' : 'wrong');
            if (isRight) {
                ansHint.innerHTML = `✓ Benar！<span style="font-family:'Noto Sans JP',sans-serif">${escHTML(q.answer)}</span>${q.romaji && q.romaji !== q.answer ? ` <span style="opacity:.7">(${escHTML(q.romaji)})</span>` : ''}`;
            } else {
                ansHint.innerHTML = `✗ Jawaban benar:<br><span style="font-family:'Noto Sans JP',sans-serif;font-size:18px;font-weight:700">${escHTML(q.answer)}</span>${q.romaji && q.romaji !== q.answer ? `<br><span style="font-size:12px;opacity:.75">(${escHTML(q.romaji)})</span>` : ''}`;
            }
        }
        const btn = document.getElementById('ri-btn');
        if (btn) btn.textContent = idx + 1 >= total ? 'Lihat Hasil →' : 'Soal Berikutnya →';
    };

    render();
}

// ════════════════════════════════════════════════════════
// LATIHAN 5 — PASANGKAN KATA (Matching)
// ════════════════════════════════════════════════════════
// ── vocabFuri: render furigana dari vocab object ─────────
// Menggunakan v.kanji + v.kana langsung, tanpa perlu lookup MAP.
// Jika kanji sama dengan kana (atau kanji kosong), tampilkan teks saja.
// STATE.showFurigana tetap dihormati.
function vocabFuri(v, fontSize) {
    const kanji = v.kanji || v.jp || '';
    const kana  = v.kana  || '';
    const word  = kanji || kana;
    if (!word) return '';
    if (!STATE.showFurigana || !kanji || kanji === kana) {
        return `<span style="font-family:'Noto Sans JP',sans-serif${fontSize?';font-size:'+fontSize:''}">${escHTML(word)}</span>`;
    }
    // Build ruby HTML: kanji + kana in parentheses style (consistent with app)
    return `<span style="font-family:'Noto Sans JP',sans-serif${fontSize?';font-size:'+fontSize:''}">${escHTML(kanji)}<span class="furi-paren">（${escHTML(kana)}）</span></span>`;
}

function startRenshuMatching() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    const panel = document.getElementById('renshu-panel');

    const vocab = renshuShuffle(lesson.vocab.filter(v => v.kana && v.arti)).slice(0, 8);
    if (vocab.length < 4) {
        panel.innerHTML = `<div class="renshu-back-row"><button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button></div>
          <div class="empty-state"><div class="empty-state-icon">🔗</div><div class="empty-state-text">Tidak ada cukup kosakata untuk latihan pasangkan.</div></div>`;
        return;
    }

    // State
    let selectedLeft  = null; // index in vocab
    let selectedRight = null; // index in artis (shuffled)
    let matched = new Set();
    let wrongPair = null;
    let score = 0;
    const artis = renshuShuffle(vocab.map((v,i) => ({ arti: v.arti, origIdx: i })));

    const render = () => {
        if (matched.size === vocab.length) {
            renderRenshuResult('matching', score, vocab.length, startRenshuMatching);
            return;
        }
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row">🔗 Pasangkan Kata</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">${matched.size} dari ${vocab.length} terpasang</span>
              <span class="renshu-score-badge">✓ ${score}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(matched.size/vocab.length)*100}%"></div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;text-align:center">Ketuk kata Jepang, lalu ketuk artinya</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="display:flex;flex-direction:column;gap:8px">
              ${vocab.map((v,i) => {
                const isMatched = matched.has(i);
                const isSelected = selectedLeft === i;
                const isWrong = wrongPair && wrongPair[0] === i;
                let cls = 'renshu-opt-btn';
                let style = 'width:100%;font-family:"Noto Sans JP",sans-serif;font-size:15px;height:auto;min-height:48px;padding:10px 8px;white-space:normal;word-break:break-all;';
                if (isMatched) { style += 'opacity:.35;cursor:default;background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.3);'; }
                else if (isWrong) { cls += ' is-wrong'; }
                else if (isSelected) { cls += ' is-correct'; style += 'transform:scale(1.04)'; }
                return `<button class="${cls}" style="${style}" ${isMatched?'disabled':''} onclick="matchLeft(${i})">${vocabFuri(v, '15px')}</button>`;
              }).join('')}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${artis.map((a,ri) => {
                const isMatched = matched.has(a.origIdx);
                const isSelected = selectedRight === ri;
                const isWrong = wrongPair && wrongPair[1] === ri;
                let cls = 'renshu-opt-btn';
                let style = 'width:100%;font-size:13px;height:auto;min-height:48px;padding:10px 8px;white-space:normal;word-break:break-word;';
                if (isMatched) { style += 'opacity:.35;cursor:default;background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.3);'; }
                else if (isWrong) { cls += ' is-wrong'; }
                else if (isSelected) { cls += ' is-correct'; }
                return `<button class="${cls}" style="${style}" ${isMatched?'disabled':''} onclick="matchRight(${ri})">${escHTML(a.arti)}</button>`;
              }).join('')}
            </div>
          </div>`;
    };

    window.matchLeft = (i) => {
        if (matched.has(i)) return;
        selectedLeft = i;
        wrongPair = null;
        if (selectedRight !== null) tryMatch();
        else render();
    };
    window.matchRight = (ri) => {
        if (matched.has(artis[ri].origIdx)) return;
        selectedRight = ri;
        wrongPair = null;
        if (selectedLeft !== null) tryMatch();
        else render();
    };
    function tryMatch() {
        const li = selectedLeft, ri = selectedRight;
        const isMatch = artis[ri].origIdx === li;
        if (isMatch) {
            matched.add(li);
            score++;
            selectedLeft = null; selectedRight = null; wrongPair = null;
            render();
        } else {
            wrongPair = [li, ri];
            render();
            setTimeout(() => {
                selectedLeft = null; selectedRight = null; wrongPair = null;
                render();
            }, 700);
        }
    }
    render();
}

// ════════════════════════════════════════════════════════
// LATIHAN 6 — KUIS SOAL PILIHAN GANDA (chapter-aware MCQ)
// ════════════════════════════════════════════════════════
function startRenshuSoal() {
    const lesson = getCurrentLesson();
    if (!lesson) return;
    const panel = document.getElementById('renshu-panel');
    const vocab = lesson.vocab.filter(v => v.arti);
    if (vocab.length < 4) {
        panel.innerHTML = `<div class="renshu-back-row"><button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button></div>
          <div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-text">Tidak ada cukup kosakata untuk kuis ini.</div></div>`;
        return;
    }

    // Mix question types: JP→ID, ID→JP, grammar-based if bunpou available
    const allVocab = vocab;
    const makeQuestion = (v) => {
        const type = Math.random();
        const jWord = v.kanji || v.kana;
        const wrong3 = renshuShuffle(allVocab.filter(x => x.arti !== v.arti)).slice(0,3).map(x => x.arti);
        if (type < 0.5) {
            // JP → ID: question is the Japanese word
            return {
                q: jWord,
                _v: v,           // vocab object for vocabFuri
                sub: v.romaji ? `(${v.romaji})` : 'Apa arti kata ini?',
                opts: renshuShuffle([v.arti, ...wrong3]),
                answer: v.arti,
                type: 'jp-id'
            };
        } else {
            // ID → JP: options are Japanese words
            const wrongJP = renshuShuffle(allVocab.filter(x => x.kana !== v.kana)).slice(0,3);
            return {
                q: v.arti,
                _v: v,
                sub: 'Pilih kata Jepang yang tepat:',
                opts: renshuShuffle([v, ...wrongJP]),  // store vocab objects for furigana
                answer: jWord,
                type: 'id-jp'
            };
        }
    };

    const deck = renshuShuffle(vocab).slice(0, 10).map(v => makeQuestion(v));
    let idx = 0, score = 0, answered = false;
    const total = deck.length;

    const render = () => {
        if (idx >= total) { renderRenshuResult('soal', score, total, startRenshuSoal); return; }
        const q = deck[idx];
        answered = false;
        panel.innerHTML = `
          <div class="renshu-back-row">
            <button class="btn-ghost" onclick="renderRenshuHome()">← Kembali</button>
            <span class="renshu-title-row">📝 Kuis Soal</span>
          </div>
          <div class="renshu-progress-wrap">
            <div class="renshu-progress-header">
              <span class="renshu-progress-title">Soal ${idx+1} dari ${total}</span>
              <span class="renshu-score-badge">✓ ${score} / ${total}</span>
            </div>
            <div class="renshu-progress-bar">
              <div class="renshu-progress-fill" style="width:${(idx/total)*100}%"></div>
            </div>
          </div>
          <div class="renshu-question-card" style="margin-bottom:14px">
            <div style="font-size:${q.type==='jp-id'?'34':'22'}px;font-family:${q.type==='jp-id'?"'Noto Sans JP',sans-serif":'inherit'};font-weight:700;text-align:center;color:var(--text-primary);line-height:1.3">${q.type==='jp-id' ? vocabFuri(q._v, q.type==='jp-id'?'34px':'22px') : escHTML(q.q)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:6px;text-align:center">${escHTML(q.sub)}</div>
          </div>
          <div class="renshu-particle-opts" id="soal-opts">
            ${q.opts.map(opt => {
              const optText  = q.type==='id-jp' ? (opt.kanji||opt.kana) : opt;
              const optDisplay = q.type==='id-jp' ? vocabFuri(opt, '17px') : escHTML(opt);
              return `<button class="renshu-opt-btn" style="font-family:${q.type==='id-jp'?"'Noto Sans JP',sans-serif":'inherit'};font-size:${q.type==='id-jp'?'17':'14'}px;height:auto;min-height:52px;white-space:normal;word-break:break-word;padding:10px 8px"
                onclick="soalAnswer(this,'${escAttr(optText)}','${escAttr(q.answer)}')">${optDisplay}</button>`;
            }).join('')}
          </div>
          <div class="renshu-feedback" id="soal-feedback"></div>
          <button class="btn-primary-full" id="soal-next" style="display:none" onclick="soalNext()">
            ${idx+1>=total?'Lihat Hasil →':'Soal Berikutnya →'}
          </button>`;
    };

    window.soalAnswer = (btn, selected, correct) => {
        if (answered) return;
        answered = true;
        const isRight = selected === correct;
        if (isRight) score++;
        document.querySelectorAll('#soal-opts .renshu-opt-btn').forEach(b => {
            b.onclick = null;
            const t = b.textContent.trim();
            if (t === correct) b.classList.add(isRight&&t===selected?'is-correct':'is-reveal');
            else if (t === selected && !isRight) b.classList.add('is-wrong');
        });
        const fb = document.getElementById('soal-feedback');
        if (fb) {
            fb.className = 'renshu-feedback ' + (isRight?'correct':'wrong');
            fb.textContent = isRight ? '✓ Benar！よくできました！' : `✗ Jawaban yang benar: 「${correct}」`;
        }
        playQuizSound(isRight);
        const nb = document.getElementById('soal-next');
        if (nb) nb.style.display = '';
    };
    window.soalNext = () => { idx++; render(); };
    render();
}

// ════════════════════════════════════════════════════════
// RESULT SCREEN
// ════════════════════════════════════════════════════════
let _renshuLastReplayFn = null;

function renderRenshuResult(mode, score, total, replayFn) {
    renshuSaveBest(mode, score, total);
    _renshuLastReplayFn = replayFn;
    const pct   = total ? Math.round((score / total) * 100) : 0;
    const emoji = pct >= 90 ? '🏆' : pct >= 70 ? '🎯' : pct >= 50 ? '💪' : '📚';
    const msg   = pct >= 90 ? 'Luar biasa! Sempurna sekali!' :
                  pct >= 70 ? 'Kerja bagus! Terus berlatih!' :
                  pct >= 50 ? 'Bagus! Ulangi yang keliru ya.' : 'Semangat! Pelajari materi dulu.';
    const color = pct >= 70 ? 'var(--accent-verb)' : pct >= 50 ? 'var(--accent-adj)' : 'var(--accent-danger)';
    const panel = document.getElementById('renshu-panel');
    panel.innerHTML = `
      <div class="renshu-result">
        <span class="renshu-result-emoji">${emoji}</span>
        <div class="renshu-result-score">${score}<span style="font-size:22px;color:var(--text-muted)">/${total}</span></div>
        <div class="renshu-result-sub">${msg}</div>
        <div class="renshu-result-bar" style="width:100%">
          <div class="renshu-result-bar-fill" style="width:0%;background:${color}"></div>
        </div>
        <div style="font-size:13px;color:var(--text-muted)">${pct}% benar</div>
        <div style="display:flex;gap:10px;width:100%">
          <button class="btn-ghost" style="flex:1" onclick="renderRenshuHome()">← Menu</button>
          <button class="btn-primary-full" style="flex:2" id="btn-renshu-replay">🔄 Latihan Lagi</button>
        </div>
      </div>`;
    // animate bar
    requestAnimationFrame(() => {
        const fill = panel.querySelector('.renshu-result-bar-fill');
        if (fill) { setTimeout(() => fill.style.width = pct + '%', 60); }
    });
    // wire replay button safely
    const replayBtn = document.getElementById('btn-renshu-replay');
    if (replayBtn) {
        replayBtn.addEventListener('click', () => {
            if (_renshuLastReplayFn) _renshuLastReplayFn();
        });
    }
}

// ── Patch switchChapter to reset renshu panel ────────────
const _origSwitchChapter = switchChapter;
switchChapter = function(idx) {
    _origSwitchChapter(idx);
    if (STATE.currentTab === 'renshu') renderRenshuHome();
};

// ════════════════════════════════════════════════════════
// LATIHAN FOKUS — Dari tombol Bunpou
// ════════════════════════════════════════════════════════
function startRenshuBunpouFocus(bunpou) {
    const panel = document.getElementById('renshu-panel');
    if (!panel) return;

    const PARTICLES = ['は','が','を','に','で','と','へ','も','の','から','まで'];
    const questions = [];

    const text = bunpou.p || '';
    const lines = text.split('\n');
    lines.forEach(line => {
        if (!line.includes('例') && !line.match(/[あ-ん]/)) return;
        const m = line.match(/例[:：]?\s*(.*)/);
        if (!m) return;
        let raw = m[1].trim();
        const trMatch = raw.match(/[（(]([^)）]+)[)）]/);
        const tr = trMatch ? trMatch[1].trim() : '';
        let jp = raw.replace(/[（(][^)）]*[)）]/g,'').replace(/\[.*?\]/g,'').trim().replace(/。+$/,'').trim();
        if (!jp || jp.length < 4) return;

        // Try partikel questions
        PARTICLES.forEach(p => {
            const idx = jp.indexOf(p);
            if (idx < 1) return;
            const before = jp.slice(0, idx);
            const after = jp.slice(idx + p.length);
            if (!before || before.length < 1) return;
            const wrong = renshuShuffle(PARTICLES.filter(x => x !== p)).slice(0, 3);
            const opts = renshuShuffle([p, ...wrong]);
            questions.push({ type: 'partikel', before, answer: p, after, opts, full: jp, translation: tr });
        });

        // Also add isi kalimat — fill in a vocab word from the sentence
        questions.push({ type: 'isi', q: `${tr ? '「'+tr+'」\n' : ''}Lengkapi: ${jp.replace(/[あ-ん]{2,}/g, m => jp.indexOf(m) > 2 ? '___' : m)} (dalam romaji)`, answer: '', rawJp: jp, translation: tr, isReibun: true });
    });

    // Filter valid isi questions
    const validIsi = questions.filter(q => q.type === 'partikel');

    if (!validIsi.length) {
        // fallback to general renshu
        renderRenshuHome();
        setTimeout(() => renshuStart('partikel'), 50);
        return;
    }

    const deck = renshuShuffle(validIsi).slice(0, 6);
    panel.innerHTML = `
      <div class="renshu-back-row">
        <button class="btn-ghost" onclick="renderRenshuHome()">← Menu Renshū</button>
        <span class="renshu-title-row">🎯 Drill Bunpou</span>
      </div>
      <div style="background:rgba(196,181,253,.08);border:1px solid rgba(196,181,253,.2);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text-secondary)">
        <b style="color:var(--accent-primary)">📌 ${escHTML(bunpou.title)}</b><br>
        Latihan partikel dari contoh kalimat bunpou ini.
      </div>`;

    setTimeout(() => runRenshuPartikel(deck), 80);
}
// ── Refresh semua tampilan yang bergantung pada pengaturan furigana/romaji ──
// Dipanggil setiap kali toggle furigana atau romaji berubah.
// PENGECUALIAN: cb-furigana & cb-romaji (bagian belakang flashcard) selalu
// tampil — tidak dipengaruhi toggle ini sesuai desain.
function refreshDisplaySettings() {
    // ── Materi: flashcard depan + vocab list + grammar ──
    renderFlashcard();
    renderVocabList();
    renderBunpou();

    // ── Kotoba: vocab list + flashcard aktif ──
    // FIX: renderKotobaList tidak ada — fungsi yang benar adalah renderKotobaPage()
    if (typeof renderKotobaPage === 'function') renderKotobaPage();
    if (KOTOBA_STATE.flashPool?.length && KOTOBA_STATE.flashMode) {
        renderKotobaFlash();
    }

    // ── Kanji flashcard (mode flash) ──
    if (typeof KANJI_STATE !== 'undefined' &&
        KANJI_STATE.mode === 'flash' && KANJI_STATE.cards?.length) {
        const kanjiContent = document.getElementById('kanji-content');
        if (kanjiContent) renderKanjiFlash(kanjiContent);
    }

    // ── Kanji mode Daftar / Hafal — re-render agar furigana/romaji ikut update ──
    if (typeof KANJI_STATE !== 'undefined' &&
        (KANJI_STATE.mode === 'list' || KANJI_STATE.mode === 'hafal') && KANJI_STATE.cards?.length) {
        const kanjiContent = document.getElementById('kanji-content');
        if (kanjiContent) renderKanjiContent();
    }

    // ── Quiz vocab (mode pilihan ganda) ──
    // Tidak pakai guard STATE.currentPage — toggle bisa diubah dari halaman Setelan
    const quizWrap = document.getElementById('quiz-card-wrap');
    if (quizWrap && quizWrap.style.display !== 'none' &&
        STATE.quizData?.length && STATE.quizIndex < STATE.quizData.length) {
        renderQuizQuestion();
    }

    // ── Kanji Tes — re-render soal aktif (belum dijawab) ──
    const kanjiContent = document.getElementById('kanji-content');
    if (kanjiContent && typeof KANJI_TES !== 'undefined' &&
        KANJI_TES.deck?.length && KANJI_TES.idx < KANJI_TES.total && !KANJI_TES.answered) {
        renderKanjiTesQuestion(kanjiContent);
    }
}

function initSettings() {
    document.getElementById('toggle-dark')?.addEventListener('click', () => toggleTheme());
    const toggleFurigana = document.getElementById('toggle-furigana');
    // Helper: sync furigana CSS class on body (controls .furi-paren visibility)
    const applyFuriganaClass = () => {
        document.body.classList.toggle('furigana-off', !STATE.showFurigana);
    };
    if (toggleFurigana) {
        toggleFurigana.className = 'toggle-switch ' + (STATE.showFurigana ? 'on' : 'off');
        applyFuriganaClass(); // set initial state on load
        toggleFurigana.addEventListener('click', () => {
            STATE.showFurigana = !STATE.showFurigana;
            toggleFurigana.className = 'toggle-switch ' + (STATE.showFurigana ? 'on' : 'off');
            applyFuriganaClass();
            STATE.save();
            refreshDisplaySettings();
        });
    }
    const toggleRomaji = document.getElementById('toggle-romaji');
    const applyRomajiClass = () => {
        document.body.classList.toggle('romaji-off', !STATE.showRomaji);
    };
    if (toggleRomaji) {
        toggleRomaji.className = 'toggle-switch ' + (STATE.showRomaji ? 'on' : 'off');
        applyRomajiClass(); // set initial state on load
        toggleRomaji.addEventListener('click', () => {
            STATE.showRomaji = !STATE.showRomaji;
            toggleRomaji.className = 'toggle-switch ' + (STATE.showRomaji ? 'on' : 'off');
            applyRomajiClass();
            STATE.save();
            refreshDisplaySettings();
        });
    }
    const toggleSound = document.getElementById('toggle-sound');
    if (toggleSound) {
        // Init dari STATE yang sudah di-load
        window._soundOn = STATE.soundOn;
        toggleSound.className = 'toggle-switch ' + (STATE.soundOn ? 'on' : 'off');
        toggleSound.addEventListener('click', () => {
            window._soundOn = !window._soundOn;
            STATE.soundOn = window._soundOn;
            toggleSound.className = 'toggle-switch ' + (window._soundOn ? 'on' : 'off');
            STATE.save();
        });
    }
    const btnReset = document.getElementById('btn-reset-progress');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (confirm('Reset semua progress belajar? Tindakan ini tidak bisa dibatalkan.')) {
                STATE.learnedCards.clear();
                STATE.save();
                updateProgressRing();
                renderVocabList();
                renderChapterListHome();
                alert('Progress berhasil direset ✓');
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════
// PWA / INSTALL
// ═══════════════════════════════════════════════════════════
let deferredInstallPrompt = null;


// ═══════════════════════════════════════════════════════════
// KEYBOARD
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
    if (STATE.currentPage !== 'materi' || STATE.currentTab !== 'flashcard') return;
    if (e.key === 'ArrowRight' || e.key === 'l') goNextCard();
    if (e.key === 'ArrowLeft'  || e.key === 'j') goPrevCard();
    if (e.key === ' ' || e.key === 'Enter') flipCard();
});

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
function _syncUpgradeUI() {
    // Show/hide the upgrade CTA in Settings based on premium state
    const sec = document.getElementById('settings-upgrade-section');
    if (sec) sec.style.display = isPremiumUser() ? 'none' : 'block';
}

// ── Roadmap Progress Menu Card (dashboard) ──
function updateRoadmapMenuCard() {
    const el = document.getElementById('roadmap-menu-sub');
    if (!el) return;
    const pct = typeof ROADMAP_MODULE !== 'undefined' ? ROADMAP_MODULE.getRoadmapPct() : 0;
    const next = typeof ROADMAP_MODULE !== 'undefined' ? ROADMAP_MODULE.getNextStep() : null;
    el.textContent = pct + '% — ' + (next ? next.title : 'Selesai!');
}


function init() {
    STATE.load();
    applyTheme(STATE.isDark);

    // [SENTENCE_ENGINE] Sync difficulty button active state setelah STATE.load()
    const _initDiff = STATE.exDifficulty || 'easy';
    ['easy','medium','hard'].forEach(d => {
        const btn = document.getElementById('ex-diff-' + d);
        if (btn) btn.classList.toggle('active', d === _initDiff);
    });
    // Load master_kotoba.json, then refresh dashboard once ready
    if (!window.MASTER_KOTOBA_READY) {
        loadMasterKotoba().then(() => {
            // Re-render dashboard stats after DB loaded
            if (typeof LEARNING_PATH !== 'undefined' && LEARNING_PATH.render) {
                LEARNING_PATH.render();
            }
            if (typeof updateRoadmapMenuCard === 'function') updateRoadmapMenuCard();
            if (typeof renderVocabDbCard === 'function') renderVocabDbCard();
            // Update any vocab count displays
            const sub = document.getElementById('kotoba-subtitle');
            if (sub) sub.textContent = `${getAllVocabCount().toLocaleString()} kata tersedia`;
        });
    }

    // Header chapter
    updateHeaderChapter();

    // Bind theme
    document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);

    // Bind install



    // Bind bottom nav
    // Fast-paint: show cached user immediately while Firebase resolves
    AUTH.load();
    updateProfileUI();
    // Firebase onAuthStateChanged (above) will override once it fires
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => { if (btn.dataset.page) navigateTo(btn.dataset.page); });
    });

    // Sub tabs
    document.querySelectorAll('.sub-tab').forEach(btn => {
        btn.addEventListener('click', () => switchSubTab(btn.dataset.tab));
    });

    // Flashcard flip
    const flipper = document.getElementById('flashcard-flipper');
    if (flipper) {
        flipper.addEventListener('click', flipCard);
        flipper.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); } });
    }

    // Prev/next
    document.getElementById('btn-next')?.addEventListener('click', goNextCard);
    document.getElementById('btn-prev')?.addEventListener('click', goPrevCard);
    document.getElementById('btn-mark-learned')?.addEventListener('click', () => window.toggleLearnedCard());
    // Mazii-style controls
    document.getElementById('btn-shuffle-fc')?.addEventListener('click', shuffleFlashcard);
    document.getElementById('btn-star-fc')?.addEventListener('click', () => {
        const lesson = getCurrentLesson();
        if (!lesson || !lesson.vocab.length) return;
        window.toggleLearnedCard(); // reuse existing toggle — marks as hafal / bintang
    });

    // TTS — baca kartu dengan Web Speech API (ja-JP)
    document.getElementById('btn-tts')?.addEventListener('click', () => {
        const lesson = getCurrentLesson();
        if (!lesson || !lesson.vocab.length) return;
        const w = lesson.vocab[Math.min(STATE.currentCard, lesson.vocab.length - 1)];
        const text = w.kanji || w.kana || '';
        if (!text || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'ja-JP';
        utt.rate = 0.85;
        window.speechSynthesis.speak(utt);
    });

    // Quick Review — lompat ke kartu belum hafal secara acak
    document.getElementById('btn-quick-review')?.addEventListener('click', () => {
        const lesson = getCurrentLesson();
        if (!lesson || !lesson.vocab.length) return;
        const unlearned = lesson.vocab.map((w, i) => ({ w, i }))
            .filter(({ w }) => !STATE.learnedCards.has(learnedKey(w)));
        if (!unlearned.length) { alert('Semua kartu sudah hafal! 🎉'); return; }
        const pick = unlearned[Math.floor(Math.random() * unlearned.length)];
        STATE.currentCard = pick.i;
        STATE.isFlipped = false;
        renderFlashcard();
    });

    // Chapter picker
    document.getElementById('chapter-picker')?.addEventListener('change', e => switchChapter(parseInt(e.target.value, 10)));
    document.getElementById('book-picker')?.addEventListener('change', e => switchBook(e.target.value));

    // Filter input
    document.getElementById('filter-input')?.addEventListener('input', e => renderVocabList(e.target.value));

    // AI
    document.getElementById('ai-send')?.addEventListener('click', () => {
        const q = document.getElementById('ai-input')?.value;
        if (q) aiAsk(q);
    });
    document.getElementById('ai-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const q = e.target.value; if (q) aiAsk(q); }
    });

    // Quiz
    document.getElementById('btn-skip-quiz')?.addEventListener('click', startQuiz);

    // Global search
    document.getElementById('global-search-input')?.addEventListener('input', e => renderGlobalSearch(e.target.value));

    // Kana script tabs
    document.querySelectorAll('[data-script]').forEach(btn => {
        btn.addEventListener('click', () => {
            STATE.kanaScript = btn.dataset.script;
            document.querySelectorAll('[data-script]').forEach(b => b.classList.toggle('active', b.dataset.script === STATE.kanaScript));
            updateKanaStats();
        });
    });

    // Settings
    initSettings();

    // Initial renders
    renderChapterPicker();
    renderBookPicker();
    renderFlashcard();
    renderVocabList();
    renderChapterListHome();
    updateProgressRing();
    updateKanaStats();
    renderDailyChallenge();

    // Splash is now hidden by onAuthStateChanged gate
    // Fallback: force hide after 13s in case Firebase is slow on APK WebView.
    // 13s gives Firebase Auth + Firestore fetch enough time on slow 3G connections.
    setTimeout(() => {
        if (!_authResolved) {
            console.warn('[AUTH] SPLASH_FALLBACK_FIRED — Firebase did not resolve in 13s. Forcing unauthenticated state.');
            _setAuthState("unauthenticated");  // properly set state (not just _authResolved)
            _acReleaseLoadingOnError(null);    // release any in-flight loading without showing error
            setAuthLoading(false);
            _hideSplash();
            const guestFlag = (() => { try { return localStorage.getItem('mnn_guest')==='1'; } catch(e){return false;} })();
            if (guestFlag) {
                // Re-enter guest mode from flag
                window._guestMode = true;
                AUTH.user = { name: 'Tamu', email: '', avatar: '👤', isGuest: true, isPremium: false, joinedAt: new Date().toISOString() };
                _setAuthState("guest");
                updateProfileUI();
                renderChapterListHome();
                renderChapterPicker();
                renderKotobaPage();
                renderDailyChallenge();
                _updateGuestBadge();
            } else {
                // Show auth choice with a connection-warning hint
                showAuthChoice();
                // Display soft warning inside the auth panel
                setTimeout(() => {
                    const hint = document.getElementById('ac-conn-hint');
                    if (hint) { hint.style.display = ''; }
                }, 100);
            }
        }
    }, 13000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ══════════════════════════════════════════════════════════════
// MNN PWA — Safe Update System
// Version bump here → triggers What's New modal once per user
// ══════════════════════════════════════════════════════════════
const APP_VERSION = '2.8.0';
const APP_SEEN_KEY = 'mnn_seen_version';

// ── Changelog shown in What's New modal ──
const CHANGELOG = [
  { icon: '📝', title: 'JFT Basic Full Simulation', desc: 'Latihan ujian lengkap 4 section (Kanji-Kotoba, Expression, Dokkai, Choukai) dengan soal, audio, dan waktu sungguhan — kondisinya dibuat semirip ujian JFT Basic asli.' },
  { icon: '📖', title: 'Contoh Kalimat di Flashcard Kotoba', desc: 'Flashcard di tab Kotoba (mode Belajar/Review/Acak) sekarang menampilkan contoh kalimat untuk setiap kata, sama seperti di tab Materi.' },
  { icon: '✨', title: 'Tampilan Flashcard Kotoba Lebih Clean', desc: 'Status di atas kartu (mode & jumlah kata) dirombak jadi pill ringkas, dan filter level JLPT yang membingungkan sudah disembunyikan.' },
  { icon: '🐛', title: 'Perbaikan Bug', desc: 'Beberapa perbaikan kecil di halaman Kotoba untuk pengalaman belajar yang lebih mulus.' },
];

// ── What's New Modal ──────────────────────────────────────────
function _wnShowIfNeeded() {
  if (localStorage.getItem(APP_SEEN_KEY) === APP_VERSION) return;
  const modal = document.getElementById('whats-new-modal');
  const badge = document.getElementById('wn-version-badge');
  const list  = document.getElementById('wn-changelog');
  if (!modal) return;

  badge.textContent = 'v' + APP_VERSION;

  list.innerHTML = CHANGELOG.map((item, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px${i > 0 ? ';border-top:1px solid var(--border);padding-top:10px' : ''}">
      <span style="font-size:16px;flex-shrink:0;margin-top:1px">${item.icon}</span>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--text-primary)">${item.title}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;line-height:1.5">${item.desc}</div>
      </div>
    </div>
  `).join('');

  modal.style.display = 'flex';

  document.getElementById('wn-continue-btn').onclick = () => {
    localStorage.setItem(APP_SEEN_KEY, APP_VERSION);
    modal.style.display = 'none';
  };
}

// ── Update Toast ──────────────────────────────────────────────
let _waitingSW = null;      // holds the waiting SW registration
let _reloadLocked = false;  // prevents infinite reload loop

function _showUpdateToast(reg) {
  _waitingSW = reg;
  const toast   = document.getElementById('update-toast');
  const applyBtn = document.getElementById('update-toast-btn');
  const dismissBtn = document.getElementById('update-toast-dismiss');
  if (!toast) return;

  toast.style.display = 'block';
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  applyBtn.onclick = () => {
    if (!_waitingSW || !_waitingSW.waiting) return;
    // Tell the waiting SW to skip its waiting phase.
    // The 'controllerchange' event fires when it takes control → we reload once.
    _waitingSW.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  };

  dismissBtn.onclick = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => { toast.style.display = 'none'; }, 320);
  };
}

// ── Service Worker Registration ───────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] Registered:', reg.scope);

        // Case 1: Update found while app is running
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener('statechange', () => {
            // New SW has finished installing but hasn't taken control yet.
            // Only show toast if there's already a controller (not first install).
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateToast(reg);
            }
          });
        });

        // Case 2: SW was already waiting when page loaded (e.g. tab was open during deploy)
        if (reg.waiting && navigator.serviceWorker.controller) {
          _showUpdateToast(reg);
        }
      })
      .catch(e => console.warn('[SW] Failed:', e));

    // Single reload guard — fires when new SW takes control after SKIP_WAITING.
    // _reloadLocked prevents the reload from triggering more than once.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloadLocked) return;
      _reloadLocked = true;
      window.location.reload();
    });
  });
}

// ── Show What's New after DOM is ready ───────────────────────
// Delay 1200ms so the app finishes its own init() before the modal appears.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_wnShowIfNeeded, 1200));
} else {
  setTimeout(_wnShowIfNeeded, 1200);
}

// Install Banner
