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
    const MODEL = 'google/gemini-flash-1.5';
    const MAX_HISTORY_TURNS = 6; // simpan 6 pasang user+assistant

    // ── State chat ──
    let _chatHistory  = [];   // [{role, content}, ...]
    let _isLoading    = false;
    let _creditsCache = null; // cache supaya tidak spam Firestore

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
        const defaultCredits = isPrem ? 50 : 5;
        const defaultPlan    = isPrem ? 'premium-bonus' : 'free';

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

            // Reset bulanan jika bulan berubah
            if (aiCreditReset !== now) {
                const resetCredits = isPrem ? PREMIUM_CREDITS_MONTHLY : FREE_CREDITS_MONTHLY;
                const resetPlan    = isPrem ? 'premium' : 'free';
                console.log('[AI_CREDIT] 🔄 Reset bulanan — bulan lama:', aiCreditReset,
                            '→ bulan baru:', now, '| kredit baru:', resetCredits);
                await ref.set({
                    aiCredits:    resetCredits,
                    aiUsage:      0,
                    aiPlan:       resetPlan,
                    aiCreditReset: now,
                }, { merge: true });
                aiCredits    = resetCredits;
                aiUsage      = 0;
                aiPlan       = resetPlan;
                aiCreditReset = now;
            }

            // Sinkronisasi plan jika premium status berubah
            // (misal: user baru upgrade premium)
            const expectedPlan = isPrem ? 'premium' : 'free';
            if (aiPlan === 'free' && isPrem) {
                console.log('[AI_CREDIT] ⬆️ User upgrade ke premium — update plan & kredit');
                await ref.set({
                    aiCredits: PREMIUM_CREDITS_MONTHLY,
                    aiPlan: 'premium',
                }, { merge: true });
                aiCredits = PREMIUM_CREDITS_MONTHLY;
                aiPlan    = 'premium';
            }

            const remaining = Math.max(0, aiCredits - (aiUsage || 0));
            _creditsCache = {
                total:     aiCredits,
                used:      aiUsage || 0,
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
     * Kurangi 1 kredit setelah AI menjawab.
     * Menggunakan FieldValue.increment(-1) agar atomic.
     * Return: sisa kredit baru
     */
    async function deductCredit() {
        const ref = _userRef();
        if (!ref) return 0;
        try {
            // atomic decrement — tidak akan negatif karena sudah dicek sebelumnya
            await ref.set({
                aiCredits: _increment(-1),
                aiUsage:   _increment(1),
            }, { merge: true });

            if (_creditsCache) {
                _creditsCache.used      = (_creditsCache.used || 0) + 1;
                _creditsCache.remaining = Math.max(0, _creditsCache.remaining - 1);
                _creditsCache.total     = Math.max(0, (_creditsCache.total || 1) - 1);
            }

            console.log('[AI_CREDIT] 💳 Kredit dikurangi 1. Sisa cache:', _creditsCache?.remaining);
            return _creditsCache?.remaining ?? 0;
        } catch (e) {
            console.error('[AI_CREDIT] ❌ deductCredit ERROR:', e.message);
            return _creditsCache?.remaining ?? 0; // jangan block user jika gagal
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
                    const bunpouList = (lesson.bunpou || []).map(b => b.title).join('、');
                    lessonCtx = `\nPelajar sedang belajar: ${lesson.title} (${lesson.topic || ''}).\nPola tata bahasa: ${bunpouList || 'belum dipilih'}.`;
                }
            }
        } catch (_) {}

        return `Kamu adalah AI Sensei - asisten pembelajaran bahasa Jepang untuk aplikasi MNN Learning (Minna no Nihongo).

PERAN:
- Bantu pelajar Indonesia memahami bahasa Jepang dengan cara yang ramah dan sabar.
- Fokus pada: kosakata, tata bahasa (bunpou), pola kalimat, penggunaan partikel, dan contoh percakapan.
- Gunakan metode Minna no Nihongo sebagai referensi utama.
${lessonCtx}

ATURAN JAWABAN:
1. Jawab dalam BAHASA INDONESIA yang jelas dan mudah dipahami.
2. Sertakan contoh kalimat Jepang (dengan furigana/romaji jika perlu) dan terjemahannya.
3. Jelaskan MENGAPA suatu aturan berlaku, bukan hanya "bagaimana"-nya.
4. Gunakan format yang rapi: pisahkan penjelasan, contoh, dan catatan penting.
5. Jika ada beberapa cara penggunaan, jelaskan perbedaannya.
6. Maksimal 400 kata per jawaban - padat, jelas, tidak bertele-tele.

TOPIK YANG BISA DITANYAKAN:
- Arti dan penggunaan kosakata Jepang
- Pola tata bahasa (misalnya: て-form, に vs で, は vs が)
- Cara membaca/menulis Hiragana/Katakana/Kanji
- Contoh kalimat dan percakapan sehari-hari
- Perbedaan ungkapan formal vs informal
- Budaya Jepang yang berkaitan dengan bahasa

BATASAN:
- Jangan menjawab topik di luar pembelajaran bahasa Jepang.
- Jika pertanyaan tidak jelas, minta klarifikasi dengan sopan.`;
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
    async function ask(userMessage) {
        if (_isLoading) return { success: false, error: 'Sedang memproses, harap tunggu...' };
        if (!userMessage?.trim()) return { success: false, error: 'Pesan tidak boleh kosong.' };

        // Cek login
        if (!window.AUTH?.user || window.AUTH?.user?.isGuest) {
            return { success: false, error: 'Silakan login terlebih dahulu untuk menggunakan AI Sensei.' };
        }

        // Cek kredit
        const credits = await getCredits();

        if (credits.isGuest) {
            return { success: false, error: 'Silakan login untuk menggunakan AI Sensei.' };
        }
        if (credits.error) {
            // Jangan block — log error tapi tetap izinkan (fail-open untuk UX)
            // Ubah ke fail-closed jika ingin strict: return { success: false, error: '...' }
            console.warn('[AI_CREDIT] getCredits error saat ask(), lanjutkan tanpa cek kredit:', credits.errMsg);
        }
        if (!credits.error && credits.remaining <= 0) {
            const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();
            return {
                success: false,
                error: `Kredit AI Sensei kamu habis bulan ini. Kredit gratis direset setiap bulan.

${
                    !isPrem
                        ? '✨ Upgrade ke Premium untuk mendapat lebih banyak kredit!'
                        : 'Kredit akan direset di awal bulan depan.'
                }`
            };
        }

        _isLoading = true;

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
            const res = await fetch('/api/ai-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

            // Kurangi kredit
            const remaining = await deductCredit();

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
        bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
        if (!msg || _isLoading) return;

        inp.value = '';
        inp.style.height = 'auto';
        _setInputDisabled(true);

        // Bubble user
        appendMessage('user', msg);

        // Loading dots
        showLoading();

        // Kirim ke AI
        const result = await ask(msg);

        hideLoading();
        _setInputDisabled(false);
        inp.focus();

        if (result.success) {
            appendMessage('ai', result.answer);
            // Refresh kredit display
            refreshCreditDisplay();
        } else {
            appendMessage('error', result.error);
        }
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

    function init() {
        invalidateCache();
        refreshCreditDisplay();

        // Setup input event: auto-resize + Enter to send
        const inp = document.getElementById('ais-input');
        if (inp) {
            inp.addEventListener('input', () => {
                inp.style.height = 'auto';
                inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
            });
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                }
            });
        }

        // Tombol kirim
        const sendBtn = document.getElementById('ais-send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', handleSend);
        }

        // Tombol chat baru
        const newBtn = document.getElementById('ais-new-chat-btn');
        if (newBtn) {
            newBtn.addEventListener('click', () => {
                resetChat();
                const container = document.getElementById('ais-messages');
                if (container) container.innerHTML = '';
                _appendWelcomeMessage();
                inp?.focus();
            });
        }

        // Tombol quick question
        document.querySelectorAll('.ais-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.dataset.q;
                if (!q) return;
                const inp2 = document.getElementById('ais-input');
                if (inp2) inp2.value = q;
                handleSend();
            });
        });

        // Tampilkan pesan selamat datang jika container kosong
        const container = document.getElementById('ais-messages');
        if (container && container.children.length === 0) {
            _appendWelcomeMessage();
        }
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
        refreshCreditDisplay,
        appendMessage,
        handleSend,
    };

})();

// Expose ke window
window.AI_SENSEI = AI_SENSEI;
