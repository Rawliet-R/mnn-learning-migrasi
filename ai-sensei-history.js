/* ═══════════════════════════════════════════════════════════
   MNN Learning — AI Sensei Chat History
   ai-sensei-history.js

   Firestore path:
     users/{uid}/aiChats/{chatId}
     { title, createdAt, updatedAt, messages: [{role, content, ts}] }

   UI: drawer panel dari kiri, toggle via tombol di header
   ═══════════════════════════════════════════════════════════ */

'use strict';

const AI_HISTORY = (() => {

    let _currentChatId  = null;
    let _currentMsgs    = [];   // [{role, content, ts}]
    let _drawerOpen     = false;

    // ─────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────
    function _userRef() {
        const uid = window.AUTH?.user?.uid;
        if (!uid || window.AUTH?.user?.isGuest || typeof _fbDb === 'undefined') return null;
        return _fbDb.collection('users').doc(uid).collection('aiChats');
    }

    function _truncate(str, n) {
        return str && str.length > n ? str.slice(0, n) + '...' : (str || '');
    }

    // ─────────────────────────────────────────────────────
    // BUAT CHAT BARU
    // ─────────────────────────────────────────────────────
    async function newChat() {
        _currentChatId = null;
        _currentMsgs   = [];
        console.log('[AI_HISTORY] New chat session started');
    }

    // ─────────────────────────────────────────────────────
    // SIMPAN PESAN KE FIRESTORE
    // ─────────────────────────────────────────────────────
    async function saveMessage(role, content) {
        const ref = _userRef();
        if (!ref) return;

        const msg = {
            role,
            content: content.slice(0, 2000), // limit per message
            ts: Date.now()
        };
        _currentMsgs.push(msg);

        try {
            if (!_currentChatId) {
                // Buat dokumen chat baru
                const title = _truncate(
                    role === 'user' ? content : 'Chat baru',
                    40
                );
                const docRef = await ref.add({
                    title,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    messages:  [msg],
                });
                _currentChatId = docRef.id;
                console.log('[AI_HISTORY] Chat created:', _currentChatId);
            } else {
                // Update dokumen yang ada
                await ref.doc(_currentChatId).update({
                    messages:  firebase.firestore.FieldValue.arrayUnion(msg),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            }
        } catch (e) {
            console.warn('[AI_HISTORY] saveMessage error (non-critical):', e.message);
        }
    }

    // ─────────────────────────────────────────────────────
    // LOAD DAFTAR CHAT
    // ─────────────────────────────────────────────────────
    async function loadChatList() {
        const ref = _userRef();
        if (!ref) return [];
        try {
            const snap = await ref
                .orderBy('updatedAt', 'desc')
                .limit(20)
                .get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            // Jika index belum ada, fallback tanpa orderBy
            try {
                const snap2 = await ref.limit(20).get();
                const docs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a, b) => {
                    const ta = a.updatedAt?.seconds || 0;
                    const tb = b.updatedAt?.seconds || 0;
                    return tb - ta;
                });
                return docs;
            } catch (e2) {
                console.warn('[AI_HISTORY] loadChatList error:', e2.message);
                return [];
            }
        }
    }

    // ─────────────────────────────────────────────────────
    // LOAD & RESTORE CHAT LAMA
    // ─────────────────────────────────────────────────────
    async function restoreChat(chatId) {
        const ref = _userRef();
        if (!ref) return;
        try {
            const snap = await ref.doc(chatId).get();
            if (!snap.exists) return;

            const data = snap.data();
            _currentChatId = chatId;
            _currentMsgs   = data.messages || [];

            // Clear UI
            const container = document.getElementById('ais-messages');
            if (!container) return;
            container.innerHTML = '';

            // Render ulang pesan lama
            _currentMsgs.forEach(msg => {
                if (msg.role === 'user') {
                    if (window.AI_SENSEI) AI_SENSEI.appendMessage('user', msg.content);
                } else if (msg.role === 'assistant') {
                    if (window.AI_SENSEI) AI_SENSEI.appendMessage('ai', msg.content);
                }
            });

            // Restore ke AI_SENSEI chat history array (konteks)
            if (window.AI_SENSEI) {
                AI_SENSEI.resetChat();
                _currentMsgs.forEach(m => {
                    if (m.role === 'user' || m.role === 'assistant') {
                        AI_SENSEI.pushHistory({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
                    }
                });
            }

            // Scroll ke bawah
            container.scrollTop = container.scrollHeight;
            closeDrawer();
            console.log('[AI_HISTORY] Chat restored:', chatId, 'msgs:', _currentMsgs.length);
        } catch (e) {
            console.error('[AI_HISTORY] restoreChat error:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────
    // DELETE CHAT
    // ─────────────────────────────────────────────────────
    async function deleteChat(chatId) {
        const ref = _userRef();
        if (!ref) return;
        try {
            await ref.doc(chatId).delete();
            if (chatId === _currentChatId) {
                _currentChatId = null;
                _currentMsgs   = [];
            }
            console.log('[AI_HISTORY] Chat deleted:', chatId);
        } catch (e) {
            console.error('[AI_HISTORY] deleteChat error:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────
    // DRAWER UI
    // ─────────────────────────────────────────────────────
    function toggleDrawer() {
        _drawerOpen ? closeDrawer() : openDrawer();
    }

    async function openDrawer() {
        _drawerOpen = true;
        const drawer = document.getElementById('ais-history-drawer');
        const overlay = document.getElementById('ais-history-overlay');
        if (!drawer || !overlay) return;

        drawer.classList.add('open');
        overlay.classList.add('open');

        // Load dan render daftar chat
        const list = document.getElementById('ais-history-list');
        if (list) {
            list.innerHTML = '<div class="aish-loading">Memuat riwayat...</div>';
            const chats = await loadChatList();
            if (!chats.length) {
                list.innerHTML = '<div class="aish-empty">Belum ada riwayat chat.</div>';
                return;
            }
            list.innerHTML = chats.map(chat => {
                const date = chat.updatedAt?.toDate
                    ? chat.updatedAt.toDate().toLocaleDateString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})
                    : '';
                const isActive = chat.id === _currentChatId ? ' aish-item-active' : '';
                return '<div class="aish-item' + isActive + '" data-id="' + chat.id + '">' +
                    '<div class="aish-item-title">' + _truncate(chat.title || 'Chat', 38) + '</div>' +
                    '<div class="aish-item-date">' + date + '</div>' +
                    '<button class="aish-item-del" data-id="' + chat.id + '" aria-label="Hapus">&#x2715;</button>' +
                '</div>';
            }).join('');

            // Bind events
            list.querySelectorAll('.aish-item').forEach(el => {
                el.addEventListener('click', e => {
                    if (e.target.classList.contains('aish-item-del')) return;
                    restoreChat(el.dataset.id);
                });
            });
            list.querySelectorAll('.aish-item-del').forEach(btn => {
                btn.addEventListener('click', async e => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    await deleteChat(id);
                    btn.closest('.aish-item').remove();
                    if (!list.querySelector('.aish-item')) {
                        list.innerHTML = '<div class="aish-empty">Belum ada riwayat chat.</div>';
                    }
                });
            });
        }
    }

    function closeDrawer() {
        _drawerOpen = false;
        document.getElementById('ais-history-drawer')?.classList.remove('open');
        document.getElementById('ais-history-overlay')?.classList.remove('open');
    }

    // ─────────────────────────────────────────────────────
    // PUBLIC
    // ─────────────────────────────────────────────────────
    return {
        newChat,
        saveMessage,
        restoreChat,
        deleteChat,
        loadChatList,
        toggleDrawer,
        openDrawer,
        closeDrawer,
        getCurrentChatId: () => _currentChatId,
        pushHistory: (msg) => { _currentMsgs.push(msg); },
    };

})();

window.AI_HISTORY = AI_HISTORY;
