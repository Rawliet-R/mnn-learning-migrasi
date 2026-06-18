/**
 * MNN Learning — Migration Notice (v1)
 * ──────────────────────────────────────────────────────────────
 * Soft, non-intrusive "new version available" banner.
 *
 * Behavior:
 *  - Shown only when the app is NOT being served from the new
 *    primary domain (PRIMARY_HOST below).
 *  - Shown at most once per browser (localStorage flag) — dismissing
 *    it, or tapping "Open new version", both mark it as seen.
 *  - NEVER auto-redirects. Navigation only happens on explicit click.
 *  - Does not block, delay, or alter any existing app UI/logic —
 *    it only appends a small floating bar to <body>.
 *
 * To retire this feature once migration is complete, simply remove
 * the <script src="migration-notice.js"> tag from index.html (and
 * its entry in sw.js's LOCAL_ASSETS) — nothing else depends on it.
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  var PRIMARY_HOST = 'rawliet-app.uk';
  var NEW_VERSION_URL = 'https://' + PRIMARY_HOST;
  var STORAGE_KEY = 'mnn_migration_notice_seen_v1';

  // ── Helpers ─────────────────────────────────────────────────
  function isOnPrimaryDomain() {
    var h = window.location.hostname;
    return h === PRIMARY_HOST || h === 'www.' + PRIMARY_HOST;
  }

  function hasBeenSeen() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false; // if storage is unavailable, fail safe (don't show repeatedly is best-effort only)
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (e) {
      /* ignore — private mode / storage disabled */
    }
  }

  function injectStyles() {
    if (document.getElementById('mnn-migration-banner-style')) return;
    var css =
      '#mnn-migration-banner{position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'display:flex;align-items:center;gap:10px;padding:10px 14px;' +
      'padding-top:calc(10px + env(safe-area-inset-top));' +
      'background:linear-gradient(135deg,#a78bfa,#f472b6);color:#fff;' +
      'font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.25);animation:mnnBannerSlide .35s ease;}' +
      '@keyframes mnnBannerSlide{from{transform:translateY(-100%)}to{transform:translateY(0)}}' +
      '#mnn-migration-banner .mnn-mb-text{flex:1;min-width:0;line-height:1.4;}' +
      '#mnn-migration-banner button{font-family:inherit;cursor:pointer;border:none;}' +
      '#mnn-migration-banner .mnn-mb-cta{flex-shrink:0;padding:7px 14px;border-radius:10px;' +
      'background:#fff;color:#7c3aed;font-weight:700;font-size:12px;white-space:nowrap;}' +
      '#mnn-migration-banner .mnn-mb-close{flex-shrink:0;width:26px;height:26px;border-radius:50%;' +
      'background:rgba(255,255,255,.22);color:#fff;font-size:16px;line-height:1;}' +
      '@media (min-width:640px){#mnn-migration-banner{font-size:14px;}}';
    var style = document.createElement('style');
    style.id = 'mnn-migration-banner-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showBanner() {
    injectStyles();

    var bar = document.createElement('div');
    bar.id = 'mnn-migration-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span class="mnn-mb-text">A new version of MNN Learning is available</span>' +
      '<button type="button" class="mnn-mb-cta" id="mnn-mb-open">Open new version</button>' +
      '<button type="button" class="mnn-mb-close" id="mnn-mb-close" aria-label="Tutup">&times;</button>';
    document.body.appendChild(bar);

    document.getElementById('mnn-mb-open').addEventListener('click', function () {
      markSeen();
      window.location.href = NEW_VERSION_URL; // explicit user action only — no auto-redirect
    });
    document.getElementById('mnn-mb-close').addEventListener('click', function () {
      markSeen();
      bar.remove();
    });
  }

  function init() {
    if (isOnPrimaryDomain()) return; // already on the new host — nothing to announce
    if (hasBeenSeen()) return; // show only once

    if (document.body) {
      showBanner();
    } else {
      document.addEventListener('DOMContentLoaded', showBanner);
    }
  }

  init();
})();
