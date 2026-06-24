/* ═══════════════════════════════════════════════════════════
   MNN Learning — 🤖 AI JFT Simulation
   ai-jft-sim.js — Phase 1

   TUJUAN:
   Simulasi JFT yang soalnya dibuat otomatis oleh AI, SATU KALI
   per sesi (bukan per soal). Setelah soal dibuat, user mengerjakan
   sepenuhnya offline-dari-AI (tidak ada panggilan AI susulan).

   TIDAK MENGUBAH:
   - ai-sensei.js / ai-sensei-flag.js / ai-sensei-credit.js / dst.
     (file ini hanya MEMAKAI fungsi publik AI_SENSEI.getCredits()
      dan AI_SENSEI.deductCredit() — tidak pernah menulis ke
      ai-sensei.js ataupun mengubah logikanya)
   - exam_engine_v9.js / jft_simulation.js (JFT Basic Full Simulation
     yang sudah ada tetap 100% terpisah dan tidak tersentuh)
   - Sistem credit AI Sensei (aiCredits di users/{uid}) — DIPAKAI
     BERSAMA, bukan dibuat ulang. Lihat catatan asumsi di README/chat.

   FIRESTORE SCHEMA (baru):
   users/{uid}/aiJftSessions/{sessionId}
   {
     sessionId, level, mode, createdAt, creditCost,
     score: null|number, completed: boolean,
     sectionScores: { kanji_kotoba:{correct,total}, expression:{...}, dokkai:{...} },
     questions: { kanji_kotoba:[...], expression:[...], dokkai:[...] }
   }

   FEATURE FLAG:
   Dikontrol oleh AI_JFT_FLAG (ai-jft-sim-flag.js) — field
   config/appSettings.aiJftSimulationEnabled. Akses halaman setup
   sudah dicek oleh navigateTo() di app.js SEBELUM modul ini dipanggil;
   modul ini sendiri tidak mengulang pengecekan flag (hanya AI_FLAG-style
   admin test mode yang relevan ada di AI_JFT_FLAG).

   PHASE 1 — HANYA:
   1. Kanji & Kotoba   2. Expression   3. Dokkai
   (Choukai & AI Analysis SENGAJA belum diimplementasikan)
   ═══════════════════════════════════════════════════════════ */

'use strict';

const AI_JFT_SIM = (() => {

    // ─────────────────────────────────────────────────────
    // KONSTANTA
    // ─────────────────────────────────────────────────────

    // Model khusus untuk generate soal terstruktur — cepat & murah,
    // SENGAJA dipisah dari model AI Sensei (openai/gpt-4o-mini).
    // Ini adalah model default yang sudah ada di api/ai-proxy.js
    // & netlify/functions/ai-proxy.js saat field "model" tidak dikirim,
    // di sini dikirim eksplisit agar jelas di kode.
    const MODEL = 'google/gemini-2.0-flash-001';

    const LEVELS = {
        n5:        'N5',
        n4:        'N4',
        jft_basic: 'JFT Basic',
        ssw:       'SSW',
    };

    // Pembagian soal per section (kanji_kotoba/expression/dokkai) adalah
    // DEFAULT yang bisa disesuaikan kapan saja — total soal & credit cost
    // mengikuti spesifikasi persis dari permintaan awal.
    const MODES = {
        easy:   { label: 'Easy',   totalSoal: 10, credit: 5,  maxTokens: 2200, sections: { kanji_kotoba: 4,  expression: 3,  dokkai: 3  } },
        normal: { label: 'Normal', totalSoal: 20, credit: 10, maxTokens: 4200, sections: { kanji_kotoba: 8,  expression: 6,  dokkai: 6  } },
        full:   { label: 'Full',   totalSoal: 40, credit: 20, maxTokens: 8200, sections: { kanji_kotoba: 16, expression: 12, dokkai: 12 } },
    };

    // Urutan tampil tetap — Phase 1 belum ada choukai.
    const SECTION_ORDER  = ['kanji_kotoba', 'expression', 'dokkai'];
    const SECTION_LABELS = {
        kanji_kotoba: '📚 Kanji & Kotoba',
        expression:   '💬 Expression',
        dokkai:       '📖 Dokkai',
    };

    // ─────────────────────────────────────────────────────
    // STATE (in-memory, hilang saat reload — lihat catatan di chat)
    // ─────────────────────────────────────────────────────
    let _selectedLevel   = null;
    let _selectedMode    = null;
    let _generating       = false;
    let _sessionLoading   = false; // true saat retrySession() sedang fetch dari Firestore
    let _activeSession   = null;  // lihat _buildActiveSession()
    let _creditsSnapshot = null;  // snapshot tampilan saldo di halaman setup (bukan untuk validasi)

    let _setupBound          = false;
    let _sessionTopbarBound  = false;

    // ─────────────────────────────────────────────────────
    // HELPERS — Firestore
    // ─────────────────────────────────────────────────────
    function _sessionsRef() {
        const uid = window.AUTH?.user?.uid;
        if (!uid || window.AUTH?.user?.isGuest || typeof _fbDb === 'undefined') return null;
        return _fbDb.collection('users').doc(uid).collection('aiJftSessions');
    }

    function _flattenSections(sections) {
        const flat = [];
        SECTION_ORDER.forEach(sec => {
            (sections[sec] || []).forEach(q => flat.push({ section: sec, q }));
        });
        return flat;
    }

    function _buildActiveSession(sessionId, level, mode, creditCost, sections, existingAnswers) {
        return {
            sessionId, level, mode, creditCost,
            sections,                          // { kanji_kotoba:[...], expression:[...], dokkai:[...] }
            flat: _flattenSections(sections),  // urutan tampil flat
            currentIndex: 0,
            answers: existingAnswers || [],    // [{section, selectedIndex, correct}]
            answered: false,
        };
    }

    // ─────────────────────────────────────────────────────
    // SETUP PAGE
    // ─────────────────────────────────────────────────────

    /**
     * Render halaman setup (pilih level/mode + riwayat).
     * Akses (feature flag) sudah dicek oleh navigateTo() di app.js
     * sebelum fungsi ini dipanggil.
     */
    function renderSetupPage() {
        _selectedLevel    = null;
        _selectedMode     = null;
        _creditsSnapshot  = null;

        document.querySelectorAll('.aijs-level-btn').forEach(b => b.classList.remove('aijs-selected'));
        document.querySelectorAll('.aijs-mode-btn').forEach(b => b.classList.remove('aijs-selected'));

        _bindSetupEvents();
        _updateStartButton();
        loadHistory();

        // Ambil snapshot saldo SEKALI per kunjungan halaman (bukan tiap tap tombol)
        if (window.AI_SENSEI?.getCredits) {
            AI_SENSEI.getCredits().then(c => {
                _creditsSnapshot = c;
                _updateStartButton();
            }).catch(() => {});
        }
    }

    function _bindSetupEvents() {
        // Tombol level/mode bersifat statis di index.html (tidak di-render ulang),
        // jadi listener cukup dipasang sekali agar tidak dobel saat halaman dibuka berkali-kali.
        if (_setupBound) return;
        _setupBound = true;

        document.querySelectorAll('.aijs-level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.aijs-level-btn').forEach(b => b.classList.remove('aijs-selected'));
                btn.classList.add('aijs-selected');
                _selectedLevel = btn.dataset.level;
                _updateStartButton();
            });
        });

        document.querySelectorAll('.aijs-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.aijs-mode-btn').forEach(b => b.classList.remove('aijs-selected'));
                btn.classList.add('aijs-selected');
                _selectedMode = btn.dataset.mode;
                _updateStartButton();
            });
        });

        const startBtn = document.getElementById('aijs-start-btn');
        if (startBtn) startBtn.addEventListener('click', startGeneration);
    }

    function _updateStartButton() {
        const startBtn = document.getElementById('aijs-start-btn');
        const info     = document.getElementById('aijs-start-credit-info');
        if (!startBtn) return;

        if (!_selectedLevel || !_selectedMode) {
            startBtn.disabled = true;
            if (info) info.textContent = 'Pilih level dan mode untuk memulai.';
            return;
        }

        const cfg = MODES[_selectedMode];
        startBtn.disabled = false;

        if (info) {
            const remaining = _creditsSnapshot ? (_creditsSnapshot.remaining ?? 0) : null;
            info.innerHTML = remaining === null
                ? 'Sesi ini membutuhkan <strong>' + cfg.credit + ' credit</strong>.'
                : 'Sesi ini membutuhkan <strong>' + cfg.credit + ' credit</strong> · Sisa credit kamu: <strong>' + remaining + '</strong>';
        }
    }

    // ─────────────────────────────────────────────────────
    // GENERATE SESSION — AI dipanggil SATU KALI di sini
    // ─────────────────────────────────────────────────────

    async function startGeneration() {
        if (_generating) return;
        if (!_selectedLevel || !_selectedMode) return;

        if (!window.AUTH?.user || window.AUTH?.user?.isGuest) {
            if (typeof showLoginModal === 'function') showLoginModal();
            return;
        }
        if (!window.AI_SENSEI?.getCredits || !window.AI_SENSEI?.deductCredit) {
            _showGenerateErrorDialog('Sistem credit AI belum siap. Muat ulang aplikasi lalu coba lagi.');
            return;
        }

        const cfg = MODES[_selectedMode];

        // ── VALIDASI CREDIT (pengecekan otoritatif, terlepas dari snapshot tampilan) ──
        let credits;
        try {
            credits = await AI_SENSEI.getCredits();
        } catch (e) {
            credits = { remaining: 0, error: true };
        }

        if (!credits || (credits.remaining ?? 0) < cfg.credit) {
            _showInsufficientCreditDialog(cfg.credit, credits?.remaining ?? 0);
            return;
        }

        await _generateSession(_selectedLevel, _selectedMode, cfg);
    }

    function _levelGuide(levelId) {
        const guides = {
            n5:        'Level N5 (dasar): kosakata & tata bahasa paling dasar, kalimat pendek & sederhana, dominan hiragana/katakana, kanji dasar saja.',
            n4:        'Level N4: kosakata & tata bahasa menengah-dasar, kalimat sedikit lebih kompleks dari N5.',
            jft_basic: 'Level JFT-Basic (setara CEFR A2): fokus situasi kehidupan sehari-hari & kerja sederhana, gaya soal mengikuti format resmi ujian JFT-Basic.',
            ssw:       'Level SSW (Specified Skilled Worker): fokus kosakata & ekspresi dunia kerja di Jepang — instruksi atasan, keselamatan kerja, komunikasi dengan rekan kerja.',
        };
        return guides[levelId] || guides.jft_basic;
    }

    function _buildPrompt(levelId, cfg) {
        const levelLabel = LEVELS[levelId] || levelId;
        const levelGuide = _levelGuide(levelId);
        const s = cfg.sections;

        const system =
            'Kamu adalah AI pembuat soal latihan ujian JFT-Basic/JLPT untuk aplikasi belajar bahasa Jepang ' +
            '"MNN Learning" (Rawliet.ID). Tugasmu HANYA membuat soal pilihan ganda dan membalas dalam format JSON murni.\n\n' +
            'ATURAN MUTLAK:\n' +
            '1. Balas HANYA dengan satu objek JSON. JANGAN tambahkan teks, komentar, atau markdown code fence apa pun di luar JSON.\n' +
            '2. Setiap soal WAJIB memiliki tepat 4 pilihan jawaban berbeda (array "options" panjang 4).\n' +
            '3. Field "answer" harus berupa string yang SAMA PERSIS (karakter demi karakter) dengan salah satu isi "options".\n' +
            '4. Field "explanation" wajib Bahasa Indonesia, singkat (1-2 kalimat), menjelaskan kenapa jawaban itu benar.\n' +
            '5. Untuk soal section "dokkai", gabungkan teks bacaan singkat (3-6 kalimat bahasa Jepang) ke dalam field "question" ' +
            'SEBELUM kalimat pertanyaan, dipisah dua baris baru (\\n\\n), lalu diikuti pertanyaan pemahamannya.\n' +
            '6. Variasikan topik antar soal — jangan mengulang pola/topik/jawaban yang sama berturut-turut.\n' +
            '7. Tulis kalimat Jepang biasa (campuran kanji+kana sesuai level), TANPA furigana/ruby/HTML.\n\n' +
            'KONTEKS LEVEL: ' + levelGuide;

        const user =
            'Buatkan SATU paket soal latihan "AI JFT Simulation" level "' + levelLabel + '" dengan struktur JSON berikut ' +
            '(jumlah soal per section harus TEPAT sesuai angka yang diminta):\n\n' +
            '{\n' +
            '  "sections": {\n' +
            '    "kanji_kotoba": [ /* ' + s.kanji_kotoba + ' soal */ ],\n' +
            '    "expression":   [ /* ' + s.expression   + ' soal */ ],\n' +
            '    "dokkai":       [ /* ' + s.dokkai       + ' soal */ ]\n' +
            '  }\n' +
            '}\n\n' +
            'Setiap elemen soal di tiap array HARUS persis berbentuk:\n' +
            '{ "question": "...", "options": ["...","...","...","..."], "answer": "...", "explanation": "..." }\n\n' +
            'Section "kanji_kotoba": arti/cara baca kanji atau kosakata yang tepat untuk suatu konteks kalimat.\n' +
            'Section "expression": melengkapi kalimat / pola tata bahasa (gaya soal isian seperti pada ujian JFT asli).\n' +
            'Section "dokkai": pemahaman membaca dengan teks bacaan singkat (lihat aturan #5 di atas).\n\n' +
            'Balas LANGSUNG dengan objek JSON-nya saja, tanpa penjelasan apa pun di luar JSON.';

        return { system, user };
    }

    function _extractJSON(text) {
        let t = String(text || '').trim();
        t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const start = t.indexOf('{');
        const end   = t.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) return null;
        try {
            return JSON.parse(t.slice(start, end + 1));
        } catch (e) {
            return null;
        }
    }

    function _isValidQuestion(q) {
        return !!q && typeof q.question === 'string' && q.question.trim().length > 0 &&
            Array.isArray(q.options) && q.options.length === 4 &&
            q.options.every(o => typeof o === 'string' && o.trim().length > 0) &&
            typeof q.answer === 'string' && q.options.includes(q.answer) &&
            typeof q.explanation === 'string';
    }

    /**
     * Parse + validasi JSON dari AI. Toleran terhadap jumlah soal yang
     * sedikit berbeda dari permintaan (mis. AI mengembalikan 15 dari 16
     * yang diminta) — soal yang valid tetap dipakai. Section yang
     * akhirnya kosong sama sekali dianggap GAGAL.
     * @returns {object|null} { kanji_kotoba:[...], expression:[...], dokkai:[...] } atau null jika gagal total
     */
    function _parseAndValidate(raw) {
        const parsed = _extractJSON(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        const src = (parsed.sections && typeof parsed.sections === 'object') ? parsed.sections : parsed;
        const out = {};
        for (const sec of SECTION_ORDER) {
            const arr   = Array.isArray(src[sec]) ? src[sec] : [];
            const valid = arr.filter(_isValidQuestion);
            if (!valid.length) return null;
            out[sec] = valid;
        }
        return out;
    }

    async function _generateSession(levelId, modeId, cfg) {
        _generating = true;
        _showGeneratingOverlay(cfg);

        try {
            const prompt = _buildPrompt(levelId, cfg);

            let idToken = '';
            try {
                const currentUser = firebase.auth().currentUser;
                if (currentUser) idToken = await currentUser.getIdToken();
            } catch (e) { /* ditangani di bawah */ }

            if (!idToken) throw new Error('Sesi login tidak valid. Silakan login ulang.');

            // Escape non-ASCII ke \uXXXX — sama dengan pola AI Sensei, mencegah
            // ByteString error pada runtime Node.js di api/ai-proxy.
            const _rawPayload = JSON.stringify({
                model: MODEL,
                max_tokens: cfg.maxTokens,
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user',   content: prompt.user },
                ],
            });
            const _safePayload = _rawPayload.replace(
                /[\u0080-\uFFFF]/g,
                ch => '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4)
            );

            const res = await fetch('/api/ai-proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + idToken,
                },
                body: _safePayload,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || ('HTTP ' + res.status));
            }

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const raw = data?.choices?.[0]?.message?.content;
            if (!raw) throw new Error('Respon AI kosong. Coba lagi.');

            const sections = _parseAndValidate(raw);
            if (!sections) throw new Error('Format soal dari AI tidak valid. Coba lagi.');

            // ── Generate berhasil → simpan ke Firestore dulu, BARU potong credit ──
            const ref = _sessionsRef();
            if (!ref) throw new Error('Tidak bisa menyimpan sesi — coba login ulang.');

            const docRef    = ref.doc();
            const sessionId = docRef.id;

            await docRef.set({
                sessionId,
                level:         levelId,
                mode:          modeId,
                createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
                creditCost:    cfg.credit,
                score:         null,
                completed:     false,
                sectionScores: {},
                questions:     sections,
            });

            // ── POTONG CREDIT — hanya sampai titik ini jika semua di atas berhasil ──
            await AI_SENSEI.deductCredit(cfg.credit);

            // Analytics — fire-and-forget, tidak wajib berhasil
            try {
                window.AI_ANALYTICS?.track?.('AI JFT Simulation', cfg.credit, prompt.user.length, raw.length, true);
            } catch (e) {}

            _activeSession = _buildActiveSession(sessionId, levelId, modeId, cfg.credit, sections, []);

            _hideGeneratingOverlay();
            _generating = false;
            navigateTo('ai-jft-session');

        } catch (e) {
            console.error('[AI_JFT_SIM] generate error:', e);
            _hideGeneratingOverlay();
            _generating = false;
            _showGenerateErrorDialog(e.message || 'Gagal membuat soal. Silakan coba lagi.');
        }
    }

    // ─────────────────────────────────────────────────────
    // DIALOG / OVERLAY UI
    // ─────────────────────────────────────────────────────

    function _showGeneratingOverlay(cfg) {
        document.getElementById('aijs-generating-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'aijs-generating-overlay';
        overlay.innerHTML =
            '<div class="aijs-gen-spinner"></div>' +
            '<div class="aijs-gen-text">🤖 AI sedang menyiapkan ' + cfg.totalSoal + ' soal...</div>' +
            '<div class="aijs-gen-sub">Proses ini hanya terjadi sekali di awal sesi. Jangan tutup aplikasi.</div>';
        document.body.appendChild(overlay);
    }
    function _hideGeneratingOverlay() {
        document.getElementById('aijs-generating-overlay')?.remove();
    }

    function _showInsufficientCreditDialog(needed, have) {
        document.getElementById('aijs-dialog-popup')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'aijs-dialog-popup';
        overlay.innerHTML =
            '<div class="ais-popup-box">' +
            '<div class="ais-popup-icon">💳</div>' +
            '<div class="ais-popup-title">Credit Tidak Mencukupi</div>' +
            '<div class="ais-popup-body">Mode ini membutuhkan <strong>' + needed + ' credit</strong>,<br>' +
            'sisa credit kamu <strong>' + have + ' credit</strong>.</div>' +
            '<div class="ais-popup-actions">' +
            '<button class="ais-popup-btn-secondary" id="aijs-dialog-close">Tutup</button>' +
            '<button class="ais-popup-btn-primary" id="aijs-dialog-topup">Top Up Credit</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        document.getElementById('aijs-dialog-close').onclick = () => overlay.remove();
        document.getElementById('aijs-dialog-topup').onclick = () => { overlay.remove(); navigateTo('ai-credit'); };
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    function _showGenerateErrorDialog(message) {
        document.getElementById('aijs-dialog-popup')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'aijs-dialog-popup';
        overlay.innerHTML =
            '<div class="ais-popup-box">' +
            '<div class="ais-popup-icon">⚠️</div>' +
            '<div class="ais-popup-title">Gagal Membuat Soal</div>' +
            '<div class="ais-popup-body">' + escHTML(message) + '</div>' +
            '<div class="ais-popup-sub">Credit kamu TIDAK terpotong. Silakan coba lagi.</div>' +
            '<div class="ais-popup-actions">' +
            '<button class="ais-popup-btn-primary" id="aijs-dialog-ok" style="width:100%">Tutup</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        document.getElementById('aijs-dialog-ok').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    // ─────────────────────────────────────────────────────
    // SESSION PAGE — practice flow (tanpa panggilan AI lagi)
    // ─────────────────────────────────────────────────────

    function renderSessionPage() {
        _bindSessionTopbarOnce();

        if (_sessionLoading) {
            _renderSessionLoadingState();
            return;
        }
        if (!_activeSession) {
            // Tidak ada sesi aktif di memori (reload / navigasi langsung) → kembali ke setup
            navigateTo('ai-jft-setup');
            return;
        }
        _renderCurrentQuestion();
    }

    function _bindSessionTopbarOnce() {
        if (_sessionTopbarBound) return;
        _sessionTopbarBound = true;
        const exitBtn = document.getElementById('aijs-session-exit-btn');
        if (!exitBtn) return;
        exitBtn.addEventListener('click', () => {
            const s = _activeSession;
            const midSession = s && s.currentIndex < s.flat.length;
            if (midSession && !confirm('Keluar dari sesi ini? Progress yang belum selesai tidak akan tersimpan.')) {
                return;
            }
            _activeSession = null;
            navigateTo('ai-jft-setup');
        });
    }

    function _renderSessionLoadingState() {
        const body = document.getElementById('aijs-session-body');
        if (body) {
            body.innerHTML = '<div class="aijs-session-loading"><div class="aijs-gen-spinner"></div>' +
                '<div>Memuat soal tersimpan...</div></div>';
        }
    }

    function _renderCurrentQuestion() {
        const s     = _activeSession;
        const total = s.flat.length;
        const idx   = s.currentIndex;

        if (idx >= total) { _finishSession(); return; }

        const { section, q } = s.flat[idx];

        const secLabelEl = document.getElementById('aijs-session-section-label');
        const counterEl  = document.getElementById('aijs-session-counter');
        const fillEl     = document.getElementById('aijs-session-progress-fill');
        if (secLabelEl) secLabelEl.textContent = SECTION_LABELS[section] || section;
        if (counterEl)  counterEl.textContent  = (idx + 1) + '/' + total;
        if (fillEl)     fillEl.style.width = Math.round((idx / total) * 100) + '%';

        const body = document.getElementById('aijs-session-body');
        if (!body) return;

        const optionsHtml = q.options.map((opt, i) =>
            '<button class="aijs-option-btn" data-idx="' + i + '">' + escHTML(opt) + '</button>'
        ).join('');

        body.innerHTML =
            '<div class="aijs-q-card"><div class="aijs-q-text">' + escHTML(q.question) + '</div></div>' +
            '<div class="aijs-option-list" id="aijs-option-list">' + optionsHtml + '</div>' +
            '<div id="aijs-feedback-slot"></div>';

        document.querySelectorAll('#aijs-option-list .aijs-option-btn').forEach(btn => {
            btn.addEventListener('click', () => _selectOption(parseInt(btn.dataset.idx, 10)));
        });
    }

    function _selectOption(optionIndex) {
        const s = _activeSession;
        if (!s || s.answered) return;

        const { section, q } = s.flat[s.currentIndex];
        const correct = q.options[optionIndex] === q.answer;

        s.answered = true;
        s.answers.push({ section, selectedIndex: optionIndex, correct });

        document.querySelectorAll('#aijs-option-list .aijs-option-btn').forEach((btn, i) => {
            btn.classList.add('aijs-opt-disabled');
            if (q.options[i] === q.answer) btn.classList.add('aijs-opt-correct');
            else if (i === optionIndex) btn.classList.add('aijs-opt-wrong');
        });

        const slot = document.getElementById('aijs-feedback-slot');
        if (slot) {
            const isLast = (s.currentIndex + 1 >= s.flat.length);
            slot.innerHTML =
                '<div class="aijs-feedback-box">' +
                '<div class="aijs-feedback-title ' + (correct ? 'aijs-fb-correct' : 'aijs-fb-wrong') + '">' +
                (correct ? '✅ Benar!' : '❌ Kurang tepat') + '</div>' +
                escHTML(q.explanation) +
                '</div>' +
                '<button class="aijs-btn" id="aijs-next-btn" style="margin-top:14px">' +
                (isLast ? 'Lihat Hasil →' : 'Lanjut →') + '</button>';
            document.getElementById('aijs-next-btn').addEventListener('click', _goToNextQuestion);
        }
    }

    function _goToNextQuestion() {
        const s = _activeSession;
        if (!s) return;
        s.currentIndex += 1;
        s.answered = false;
        _renderCurrentQuestion();
    }

    async function _finishSession() {
        const s = _activeSession;
        if (!s) return;

        const sectionScores = {};
        SECTION_ORDER.forEach(sec => { sectionScores[sec] = { correct: 0, total: 0 }; });
        s.answers.forEach(a => {
            if (!sectionScores[a.section]) sectionScores[a.section] = { correct: 0, total: 0 };
            sectionScores[a.section].total   += 1;
            if (a.correct) sectionScores[a.section].correct += 1;
        });

        const totalCorrect = s.answers.filter(a => a.correct).length;
        const totalSoal    = s.flat.length;
        const overallScore = totalSoal ? Math.round((totalCorrect / totalSoal) * 100) : 0;

        const fillEl = document.getElementById('aijs-session-progress-fill');
        const counterEl = document.getElementById('aijs-session-counter');
        const secLabelEl = document.getElementById('aijs-session-section-label');
        if (fillEl) fillEl.style.width = '100%';
        if (counterEl) counterEl.textContent = totalSoal + '/' + totalSoal;
        if (secLabelEl) secLabelEl.textContent = 'Selesai';

        // Simpan hasil — overwrite score/sectionScores/completed di dokumen sesi yang sama.
        // Berlaku juga untuk sesi hasil 🔄 Ulangi (sengaja menimpa skor lama, lihat catatan di chat).
        try {
            const ref = _sessionsRef();
            if (ref) {
                await ref.doc(s.sessionId).set({ score: overallScore, completed: true, sectionScores }, { merge: true });
            }
        } catch (e) {
            console.warn('[AI_JFT_SIM] Gagal menyimpan hasil sesi (non-fatal):', e.message);
        }

        _renderSummary(overallScore, sectionScores, totalSoal);
    }

    function _renderSummary(overallScore, sectionScores, totalSoal) {
        const body = document.getElementById('aijs-session-body');
        if (!body) return;

        const rowsHtml = SECTION_ORDER.map(sec => {
            const sc = sectionScores[sec] || { correct: 0, total: 0 };
            return '<div class="aijs-summary-row">' +
                '<span class="aijs-summary-row-name">' + SECTION_LABELS[sec] + '</span>' +
                '<span class="aijs-summary-row-score">' + sc.correct + '/' + sc.total + '</span></div>';
        }).join('');

        body.innerHTML =
            '<div class="aijs-summary-wrap">' +
            '<div class="aijs-summary-score">' + overallScore + '%</div>' +
            '<div class="aijs-summary-label">Skor keseluruhan · ' + totalSoal + ' soal</div>' +
            '<div class="aijs-summary-sections">' + rowsHtml + '</div>' +
            '<div class="aijs-summary-actions">' +
            '<button class="aijs-btn" id="aijs-summary-retry-btn">🔄 Ulangi Soal Ini</button>' +
            '<button class="aijs-btn-secondary" id="aijs-summary-back-btn">← Kembali ke Setup</button>' +
            '</div></div>';

        document.getElementById('aijs-summary-retry-btn').addEventListener('click', () => retrySession(_activeSession.sessionId));
        document.getElementById('aijs-summary-back-btn').addEventListener('click', () => {
            _activeSession = null;
            navigateTo('ai-jft-setup');
        });
    }

    // ─────────────────────────────────────────────────────
    // ULANGI — pakai soal tersimpan di Firestore, TANPA panggil AI, TANPA potong credit
    // ─────────────────────────────────────────────────────
    async function retrySession(sessionId) {
        const ref = _sessionsRef();
        if (!ref || !sessionId) return;

        _sessionLoading = true;
        navigateTo('ai-jft-session'); // memicu renderSessionPage() → tampil state loading

        try {
            const snap = await ref.doc(sessionId).get();
            if (!snap.exists) throw new Error('Sesi tidak ditemukan.');
            const data = snap.data();

            _activeSession = _buildActiveSession(sessionId, data.level, data.mode, data.creditCost, data.questions || {}, []);
            _sessionLoading = false;
            _renderCurrentQuestion();
        } catch (e) {
            console.error('[AI_JFT_SIM] retrySession error:', e.message);
            _sessionLoading = false;
            const body = document.getElementById('aijs-session-body');
            if (body) {
                body.innerHTML = '<div class="aijs-session-loading">⚠️ Gagal memuat sesi tersimpan.<br>' +
                    '<button class="aijs-btn-secondary" id="aijs-retry-back-btn" style="margin-top:10px">← Kembali</button></div>';
                document.getElementById('aijs-retry-back-btn')?.addEventListener('click', () => navigateTo('ai-jft-setup'));
            }
        }
    }

    // ─────────────────────────────────────────────────────
    // RIWAYAT SIMULASI AI
    // ─────────────────────────────────────────────────────
    async function loadHistory() {
        const list = document.getElementById('aijs-history-list');
        if (!list) return;
        list.innerHTML = '<div class="aijs-history-empty">Memuat riwayat...</div>';

        const ref = _sessionsRef();
        if (!ref) {
            list.innerHTML = '<div class="aijs-history-empty">Login untuk melihat riwayat.</div>';
            return;
        }

        try {
            let docs;
            try {
                const snap = await ref.orderBy('createdAt', 'desc').limit(15).get();
                docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                // Fallback tanpa orderBy jika composite index belum tersedia
                const snap2 = await ref.limit(15).get();
                docs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            }

            if (!docs.length) {
                list.innerHTML = '<div class="aijs-history-empty">Belum ada riwayat simulasi.</div>';
                return;
            }

            list.innerHTML = docs.map(d => {
                const date = d.createdAt?.toDate
                    ? d.createdAt.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '-';
                const levelLabel = LEVELS[d.level] || d.level || '-';
                const modeLabel  = MODES[d.mode]?.label || d.mode || '-';
                const scoreHtml  = (d.completed && typeof d.score === 'number')
                    ? '<div class="aijs-history-score">' + d.score + '%</div>'
                    : '<div class="aijs-history-score aijs-pending">Belum selesai</div>';

                return '<div class="aijs-history-item">' +
                    '<div class="aijs-history-info">' +
                    '<div class="aijs-history-meta">' + escHTML(levelLabel) + ' · ' + escHTML(modeLabel) + '</div>' +
                    '<div class="aijs-history-date">' + date + '</div></div>' +
                    scoreHtml +
                    '<button class="aijs-history-retry" data-sid="' + d.id + '">🔄 Ulangi</button></div>';
            }).join('');

            list.querySelectorAll('.aijs-history-retry').forEach(btn => {
                btn.addEventListener('click', () => retrySession(btn.dataset.sid));
            });
        } catch (e) {
            console.error('[AI_JFT_SIM] loadHistory error:', e.message);
            list.innerHTML = '<div class="aijs-history-empty">Gagal memuat riwayat.</div>';
        }
    }

    // ─────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────
    return {
        renderSetupPage,
        renderSessionPage,
        startGeneration,
        retrySession,
        loadHistory,
    };

})();

window.AI_JFT_SIM = AI_JFT_SIM;
