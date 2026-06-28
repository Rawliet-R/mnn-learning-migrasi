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
    const MODEL = 'openai/gpt-4o-mini';

    const LEVELS = {
        n5:        'A1 Pemula',
        n4:        'A2 Awal Kerja',
        jft_basic: 'A2+ Siap Kerja',
    };

    // Pembagian soal per section (kanji_kotoba/expression/dokkai) adalah
    // DEFAULT yang bisa disesuaikan kapan saja — total soal & credit cost
    // mengikuti spesifikasi persis dari permintaan awal.
    const MODES = {
        easy:   { label: 'Easy',   totalSoal: 10, credit: 5,  maxTokens: 4500, timerSeconds: 900,  sections: { kanji_kotoba: 3,  expression: 2,  choukai: 2,  dokkai: 3  } },
        normal: { label: 'Normal', totalSoal: 20, credit: 10, maxTokens: 7500, timerSeconds: 1800, sections: { kanji_kotoba: 6,  expression: 5,  choukai: 4,  dokkai: 5  } },
        full:   { label: 'Full',   totalSoal: 40, credit: 20, maxTokens: 13000, timerSeconds: 3600, sections: { kanji_kotoba: 12, expression: 10, choukai: 8,  dokkai: 10 } },
    };

    const SECTION_ORDER  = ['kanji_kotoba', 'expression', 'choukai', 'dokkai'];
    const SECTION_LABELS = {
        kanji_kotoba: '📚 Kanji & Kotoba',
        expression:   '💬 Expression',
        dokkai:       '📖 Dokkai',
        choukai:      '🎧 Choukai',
    };

    // Render text: escape HTML + convert \n literals to <br>
    function _renderText(str) {
        if (!str) return '';
        var e = String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        return e.replace(/\\n/g,'<br>').replace(/\n/g,'<br>');
    }

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

    // ── Phase 2: Timer ──
    let _timerInterval   = null;  // setInterval handle
    let _timerRemaining  = 0;     // detik tersisa
    let _sessionStartTs  = null;  // Date.now() saat sesi mulai (untuk durasi)

    // ─────────────────────────────────────────────────────
    // HELPERS — Firestore
    // ─────────────────────────────────────────────────────
    function _sessionsRef() {
        const uid = window.AUTH?.user?.uid;
        if (!uid || window.AUTH?.user?.isGuest || typeof _fbDb === 'undefined') return null;
        return _fbDb.collection('users').doc(uid).collection('aiJftSessions');
    }

    // V3: aiJftHistory — koleksi baru untuk riwayat paket ujian
    // aiJftSessions tetap dipertahankan agar session lama tidak hilang.
    function _historyRef() {
        const uid = window.AUTH?.user?.uid;
        if (!uid || window.AUTH?.user?.isGuest || typeof _fbDb === 'undefined') return null;
        return _fbDb.collection('users').doc(uid).collection('aiJftHistory');
    }

    function _flattenSections(sections) {
        const flat = [];
        SECTION_ORDER.forEach(sec => {
            (sections[sec] || []).forEach(q => flat.push({ section: sec, q }));
        });
        return flat;
    }

    function _buildActiveSession(sessionId, level, mode, creditCost, sections, existingAnswers, timerSeconds) {
        return {
            sessionId, level, mode, creditCost,
            sections,                           // { kanji_kotoba:[...], expression:[...], dokkai:[...] }
            flat: _flattenSections(sections),   // urutan tampil flat
            currentIndex: 0,
            answers: existingAnswers || [],     // [{section, selectedIndex, correct}]
            answered: false,
            timerSeconds: timerSeconds || 0,    // Phase 2: durasi timer mode ini
        };
    }

    // ── IMAGE FRAMEWORK ───────────────────────────────────────────
    // AI memilih imageId (mis. "restaurant_menu_01"), sistem load dari
    // /assets/jft-images/{imageId}.jpg|.png. Tanpa refactor saat asset tersedia.
    const IMAGE_ASSET_BASE = '/assets/jft-images/';
    const IMAGE_EXTENSIONS = ['.jpg', '.png', '.webp'];

    function _resolveImageAsset(imageId) {
        if (!imageId) return null;
        // Gunakan ekstensi pertama — saat ini placeholder; override saat asset ada
        return IMAGE_ASSET_BASE + imageId + '.jpg';
    }

    function _renderImagePlaceholder(imageId) {
        const label = imageId ? imageId.replace(/_/g, ' ') : 'Gambar';
        return '<div class="aijs-img-placeholder"><div class="aijs-img-placeholder-icon">🖼️</div>' +
               '<div class="aijs-img-placeholder-label">' + escHTML(label) + '</div>' +
               '<div class="aijs-img-placeholder-hint">Asset belum tersedia</div></div>';
    }

    function _renderImageBlock(q) {
        // Support both new imageId and legacy imageCategory/imageAsset
        const imageId = q.imageId || null;
        if (!imageId) return '';
        const src = _resolveImageAsset(imageId);
        return '<div class="aijs-img-wrap" data-imgid="' + escHTML(imageId) + '">' +
               '<img class="aijs-img-asset" src="' + escHTML(src) +
               '" alt="' + escHTML(imageId) + '" loading="lazy"></div>';
    }

    function _bindImageFallbacks(container) {
        container.querySelectorAll('.aijs-img-asset').forEach(img => {
            img.addEventListener('error', function() {
                const wrap = this.closest('[data-imgid]');
                const id   = wrap ? wrap.dataset.imgid : '';
                if (wrap) wrap.outerHTML = _renderImagePlaceholder(id);
            });
        });
    }

    // ── Phase 2: CHOUKAI FOUNDATION ──────────────────────────────
    // Struktur data choukai — belum ada TTS/audio, hanya fondasi.
    // { listeningText: "...", audioUrl: null, maxPlay: 2 }
    function _docTypeLabel(docType) {
        const map = {
            brosur:       '📄 Brosur',
            poster:       '🗒️ Poster',
            jadwal:       '🗓️ Jadwal',
            pengumuman:   '📢 Pengumuman',
            formulir:     '📋 Formulir',
            email:        '📧 Email',
            chat:         '💬 Chat',
            papan_info:   '🪧 Papan Informasi',
            teks_bebas:   '📖 Teks',
        };
        return map[docType] || ('📄 ' + docType);
    }

    function _renderChoukaiBadge(q) {
        if (q.questionType !== 'choukai') return '';
        return '<div class="aijs-choukai-badge">🎧 Choukai — Audio belum tersedia</div>';
    }

    // ═══════════════════════════════════════════════════════════
    // TTS ENGINE — Browser SpeechSynthesis, ja-JP, multi-speaker
    // ═══════════════════════════════════════════════════════════
    const _TTS = {
        ALLOW_REPLAY : true,   // false = audio hanya sekali (strict JFT mode)
        _ready       : false,
        _voices      : [],
        _maleVoice   : null,
        _femaleVoice : null,
        _onDoneCb    : null,
        _utterances  : [],

        /** Inisialisasi voices. Dipanggil sekali lalu cache. */
        init() {
            if (!window.speechSynthesis) return;
            const load = () => {
                this._voices = window.speechSynthesis.getVoices();
                this._pickVoices();
                this._ready = true;
            };
            if (window.speechSynthesis.getVoices().length) {
                load();
            } else {
                window.speechSynthesis.addEventListener('voiceschanged', load, { once: true });
            }
        },

        _pickVoices() {
            const jp = this._voices.filter(v => v.lang && v.lang.startsWith('ja'));
            if (!jp.length) return;
            // Female: default/pertama
            this._femaleVoice = jp[0];
            // Male: cari kata "male" atau "man" di name, atau ambil index ke-1 jika ada
            const maleHint = jp.find(v => /male|man|otoko/i.test(v.name));
            this._maleVoice = maleHint || (jp.length > 1 ? jp[1] : jp[0]);
        },

        _hasJpVoice() {
            return !!(this._maleVoice || this._femaleVoice);
        },

        /**
         * Mainkan array script: [{speaker:"male"|"female", text:"..."}]
         * onDone dipanggil setelah semua utterance selesai.
         */
        speak(script, onDone) {
            if (!window.speechSynthesis) { if (onDone) onDone(); return; }
            window.speechSynthesis.cancel();
            this._onDoneCb  = onDone;
            this._utterances = [];

            const lines = Array.isArray(script) ? script : [];
            if (!lines.length) { if (onDone) onDone(); return; }

            lines.forEach((line, i) => {
                const utt  = new SpeechSynthesisUtterance(line.text || '');
                utt.lang   = 'ja-JP';
                utt.rate   = 0.88;
                utt.pitch  = (line.speaker === 'male') ? 0.75 : 1.15;
                const voice = (line.speaker === 'male') ? this._maleVoice : this._femaleVoice;
                if (voice) utt.voice = voice;
                if (i === lines.length - 1) {
                    utt.onend = () => { if (this._onDoneCb) { this._onDoneCb(); this._onDoneCb = null; } };
                    utt.onerror = () => { if (this._onDoneCb) { this._onDoneCb(); this._onDoneCb = null; } };
                }
                this._utterances.push(utt);
            });

            this._utterances.forEach(u => window.speechSynthesis.speak(u));
        },

        stop() {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            this._onDoneCb = null;
        },

        warningHtml() {
            if (!window.speechSynthesis) {
                return '<div class="aijs-tts-warn">⚠️ Browser tidak mendukung SpeechSynthesis. Choukai tidak tersedia.</div>';
            }
            if (!this._hasJpVoice()) {
                return '<div class="aijs-tts-warn">⚠️ Suara bahasa Jepang tidak tersedia di perangkat ini. Teks dialog ditampilkan sebagai gantinya.</div>';
            }
            return '';
        },
    };
    _TTS.init();

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
        const g = {
            a1:'A1 Pemula: kosakata SANGAT dasar. Kalimat max 10 kata. Kanji HANYA: 人日本水火木金土月山川大小中上下食飲見行来帰時間円店駅学校先生.',
            a1plus:'A1+ Dasar: kosakata berkembang, partikel はがをにでの. Topik: belanja, transportasi.',
            a2:'A2 Awal Kerja (JFT-Basic): format resmi JFT. Kosakata kerja.',
            a2plus:'A2+ Siap Kerja: pengumuman resmi, formulir, instruksi kompleks.',
            n5:'N5: dasar.', n4:'N4: menengah-dasar.', jft_basic:'JFT-Basic (CEFR A2).'
        };
        return g[levelId] || g.a2;
    }

    function _buildPrompt(levelId, cfg) {
        const levelLabel = LEVELS[levelId] || levelId;
        const levelGuide = _levelGuide(levelId);
        const s = cfg.sections;
        const system =
            'Kamu adalah pembuat soal ujian JFT-Basic untuk MNN Learning. Balas HANYA JSON murni.\n\n' +
            '== KANJI & KOTOBA (4 tipe merata) ==\n' +
            'TIPE 1 Word Meaning: situasi singkat → pilih kata.\n' +
            '  A1: Q="かおをあらいます。どこでしますか。" Opts=["おふろ","トイレ","だいどころ","しんしつ"] A="おふろ"\n\n' +
            'TIPE 2 Word Usage: kalimat+(　)→pilih. GRAMMAR WAJIB:\n' +
            '  +ます→stem(おき/ね) | +てきました→te(なれて) | +をします→nomina(散歩) | +です→adj(あまい)\n' +
            '  BENAR: Q="毎日 6時に(　)ます。" Opts=["おき","ね","あらい","いき"] A="おき"\n\n' +
            'TIPE 3 Kanji Reading: [漢字]→4 cara baca HIRAGANA kata ITU. BUKAN kata lain!\n' +
            '  BENAR: Q="[電話]ボックス" Opts=["でんわ","てんわ","でいわ","とんわ"] A="でんわ"\n\n' +
            'TIPE 4 Kanji Meaning: (　)→pilih kanji. Opts=["乗って","光って","通って","走って"] A="光って"\n\n' +
            '== EXPRESSION ==\\n' +
            'いらっしゃいませ=SELALU 店員→客. Tanya いくら？→HARGA(300円). Tanya 何時？→JAM(3時). Blank:(　　　).\\n' +
            '!!! WAJIB: field "question" HARUS berisi DIALOG atau SITUASI dengan 1-2 kalimat + blank. BUKAN hanya pertanyaan kosong !!!\\n' +
            '!!! DILARANG: "question": "(　　　)" saja — HARUS ada konteks dialog !!!\\n' +
            'Format WAJIB: "A: [kalimat]\\nB: (　　　)" atau "[situasi]. (　　　)"\\n' +
            'BENAR: Q="店員：いらっしゃいませ！\\n客：(　　　)" Opts=["ありがとうございます","すみません","いいです","どうぞ"]\\n' +
            'BENAR: Q="上司に仕事が終わったことを伝えたい。(　　　)" Opts=["お疲れ様でした","起きます","いきます","説明します"]\\n' +
            'SALAH: Q="(　　　)" saja — tidak ada konteks!\\n' +
            'SALAH: Q="いくらですか？" → ini pertanyaan, BUKAN dialog dengan blank!\\n' +
            'Options=ungkapan Jepang natural, relevan konteks dialog.\\n\\n' +

            '== CHOUKAI ==\n' +
            'WAJIB: "listeningScript":[{"speaker":"male"|"female","text":"..."},...], "maxPlay":1|2.\n' +
            '"question"=kalimat tanya SINGKAT (bukan isi script, tanpa \\n).\n' +
            'INFO DITANYA HARUS ADA DI SCRIPT: tanya jam→script sebut jam; tanya harga→script sebut harga.\n' +
            'BENAR: [{m:"会議は何時?"},{f:"10時から"}] q="会議は何時から?" → 10時 ADA.\n' +
            'SALAH: [{f:"会議です"}] q="会議は何時?" → jam tidak ada!\n' +
            '3 tipe: dialog maxPlay:2 | toko maxPlay:2 | pengumuman maxPlay:1.\n\n' +
            '== DOKKAI ==\n' +
            '"docType": surat|memo|chat|email|pengumuman|brosur|jadwal|label_obat|papan_info|daftar_harga.\n' +
            'TEKS HARUS MEMUAT FAKTA UNTUK MENJAWAB: harga→ada harga; jam→ada jam; populer→sebutkan mana.\n' +
            'BENAR: "りんご 100円\nバナナ 150円\nバナナは?" A="150円".\n' +
            'SALAH: "りんご、バナナを売っています。りんごは?" → harga tidak ada!\n' +
            'SALAH: "おいしいレストラン。一番人気は?" → tidak disebutkan mana paling populer!\n\n' +
            '== LEVEL == ' + levelGuide + '\n\n' +
            'QUALITY: TIPE3=hiragana cara baca | expression peran benar | choukai script ada info | dokkai teks ada fakta';
        const user =
            'Buat paket JFT-Basic level "' + levelLabel + '" soal TEPAT: ' +
            'choukai=' + s.choukai + ' | kanji_kotoba=' + s.kanji_kotoba + ' | expression=' + s.expression + ' | dokkai=' + s.dokkai + '\n\n' +
            'JSON output (dokkai PERTAMA — agar tidak terpotong token):\n{"sections":{"dokkai":[...],"kanji_kotoba":[...],"expression":[...],"choukai":[...]}}\n\n' +
            'Format: {"question":"...","options":["A","B","C","D"],"answer":"A","explanation":"..."}\n' +
            'Choukai+: "listeningScript":[{"speaker":"male","text":"..."},...], "maxPlay":2\n' +
            'Dokkai+: "docType":"..."\n\n' +
            '!!! DOKKAI WAJIB ' + s.dokkai + ' soal — GENERATE DULU sebelum choukai !!!\n' +
            '!!! CHOUKAI WAJIB ' + s.choukai + ' soal dengan listeningScript !!!\n' +
            'Balas JSON saja.';
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

    function _isValidQuestion(q, sectionHint) {
        if (!q || typeof q.question !== 'string') return false;
        var qt = q.question.trim();
        // Strip prefix Q="..." atau Q='...' yang AI sering tambahkan dari contoh prompt
        qt = qt.replace(/^[Qq]\s*[:=]\s*["']/, '').replace(/["']\s*$/, '').trim();
        if (qt !== q.question.trim()) q.question = qt; // koreksi di objek
        if (!qt || qt.length < 3) return false;
        if (!Array.isArray(q.options) || q.options.length !== 4) return false;
        if (!q.options.every(function(o){ return typeof o === 'string' && o.trim(); })) return false;
        if (typeof q.answer !== 'string') return false;
        if (q.explanation == null) q.explanation = '';
        if (typeof q.explanation !== 'string') return false;

        // ── DOKKAI: validasi ultra-lenient ─────────────────────────────
        if (sectionHint === 'dokkai') {
            var _dc = function(s) {
                return String(s).trim()
                    .replace(/[\u3000\u00a0 ]+/g, '')
                    .replace(/[\u3002\u3001\uff1f\uff01\.\?!,]/g, '')
                    .toLowerCase();
            };
            var dcAns = _dc(q.answer);
            var dcMatch = q.options.find(function(o){ return _dc(o) === dcAns; });
            if (!dcMatch) {
                dcMatch = q.options.find(function(o){
                    var co = _dc(o);
                    return co.indexOf(dcAns) !== -1 || dcAns.indexOf(co) !== -1;
                });
            }
            if (!dcMatch) {
                console.warn('[DOKKAI rejected] answer not in opts:', q.answer, q.options);
                return false;
            }
            q.answer = dcMatch;
            if (q.listeningScript !== undefined) delete q.listeningScript;
            return true;
        }

        // ── SEMUA SECTION LAIN ─────────────────────────────────────────
        var _norm = function(s){ return String(s).trim().replace(/[\s\u3000]+/g,' '); };
        var normAns = _norm(q.answer);
        var matched = q.options.find(function(o){ return _norm(o) === normAns; });
        if (!matched) return false;
        q.answer = matched;

        var uniq = new Set(q.options.map(function(o){ return o.trim().toLowerCase(); }));
        if (uniq.size < 4) return false;

        if (q.listeningScript !== undefined) {
            if (!Array.isArray(q.listeningScript) || !q.listeningScript.length) {
                delete q.listeningScript;
            } else {
                q.listeningScript = q.listeningScript.filter(
                    function(l){ return l && typeof l.text === 'string' && l.text.trim(); }
                );
                if (!q.listeningScript.length) delete q.listeningScript;
            }
        }

        var _km = qt.match(/\u3010([^\u3011]+)\u3011/);
        var target = _km ? _km[1] : null;
        if (target && q.options.some(function(o){ return o.trim() === target; })) return false;

        return true;
    }
    function _parseAndValidate(raw) {
        const parsed = _extractJSON(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        const src = (parsed.sections && typeof parsed.sections === 'object') ? parsed.sections : parsed;
        const out = {};
        // Shuffle options agar jawaban tidak selalu di posisi pertama
        function shuffleQ(q) {
            var o=q.options.slice();
            for(var i=o.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=o[i];o[i]=o[j];o[j]=t;}
            q.options=o; return q;
        }
        let totalValid = 0;
        for (const sec of SECTION_ORDER) {
            const arr   = Array.isArray(src[sec]) ? src[sec] : [];
            const valid = arr.filter(q => _isValidQuestion(q, sec)).map(shuffleQ);
            out[sec] = valid;
            totalValid += valid.length;
        }
        console.debug('[AI_JFT_SIM] soal valid:', Object.fromEntries(SECTION_ORDER.map(s=>[s,out[s].length])));
        if (totalValid === 0) return null;
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
                temperature: 0.7,
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
                // Phase 2
                timerSeconds:   cfg.timerSeconds || 0,
                durationSeconds: null,
                sectionType:    'standard',
                // V3
                schemaVersion:  3,
            });

            // V3: dual-write ke aiJftHistory (non-blocking)
            const histRef = _historyRef();
            if (histRef) {
                histRef.doc(sessionId).set({
                    examId:    sessionId,
                    level:     levelId,
                    mode:      modeId,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    sections,
                    answers:   [],
                    score:     null,
                    completed: false,
                }).catch(() => {});
            }

            // ── POTONG CREDIT — hanya sampai titik ini jika semua di atas berhasil ──
            await AI_SENSEI.deductCredit(cfg.credit);

            // Analytics — fire-and-forget, tidak wajib berhasil
            try {
                window.AI_ANALYTICS?.track?.('AI JFT Simulation', cfg.credit, prompt.user.length, raw.length, true);
            } catch (e) {}

            _activeSession = _buildActiveSession(sessionId, levelId, modeId, cfg.credit, sections, [], cfg.timerSeconds);

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

    // ── Phase 2: TIMER ───────────────────────────────────────────
    function _startTimer(seconds) {
        _clearTimer();
        _timerRemaining  = seconds;
        _sessionStartTs  = Date.now();
        _updateTimerDisplay();
        _timerInterval = setInterval(() => {
            _timerRemaining -= 1;
            _updateTimerDisplay();
            if (_timerRemaining <= 0) {
                _clearTimer();
                _finishSession(true); // true = time-up
            }
        }, 1000);
    }

    function _clearTimer() {
        if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    }

    function _updateTimerDisplay() {
        const el = document.getElementById('aijs-timer-display');
        if (el) {
            const m = Math.floor(_timerRemaining / 60);
            const s = _timerRemaining % 60;
            el.textContent = m + ':' + String(s).padStart(2, '0');
            el.classList.toggle('aijs-timer-warning', _timerRemaining <= 60);
        }
        _syncTimerHero(); // V3: sync hero timer juga
    }

    function _getElapsedSeconds() {
        if (!_sessionStartTs) return 0;
        return Math.round((Date.now() - _sessionStartTs) / 1000);
    }

        function renderSessionPage() {
        _bindSessionTopbarOnce();

        if (_sessionLoading) {
            _renderSessionLoadingState();
            return;
        }
        if (!_activeSession) {
            navigateTo('ai-jft-setup');
            return;
        }
        // Phase 2: start timer only on fresh session (index 0), not on re-render
        if (_activeSession.currentIndex === 0 && _activeSession.timerSeconds > 0 && !_timerInterval) {
            _startTimer(_activeSession.timerSeconds);
        }
        // V3: inject timer hero into session body BEFORE question
        _renderTimerHero();
        _renderCurrentQuestion();
    }

    function _renderTimerHero() {
        // Timer hero: block di atas soal, update bersama _updateTimerDisplay
        const body = document.getElementById('aijs-session-body');
        if (!body) return;
        // Hanya inject sekali; jika sudah ada skip
        if (document.getElementById('aijs-timer-hero')) return;
        const hero = document.createElement('div');
        hero.id = 'aijs-timer-hero';
        hero.className = 'aijs-timer-hero';
        const s = _activeSession;
        const totalSections = SECTION_ORDER.filter(sec => (s.sections[sec]||[]).length > 0).length;
        const flat = s.flat[s.currentIndex] || {};
        const secLabel = SECTION_LABELS[flat.section] || '—';
        const secIndex = SECTION_ORDER.filter(sec => (s.sections[sec]||[]).length > 0)
                                      .indexOf(flat.section) + 1;
        hero.innerHTML =
            '<div class="aijs-timer-hero-time" id="aijs-timer-hero-time">—</div>' +
            '<div class="aijs-timer-hero-label">WAKTU TERSISA</div>' +
            '<div class="aijs-timer-hero-section" id="aijs-timer-hero-section">—</div>' +
            '<div class="aijs-timer-hero-pos" id="aijs-timer-hero-pos"></div>';
        body.parentElement.insertBefore(hero, body);
        _syncTimerHero();
    }

    function _syncTimerHero() {
        const el = document.getElementById('aijs-timer-hero-time');
        if (!el) return;
        const m = Math.floor(_timerRemaining / 60), sc = _timerRemaining % 60;
        el.textContent = m + ':' + String(sc).padStart(2, '0');
        el.classList.toggle('aijs-timer-hero-warning', _timerRemaining <= 60);
        const s = _activeSession; if (!s) return;
        const flat = s.flat[s.currentIndex] || {};
        const secLabel = SECTION_LABELS[flat.section] || '—';
        const activeSecs = SECTION_ORDER.filter(sec => (s.sections[sec]||[]).length > 0);
        const secIndex = activeSecs.indexOf(flat.section) + 1;
        const secEl = document.getElementById('aijs-timer-hero-section');
        const posEl = document.getElementById('aijs-timer-hero-pos');
        if (secEl) secEl.textContent = secLabel;
        if (posEl) posEl.textContent = secIndex > 0 ? 'Section ' + secIndex + '/' + activeSecs.length : '';
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
            _clearTimer();
            _TTS.stop();
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

        if (section === 'choukai') { body.innerHTML = ''; _renderChoukaiQuestion(body, q); return; }
        const imgBlock = _renderImageBlock(q);
        body.innerHTML =
            (imgBlock ? '<div class="aijs-q-visual">' + imgBlock + '</div>' : '') +
            '<div class="aijs-q-card"><div class="aijs-q-text">' + _renderText(q.question) + '</div></div>' +
            '<div class="aijs-option-list" id="aijs-option-list">' +
            q.options.map((opt,i)=>'<button class="aijs-option-btn" data-idx="'+i+'">'+_renderText(opt)+'</button>').join('') +
            '</div><div id="aijs-feedback-slot"></div>';
        document.querySelectorAll('#aijs-option-list .aijs-option-btn').forEach(btn=>{
            btn.addEventListener('click',()=>_selectOption(parseInt(btn.dataset.idx,10)));
        });
        _bindImageFallbacks(body);
    }

    // ── CHOUKAI AUDIO FLOW ─────────────────────────────────────────
    function _renderChoukaiQuestion(body, q) {
        const warn = _TTS.warningHtml();
        const hasAudio = !warn && Array.isArray(q.listeningScript) && q.listeningScript.length;

        const maxPlay = (typeof q.maxPlay==='number'&&q.maxPlay>=1)?q.maxPlay:2;
        body.innerHTML =
            '<div class="aijs-choukai-wrap">' + warn +
            '<div class="aijs-q-card"><div class="aijs-choukai-question-text">' + _renderText(q.question) + '</div></div>' +
            '<div class="aijs-choukai-player" id="aijs-choukai-player">' +
            (hasAudio
                ? '<div class="aijs-choukai-play-area"><button class="aijs-play-btn" id="aijs-play-btn">&#9654; Putar Audio <span class="aijs-play-hint">(maks '+maxPlay+'x)</span></button><p class="aijs-choukai-hint">Dengarkan lalu pilih jawaban.</p></div>'
                : '<p class="aijs-choukai-noscript">Suara tidak tersedia — teks ditampilkan langsung.</p>') +
            '</div><div id="aijs-choukai-options-slot"></div><div id="aijs-feedback-slot"></div></div>';
        if (hasAudio) {
            let pc=0; const pb=document.getElementById('aijs-play-btn'); if(!pb)return;
            pb.addEventListener('click',function(){ if(pc>=maxPlay)return; pb.disabled=true; pb.innerHTML='&#9646;&#9646; Memutar...';
                _TTS.speak(q.listeningScript,()=>{pc++;_revealChoukaiOptions(q,pc,maxPlay);});
            });
        } else { _showChoukaiScript(q); _revealChoukaiOptions(q,1,1); }
    }

    function _showChoukaiScript(q) {
        const player = document.getElementById('aijs-choukai-player');
        if (!player || !Array.isArray(q.listeningScript)) return;
        const lines = q.listeningScript.map(l => {
            const icon = l.speaker === 'male' ? '👨' : '👩';
            return '<div class="aijs-script-line aijs-script-' + escHTML(l.speaker || 'female') + '">' +
                   '<span class="aijs-script-icon">' + icon + '</span>' +
                   '<span class="aijs-script-text">' + _renderText(l.text || '') + '</span></div>';
        }).join('');
        player.innerHTML = '<div class="aijs-script-box">' + lines + '</div>';
    }

    function _revealChoukaiOptions(q, playCount, maxPlay) {
        playCount = playCount||1; maxPlay = maxPlay||2;
        const spinner = document.getElementById('aijs-choukai-spinner');
        if (spinner) spinner.remove();

        // Show script after audio done
        const player = document.getElementById('aijs-choukai-player');
        if (player && Array.isArray(q.listeningScript)) {
            const lines = q.listeningScript.map(l => {
                const icon = l.speaker === 'male' ? '👨' : '👩';
                return '<div class="aijs-script-line aijs-script-' + escHTML(l.speaker || 'female') + '">' +
                       '<span class="aijs-script-icon">' + icon + '</span>' +
                       '<span class="aijs-script-text">' + _renderText(l.text || '') + '</span></div>';
            }).join('');
            player.innerHTML = '<div class="aijs-script-box">' + lines + '</div>' +
                (_TTS.ALLOW_REPLAY && _TTS._hasJpVoice() && Array.isArray(q.listeningScript) && (q.maxPlay || 2) > 1
                    ? '<button class="aijs-replay-btn" id="aijs-replay-btn">🔁 Putar Ulang</button>'
                    : '');
            const replayBtn = document.getElementById('aijs-replay-btn');
            if (replayBtn) {
                // maxPlay: 1 = sekali saja, 2 = boleh ulang (default JFT: 2)
                const maxPlay  = (typeof q.maxPlay === 'number') ? q.maxPlay : 2;
                let   playCount = 1; // sudah diputar sekali otomatis
                const updateReplayBtn = () => {
                    if (playCount >= maxPlay) {
                        replayBtn.disabled = true;
                        replayBtn.textContent = '🔇 Batas putar tercapai';
                    }
                };
                replayBtn.addEventListener('click', () => {
                    if (playCount >= maxPlay) return;
                    replayBtn.disabled = true;
                    replayBtn.textContent = '⏸ Memutar...';
                    _TTS.speak(q.listeningScript, () => {
                        playCount++;
                        replayBtn.disabled = false;
                        replayBtn.textContent = '🔁 Putar Ulang (' + playCount + '/' + maxPlay + ')';
                        updateReplayBtn();
                    });
                });
                replayBtn.textContent = '🔁 Putar Ulang (1/' + maxPlay + ')';
                updateReplayBtn();
            }
        }

        const slot = document.getElementById('aijs-choukai-options-slot');
        if (!slot) return;
        const optionsHtml = q.options.map((opt, i) =>
            '<button class="aijs-option-btn" data-idx="' + i + '">' + escHTML(opt) + '</button>'
        ).join('');
        slot.innerHTML = '<div class="aijs-option-list" id="aijs-option-list">' + optionsHtml + '</div>';
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
        _TTS.stop();
        s.currentIndex += 1;
        s.answered = false;
        _renderCurrentQuestion();
    }

    async function _finishSession(timeUp) {
        const s = _activeSession;
        if (!s) return;
        _clearTimer();
        const durationSeconds = _getElapsedSeconds();

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
                await ref.doc(s.sessionId).set({
                        score: overallScore, completed: true, sectionScores,
                        durationSeconds,  // Phase 2
                    }, { merge: true });
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

            _activeSession = _buildActiveSession(sessionId, data.level, data.mode, data.creditCost, data.questions || {}, [], data.timerSeconds || 0);
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

                // Phase 2: durasi pengerjaan
                const dur = (typeof d.durationSeconds === 'number')
                    ? Math.floor(d.durationSeconds / 60) + 'm ' + (d.durationSeconds % 60) + 'd'
                    : null;
                const durHtml = dur
                    ? '<span class="aijs-history-dur">⏱ ' + dur + '</span>'
                    : '';

                return '<div class="aijs-history-item">' +
                    '<div class="aijs-history-info">' +
                    '<div class="aijs-history-meta">' + escHTML(levelLabel) + ' · ' + escHTML(modeLabel) + durHtml + '</div>' +
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
