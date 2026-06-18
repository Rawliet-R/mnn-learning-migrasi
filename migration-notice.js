/**
 * MNN Learning — Migration Notice  (v2)
 * ─────────────────────────────────────────────────────────────
 * Upgraded from a small top-banner to a prominent bottom card
 * that is hard to miss but never blocks the app.
 *
 * Behavior:
 *  - Shown only when running on the legacy Netlify domain
 *    (hostname contains "netlify.app" or "netlify.com",
 *     or is NOT rawliet-app.uk / www.rawliet-app.uk).
 *  - Shown at most once per browser  (localStorage flag).
 *  - "Update Sekarang" opens rawliet-app.uk/download — the APK
 *    download page — in the same tab (explicit user action only).
 *  - "Nanti" dismisses the card and sets the seen flag.
 *  - NEVER auto-redirects.
 *  - Does not modify any existing app UI or logic.
 *
 * To retire: remove <script src="migration-notice.js"> from
 * index.html (and its entry in sw.js LOCAL_ASSETS).
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  var PRIMARY_HOSTS   = ['rawliet-app.uk', 'www.rawliet-app.uk'];
  var DOWNLOAD_URL    = 'https://rawliet-app.uk/download';
  var STORAGE_KEY     = 'mnn_migration_notice_seen_v2';

  // ── Helpers ─────────────────────────────────────────────────
  function isOnPrimaryDomain() {
    var h = window.location.hostname;
    return PRIMARY_HOSTS.indexOf(h) !== -1 || h === 'localhost' || h === '127.0.0.1';
  }

  function isNetlifyDomain() {
    var h = window.location.hostname;
    return h.indexOf('netlify.app') !== -1 || h.indexOf('netlify.com') !== -1;
  }

  function hasBeenSeen() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, '1'); }
    catch (e) { /* storage unavailable — fail safe */ }
  }

  function injectStyles() {
    if (document.getElementById('mnn-mig-style')) return;

    var css = [
      /* Backdrop overlay */
      '#mnn-mig-backdrop{',
        'position:fixed;inset:0;z-index:9990;',
        'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);',
        'animation:mnnFadeIn .3s ease;',
      '}',
      '@keyframes mnnFadeIn{from{opacity:0}to{opacity:1}}',

      /* Bottom card */
      '#mnn-mig-card{',
        'position:fixed;left:0;right:0;bottom:0;z-index:9991;',
        'background:#1e1e2e;',
        'border-top:1.5px solid rgba(167,139,250,.3);',
        'border-radius:28px 28px 0 0;',
        'padding:28px 24px calc(28px + env(safe-area-inset-bottom));',
        'max-width:560px;margin:0 auto;',
        'box-shadow:0 -12px 60px rgba(0,0,0,.5);',
        'animation:mnnSlideUp .38s cubic-bezier(.34,1.56,.64,1);',
        'font-family:"DM Sans",sans-serif;',
      '}',
      '@keyframes mnnSlideUp{',
        'from{transform:translateY(100%);opacity:0}',
        'to{transform:translateY(0);opacity:1}',
      '}',

      /* Badge */
      '#mnn-mig-badge{',
        'display:inline-flex;align-items:center;gap:6px;',
        'padding:4px 12px;border-radius:99px;',
        'background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.22);',
        'color:#a78bfa;font-size:12px;font-weight:700;',
        'margin-bottom:14px;',
      '}',

      /* Heading */
      '#mnn-mig-card h2{',
        'font-size:20px;font-weight:800;',
        'color:#e8e8f0;margin-bottom:8px;line-height:1.3;',
      '}',

      /* Body text */
      '#mnn-mig-card p{',
        'font-size:14px;color:#a0a0b8;line-height:1.65;margin-bottom:22px;',
      '}',

      /* Feature list */
      '#mnn-mig-features{',
        'list-style:none;display:flex;flex-direction:column;gap:6px;',
        'margin-bottom:24px;',
      '}',
      '#mnn-mig-features li{',
        'display:flex;align-items:center;gap:8px;',
        'font-size:13px;color:#a0a0b8;',
      '}',
      '#mnn-mig-features li span.icon{',
        'flex-shrink:0;width:22px;height:22px;border-radius:6px;',
        'background:rgba(167,139,250,.12);',
        'display:flex;align-items:center;justify-content:center;font-size:12px;',
      '}',

      /* CTA button */
      '#mnn-mig-cta{',
        'display:flex;align-items:center;justify-content:center;gap:8px;',
        'width:100%;padding:16px;border-radius:16px;border:none;',
        'background:linear-gradient(135deg,#a78bfa,#f472b6);',
        'color:#fff;font-family:"DM Sans",sans-serif;',
        'font-size:17px;font-weight:800;cursor:pointer;',
        'box-shadow:0 8px 28px rgba(167,139,250,.3);',
        'transition:opacity .2s,transform .15s;',
        'margin-bottom:12px;',
      '}',
      '#mnn-mig-cta:hover{opacity:.92}',
      '#mnn-mig-cta:active{transform:scale(.98)}',

      /* Dismiss link */
      '#mnn-mig-dismiss{',
        'display:block;text-align:center;',
        'font-size:13px;color:#64648a;',
        'background:none;border:none;',
        'font-family:"DM Sans",sans-serif;',
        'cursor:pointer;padding:6px;',
        'text-decoration:underline;',
        'transition:color .2s;',
      '}',
      '#mnn-mig-dismiss:hover{color:#a0a0b8}',

      /* Desktop: left-align card */
      '@media (min-width:600px){',
        '#mnn-mig-card{',
          'left:50%;right:auto;',
          'transform:translateX(-50%) translateY(0);',
          'width:560px;border-radius:28px 28px 0 0;',
        '}',
        '@keyframes mnnSlideUp{',
          'from{transform:translateX(-50%) translateY(100%);opacity:0}',
          'to{transform:translateX(-50%) translateY(0);opacity:1}',
        '}',
      '}',
    ].join('');

    var style = document.createElement('style');
    style.id = 'mnn-mig-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showCard() {
    injectStyles();

    // ── Backdrop ──
    var backdrop = document.createElement('div');
    backdrop.id = 'mnn-mig-backdrop';
    document.body.appendChild(backdrop);

    // ── Card ──
    var card = document.createElement('div');
    card.id = 'mnn-mig-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', 'Versi baru MNN Learning tersedia');

    card.innerHTML = [
      '<div id="mnn-mig-badge">',
        '<span>🚀</span> Versi Baru Tersedia',
      '</div>',
      '<h2>MNN Learning telah pindah!</h2>',
      '<p>',
        'Kamu masih menggunakan versi lama yang berjalan di Netlify. ',
        'Versi terbaru sudah tersedia di <strong>rawliet-app.uk</strong> ',
        '— lebih cepat, lebih stabil, dan terus diperbarui.',
      '</p>',
      '<ul id="mnn-mig-features">',
        '<li><span class="icon">⚡</span> Performa lebih cepat di Vercel</li>',
        '<li><span class="icon">📦</span> APK Android terbaru tersedia</li>',
        '<li><span class="icon">🔄</span> Update otomatis tanpa reinstall (PWA)</li>',
        '<li><span class="icon">🔐</span> Login akun tetap berfungsi normal</li>',
      '</ul>',
      '<button id="mnn-mig-cta" type="button">',
        '📱 Update Sekarang',
      '</button>',
      '<button id="mnn-mig-dismiss" type="button">',
        'Nanti saja',
      '</button>',
    ].join('');

    document.body.appendChild(card);

    function remove() {
      markSeen();
      card.style.animation = 'none';
      card.style.transform = 'translateY(100%)';
      card.style.opacity = '0';
      card.style.transition = 'transform .3s ease, opacity .3s ease';
      backdrop.style.opacity = '0';
      backdrop.style.transition = 'opacity .3s ease';
      setTimeout(function () {
        card.remove();
        backdrop.remove();
      }, 320);
    }

    // CTA — explicit navigation only
    document.getElementById('mnn-mig-cta').addEventListener('click', function () {
      markSeen();
      window.location.href = DOWNLOAD_URL; // user-initiated only
    });

    // Dismiss
    document.getElementById('mnn-mig-dismiss').addEventListener('click', remove);
    backdrop.addEventListener('click', remove);
  }

  function init() {
    if (isOnPrimaryDomain()) return;  // already on the right host
    if (hasBeenSeen()) return;         // shown & dismissed before

    if (document.body) {
      showCard();
    } else {
      document.addEventListener('DOMContentLoaded', showCard);
    }
  }

  init();
})();
