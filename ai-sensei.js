/* ═══════════════════════════════════════════════════════════
   MNN Learning — AI Sensei Beta
   ai-sensei.js — Phase 1

   Fitur:
   - Firestore aiCredits (per user, reset bulanan)
   - Pengurangan kredit saat AI digunakan
   - Chat history (dalam memory)
   - System prompt khusus pembelajaran bahasa Jepang
   - Loading state + Error handling
   - Integrasi /api/ai-proxy (OpenRouter via Vercel)

   Tidak mengubah: styles.css, data.js, features.js,
                   sistem premium yang ada, sistem progress
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────────────────
// KONSTANTA
// ─────────────────────────────────────────────────────────
const AI_SENSEI = (() => {

    const FREE_CREDITS_MONTHLY   = 20;
    const PREMIUM_CREDITS_MONTHLY = 200;
    const MODEL = 'openai/gpt-4o-mini';
    const MAX_HISTORY_TURNS = 6; // simpan 6 pasang user+assistant

    // Biaya credit per fitur
    const FEATURE_COSTS = {
        'interview':  5,
        'roleplay':   3,
        'koreksi':    2,
        'bunpou':     1,
        'kotoba':     1,
        'default':    1,
    };

    // ── State chat ──
    let _chatHistory  = [];   // [{role, content}, ...]
    let _isLoading    = false;
    let _sendLock     = false; // Anti-duplikat di handleSend sebelum ask()
    let _creditsCache = null; // cache supaya tidak spam Firestore
    let _evAbort      = null; // AbortController untuk event listeners — cegah duplikat

    // ─────────────────────────────────────────────────────
    // CREDIT MANAGER
    // ─────────────────────────────────────────────────────

    /** Ambil bulan saat ini dalam format "YYYY-MM" */
    function _currentMonth() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // ─────────────────────────────────────────────────────
    // HELPERS — Firestore ref & FieldValue
    // ─────────────────────────────────────────────────────

    /**
     * Referensi dokumen user di Firestore.
     * PENTING: credit disimpan sebagai field di users/{uid}
     * bukan subcollection, agar kompatibel dengan data user lama
     * dan Firestore rules yang sudah ada.
     */
    function _userRef() {
        const uid = window.AUTH?.user?.uid;
        if (!uid || window.AUTH?.user?.isGuest) {
            console.log('[AI_CREDIT] _userRef: null — guest atau belum login');
            return null;
        }
        if (typeof _fbDb === 'undefined') {
            console.error('[AI_CREDIT] _userRef: _fbDb tidak tersedia!');
            return null;
        }
        return _fbDb.collection('users').doc(uid);
    }

    /** Firestore FieldValue.increment — compat SDK */
    function _increment(n) {
        return firebase.firestore.FieldValue.increment(n);
    }

    // ─────────────────────────────────────────────────────
    // MIGRASI OTOMATIS — user lama tanpa field AI
    // ─────────────────────────────────────────────────────

    /**
     * Cek dan migrasi field AI jika belum ada di dokumen user.
     * Hanya menulis field: aiCredits, aiPlan, aiUsage, aiCreditReset.
     * TIDAK menyentuh: email, isPremium, role, cloudProgress, dll.
     *
     * @param {firebase.firestore.DocumentSnapshot} snap - snapshot user doc
     * @param {firebase.firestore.DocumentReference} ref - user doc ref
     * @returns {Promise<{aiCredits, aiPlan, aiUsage, aiCreditReset}>}
     */
    async function _migrateAiFields(snap, ref) {
        const data = snap.exists ? snap.data() : {};
        const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();
        const now    = _currentMonth();

        // Sudah punya semua field AI → tidak perlu migrasi
        if (
            typeof data.aiCredits    !== 'undefined' &&
            typeof data.aiPlan       !== 'undefined' &&
            typeof data.aiUsage      !== 'undefined' &&
            typeof data.aiCreditReset !== 'undefined'
        ) {
            console.log('[AI_CREDIT] Field AI sudah ada, skip migrasi.',
                        '| aiCredits:', data.aiCredits,
                        '| aiPlan:', data.aiPlan,
                        '| aiUsage:', data.aiUsage);
            return {
                aiCredits:    data.aiCredits,
                aiPlan:       data.aiPlan,
                aiUsage:      data.aiUsage,
                aiCreditReset: data.aiCreditReset
            };
        }

        // Tentukan nilai default berdasarkan isPremium
        // Credit awal = 0 — semua credit awal diberikan oleh claimWelcomeBonus (1x per akun)
        const defaultCredits = 0;
        const defaultPlan    = isPrem ? 'premium' : 'free';

        const patch = {
            aiCredits:    data.aiCredits    ?? defaultCredits,
            aiPlan:       data.aiPlan       ?? defaultPlan,
            aiUsage:      data.aiUsage      ?? 0,
            aiCreditReset: data.aiCreditReset ?? now,
        };

        console.log('[AI_CREDIT] 🔧 MIGRASI user lama — menulis field AI:',
                    JSON.stringify(patch),
                    '| isPremium:', isPrem,
                    '| uid:', window.AUTH?.user?.uid);

        // merge: true → HANYA tambah field baru, tidak sentuh field lain
        await ref.set(patch, { merge: true });

        console.log('[AI_CREDIT] ✅ Migrasi selesai.');
        return patch;
    }

    // ─────────────────────────────────────────────────────
    // CREDIT MANAGER
    // ─────────────────────────────────────────────────────

    /**
     * Baca state kredit dari Firestore.
     * Jika field AI belum ada → migrasi otomatis (user lama).
     * Jika bulan berubah → reset aiUsage = 0.
     * Return: { total, used, remaining, plan, lastReset }
     */
    async function getCredits() {
        const ref = _userRef();

        if (!ref) {
            // Guest atau tidak login
            return { total: 0, used: 0, remaining: 0, lastReset: '', isGuest: true };
        }

        try {
            console.log('[AI_CREDIT] getCredits() — membaca Firestore...');
            const snap = await ref.get();
            const now  = _currentMonth();
            const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();

            // Migrasi otomatis jika field belum ada
            const aiFields = await _migrateAiFields(snap, ref);

            let { aiCredits, aiPlan, aiUsage, aiCreditReset } = aiFields;

            // [DISABLED] Reset bulanan dimatikan sementara
            // Aktifkan kembali jika sistem kredit bulanan siap
            // if (aiCreditReset !== now) {
            //     const resetCredits = isPrem ? PREMIUM_CREDITS_MONTHLY : FREE_CREDITS_MONTHLY;
            //     const resetPlan    = isPrem ? 'premium' : 'free';
            //     console.log('[AI_CREDIT] 🔄 Reset bulanan — bulan lama:', aiCreditReset,
            //                 '→ bulan baru:', now, '| kredit baru:', resetCredits);
            //     await ref.set({
            //         aiCredits:    resetCredits,
            //         aiUsage:      0,
            //         aiPlan:       resetPlan,
            //         aiCreditReset: now,
            //     }, { merge: true });
            //     aiCredits    = resetCredits;
            //     aiUsage      = 0;
            //     aiPlan       = resetPlan;
            //     aiCreditReset = now;
            // }

            // Sinkronisasi plan jika premium status berubah (label saja, tidak tambah kredit)
            // [DISABLED] Auto-credit saat upgrade dimatikan — kredit dikelola manual/admin
            const expectedPlan = isPrem ? 'premium' : 'free';
            if (aiPlan !== expectedPlan) {
                console.log('[AI_CREDIT] 🔄 Sinkronisasi aiPlan:', aiPlan, '→', expectedPlan);
                await ref.set({ aiPlan: expectedPlan }, { merge: true });
                aiPlan = expectedPlan;
            }

            // [FIX PC-1] Model kredit yang benar:
            // - aiCredits  = saldo tersisa (berkurang setiap deductCredit)
            // - aiUsage    = statistik akumulasi (hanya naik, tidak mempengaruhi remaining)
            // - remaining  = aiCredits langsung (BUKAN aiCredits - aiUsage)
            // - total      = aiCredits + aiUsage (rekonstruksi alokasi awal untuk progress bar)
            const safeUsage = Math.max(0, aiUsage || 0);
            const remaining = Math.max(0, aiCredits);
            const total     = aiCredits + safeUsage; // alokasi awal = sisa + yang sudah terpakai

            _creditsCache = {
                total,
                used:      safeUsage,
                remaining,
                plan:      aiPlan,
                lastReset: aiCreditReset,
            };

            console.log('[AI_CREDIT] ✅ getCredits OK —',
                        'total:', _creditsCache.total,
                        '| used:', _creditsCache.used,
                        '| remaining:', remaining,
                        '| plan:', aiPlan);
            return _creditsCache;

        } catch (e) {
            console.error('[AI_CREDIT] ❌ getCredits ERROR:', e.code || '', e.message);
            return { total: 0, used: 0, remaining: 0, lastReset: '', error: true, errMsg: e.message };
        }
    }

    /**
     * Kurangi kredit setelah AI menjawab.
     * Menggunakan FieldValue.increment(-n) agar atomic.
     *
     * [FIX PC-1] Model kredit baru:
     * - aiCredits berkurang (saldo tersisa)
     * - aiUsage bertambah (statistik, tidak mempengaruhi remaining)
     * - _creditsCache.total TIDAK dikurangi (total = alokasi awal, bersifat tetap)
     *
     * Return: sisa kredit baru
     */
    async function deductCredit(amount = 1) {
        const ref = _userRef();
        if (!ref) return 0;
        const safeAmount = Math.max(1, Math.floor(amount));
        try {
            await ref.set({
                aiCredits: _increment(-safeAmount),  // saldo berkurang
                aiUsage:   _increment(safeAmount),   // statistik naik
            }, { merge: true });
            if (_creditsCache) {
                _creditsCache.used      = (_creditsCache.used || 0) + safeAmount;
                _creditsCache.remaining = Math.max(0, _creditsCache.remaining - safeAmount);
                // [FIX PC-1] total TIDAK diubah — merepresentasikan alokasi awal bulan ini
            }
            console.log('[AI_CREDIT] Kredit dikurangi', safeAmount, '. Sisa:', _creditsCache?.remaining);
            return _creditsCache?.remaining ?? 0;
        } catch (e) {
            console.error('[AI_CREDIT] deductCredit ERROR:', e.message);
            return _creditsCache?.remaining ?? 0;
        }
    }
    // ─────────────────────────────────────────────────────
    // ADMIN — tambah credit via MemberId (MNN-XXXXXX)
    // ─────────────────────────────────────────────────────

    /**
     * Admin: cari user berdasarkan memberId lalu tambah credit.
     * Lebih user-friendly daripada UID mentah.
     * @param {string} memberId - contoh: "MNN-849622"
     * @param {number} amount
     */
    async function adminAddCreditByMemberId(memberId, amount) {
        if (window.AUTH?.user?.role !== 'admin') {
            return { success: false, error: 'Hanya admin yang bisa melakukan ini.' };
        }
        if (!memberId || amount <= 0) {
            return { success: false, error: 'MNN-ID dan jumlah tidak valid.' };
        }
        if (typeof _fbDb === 'undefined') {
            return { success: false, error: 'Firestore tidak tersedia.' };
        }
        try {
            // Query user berdasarkan memberId
            const snap = await _fbDb.collection('users')
                .where('memberId', '==', memberId.trim().toUpperCase())
                .limit(1)
                .get();

            if (snap.empty) {
                return { success: false, error: 'MNN-ID tidak ditemukan: ' + memberId };
            }

            const userDoc  = snap.docs[0];
            const targetUid = userDoc.id;
            const email    = userDoc.data().email || '-';

            await userDoc.ref.set({
                aiCredits: firebase.firestore.FieldValue.increment(amount),
            }, { merge: true });

            await _fbDb.collection('creditTransactions').add({
                uid:       targetUid,
                memberId:  memberId.trim().toUpperCase(),
                amount,
                type:      'manual_topup',
                adminUid:  window.AUTH.user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

            console.log('[ADMIN] Credit ditambahkan:', amount, '-> memberId:', memberId, '| uid:', targetUid);
            // Analytics: catat top-up
            if (window.AI_ANALYTICS?.trackTopUp) AI_ANALYTICS.trackTopUp(targetUid, amount, 'admin_add');
            return { success: true, targetUid, email };
        } catch (e) {
            console.error('[ADMIN] adminAddCreditByMemberId error:', e.message);
            return { success: false, error: e.message };
        }
    }

    // ─────────────────────────────────────────────────────
    // SYSTEM PROMPT — Pembelajaran Bahasa Jepang
    // ─────────────────────────────────────────────────────

    function _buildSystemPrompt() {
        // Ambil konteks pelajaran aktif jika tersedia
        let lessonCtx = '';
        try {
            if (typeof getCurrentLesson === 'function') {
                const lesson = getCurrentLesson();
                if (lesson) {
                    const bunpouList = (lesson.bunpou || []).map(b => b.title).join(', ');
                    lessonCtx = '\n\nKONTEKS PELAJARAN AKTIF: Pengguna sedang belajar ' +
                        lesson.title + ' (' + (lesson.topic || '') + ').' +
                        '\nPola tata bahasa: ' + (bunpouList || 'belum dipilih') + '.';
                }
            }
        } catch (_) {}

        // Catatan: semua karakter di sini ASCII agar aman melewati Node.js proxy
        return 'Kamu adalah AI Sensei resmi di aplikasi MNN Learning.\n\n' +
'Misi utama kamu adalah membantu pengguna memahami bahasa Jepang dengan cepat, nyaman, terarah, dan percaya diri, terutama untuk:\n' +
'- Pemula belajar bahasa Jepang\n' +
'- Peserta JFT-Basic\n' +
'- Calon pekerja SSW Jepang\n' +
'- Orang yang ingin bekerja di Jepang\n\n' +
'IDENTITAS AI SENSEI\n' +
'Kamu bukan chatbot umum. Kamu adalah mentor belajar bahasa Jepang yang terintegrasi dengan MNN Learning.\n' +
'Fokus utama: Bahasa Jepang, JFT-Basic, SSW Jepang, kehidupan sehari-hari di Jepang, budaya kerja Jepang, persiapan kerja di Jepang.\n' +
'Jika pengguna bertanya di luar topik tersebut, arahkan kembali secara sopan ke topik pembelajaran Jepang.\n\n' +
'ATURAN UMUM\n' +
'1. Selalu jawab menggunakan bahasa Indonesia yang sederhana dan mudah dipahami.\n' +
'2. Hindari penjelasan akademis yang terlalu rumit.\n' +
'3. Pilih cara menjelaskan yang paling mudah dipahami pemula.\n' +
'4. Dorong pengguna untuk aktif berpikir dan menjawab, bukan hanya membaca jawaban.\n' +
'5. Gunakan emoji seperlunya agar jawaban lebih nyaman dibaca.\n' +
'6. Selalu prioritaskan jawaban yang praktis dan bisa langsung digunakan di Jepang.\n\n' +
'KOSAKATA (KOTOBA)\n' +
'Jika menjelaskan kosakata, tampilkan dengan format:\n' +
'Kanji (jika ada), Hiragana, Arti Bahasa Indonesia.\n' +
'Contoh kalimat minimal 1. Level: N5/N4/N3/N2/N1/JFT-Basic.\n' +
'Tingkat kesopanan: Kasual/Sopan/Formal. Penggunaan di tempat kerja jika relevan. Kosakata berkaitan.\n\n' +
'TATA BAHASA (BUNPOU)\n' +
'Jika menjelaskan tata bahasa, tampilkan: rumus pola, penjelasan sederhana, minimal 3 contoh kalimat,\n' +
'level, catatan kesalahan umum pemula, dan penggunaan di lingkungan kerja Jepang jika relevan.\n\n' +
'KOREKSI KALIMAT\n' +
'Jika pengguna membuat kesalahan: tampilkan versi yang benar, jelaskan bagian yang salah,\n' +
'berikan tips agar tidak mengulang kesalahan. Jangan hanya mengatakan "salah".\n' +
'PENTING: Hiragana dan kanji untuk kata yang sama KEDUANYA benar. "もうします" dan "申します" adalah SAMA-SAMA BENAR, bukan kesalahan. Hanya koreksi jika ada kesalahan tata bahasa, kosakata yang salah, atau partikel yang tidak tepat. Jika user menulis hiragana semua dan tata bahasanya benar: puji dan lanjutkan, JANGAN koreksi.\n\n' +
'LATIHAN\n' +
'Jika pengguna meminta latihan: sesuaikan level, berikan soal bertahap, tunggu jawaban, koreksi dan jelaskan.\n\n' +
'SIMULASI PERCAKAPAN\n' +
'Jika pengguna meminta percakapan: berperan sebagai orang Jepang, gunakan percakapan realistis.\n' +
'Situasi yang bisa disimulasikan: interview kerja, restoran, konbini, tempat kerja, kehidupan sehari-hari.\n' +
'FEEDBACK SELAMA ROLEPLAY:\n' +
'Jika jawaban user terlalu pendek (kurang dari 5 kata): hentikan roleplay sebentar, minta user menjawab lebih lengkap dan natural.\n' +
'Jika user menggunakan bahasa kasual/tidak sopan saat roleplay interview/kerja: berikan koreksi sopan, contohkan bentuk yang benar, lalu lanjutkan roleplay.\n' +
'Jika user menjawab dalam bahasa Indonesia padahal roleplay Jepang: ingatkan dan minta ulangi dalam bahasa Jepang.\n\n' +
'JFT-BASIC DAN SSW\n' +
'Prioritaskan jawaban relevan untuk kebutuhan kerja di Jepang.\n' +
'Berikan contoh yang sering muncul di tempat kerja. Fokus pada penggunaan praktis.\n\n' +
'PANDUAN PEMULA\n' +
'Jika pengguna mengatakan "baru mulai", "mulai dari mana", "pemula", atau "bingung belajar apa dulu",\n' +
'berikan panduan langkah belajar MNN Learning:\n' +
'1.Hiragana - 2.Katakana - 3.Kosakata Dasar - 4.Bunpou N5 - 5.Quiz - 6.Flashcard - 7.Simulasi JFT - 8.Latihan Percakapan - 9.Persiapan Interview.\n\n' +
'FORMAT JAWABAN\n' +
'Gunakan format rapi dengan judul, poin-poin, emoji seperlunya. Mudah dibaca di layar HP.\n\n' +
'TUJUAN UTAMA\n' +
'Membantu pengguna memahami bahasa Jepang dengan cepat, nyaman, terarah, dan percaya diri\n' +
'untuk lulus JFT-Basic serta bekerja di Jepang.\n' +
'Selalu bertindak sebagai Sensei yang sabar, mendukung, dan fokus pada kemajuan belajar pengguna.' +
        lessonCtx;
    }
    // ─────────────────────────────────────────────────────
    // CHAT ENGINE
    // ─────────────────────────────────────────────────────

    /**
     * Kirim pertanyaan ke AI.
     * Mengelola: validasi kredit, history, API call, deduct kredit.
     *
     * @param {string} userMessage - Pesan dari user
     * @returns {Promise<{success: boolean, answer?: string, error?: string, remaining?: number}>}
     */
    async function ask(userMessage, cost = 1) {
        if (_isLoading) return { success: false, error: 'Sedang memproses, harap tunggu...' };
        if (!userMessage?.trim()) return { success: false, error: 'Pesan tidak boleh kosong.' };

        // Cek login
        if (!window.AUTH?.user || window.AUTH?.user?.isGuest) {
            return { success: false, error: 'Silakan login terlebih dahulu untuk menggunakan AI Sensei.' };
        }

        // [FIX AR-1] _isLoading=true SEBELUM await apapun — menutup race window
        // sehingga dua panggilan ask() paralel tidak bisa lolos bersamaan.
        _isLoading = true;

        // Cek kredit
        const credits = await getCredits();

        if (credits.isGuest) {
            _isLoading = false;
            return { success: false, error: 'Silakan login untuk menggunakan AI Sensei.' };
        }
        if (credits.error) {
            // Jangan block — log error tapi tetap izinkan (fail-open untuk UX)
            // Ubah ke fail-closed jika ingin strict: _isLoading = false; return { success: false, error: '...' }
            console.warn('[AI_CREDIT] getCredits error saat ask(), lanjutkan tanpa cek kredit:', credits.errMsg);
        }
        if (!credits.error && credits.remaining <= 0) {
            _isLoading = false;
            const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();
            return {
                success: false,
                error: `Kredit AI Sensei kamu habis bulan ini. Kredit gratis direset setiap bulan.\n\n${
                    !isPrem
                        ? '✨ Upgrade ke Premium untuk mendapat lebih banyak kredit!'
                        : 'Kredit akan direset di awal bulan depan.'
                }`
            };
        }

        // Tambah ke history
        _chatHistory.push({ role: 'user', content: userMessage.trim() });

        // Pangkas history agar tidak terlalu panjang
        if (_chatHistory.length > MAX_HISTORY_TURNS * 2) {
            _chatHistory = _chatHistory.slice(-MAX_HISTORY_TURNS * 2);
        }

        const messages = [
            { role: 'system', content: _buildSystemPrompt() },
            ..._chatHistory
        ];

        try {
            // Escape semua non-ASCII ke \uXXXX agar body pure ASCII
            // Fix: Node.js di api/ai-proxy melempar ByteString error
            // jika body mengandung karakter Unicode (Jepang, em-dash, dll)
            const _rawPayload = JSON.stringify({ model: MODEL, messages });
            const _safePayload = _rawPayload.replace(
                /[\u0080-\uFFFF]/g,
                ch => '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4)
            );

            // [FIX KM-1] Ambil Firebase ID Token untuk autentikasi proxy.
            // Proxy akan menolak request tanpa token yang valid (HTTP 401).
            let idToken = '';
            try {
                const currentUser = firebase.auth().currentUser;
                if (currentUser) {
                    idToken = await currentUser.getIdToken();
                }
            } catch (tokenErr) {
                console.warn('[AI_SENSEI] Gagal ambil ID token:', tokenErr.message);
            }

            if (!idToken) {
                _isLoading = false;
                if (_chatHistory[_chatHistory.length - 1]?.role === 'user') _chatHistory.pop();
                return { success: false, error: 'Sesi login tidak valid. Silakan login ulang.' };
            }

            const res = await fetch('/api/ai-proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + idToken,  // [FIX KM-1] wajib ada
                },
                body: _safePayload
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const answer = data?.choices?.[0]?.message?.content;
            if (!answer) throw new Error('Respon AI tidak valid. Coba lagi.');

            // Tambah jawaban AI ke history
            _chatHistory.push({ role: 'assistant', content: answer });

            // Kurangi kredit sesuai biaya fitur
            const remaining = await deductCredit(cost);

            _isLoading = false;
            return { success: true, answer, remaining };

        } catch (e) {
            // Kalau gagal, hapus pesan user terakhir dari history (biar tidak merusak konteks)
            if (_chatHistory[_chatHistory.length - 1]?.role === 'user') {
                _chatHistory.pop();
            }
            _isLoading = false;
            console.warn('[AI_SENSEI] ask error:', e);
            return {
                success: false,
                error: e.message?.includes('Failed to fetch')
                    ? 'Koneksi gagal. Periksa internet kamu dan coba lagi.'
                    : (e.message || 'Terjadi kesalahan. Silakan coba lagi.')
            };
        }
    }


    // ─────────────────────────────────────────────────────
    // FEATURE DETECTION — deteksi jenis pertanyaan & biaya
    // ─────────────────────────────────────────────────────

    /**
     * Deteksi fitur dari pesan user untuk menentukan biaya credit.
     * @param {string} msg
     * @returns {{ feature: string, cost: number }}
     */
    function _detectFeature(msg) {
        const m = msg.toLowerCase();
        if (/interview|wawancara kerja|simulasi interview/.test(m))
            return { feature: 'Interview AI', cost: FEATURE_COSTS.interview };
        if (/roleplay|bermain peran|simulasi percakapan|berperan sebagai|role.?play/.test(m))
            return { feature: 'Roleplay Percakapan', cost: FEATURE_COSTS.roleplay };
        if (/koreksi|perbaiki kalimat|betulkan|benarkan|apakah.*benar|cek kalimat/.test(m))
            return { feature: 'Koreksi Kalimat', cost: FEATURE_COSTS.koreksi };
        if (/bunpou|tata bahasa|pola kalimat|grammar|partikel|て.form|た.form/.test(m))
            return { feature: 'Bunpou', cost: FEATURE_COSTS.bunpou };
        if (/arti|kosakata|kotoba|apa artinya|translate|terjemah/.test(m))
            return { feature: 'Kotoba', cost: FEATURE_COSTS.kotoba };
        return { feature: 'Pertanyaan Umum', cost: FEATURE_COSTS.default };
    }

    // ─────────────────────────────────────────────────────
    // USAGE LOG — simpan riwayat pemakaian ke Firestore
    // ─────────────────────────────────────────────────────

    /**
     * Catat log penggunaan ke collection aiUsageLogs.
     * Fire-and-forget — tidak block UI jika gagal.
     */
    /**
     * Log usage + trigger analytics tracking.
     * Delegate ke AI_ANALYTICS.track() — fire-and-forget.
     * @param {string} feature        - nama fitur dari _detectFeature()
     * @param {number} creditUsed     - kredit yang dipotong
     * @param {number} messageLength  - panjang pesan user
     * @param {number} answerLength   - panjang jawaban AI
     * @param {boolean} success       - apakah sukses
     * @param {number} currentBalance - saldo setelah deduct
     */
    function _logUsage(feature, creditUsed, messageLength, answerLength, success, currentBalance) {
        // Delegate ke modul analytics — tidak perlu await, tidak block UI
        if (window.AI_ANALYTICS?.track) {
            window.AI_ANALYTICS.track(
                feature, creditUsed, messageLength, answerLength, success, currentBalance
            );
        }
    }

    // ─────────────────────────────────────────────────────
    // WELCOME BONUS — satu kali per akun
    // ─────────────────────────────────────────────────────

    /**
     * Cek dan klaim bonus launch AI Sensei.
     * Premium: +15 credit. Free: +5 credit.
     * Hanya sekali per akun, dijaga oleh field aiWelcomeBonusClaimed.
     * @returns {Promise<{ claimed: boolean, amount: number }>}
     */
    async function claimWelcomeBonus() {
        const ref = _userRef();
        if (!ref) return { claimed: false, amount: 0 };

        try {
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : {};

            // Sudah pernah klaim → skip
            if (data.aiWelcomeBonusClaimed === true) {
                console.log('[AI_CREDIT] Welcome bonus sudah diklaim sebelumnya, skip.');
                return { claimed: false, amount: 0 };
            }

            const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();
            const bonus  = isPrem ? 20 : 5;
            const plan   = isPrem ? 'premium' : 'free';

            console.log('[AI_CREDIT] Mengklaim welcome bonus:', bonus, 'credit | isPremium:', isPrem);

            await ref.set({
                aiCredits:            firebase.firestore.FieldValue.increment(bonus),
                aiWelcomeBonusClaimed: true,
                aiUsage:              data.aiUsage ?? 0,
                aiPlan:               data.aiPlan  ?? plan,
            }, { merge: true });

            // Log transaksi bonus
            await _fbDb.collection('creditTransactions').add({
                uid:       window.AUTH.user.uid,
                amount:    bonus,
                type:      'welcome_bonus',
                adminUid:  null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

            // Invalidate cache agar getCredits baca ulang
            invalidateCache();

            console.log('[AI_CREDIT] Welcome bonus berhasil diklaim:', bonus, 'credit');
            return { claimed: true, amount: bonus };

        } catch (e) {
            console.error('[AI_CREDIT] claimWelcomeBonus error:', e.message);
            return { claimed: false, amount: 0 };
        }
    }

    // ─────────────────────────────────────────────────────
    // PREMIUM UPGRADE BONUS — diberikan 1x saat user upgrade ke premium
    // Terpisah dari welcome bonus agar user yang sudah klaim free bonus
    // tetap bisa dapat premium bonus saat upgrade
    // ─────────────────────────────────────────────────────
    async function claimPremiumUpgradeBonus() {
        const ref = _userRef();
        if (!ref) return { claimed: false, amount: 0 };

        const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();
        if (!isPrem) return { claimed: false, amount: 0 };

        try {
            const snap = await ref.get();
            const data = snap.exists ? snap.data() : {};

            // Sudah pernah klaim bonus premium → skip
            if (data.aiPremiumBonusClaimed === true) {
                console.log('[AI_CREDIT] Premium upgrade bonus sudah diklaim sebelumnya, skip.');
                return { claimed: false, amount: 0 };
            }

            // Hanya berikan jika sebelumnya adalah user free (bukan akun baru langsung premium)
            // Akun baru langsung premium sudah dapat 20 dari claimWelcomeBonus
            if (data.aiWelcomeBonusClaimed !== true) {
                console.log('[AI_CREDIT] Welcome bonus belum diklaim, premium bonus ditangani oleh claimWelcomeBonus.');
                return { claimed: false, amount: 0 };
            }

            const bonus = 15; // Selisih premium(20) - free(5) = 15 tambahan
            console.log('[AI_CREDIT] Mengklaim premium upgrade bonus:', bonus, 'credit');

            await ref.set({
                aiCredits:             firebase.firestore.FieldValue.increment(bonus),
                aiPremiumBonusClaimed: true,
                aiPlan:                'premium',
            }, { merge: true });

            await _fbDb.collection('creditTransactions').add({
                uid:       window.AUTH.user.uid,
                amount:    bonus,
                type:      'premium_upgrade_bonus',
                adminUid:  null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

            invalidateCache();
            console.log('[AI_CREDIT] Premium upgrade bonus berhasil diklaim:', bonus, 'credit');
            return { claimed: true, amount: bonus };

        } catch (e) {
            console.error('[AI_CREDIT] claimPremiumUpgradeBonus error:', e.message);
            return { claimed: false, amount: 0 };
        }
    }

    // ─────────────────────────────────────────────────────
    // POPUP — credit tidak cukup
    // ─────────────────────────────────────────────────────

    function _showCreditPopup(needed, have) {
        document.getElementById('ais-credit-popup')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ais-credit-popup';
        overlay.innerHTML =
            '<div class="ais-popup-box">' +
            '<div class="ais-popup-icon">💳</div>' +
            '<div class="ais-popup-title">Credit Tidak Cukup</div>' +
            '<div class="ais-popup-body">' +
            'Kamu butuh <strong>' + needed + ' credit</strong> untuk fitur ini,<br>' +
            'tapi sisa credit kamu <strong>' + have + ' credit</strong>.' +
            '</div>' +
            '<div class="ais-popup-sub">Lakukan top up credit untuk melanjutkan.</div>' +
            '<div class="ais-popup-actions">' +
            '<button class="ais-popup-btn-secondary" id="ais-popup-close">Tutup</button>' +
            '<button class="ais-popup-btn-primary" id="ais-popup-topup">Top Up Credit</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        document.getElementById('ais-popup-close').onclick = () => overlay.remove();
        document.getElementById('ais-popup-topup').onclick = () => {
            overlay.remove();
            if (typeof navigateTo === 'function') navigateTo('ai-credit');
        };
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    // ─────────────────────────────────────────────────────
    // ADMIN — tambah credit user
    // ─────────────────────────────────────────────────────

    /**
     * Admin: tambah credit ke user lain.
     * Hanya bisa dipanggil jika role = "admin".
     * @param {string} targetUid
     * @param {number} amount
     */
    async function adminAddCredit(targetUid, amount) {
        if (window.AUTH?.user?.role !== 'admin') {
            return { success: false, error: 'Hanya admin yang bisa melakukan ini.' };
        }
        if (!targetUid || amount <= 0) {
            return { success: false, error: 'UID dan jumlah credit tidak valid.' };
        }
        if (typeof _fbDb === 'undefined') {
            return { success: false, error: 'Firestore tidak tersedia.' };
        }

        try {
            const targetRef = _fbDb.collection('users').doc(targetUid);
            const snap = await targetRef.get();
            if (!snap.exists) return { success: false, error: 'User tidak ditemukan.' };

            // STEP 1: Update credit — operasi utama
            await targetRef.set({
                aiCredits: firebase.firestore.FieldValue.increment(amount),
            }, { merge: true });

            console.log('[ADMIN] Credit ditambahkan:', amount, '-> uid:', targetUid);

            // STEP 2: Log transaksi — non-blocking, jangan gagalkan operasi utama
            try {
                await _fbDb.collection('creditTransactions').add({
                    uid:       targetUid,
                    amount,
                    type:      'manual_topup',
                    adminUid:  window.AUTH.user.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (logErr) {
                // Log gagal tidak membatalkan sukses — credit sudah masuk
                console.warn('[ADMIN] Log transaksi gagal (credit tetap masuk):', logErr.message);
            }

            return { success: true };
        } catch (e) {
            console.error('[ADMIN] adminAddCredit error:', e.message);
            return { success: false, error: e.message };
        }
    }

    // ─────────────────────────────────────────────────────
    // ADMIN — SET CREDIT (ke nilai tertentu, bukan tambah)
    // ─────────────────────────────────────────────────────

    /**
     * Set credit user ke nilai tertentu (override, bukan increment).
     * Berguna untuk koreksi credit yang terlanjur salah.
     * Hanya bisa dipanggil jika role = "admin".
     * @param {string} targetUid
     * @param {number} amount - nilai kredit baru (harus >= 0)
     */
    async function adminSetCredit(targetUid, amount) {
        if (window.AUTH?.user?.role !== 'admin') {
            return { success: false, error: 'Hanya admin yang bisa melakukan ini.' };
        }
        if (!targetUid || typeof amount !== 'number' || amount < 0) {
            return { success: false, error: 'UID dan jumlah credit tidak valid (harus >= 0).' };
        }
        if (typeof _fbDb === 'undefined') {
            return { success: false, error: 'Firestore tidak tersedia.' };
        }
        try {
            const targetRef = _fbDb.collection('users').doc(targetUid);
            const snap = await targetRef.get();
            if (!snap.exists) return { success: false, error: 'User tidak ditemukan.' };

            const creditSebelum = snap.data().aiCredits ?? 0;

            await targetRef.set({ aiCredits: amount }, { merge: true });

            console.log('[ADMIN] Credit di-set:', creditSebelum, '->', amount, '| uid:', targetUid);

            try {
                await _fbDb.collection('creditTransactions').add({
                    uid:           targetUid,
                    amount:        amount,
                    amountBefore:  creditSebelum,
                    type:          'admin_set',
                    adminUid:      window.AUTH.user.uid,
                    createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (logErr) {
                console.warn('[ADMIN] Log transaksi gagal (credit tetap di-set):', logErr.message);
            }

            invalidateCache();
            return { success: true, creditSebelum, creditSesudah: amount };
        } catch (e) {
            console.error('[ADMIN] adminSetCredit error:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Set credit user ke nilai tertentu berdasarkan MemberId (MNN-XXXXXX).
     * @param {string} memberId - contoh: "MNN-849622"
     * @param {number} amount - nilai kredit baru (harus >= 0)
     */
    async function adminSetCreditByMemberId(memberId, amount) {
        if (window.AUTH?.user?.role !== 'admin') {
            return { success: false, error: 'Hanya admin yang bisa melakukan ini.' };
        }
        if (!memberId || typeof amount !== 'number' || amount < 0) {
            return { success: false, error: 'MNN-ID dan jumlah tidak valid (harus >= 0).' };
        }
        if (typeof _fbDb === 'undefined') {
            return { success: false, error: 'Firestore tidak tersedia.' };
        }
        try {
            const snap = await _fbDb.collection('users')
                .where('memberId', '==', memberId.trim().toUpperCase())
                .limit(1)
                .get();

            if (snap.empty) {
                return { success: false, error: 'MNN-ID tidak ditemukan: ' + memberId };
            }

            const userDoc      = snap.docs[0];
            const targetUid    = userDoc.id;
            const email        = userDoc.data().email || '-';
            const creditSebelum = userDoc.data().aiCredits ?? 0;

            await userDoc.ref.set({ aiCredits: amount }, { merge: true });

            console.log('[ADMIN] Credit di-set:', creditSebelum, '->', amount,
                        '| memberId:', memberId, '| uid:', targetUid);

            try {
                await _fbDb.collection('creditTransactions').add({
                    uid:           targetUid,
                    memberId:      memberId.trim().toUpperCase(),
                    amount:        amount,
                    amountBefore:  creditSebelum,
                    type:          'admin_set',
                    adminUid:      window.AUTH.user.uid,
                    createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (logErr) {
                console.warn('[ADMIN] Log transaksi gagal (credit tetap di-set):', logErr.message);
            }

            invalidateCache();
            // Analytics: catat perubahan credit oleh admin
            if (window.AI_ANALYTICS?.trackTopUp) AI_ANALYTICS.trackTopUp(targetUid, amount, 'admin_set');
            return { success: true, targetUid, email, creditSebelum, creditSesudah: amount };
        } catch (e) {
            console.error('[ADMIN] adminSetCreditByMemberId error:', e.message);
            return { success: false, error: e.message };
        }
    }

    /** Reset chat history (tombol "Chat Baru") */
    function resetChat() {
        _chatHistory = [];
    }

    /** Invalidate cache kredit (dipanggil setelah navigasi masuk ke halaman) */
    function invalidateCache() {
        _creditsCache = null;
    }

    // ─────────────────────────────────────────────────────
    // UI HELPERS — Render ke DOM
    // ─────────────────────────────────────────────────────

    /** Refresh tampilan sisa kredit di header halaman AI Sensei */
    async function refreshCreditDisplay() {
        const el = document.getElementById('ais-credit-remaining');
        const bar = document.getElementById('ais-credit-bar');
        if (!el) return;

        el.textContent = '...';
        const c = await getCredits();

        if (c.isGuest) {
            el.textContent = 'Login untuk akses';
            console.log('[AI_CREDIT] Display: user belum login');
            return;
        }
        if (c.error) {
            console.error('[AI_CREDIT] Display error — tidak bisa muat kredit:', c.errMsg);
            el.textContent = 'Gagal muat kredit';
            return;
        }

        el.textContent = `${c.remaining} kredit tersisa`;
        console.log('[AI_CREDIT] Display OK —', c.remaining, '/', c.total, '| plan:', c.plan);

        if (bar) {
            const pct = c.total > 0 ? Math.round((c.remaining / c.total) * 100) : 0;
            bar.style.width = pct + '%';
            bar.className = 'ais-credit-bar-fill' +
                (pct <= 20 ? ' ais-credit-low' : pct <= 50 ? ' ais-credit-mid' : '');
        }
    }

    /**
     * Tambah bubble chat ke DOM.
     * @param {'user'|'ai'|'error'} role
     * @param {string} content
     */
    function appendMessage(role, content) {
        const container = document.getElementById('ais-messages');
        if (!container) return;

        const bubble = document.createElement('div');
        bubble.className = `ais-bubble ais-bubble-${role}`;

        if (role === 'ai') {
            // Format teks AI: baris baru → <br>, baris dimulai - → list item
            const formatted = _formatAiText(content);
            bubble.innerHTML = formatted;
        } else if (role === 'error') {
            bubble.innerHTML = `<span class="ais-error-icon">⚠️</span> ${_escHTML(content)}`;
        } else {
            bubble.textContent = content;
        }

        container.appendChild(bubble);
        // Scroll ke bawah — gunakan container.scrollTop untuk performa lebih baik
        const _msgCont = document.getElementById('ais-messages');
        if (_msgCont) {
            requestAnimationFrame(() => {
                _msgCont.scrollTop = _msgCont.scrollHeight;
            });
        }
        return bubble;
    }

    /** Format teks AI menjadi HTML yang lebih rapi */
    function _formatAiText(text) {
        if (!text) return '';
        // Escape dulu
        let t = _escHTML(text);
        // Bold (**text**)
        t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic (*text*)
        t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Baris dimulai "- " → list item
        t = t.replace(/^- (.+)$/gm, '<li>$1</li>');
        t = t.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
        // Double newline → paragraph break
        t = t.replace(/\n\n/g, '</p><p>');
        // Single newline → <br>
        t = t.replace(/\n/g, '<br>');
        return `<p>${t}</p>`;
    }

    function _escHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Tampilkan loading indicator */
    function showLoading() {
        const container = document.getElementById('ais-messages');
        if (!container) return null;
        const el = document.createElement('div');
        el.className = 'ais-bubble ais-bubble-ai ais-loading';
        el.id = 'ais-typing';
        el.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'end' });
        return el;
    }

    /** Hapus loading indicator */
    function hideLoading() {
        document.getElementById('ais-typing')?.remove();
    }

    // ─────────────────────────────────────────────────────
    // CONTROLLER — Handle kirim pesan dari UI
    // ─────────────────────────────────────────────────────

    async function handleSend() {
        const inp = document.getElementById('ais-input');
        if (!inp) return;
        const msg = inp.value.trim();
        if (!msg || _isLoading || _sendLock) return;

        // ── KUNCI ANTI-DUPLIKAT ──
        // _sendLock mencegah double-call selama await getCredits() ~300ms.
        // JANGAN set _isLoading di sini — ask() mengeceknya di awal
        // dan akan langsung return error jika sudah true!
        _sendLock = true;
        inp.value = '';
        inp.style.height = 'auto';
        _setInputDisabled(true);

        // Deteksi fitur & biaya
        const { feature, cost } = _detectFeature(msg);

        // Cek credit — sekarang aman karena _isLoading sudah true
        const credits = await getCredits();
        if (!credits.isGuest && !credits.error && credits.remaining < cost) {
            // Credit tidak cukup — reset state dan tampilkan popup
            _sendLock = false;
            _setInputDisabled(false);
            inp.value = msg; // kembalikan pesan ke input
            _showCreditPopup(cost, credits.remaining);
            return;
        }

        // Tampilkan badge biaya + bubble user
        _showCostBadge(feature, cost);
        appendMessage('user', msg);

        // Loading dots
        showLoading();

        // Kirim ke AI
        const result = await ask(msg, cost);

        _sendLock = false;
        hideLoading();
        _setInputDisabled(false);
        inp.focus();

        if (result.success) {
            appendMessage('ai', result.answer);
            // Simpan ke chat history Firestore
            if (window.AI_HISTORY) {
                await AI_HISTORY.saveMessage('user', msg);
                await AI_HISTORY.saveMessage('assistant', result.answer);
            }
            // Log usage + analytics (feature, credits, msgLen, answerLen, success, balance)
            _logUsage(feature, cost, msg.length, result.answer.length, true, result.remaining ?? 0);
            // Refresh kredit display
            refreshCreditDisplay();
        } else {
            // Log kegagalan juga — analytics tetap dicatat, creditsUsed = 0 (tidak dipotong)
            _logUsage(feature, 0, msg.length, 0, false, null);
            appendMessage('error', result.error);
        }
    }

    /** Tampilkan badge kecil "X credit — NamaFitur" di messages */
    function _showCostBadge(feature, cost) {
        const container = document.getElementById('ais-messages');
        if (!container) return;
        const badge = document.createElement('div');
        badge.className = 'ais-cost-badge';
        badge.textContent = cost + ' credit - ' + feature;
        container.appendChild(badge);
    }

    function _setInputDisabled(disabled) {
        const inp = document.getElementById('ais-input');
        const btn = document.getElementById('ais-send-btn');
        if (inp) inp.disabled = disabled;
        if (btn) btn.disabled = disabled;
        if (btn) btn.classList.toggle('ais-btn-loading', disabled);
    }

    // ─────────────────────────────────────────────────────
    // INIT — dipanggil saat halaman AI Sensei dibuka
    // ─────────────────────────────────────────────────────

    /** Toast selamat untuk welcome bonus */
    function _showBonusToast(amount) {
        const toast = document.createElement('div');
        toast.className = 'ais-bonus-toast';
        toast.innerHTML =
            '<span class="ais-bonus-icon">🎁</span>' +
            '<span>Selamat! Kamu dapat bonus <strong>' + amount + ' credit</strong> dari AI Sensei Launch!</span>';
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    function init() {
        invalidateCache();

        // ── GUEST WALL — blokir akses sebelum apapun ──────────────────────
        const isGuest = !window.AUTH?.user || window.AUTH?.user?.isGuest;
        if (isGuest) {
            // Nonaktifkan input & tombol kirim
            const inp    = document.getElementById('ais-input');
            const btn    = document.getElementById('ais-send-btn');
            if (inp) {
                inp.disabled    = true;
                inp.placeholder = 'Login untuk menggunakan AI Sensei';
            }
            if (btn) btn.disabled = true;

            // Tampilkan pesan login di area chat
            const container = document.getElementById('ais-messages');
            if (container) {
                container.innerHTML = '';
                const wall = document.createElement('div');
                wall.className = 'ais-guest-wall';
                wall.innerHTML =
                    '<div class="ais-guest-wall-icon">🔒</div>' +
                    '<p class="ais-guest-wall-title">Login Diperlukan</p>' +
                    '<p class="ais-guest-wall-desc">Kamu perlu login untuk menggunakan AI Sensei.<br>Daftar gratis dan dapatkan 5 credit!</p>' +
                    '<button class="ais-guest-wall-btn" onclick="window.AUTH?.openLogin?.()">Masuk / Daftar</button>';
                container.appendChild(wall);
            }

            // Update credit display
            const el = document.getElementById('ais-credit-display');
            if (el) el.textContent = 'Login untuk akses';

            console.log('[AI_CREDIT] Guest wall aktif — UI dinonaktifkan.');
            return; // ← stop init, tidak pasang event listener apapun
        }
        // ──────────────────────────────────────────────────────────────────

        // Update retention flags (fire-and-forget)
        if (window.AI_ANALYTICS?.updateRetention) {
            window.AI_ANALYTICS.updateRetention();
        }

        // Cek & klaim welcome bonus (user baru) ATAU premium upgrade bonus (user lama yang upgrade)
        claimWelcomeBonus().then(result => {
            if (result.claimed) {
                _showBonusToast(result.amount);
                refreshCreditDisplay();
            } else {
                // Welcome bonus sudah diklaim → cek apakah ada premium upgrade bonus
                claimPremiumUpgradeBonus().then(upgradeResult => {
                    if (upgradeResult.claimed) {
                        _showBonusToast(upgradeResult.amount);
                    }
                    refreshCreditDisplay();
                });
            }
        });

        // Abort listener lama sebelum attach yang baru — cegah duplikat
        if (_evAbort) _evAbort.abort();
        _evAbort = new AbortController();
        const _sig = { signal: _evAbort.signal };

        // Input: auto-resize + Enter to send
        const inp = document.getElementById('ais-input');
        if (inp) {
            inp.addEventListener('input', () => {
                inp.style.height = 'auto';
                inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
            }, _sig);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                }
            }, _sig);
        }

        // Tombol kirim
        const sendBtn = document.getElementById('ais-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', handleSend, _sig);

        // Tombol chat baru
        const newBtn = document.getElementById('ais-new-chat-btn');
        if (newBtn) {
            newBtn.addEventListener('click', async () => {
                resetChat();
                if (window.AI_HISTORY) await AI_HISTORY.newChat();
                const container = document.getElementById('ais-messages');
                if (container) container.innerHTML = '';
                _appendWelcomeMessage();
                inp?.focus();
            }, _sig);
        }

        // Tombol quick action
        document.querySelectorAll('.ais-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.dataset.q;
                if (!q) return;
                const inp2 = document.getElementById('ais-input');
                if (inp2) inp2.value = q;
                handleSend();
            }, _sig);
        });

        // Tampilkan pesan selamat datang jika container kosong
        const container = document.getElementById('ais-messages');
        if (container && container.children.length === 0) {
            _appendWelcomeMessage();
        }

        // ── Scroll buttons: top & bottom ──
        const scrollTopBtn  = document.getElementById('ais-scroll-top');
        const scrollBotBtn  = document.getElementById('ais-scroll-bottom');

        // Posisikan tombol scroll secara dinamis berdasarkan layout nyata
        const _positionScrollBtns = () => {
            const inputWrap = document.querySelector('.ais-input-wrap');
            const page      = document.getElementById('page-ai-sensei');
            if (!page || !inputWrap) return;
            const pageH     = page.getBoundingClientRect().height;
            const inputH    = inputWrap.getBoundingClientRect().height;
            const inputTop  = page.getBoundingClientRect().bottom - inputWrap.getBoundingClientRect().bottom;
            // scroll-down: di atas input wrap dengan margin cukup
            const botOffset = inputH + inputTop + 24;
            // scroll-up: 52px di atas scroll-down button (36px tinggi + 16px gap)
            const topOffset = botOffset + 52; // 44 = button height + gap
            if (scrollBotBtn) scrollBotBtn.style.bottom = botOffset + 'px';
            if (scrollTopBtn) scrollTopBtn.style.bottom = topOffset + 'px';
        };

        if (container) {
            const _updateScrollBtns = () => {
                const fromTop    = container.scrollTop;
                const fromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', fromTop > 100);
                if (scrollBotBtn) scrollBotBtn.classList.toggle('visible', fromBottom > 60);
            };
            container.addEventListener('scroll', _updateScrollBtns, _sig);
            if (scrollTopBtn) {
                scrollTopBtn.addEventListener('click', () => {
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                }, _sig);
            }
            if (scrollBotBtn) {
                scrollBotBtn.addEventListener('click', () => {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }, _sig);
            }
            // Posisikan tombol dan update state awal
            requestAnimationFrame(() => {
                _positionScrollBtns();
                _updateScrollBtns();
            });
        }

        // ── Tombol riwayat chat ──
        const histBtn = document.getElementById('ais-history-btn');
        if (histBtn) histBtn.addEventListener('click', () => {
            if (window.AI_HISTORY) AI_HISTORY.toggleDrawer();
        }, _sig);
        const histOverlay = document.getElementById('ais-history-overlay');
        if (histOverlay) histOverlay.addEventListener('click', () => {
            if (window.AI_HISTORY) AI_HISTORY.closeDrawer();
        }, _sig);
    }

    function _appendWelcomeMessage() {
        const container = document.getElementById('ais-messages');
        if (!container) return;
        const welcome = document.createElement('div');
        welcome.className = 'ais-welcome';
        welcome.innerHTML = `
            <div class="ais-welcome-icon">🤖</div>
            <div class="ais-welcome-title">Halo! Aku AI Sensei Beta ✨</div>
            <div class="ais-welcome-sub">Tanyakan apa saja tentang bahasa Jepang —
                kosakata, tata bahasa, pola kalimat, atau cara penggunaan.</div>
        `;
        container.appendChild(welcome);
    }

    // ─────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────
    return {
        init,
        ask,
        getCredits,
        deductCredit,
        resetChat,
        invalidateCache,
        refreshCreditDisplay,
        appendMessage,
        handleSend,
        claimWelcomeBonus,
        claimPremiumUpgradeBonus,
        adminAddCredit,
        adminAddCreditByMemberId,
        adminSetCredit,
        adminSetCreditByMemberId,
        detectFeature: _detectFeature,
        // Untuk AI_HISTORY
        pushHistory: (msg) => { _chatHistory.push(msg); },
    };

})();

// Expose ke window
window.AI_SENSEI = AI_SENSEI;
