/* ═══════════════════════════════════════════════════════════
   MNN Learning — AI Credit Page Controller
   ai-sensei-credit.js

   Tanggung jawab:
   - Render halaman AI Credit (saldo, riwayat, paket top up)
   - Admin tools: tambah credit manual
   - Dipanggil saat navigateTo('ai-credit')
   ═══════════════════════════════════════════════════════════ */

'use strict';

const AI_CREDIT_PAGE = (() => {

    // ─────────────────────────────────────────────────────
    // RENDER UTAMA
    // ─────────────────────────────────────────────────────

    async function render() {
        const container = document.getElementById('aic-content');
        const header    = document.getElementById('aic-header-balance');
        if (!container) return;

        container.innerHTML = '<div class="aic-loading-wrap"><div class="aic-spinner"></div></div>';

        try {
            // Timeout 8 detik — jika Firestore lambat, tetap tampilkan UI
            const withTimeout = (promise, ms) => Promise.race([
                promise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
            ]);

            // Ambil data credit
            const credits = window.AI_SENSEI
                ? await withTimeout(AI_SENSEI.getCredits(), 8000).catch(() => ({
                    total: 0, remaining: 0, used: 0, plan: 'free', error: true
                  }))
                : { total: 0, remaining: 0, used: 0, plan: 'free', error: true };

            // Update header balance
            if (header) header.textContent = (credits.remaining ?? 0) + ' credit';

            // Ambil riwayat — tanpa orderBy agar tidak butuh index Firestore
            const logs = await withTimeout(_fetchUsageLogs(), 5000).catch(() => []);

            const isAdmin = window.AI_FLAG?.isAdmin?.() || false;
            const isPrem  = typeof isPremiumUser === 'function' && isPremiumUser();

            container.innerHTML =
                _renderBalanceCard(credits, isPrem) +
                _renderWelcomeBonus() +
                _renderUsageHistory(logs) +
                _renderTopUpPackages() +
                (isAdmin ? _renderAdminTools() : '');

            _bindEvents();

        } catch (e) {
            console.error('[AIC_PAGE] render error:', e.message);
            container.innerHTML =
                '<div style="text-align:center;padding:48px 24px;color:var(--text-muted,#888)">' +
                '<div style="font-size:32px;margin-bottom:12px">⚠️</div>' +
                '<div style="font-size:14px">Gagal memuat halaman credit.<br>Coba kembali dan buka lagi.</div>' +
                '</div>';
        }
    }

    // ─────────────────────────────────────────────────────
    // FIRESTORE — ambil riwayat pemakaian
    // ─────────────────────────────────────────────────────

    async function _fetchUsageLogs() {
        const uid = window.AUTH?.user?.uid;
        if (!uid || typeof _fbDb === 'undefined') return [];
        try {
            // Tanpa orderBy agar tidak butuh Firestore composite index
            const snap = await _fbDb.collection('aiUsageLogs')
                .where('uid', '==', uid)
                .limit(15)
                .get();
            // Sort manual di client setelah data masuk
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => {
                const ta = a.createdAt?.seconds || 0;
                const tb = b.createdAt?.seconds || 0;
                return tb - ta;
            });
            return docs;
        } catch (e) {
            console.warn('[AIC_PAGE] _fetchUsageLogs error:', e.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────
    // RENDER HELPERS
    // ─────────────────────────────────────────────────────

    function _renderBalanceCard(credits, isPrem) {
        const remaining = credits.remaining ?? 0;
        const total     = credits.total     ?? 0;
        const used      = credits.used      ?? 0;
        const plan      = credits.plan      ?? 'free';
        const pct       = total > 0 ? Math.round((remaining / total) * 100) : 0;
        const barClass  = pct <= 20 ? 'ais-credit-low' : pct <= 50 ? 'ais-credit-mid' : '';

        return '<div class="aic-card aic-balance-card">' +
            '<div class="aic-balance-num">' + remaining + '</div>' +
            '<div class="aic-balance-label">credit tersisa</div>' +
            '<div class="aic-balance-track">' +
                '<div class="ais-credit-bar-fill ' + barClass + '" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<div class="aic-balance-meta">' +
                '<span>Terpakai: ' + used + '</span>' +
                '<span>Plan: <strong>' + plan + '</strong></span>' +
            '</div>' +
        '</div>';
    }

    function _renderWelcomeBonus() {
        const uid      = window.AUTH?.user?.uid;
        const memberId = window.AUTH?.user?.memberId || '-';
        if (!uid) return '';
        const isPrem = typeof isPremiumUser === 'function' && isPremiumUser();
        const bonus  = isPrem ? 15 : 5;
        return '<div class="aic-card aic-bonus-card">' +
            '<div class="aic-section-title">Info Akun</div>' +
            '<div class="aic-member-id-row">' +
                '<span class="aic-member-label">MNN-ID kamu</span>' +
                '<span class="aic-member-value" id="aic-member-id-val">' + memberId + '</span>' +
            '</div>' +
            '<div class="aic-bonus-row" style="margin-top:12px">' +
                '<span class="aic-bonus-icon">🎁</span>' +
                '<div>' +
                    '<div class="aic-bonus-name">Welcome Bonus</div>' +
                    '<div class="aic-bonus-sub">1x per akun &mdash; ' + bonus + ' credit gratis</div>' +
                '</div>' +
                '<span class="aic-bonus-badge">Claimed</span>' +
            '</div>' +
        '</div>';
    }

    function _renderUsageHistory(logs) {
        const featureIcon = { 'Interview AI': '💼', 'Roleplay Percakapan': '🎭',
            'Koreksi Kalimat': '✏️', 'Bunpou': '📚', 'Kotoba': '📖', 'Pertanyaan Umum': '💬' };

        if (!logs.length) {
            return '<div class="aic-card">' +
                '<div class="aic-section-title">Riwayat Penggunaan</div>' +
                '<div class="aic-empty">Belum ada riwayat penggunaan.</div>' +
            '</div>';
        }

        const PREVIEW_COUNT = 5;

        const rows = logs.map((log, idx) => {
            const icon = featureIcon[log.feature] || '🤖';
            const date = log.createdAt?.toDate
                ? log.createdAt.toDate().toLocaleDateString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
                : '-';
            // data-extra tetap ada setelah expand — dipakai sebagai selector permanen
            const extraAttr = idx >= PREVIEW_COUNT ? ' data-extra="true" style="display:none"' : '';
            return '<div class="aic-log-row"' + extraAttr + '>' +
                '<span class="aic-log-icon">' + icon + '</span>' +
                '<div class="aic-log-info">' +
                    '<div class="aic-log-feature">' + (log.feature || 'AI Sensei') + '</div>' +
                    '<div class="aic-log-date">' + date + '</div>' +
                '</div>' +
                '<span class="aic-log-cost">-' + (log.creditUsed || 1) + '</span>' +
            '</div>';
        }).join('');

        const totalExtra = logs.length - PREVIEW_COUNT;
        const toggleBtn = totalExtra > 0
            ? '<button class="aic-history-toggle" onclick="' +
              '(function(btn){' +
              'var card=btn.closest(\'.aic-card\');' +
              'var extras=card.querySelectorAll(\'[data-extra]\');' +
              'var isExpanded=btn.classList.contains(\'expanded\');' +
              'extras.forEach(function(el){el.style.display=isExpanded?\'none\':\'\';});' +
              'btn.classList.toggle(\'expanded\',!isExpanded);' +
              'btn.querySelector(\'.aic-history-toggle-label\').textContent=' +
              'isExpanded?\'Lihat semua (+' + totalExtra + ')\':\' Sempit\';' +
              '})(this)">' +
              '<span class="aic-history-toggle-label">Lihat semua (+' + totalExtra + ')</span>' +
              '<span class="aic-history-toggle-icon">▼</span>' +
              '</button>'
            : '';

        return '<div class="aic-card">' +
            '<div class="aic-section-title">Riwayat Penggunaan</div>' +
            rows +
            toggleBtn +
        '</div>';
    }

    function _renderTopUpPackages() {
        const packages = [
            { credits: 100,  price: 'Rp5.000',  tag: '' },
            { credits: 300,  price: 'Rp10.000', tag: 'Populer' },
            { credits: 1000, price: 'Rp25.000', tag: 'Hemat' },
        ];

        const cards = packages.map(p =>
            '<div class="aic-pkg-card">' +
                (p.tag ? '<span class="aic-pkg-tag">' + p.tag + '</span>' : '') +
                '<div class="aic-pkg-credits">' + p.credits + '</div>' +
                '<div class="aic-pkg-label">credit</div>' +
                '<div class="aic-pkg-price">' + p.price + '</div>' +
                '<button class="aic-pkg-btn" onclick="AI_CREDIT_PAGE.openTopUpRequest(' + p.credits + ', \'' + p.price + '\')">' +
                    'Pilih Paket' +
                '</button>' +
            '</div>'
        ).join('');

        return '<div class="aic-card">' +
            '<div class="aic-section-title">Paket Top Up Credit</div>' +
            '<div class="aic-pkg-note">Pembayaran manual &mdash; hubungi admin setelah memilih paket.</div>' +
            '<div class="aic-pkg-grid">' + cards + '</div>' +
        '</div>';
    }

    function _renderAdminTools() {
        return '<div class="aic-card aic-admin-card">' +
            '<div class="aic-section-title">Admin Tools</div>' +
            '<div class="aic-admin-mode-toggle">' +
                '<button id="aic-mode-tambah" class="aic-mode-btn aic-mode-active">+ Tambah Credit</button>' +
                '<button id="aic-mode-set" class="aic-mode-btn">= Set Credit</button>' +
            '</div>' +
            '<div class="aic-admin-label" id="aic-admin-label">Tambah Credit via MNN-ID</div>' +
            '<input id="aic-admin-uid" class="aic-admin-input" placeholder="Contoh: MNN-849622" autocomplete="off" spellcheck="false" style="text-transform:uppercase">' +
            '<input id="aic-admin-amount" class="aic-admin-input" type="number" placeholder="Jumlah Credit" min="0">' +
            '<div id="aic-set-warning" style="display:none;font-size:12px;color:#BA7517;margin-bottom:6px;">&#9888; Set akan mengganti credit ke nilai ini, bukan menambah.</div>' +
            '<button id="aic-admin-submit" class="aic-admin-btn">Tambah Credit</button>' +
            '<div id="aic-admin-result" class="aic-admin-result"></div>' +
        '</div>';
    }

    // ─────────────────────────────────────────────────────
    // EVENT BINDING
    // ─────────────────────────────────────────────────────

    function _bindEvents() {
        // Admin: toggle mode Tambah / Set
        let _adminMode = 'tambah';
        const btnTambah  = document.getElementById('aic-mode-tambah');
        const btnSet     = document.getElementById('aic-mode-set');
        const adminLabel = document.getElementById('aic-admin-label');
        const setWarning = document.getElementById('aic-set-warning');
        const adminBtn   = document.getElementById('aic-admin-submit');

        function _switchMode(mode) {
            _adminMode = mode;
            const isTambah = mode === 'tambah';
            btnTambah.className  = 'aic-mode-btn' + (isTambah ? ' aic-mode-active' : '');
            btnSet.className     = 'aic-mode-btn' + (!isTambah ? ' aic-mode-active' : '');
            adminLabel.textContent = isTambah ? 'Tambah Credit via MNN-ID' : 'Set Credit via MNN-ID';
            adminBtn.textContent   = isTambah ? 'Tambah Credit' : 'Set Credit';
            setWarning.style.display = isTambah ? 'none' : 'block';
            document.getElementById('aic-admin-result').textContent = '';
        }

        if (btnTambah) btnTambah.addEventListener('click', () => _switchMode('tambah'));
        if (btnSet)    btnSet.addEventListener('click',    () => _switchMode('set'));

        // Admin: submit
        if (adminBtn) {
            adminBtn.addEventListener('click', async () => {
                const uid    = document.getElementById('aic-admin-uid')?.value?.trim();
                const amount = parseInt(document.getElementById('aic-admin-amount')?.value);
                const result = document.getElementById('aic-admin-result');
                const minVal = _adminMode === 'set' ? 0 : 1;

                if (!uid || isNaN(amount) || amount < minVal) {
                    if (result) result.textContent = 'Isi MNN-ID dan jumlah credit dengan benar.';
                    return;
                }

                adminBtn.disabled = true;
                adminBtn.textContent = 'Memproses...';
                if (result) result.textContent = '';

                const isMemberId = /^MNN-/i.test(uid);
                let res;
                if (_adminMode === 'tambah') {
                    res = isMemberId
                        ? await AI_SENSEI.adminAddCreditByMemberId(uid, amount)
                        : await AI_SENSEI.adminAddCredit(uid, amount);
                } else {
                    res = isMemberId
                        ? await AI_SENSEI.adminSetCreditByMemberId(uid, amount)
                        : await AI_SENSEI.adminSetCredit(uid, amount);
                }

                adminBtn.disabled = false;
                adminBtn.textContent = _adminMode === 'tambah' ? 'Tambah Credit' : 'Set Credit';

                if (result) {
                    if (res.success) {
                        const action = _adminMode === 'tambah' ? 'ditambahkan ke' : 'di-set ke';
                        const detail = _adminMode === 'set'
                            ? ' (sebelum: ' + res.creditSebelum + ' → sesudah: ' + res.creditSesudah + ')'
                            : '';
                        result.textContent = 'Berhasil! ' + amount + ' credit ' + action + ' ' + uid +
                            (res.email ? ' (' + res.email + ')' : '') + detail;
                    } else {
                        result.textContent = 'Gagal: ' + res.error;
                    }
                    result.className = 'aic-admin-result ' + (res.success ? 'aic-admin-ok' : 'aic-admin-err');
                }
            });
        }
    }

    // ─────────────────────────────────────────────────────
    // TOP UP REQUEST — manual (belum ada payment gateway)
    // ─────────────────────────────────────────────────────

    function openTopUpRequest(credits, price) {
        const memberId = window.AUTH?.user?.memberId || window.AUTH?.user?.uid || '-';
        const existing = document.getElementById('aic-topup-modal');
        if (existing) existing.remove();

        const waMsg = encodeURIComponent(
            'Halo Admin MNN Learning, saya ingin top up credit AI Sensei.\n\n' +
            'MNN-ID: ' + memberId + '\n' +
            'Paket: ' + credits + ' credit (' + price + ')\n\n' +
            'Saya sudah transfer via QRIS. Mohon dikonfirmasi. Terima kasih!'
        );
        const waUrl = 'https://wa.me/6285601381064?text=' + waMsg;

        const modal = document.createElement('div');
        modal.id = 'aic-topup-modal';
        modal.innerHTML =
            '<div class="ais-popup-box aic-topup-box">' +
            '<button class="aic-topup-close" id="aic-topup-close-btn">&#10005;</button>' +
            '<div class="ais-popup-title">Top Up ' + credits + ' Credit</div>' +
            '<div class="aic-topup-price">' + price + '</div>' +
            '<div class="aic-qris-label">Scan QRIS untuk membayar</div>' +
            '<div class="aic-qris-wrap">' +
                '<img src="/qris.jpeg" alt="QRIS Rawliet.ID" class="aic-qris-img" ' +
                'onclick="AI_CREDIT_PAGE.zoomQris()" style="cursor:zoom-in" title="Tap untuk zoom">' +
            '</div>' +
            '<div class="aic-topup-memberid">MNN-ID kamu: <strong>' + memberId + '</strong></div>' +
            '<div class="aic-topup-note">Setelah bayar, tap tombol di bawah untuk konfirmasi ke admin via WhatsApp.</div>' +
            '<div class="ais-popup-actions" style="flex-direction:column;gap:8px;margin-top:16px">' +
                '<a href="' + waUrl + '" target="_blank" rel="noopener" class="aic-wa-btn">' +
                    '&#128732; Saya Sudah Bayar &mdash; Konfirmasi via WhatsApp' +
                '</a>' +
                '<button class="ais-popup-btn-secondary" id="aic-topup-close-bottom">Batal</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(modal);
        document.getElementById('aic-topup-close-btn').onclick    = () => modal.remove();
        document.getElementById('aic-topup-close-bottom').onclick = () => modal.remove();
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    }

    // PUBLIC
    // ─────────────────────────────────────────────────────
    // ── QRIS Zoom ──
    function zoomQris() {
        const existing = document.getElementById('aic-qris-zoom');
        if (existing) { existing.remove(); return; }
        const overlay = document.createElement('div');
        overlay.id = 'aic-qris-zoom';
        overlay.innerHTML =
            '<div class="aic-qris-zoom-inner">' +
            '<img src="/qris.jpeg" alt="QRIS" class="aic-qris-zoom-img">' +
            '<button class="aic-qris-zoom-close" onclick="document.getElementById(\'aic-qris-zoom\').remove()">&#x2715; Tutup</button>' +
            '</div>';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    return { render, openTopUpRequest, zoomQris };

})();

window.AI_CREDIT_PAGE = AI_CREDIT_PAGE;
