/**
 * MNN Exam Engine v9.0
 * UI: Bigger Next button, Previous button (non-Choukai), Choukai no-Previous, Section lock
 *
 * v9.0 changes over v8:
 *  ── UI IMPROVEMENTS ────────────────────────────────────────────────────────
 *  1. [UI] Tombol Next/Selesai diperbesar: height 54px, padding lebih lebar,
 *     posisi naik sedikit dari bawah layar dengan bottom safe-area padding.
 *
 *  2. [NEW] Tombol Previous untuk section: kanji_kotoba, expression, dokkai.
 *     - Navigasi bebas maju-mundur dalam section yang sama.
 *     - Jawaban lama tersimpan; memilih jawaban baru menimpa jawaban lama.
 *     - Tampil [← Sebelumnya] [Selanjutnya →] berdampingan.
 *
 *  3. [RULE] Choukai: TIDAK ADA tombol Previous.
 *     Sesuai pengalaman ujian asli — setelah lanjut, tidak bisa kembali,
 *     tidak bisa mengulang audio, tidak bisa mengubah jawaban.
 *
 *  4. [RULE] Section lock: section yang sudah selesai dikunci.
 *     User tidak bisa kembali ke section sebelumnya setelah pindah section.
 *
 *  ── PRESERVED ──────────────────────────────────────────────────────────────
 *  Semua logika v8 (grouped shuffle, diagnostic log, choukai audio, dedup)
 *  dipertahankan verbatim.
 */

(function (global) {
  'use strict';

  const SECTION_ORDER = ['kanji_kotoba', 'expression', 'choukai', 'dokkai'];

  const SECTION_META = {
    kanji_kotoba: { label: '文字・語彙', labelSub: 'Kanji & Kotoba', icon: '漢', color: '#22c55e', colorDim: '#052e16' },
    expression:   { label: '表現',       labelSub: 'Expression',      icon: '文', color: '#2dd4bf', colorDim: '#042f2a' },
    choukai:      { label: '聴解',       labelSub: 'Choukai',         icon: '聴', color: '#facc15', colorDim: '#3f2d03' },
    dokkai:       { label: '読解',       labelSub: 'Dokkai',          icon: '読', color: '#4ade80', colorDim: '#052e16' },
  };

  const CHOUKAI_MAX_PLAYS = 2;

  // Sections yang punya tombol Previous
  const SECTIONS_WITH_PREV = new Set(['kanji_kotoba', 'expression', 'dokkai']);

  // ─── STATE ─────────────────────────────────────────────────────────────────
  const _state = {
    initialized: false, running: false,
    config: null, container: null,
    sections: [], sectionIndex: 0, questionIndex: 0,
    selectedChoice: null, answered: false,
    answers: {}, scores: {}, startTime: null, endTime: null,
    timer: { intervalId: null, remaining: 0, totalSeconds: 0 },
    audioPlayCount: {}, audioUnlocked: {}, passageExpanded: {},
    // v9: per-question saved answers (for Previous navigation)
    // key: `${sectionName}_${questionIndex}` → chosen index
    savedChoices: {},
  };

  // ─── UTILITIES ─────────────────────────────────────────────────────────────

  function _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function _groupedShuffle(arr, groupKey) {
    if (!arr.length) return [];
    if (!groupKey) return _shuffle(arr);
    const groupIndex = new Map();
    const groups     = [];
    arr.forEach(item => {
      const raw    = item[groupKey];
      const isReal = raw && raw !== 'None';
      const mapKey = isReal ? raw : '\x00solo\x00' + item.id;
      if (!groupIndex.has(mapKey)) {
        groupIndex.set(mapKey, groups.length);
        groups.push([item]);
      } else {
        groups[groupIndex.get(mapKey)].push(item);
      }
    });
    const shuffledGroups = _shuffle(groups);
    return shuffledGroups.flat();
  }

  function _buildSections(data) {
    return SECTION_ORDER.map(sName => {
      const src = data[sName] || [];
      let out;
      if (sName === 'choukai') {
        out = _groupedShuffle(src, 'audio_id');
      } else if (sName === 'dokkai') {
        out = _groupedShuffle(src, 'passage_id');
      } else {
        out = _shuffle(src);
      }
      _diagnosticLog(sName, src, out);
      return out;
    });
  }

  function _diagnosticLog(sName, src, out) {
    const srcIds  = src.map(q => q.id);
    const outIds  = out.map(q => q.id);
    const srcSet  = new Set(srcIds);
    const outSet  = new Set(outIds);
    const seen = {}; const dups = [];
    outIds.forEach(id => { seen[id] = (seen[id] || 0) + 1; if (seen[id] === 2) dups.push(id); });
    const srcSeen = {}; const srcDups = [];
    srcIds.forEach(id => { srcSeen[id] = (srcSeen[id] || 0) + 1; if (srcSeen[id] === 2) srcDups.push(id); });
    console.groupCollapsed(`[MNNDiagnostic] ${sName}`);
    console.log('  total soal source   :', src.length);
    console.log('  total soal unik     :', srcSet.size, srcDups.length ? `⚠ SOURCE DUPS: ${srcDups.join(', ')}` : '✓');
    console.log('  total setelah shuffle:', out.length);
    console.log('  unik setelah shuffle :', outSet.size, dups.length ? `⚠ SHUFFLE DUPS: ${dups.join(', ')}` : '✓');
    if (dups.length > 0) { console.error('  ⚠ DUPLICATE question_id ditemukan:', dups); } else { console.log('  duplicate question_id: NONE ✓'); }
    if (sName === 'choukai' || sName === 'dokkai') {
      const gKey = sName === 'choukai' ? 'audio_id' : 'passage_id';
      const gMap = {};
      out.forEach(q => { const k = q[gKey] && q[gKey] !== 'None' ? q[gKey] : null; if (k) { gMap[k] = (gMap[k] || 0) + 1; } });
      const multiGroups = Object.entries(gMap).filter(([,n]) => n > 1);
      if (multiGroups.length) {
        console.log('  kelompok soal (grouped shuffle):');
        multiGroups.forEach(([k, n]) => console.log(`    ${k} → ${n} soal (berurutan ①②)`));
      }
    }
    console.groupEnd();
  }

  function _qs(sel, p) { return (p || document).querySelector(sel); }
  function _formatTime(ms) { const s = Math.floor(ms / 1000), m = Math.floor(s / 60); return m + 'm ' + (s % 60).toString().padStart(2, '0') + 's'; }
  function _formatCountdown(s) { const m = Math.floor(s / 60); return m.toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0'); }
  function _pct(c, t) { return t ? Math.round(c / t * 100) : 0; }
  function _audioSrc(audioId) { const map = _state.config.audioMap || {}; const raw = map[audioId]; if (!raw) return null; return encodeURI(raw); }
  function _fmtAudioTime(secs) { if (!secs || isNaN(secs)) return '0:00'; const m = Math.floor(secs / 60), s = Math.floor(secs % 60); return m + ':' + s.toString().padStart(2, '0'); }
  function _cleanChoice(text) { const m = /^\[選択肢[A-Z]:\s*(.*?)\]$/s.exec(text); return m ? m[1].trim() : text; }

  // ─── v9: Saved choice key ─────────────────────────────────────────────────
  function _savedKey(sName, qIdx) { return sName + '_' + qIdx; }

  // ─── CSS INJECTION ─────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('mnn-exam-styles')) return;
    const style = document.createElement('style');
    style.id = 'mnn-exam-styles';
    style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Noto+Sans+JP:wght@400;500;700&display=swap');

:root,
#mnn-exam-root {
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px;
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 20px; --r-pill: 999px;
  --primary: #16a34a; --primary-strong: #15803d;
  --primary-soft: rgba(22,163,74,0.12); --primary-soft-strong: rgba(22,163,74,0.20);
  --on-primary: #ffffff;
  --success: #16a34a; --success-soft: rgba(22,163,74,0.12);
  --danger: #e11d48;  --danger-soft: rgba(225,29,72,0.10);
  --warning: #d97706; --warning-soft: rgba(217,119,6,0.12);
  --shadow-sm: 0 1px 2px rgba(15,23,20,0.06);
  --shadow-md: 0 4px 16px rgba(15,23,20,0.08);
  --shadow-lg: 0 12px 32px rgba(15,23,20,0.12);
  font-family: 'Plus Jakarta Sans', 'Noto Sans JP', system-ui, sans-serif;
}

#mnn-exam-root,
#mnn-exam-root[data-theme="light"] {
  --bg:#f4f7f5; --surface:#ffffff; --card:#ffffff; --card-muted:#eef3f0;
  --text:#11201a; --text-secondary:#5d6f67; --text-tertiary:#94a39d;
  --border:#e2e9e5; --border-strong:#cbd6d0;
  --header-bg:rgba(255,255,255,0.85); --on-card-img:#ffffff;
}

#mnn-exam-root[data-theme="dark"] {
  --bg:#0b1310; --surface:#121b17; --card:#16201c; --card-muted:#1c2823;
  --text:#eef5f1; --text-secondary:#9bb3a8; --text-tertiary:#61756c;
  --border:rgba(255,255,255,0.08); --border-strong:rgba(255,255,255,0.14);
  --header-bg:rgba(11,19,16,0.85); --on-card-img:#ffffff;
  --primary-soft:rgba(34,197,94,0.16); --primary-soft-strong:rgba(34,197,94,0.26);
  --success-soft:rgba(34,197,94,0.16); --danger-soft:rgba(244,63,94,0.16);
  --warning-soft:rgba(250,204,21,0.14);
  --shadow-sm:0 1px 2px rgba(0,0,0,0.3); --shadow-md:0 4px 16px rgba(0,0,0,0.4); --shadow-lg:0 12px 32px rgba(0,0,0,0.5);
}

@media (prefers-color-scheme: dark) {
  #mnn-exam-root[data-theme="auto"] {
    --bg:#0b1310; --surface:#121b17; --card:#16201c; --card-muted:#1c2823;
    --text:#eef5f1; --text-secondary:#9bb3a8; --text-tertiary:#61756c;
    --border:rgba(255,255,255,0.08); --border-strong:rgba(255,255,255,0.14);
    --header-bg:rgba(11,19,16,0.85);
    --primary-soft:rgba(34,197,94,0.16); --primary-soft-strong:rgba(34,197,94,0.26);
    --success-soft:rgba(34,197,94,0.16); --danger-soft:rgba(244,63,94,0.16);
    --warning-soft:rgba(250,204,21,0.14);
    --shadow-sm:0 1px 2px rgba(0,0,0,0.3); --shadow-md:0 4px 16px rgba(0,0,0,0.4); --shadow-lg:0 12px 32px rgba(0,0,0,0.5);
  }
}

#mnn-exam-root {
  background: var(--bg); color: var(--text); height: 100%;
  display: flex; flex-direction: column; overflow: hidden;
  -webkit-tap-highlight-color: transparent; -webkit-font-smoothing: antialiased;
  transition: background-color .25s ease, color .25s ease;
  zoom: 0.94;
}
:where(#mnn-exam-root) * { box-sizing: border-box; margin: 0; padding: 0; }

@keyframes fadeUp  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@keyframes fadeIn  { from{opacity:0} to{opacity:1} }
@keyframes scaleIn { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }
@keyframes pop     { 0%{transform:scale(1)} 50%{transform:scale(1.02)} 100%{transform:scale(1)} }
@keyframes shake   { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
@keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
@keyframes barIn   { from{width:0} }
@property --ring-pct { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
@keyframes ringReveal { from { --ring-pct: 0%; } }
@keyframes pageIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

@media (prefers-reduced-motion: reduce) {
  #mnn-exam-root *, #mnn-exam-root *::before, #mnn-exam-root *::after {
    animation-duration: 0.01ms !important; transition-duration: 0.01ms !important;
  }
}

/* ── HEADER ── */
.mnn-header {
  flex-shrink: 0; background: var(--header-bg);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border); z-index: 100;
  padding: var(--sp-3) var(--sp-4) var(--sp-3);
}
.mnn-header-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--sp-2); }
.mnn-header-brand { font-size:10px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--text-tertiary); }
.mnn-header-actions { display:flex; align-items:center; gap:var(--sp-2); }
.mnn-section-dots { display:flex; gap:5px; align-items:center; }
.mnn-dot { width:6px; height:6px; border-radius:var(--r-pill); background:var(--border-strong); transition:all .3s; }
.mnn-dot.done   { background:var(--primary); }
.mnn-dot.active { width:18px; background:var(--primary); }

.mnn-theme-toggle { display:flex; align-items:center; gap:2px; background:var(--card-muted); border:1px solid var(--border); border-radius:var(--r-pill); padding:2px; }
.mnn-theme-btn { width:26px; height:26px; border-radius:var(--r-pill); border:none; background:transparent; color:var(--text-tertiary); display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; transition:all .15s; -webkit-tap-highlight-color:transparent; }
.mnn-theme-btn.active { background:var(--card); color:var(--primary); box-shadow:var(--shadow-sm); }

.mnn-timer-block { text-align:center; padding:var(--sp-1) 0; }
.mnn-timer-value { font-size:44px; font-weight:900; letter-spacing:-0.03em; font-variant-numeric:tabular-nums; color:var(--text); line-height:1; transition:color .3s; }
.mnn-timer-value.warn { color:var(--danger); animation:pulse 1.2s ease infinite; }
.mnn-timer-caption { font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--text-tertiary); margin-top:2px; }

.mnn-header-section { display:flex; align-items:baseline; justify-content:center; gap:var(--sp-2); margin-top:var(--sp-2); }
.mnn-section-label { font-size:15px; font-weight:700; color:var(--section-color, var(--primary)); }
.mnn-section-tag { font-size:11px; font-weight:600; color:var(--text-tertiary); }

.mnn-progress-row { display:flex; align-items:center; gap:var(--sp-2); margin-top:var(--sp-3); }
.mnn-prog-track { flex:1; height:5px; background:var(--card-muted); border-radius:var(--r-pill); overflow:hidden; }
.mnn-prog-fill { height:100%; background:var(--section-color, var(--primary)); border-radius:var(--r-pill); transition:width .4s cubic-bezier(.4,0,.2,1); }
.mnn-prog-pct { font-size:11px; font-weight:700; color:var(--section-color, var(--primary)); min-width:32px; text-align:right; font-variant-numeric:tabular-nums; }

/* ── SCROLL BODY ── */
.mnn-scroll-body { flex:1; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; padding:var(--sp-4); scroll-behavior:smooth; }

/* ── FULL PAGE ── */
.mnn-page { flex:1; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; background:var(--bg); animation:pageIn .25s ease both; }
.mnn-page-topbar { display:flex; justify-content:flex-end; padding:var(--sp-3) var(--sp-4) 0; }

/* ── Question card ── */
.mnn-question-card { width:100%; max-width:600px; margin:0 auto; display:flex; flex-direction:column; gap:var(--sp-4); animation:fadeUp .25s ease both; }
.mnn-q-meta { display:flex; align-items:center; gap:var(--sp-2); }
.mnn-q-num { width:30px; height:30px; border-radius:var(--r-pill); flex-shrink:0; background:var(--section-color, var(--primary)); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:var(--on-primary); }
.mnn-q-chip { font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; padding:4px var(--sp-2); border-radius:var(--r-pill); background:var(--card-muted); color:var(--section-color, var(--primary)); border:1px solid color-mix(in srgb, var(--section-color, var(--primary)) 25%, transparent); }
.mnn-q-of { margin-left:auto; font-size:12px; font-weight:600; color:var(--text-tertiary); font-variant-numeric:tabular-nums; }

/* ── Passage ── */
.mnn-passage-box { background:var(--card); border:1px solid var(--border); border-radius:var(--r-lg); padding:var(--sp-4); font-size:15px; line-height:1.95; color:var(--text); box-shadow:var(--shadow-sm); }
.mnn-passage-label { font-size:10px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--section-color, var(--primary)); margin-bottom:var(--sp-3); display:flex; align-items:center; gap:6px; }
.mnn-passage-collapsed { display:flex; align-items:center; gap:var(--sp-3); background:var(--card-muted); border:1px dashed var(--border-strong); border-radius:var(--r-lg); padding:var(--sp-3) var(--sp-4); font-size:13px; color:var(--text-secondary); }
.mnn-passage-collapsed-icon { font-size:15px; flex-shrink:0; }
.mnn-passage-collapsed-text { flex:1; line-height:1.5; }
.mnn-passage-toggle { font-size:12px; font-weight:700; color:var(--primary); background:none; border:none; cursor:pointer; flex-shrink:0; padding:var(--sp-1) var(--sp-2); border-radius:var(--r-sm); -webkit-tap-highlight-color:transparent; }
.mnn-passage-toggle:hover { background:var(--primary-soft); }
.mnn-passage-box.is-collapsible { animation:fadeIn .2s ease; }

/* ── Image ── */
.mnn-image-container { width:100%; margin:0; border-radius:var(--r-lg); overflow:hidden; border:1px solid var(--border); background:var(--on-card-img); box-shadow:var(--shadow-sm); display:flex; align-items:center; justify-content:center; max-height:340px; }
.mnn-image-container img { display:block; width:auto; height:auto; max-width:100%; max-height:340px; object-fit:contain; }
.mnn-image-fallback { display:none; padding:var(--sp-4); text-align:center; color:var(--text-tertiary); font-size:12px; }
.mnn-image-container.img-failed { max-height:none; }
.mnn-image-container.img-failed .mnn-image-fallback { display:block; }
.mnn-image-container.img-failed img { display:none; }

/* ── Question text ── */
.mnn-question-text { background:var(--card); border:1px solid var(--border); border-radius:var(--r-lg); padding:var(--sp-4); font-size:17px; font-weight:600; line-height:1.75; color:var(--text); box-shadow:var(--shadow-sm); }

/* ── Choices ── */
.mnn-choices { display:flex; flex-direction:column; gap:var(--sp-2); }
.mnn-choice { display:flex; align-items:center; gap:var(--sp-3); padding:var(--sp-3); min-height:56px; border-radius:var(--r-lg); border:1.5px solid var(--border); background:var(--card); cursor:pointer; transition:border-color .15s, background .15s, transform .1s, box-shadow .15s; color:var(--text); text-align:left; width:100%; -webkit-tap-highlight-color:transparent; box-shadow:var(--shadow-sm); }
.mnn-choice:active:not(.disabled) { transform:scale(.98); }
.mnn-choice:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
.mnn-choice:hover:not(.disabled):not(.selected) { border-color:color-mix(in srgb, var(--section-color, var(--primary)) 45%, var(--border)); background:color-mix(in srgb, var(--section-color, var(--primary)) 5%, var(--card)); }
.mnn-choice.selected { border-color:var(--section-color, var(--primary)); background:var(--primary-soft); box-shadow:0 0 0 3px color-mix(in srgb, var(--section-color, var(--primary)) 16%, transparent); animation:pop .2s cubic-bezier(.34,1.56,.64,1) both; }
.mnn-choice.correct { border-color:var(--success); background:var(--success-soft); color:var(--success); }
.mnn-choice.wrong   { border-color:var(--danger);  background:var(--danger-soft);  color:var(--danger); animation:shake .35s ease both; }
.mnn-choice.disabled { cursor:default; pointer-events:none; }
.mnn-choices.audio-locked .mnn-choice { opacity:.4; cursor:not-allowed; pointer-events:none; }

.mnn-choice-letter { width:32px; height:32px; border-radius:var(--r-pill); flex-shrink:0; background:var(--card-muted); border:1.5px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:var(--text-secondary); transition:all .15s; }
.mnn-choice.selected .mnn-choice-letter { background:var(--section-color, var(--primary)); border-color:var(--section-color, var(--primary)); color:var(--on-primary); }
.mnn-choice.correct  .mnn-choice-letter { background:var(--success); border-color:var(--success); color:var(--on-primary); }
.mnn-choice.wrong    .mnn-choice-letter { background:var(--danger);  border-color:var(--danger);  color:var(--on-primary); }

.mnn-choice-text { flex:1; font-size:15px; font-weight:500; line-height:1.5; }
.mnn-choice-icon { font-size:15px; flex-shrink:0; opacity:0; transition:opacity .2s; width:18px; text-align:center; }
.mnn-choice.correct .mnn-choice-icon { opacity:1; }
.mnn-choice.correct .mnn-choice-icon::after { content:'✓'; color:var(--success); }
.mnn-choice.wrong   .mnn-choice-icon { opacity:1; }
.mnn-choice.wrong   .mnn-choice-icon::after { content:'✕'; color:var(--danger); }

/* ── Audio unlock hint ── */
.mnn-audio-unlock-hint { display:flex; align-items:center; justify-content:center; gap:var(--sp-2); padding:var(--sp-3) var(--sp-4); border-radius:var(--r-lg); background:var(--warning-soft); border:1px solid color-mix(in srgb, var(--warning) 30%, transparent); font-size:13px; font-weight:600; color:var(--warning); animation:fadeIn .3s ease; }
.mnn-audio-unlock-hint.hidden { display:none; }

/* ── Choukai audio card ── */
.mnn-audio-card { background:var(--card); border:1px solid var(--border); border-radius:var(--r-lg); padding:var(--sp-4); box-shadow:var(--shadow-sm); }
.mnn-audio-header { display:flex; align-items:center; gap:var(--sp-2); margin-bottom:var(--sp-3); }
.mnn-audio-badge { display:flex; align-items:center; gap:4px; font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; padding:3px var(--sp-2); border-radius:var(--r-pill); background:var(--primary-soft); color:var(--primary); border:1px solid color-mix(in srgb, var(--primary) 30%, transparent); }
.mnn-audio-title  { font-size:12px; font-weight:600; color:var(--text-secondary); flex:1; font-variant-numeric:tabular-nums; }
.mnn-audio-plays  { font-size:11px; font-weight:700; color:var(--text-tertiary); }
.mnn-audio-play-btn { width:100%; padding:var(--sp-3); border-radius:var(--r-md); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:var(--sp-2); font-size:15px; font-weight:800; letter-spacing:.02em; background:var(--primary); color:var(--on-primary); transition:all .15s; margin-bottom:var(--sp-2); box-shadow:0 4px 14px color-mix(in srgb, var(--primary) 30%, transparent); }
.mnn-audio-play-btn:active:not(:disabled) { transform:scale(.97); }
.mnn-audio-play-btn:hover:not(:disabled)  { filter:brightness(1.06); }
.mnn-audio-play-btn:disabled { opacity:.4; cursor:not-allowed; box-shadow:none; }
.mnn-audio-play-btn .btn-icon { font-size:16px; }
.mnn-audio-prog-track { height:5px; background:var(--card-muted); border-radius:var(--r-pill); overflow:hidden; margin-bottom:var(--sp-1); cursor:default; pointer-events:none; }
.mnn-audio-prog-fill { height:100%; border-radius:var(--r-pill); background:var(--primary); transition:width .25s linear; max-width:100%; }
.mnn-audio-time { display:flex; justify-content:space-between; font-size:11px; font-weight:600; color:var(--text-tertiary); font-variant-numeric:tabular-nums; }
.mnn-audio-status { display:flex; align-items:center; justify-content:center; gap:6px; padding:var(--sp-2); border-radius:var(--r-sm); font-size:12px; font-weight:700; margin-top:var(--sp-2); animation:fadeIn .3s ease; }
.mnn-audio-status.ready { background:var(--success-soft); color:var(--success); }
.mnn-audio-status.error { background:var(--danger-soft); color:var(--danger); }
.mnn-audio-status.limit { background:var(--warning-soft); color:var(--warning); }

/* ══════════════════════════════════
   ACTION BAR — v9 UPDATED
   ══════════════════════════════════ */
.mnn-action-bar {
  flex-shrink: 0;
  background: var(--header-bg);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
  /* v9: more bottom breathing room + safe area */
  padding: var(--sp-3) var(--sp-4) max(var(--sp-4), env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: var(--sp-2);
}

/* v9: nav group (prev + next) pushed to right */
.mnn-action-info { flex: 1; }
.mnn-action-info strong { font-size:14px; font-weight:700; color:var(--text); display:block; }
.mnn-action-info span   { font-size:12px; color:var(--text-tertiary); }

/* v9: button group */
.mnn-btn-group { display:flex; gap:var(--sp-2); align-items:center; }

/* v9: PREV button */
.mnn-btn-prev {
  height: 54px;
  min-width: 54px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-md); border: 1.5px solid var(--border-strong);
  font-size: 15px; font-weight: 700;
  cursor: pointer; color: var(--text-secondary);
  background: var(--card);
  transition: all .15s; -webkit-tap-highlight-color: transparent;
  display: flex; align-items: center; justify-content: center; gap: 4px;
}
.mnn-btn-prev:hover:not(:disabled)  { border-color: var(--section-color, var(--primary)); color: var(--section-color, var(--primary)); background: var(--primary-soft); }
.mnn-btn-prev:active:not(:disabled) { transform: scale(.96); }
.mnn-btn-prev:disabled { opacity:.3; cursor:not-allowed; }

/* v9: NEXT button — 54px height */
.mnn-btn-next {
  height: 54px;
  min-width: 120px;
  padding: 0 var(--sp-6);
  border-radius: var(--r-md); border: none;
  font-size: 15px; font-weight: 800;
  cursor: pointer; color: var(--on-primary);
  background: var(--primary);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--primary) 32%, transparent);
  transition: all .15s; -webkit-tap-highlight-color: transparent;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.mnn-btn-next:disabled { opacity:.35; cursor:not-allowed; box-shadow:none; }
.mnn-btn-next:not(:disabled):hover  { filter:brightness(1.06); }
.mnn-btn-next:not(:disabled):active { transform:scale(.96); }

/* ── Wait Screen ── */
.mnn-wait-screen { min-height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:var(--sp-6) var(--sp-4) 48px; text-align:center; animation:scaleIn .3s ease both; }
.mnn-wait-pill { font-size:11px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; padding:5px var(--sp-3); border-radius:var(--r-pill); margin-bottom:var(--sp-4); display:inline-block; background:var(--primary-soft); color:var(--primary); }
.mnn-wait-ring { width:72px; height:72px; border-radius:var(--r-pill); display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto var(--sp-4); border:3px solid var(--primary); background:var(--primary-soft); color:var(--primary); }
.mnn-wait-title { font-size:24px; font-weight:900; letter-spacing:-.02em; margin-bottom:var(--sp-1); }
.mnn-wait-sub   { font-size:14px; color:var(--text-secondary); line-height:1.6; margin-bottom:var(--sp-6); }
.mnn-wait-score { display:flex; align-items:baseline; gap:4px; justify-content:center; margin-bottom:var(--sp-1); }
.mnn-score-big  { font-size:48px; font-weight:900; line-height:1; letter-spacing:-.04em; color:var(--primary); }
.mnn-score-sep  { font-size:24px; font-weight:300; color:var(--text-tertiary); }
.mnn-score-den  { font-size:24px; font-weight:700; color:var(--text-secondary); }
.mnn-score-sub  { font-size:11px; font-weight:600; color:var(--text-tertiary); margin-bottom:var(--sp-6); text-transform:uppercase; letter-spacing:.1em; }
.mnn-acc-wrap   { width:100%; max-width:280px; margin:0 auto var(--sp-6); }
.mnn-acc-label  { display:flex; justify-content:space-between; font-size:11px; font-weight:600; color:var(--text-tertiary); margin-bottom:var(--sp-1); }
.mnn-acc-track  { height:6px; background:var(--card-muted); border-radius:var(--r-pill); overflow:hidden; }
.mnn-acc-fill   { height:100%; border-radius:var(--r-pill); background:var(--primary); animation:barIn .8s ease both; animation-delay:.2s; }
.mnn-wait-next-card { display:flex; align-items:center; gap:var(--sp-3); padding:var(--sp-3) var(--sp-4); background:var(--card); border:1px solid var(--border); border-radius:var(--r-lg); margin-bottom:var(--sp-6); width:100%; max-width:300px; text-align:left; box-shadow:var(--shadow-sm); }
.mnn-next-icon  { width:42px; height:42px; border-radius:var(--r-md); display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900; flex-shrink:0; }
.mnn-next-label small { font-size:10px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:.1em; }
.mnn-next-label p     { font-size:14px; font-weight:700; margin-top:2px; }
.mnn-btn-continue { width:100%; max-width:300px; padding:var(--sp-4); border-radius:var(--r-lg); border:none; font-size:15px; font-weight:800; letter-spacing:.02em; color:var(--on-primary); cursor:pointer; transition:all .15s; background:var(--primary); box-shadow:0 6px 18px color-mix(in srgb, var(--primary) 32%, transparent); }
.mnn-btn-continue:hover  { filter:brightness(1.06); }
.mnn-btn-continue:active { transform:scale(.97); }

/* ── Start Screen ── */
.mnn-start-screen { min-height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px var(--sp-4) 48px; animation:fadeIn .4s ease; }
.mnn-start-flag   { font-size:46px; margin-bottom:var(--sp-3); }
.mnn-start-eyebrow { font-size:11px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--primary); margin-bottom:var(--sp-2); }
.mnn-start-title  { font-size:26px; font-weight:900; letter-spacing:-.03em; margin-bottom:var(--sp-1); text-align:center; }
.mnn-start-pkg    { font-size:13px; color:var(--text-secondary); margin-bottom:var(--sp-6); text-align:center; }
.mnn-start-stats  { display:flex; gap:var(--sp-2); width:100%; max-width:380px; margin-bottom:var(--sp-4); }
.mnn-stat         { flex:1; background:var(--card); border:1px solid var(--border); border-radius:var(--r-lg); padding:var(--sp-3) var(--sp-2); text-align:center; box-shadow:var(--shadow-sm); }
.mnn-stat-i       { font-size:18px; margin-bottom:var(--sp-1); }
.mnn-stat-n       { font-size:22px; font-weight:900; line-height:1; }
.mnn-stat-l       { font-size:9px; color:var(--text-tertiary); margin-top:var(--sp-1); text-transform:uppercase; letter-spacing:.08em; }
.mnn-start-chips  { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-2); width:100%; max-width:380px; margin-bottom:var(--sp-4); }
.mnn-chip         { background:var(--card); border:1px solid var(--border); border-radius:var(--r-md); padding:var(--sp-3); display:flex; align-items:center; gap:var(--sp-3); box-shadow:var(--shadow-sm); }
.mnn-chip-icon    { width:32px; height:32px; border-radius:var(--r-sm); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:900; flex-shrink:0; }
.mnn-chip-name small { font-size:9px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:.09em; }
.mnn-chip-name p     { font-size:12px; font-weight:700; margin-top:1px; }
.mnn-chip-name .cnt  { font-size:10px; color:var(--text-tertiary); margin-top:1px; }
.mnn-start-hint   { font-size:12px; color:var(--text-tertiary); line-height:1.8; text-align:center; margin-bottom:var(--sp-6); max-width:340px; }
.mnn-btn-start { width:100%; max-width:340px; padding:var(--sp-4); border-radius:var(--r-lg); border:none; font-size:16px; font-weight:800; letter-spacing:.02em; color:var(--on-primary); background:var(--primary); box-shadow:0 8px 22px color-mix(in srgb, var(--primary) 35%, transparent); cursor:pointer; transition:all .15s; }
.mnn-btn-start:hover  { filter:brightness(1.05); }
.mnn-btn-start:active { transform:scale(.97); }

/* ── Result Screen ── */
.mnn-result-screen { display:flex; flex-direction:column; align-items:center; padding:0 0 48px; animation:fadeIn .4s ease; }
.mnn-result-hero { width:100%; padding:40px var(--sp-4) var(--sp-6); text-align:center; background:var(--surface); border-bottom:1px solid var(--border); margin-bottom:var(--sp-4); }
.mnn-result-emoji  { font-size:44px; margin-bottom:var(--sp-2); }
.mnn-result-title  { font-size:24px; font-weight:900; letter-spacing:-.02em; }
.mnn-result-sub    { font-size:12px; color:var(--text-secondary); margin-top:var(--sp-1); }
.mnn-result-ring-wrap { display:flex; flex-direction:column; align-items:center; margin-bottom:var(--sp-4); }
.mnn-result-ring { width:128px; height:128px; border-radius:var(--r-pill); background:conic-gradient(var(--primary) 0% var(--ring-pct,0%),var(--card-muted) var(--ring-pct,0%) 100%); display:flex; align-items:center; justify-content:center; --ring-pct:0%; animation:ringReveal 1.1s ease .2s both; box-shadow:0 0 0 5px var(--bg); position:relative; }
.mnn-result-ring::after { content:''; position:absolute; inset:11px; border-radius:var(--r-pill); background:var(--bg); }
.mnn-ring-inner   { position:relative; z-index:1; text-align:center; }
.mnn-ring-pct     { font-size:32px; font-weight:900; line-height:1; letter-spacing:-.03em; color:var(--primary); }
.mnn-ring-label   { font-size:10px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:.1em; margin-top:var(--sp-1); }
.mnn-ring-detail  { font-size:13px; color:var(--text-secondary); margin-top:var(--sp-2); }
.mnn-result-meta  { display:flex; gap:var(--sp-2); margin-bottom:var(--sp-4); flex-wrap:wrap; justify-content:center; padding:0 var(--sp-3); }
.mnn-meta-chip    { display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:var(--text-secondary); background:var(--card); border:1px solid var(--border); padding:var(--sp-1) var(--sp-3); border-radius:var(--r-pill); }
.mnn-result-rows  { width:100%; padding:0 var(--sp-3); max-width:520px; display:flex; flex-direction:column; gap:var(--sp-2); margin-bottom:var(--sp-4); }
.mnn-result-row   { background:var(--card); border:1px solid var(--border); border-radius:var(--r-lg); padding:var(--sp-3); box-shadow:var(--shadow-sm); }
.mnn-row-top      { display:flex; align-items:center; gap:var(--sp-3); margin-bottom:var(--sp-2); }
.mnn-row-icon     { width:36px; height:36px; border-radius:var(--r-sm); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; flex-shrink:0; }
.mnn-row-info     { flex:1; }
.mnn-row-info h4  { font-size:14px; font-weight:700; }
.mnn-row-info small { font-size:11px; color:var(--text-tertiary); }
.mnn-row-pct      { font-size:19px; font-weight:900; }
.mnn-bar-track    { height:5px; background:var(--card-muted); border-radius:var(--r-pill); overflow:hidden; }
.mnn-bar-fill     { height:100%; border-radius:var(--r-pill); background:var(--primary); animation:barIn .9s ease both; animation-delay:.3s; }
.mnn-result-btns  { display:flex; flex-direction:column; gap:var(--sp-2); width:100%; padding:0 var(--sp-3); max-width:520px; }
.mnn-btn-retry    { padding:var(--sp-4); border-radius:var(--r-md); border:none; font-size:15px; font-weight:800; color:var(--on-primary); cursor:pointer; background:var(--primary); box-shadow:0 6px 18px color-mix(in srgb, var(--primary) 32%, transparent); transition:all .15s; }
.mnn-btn-retry:hover  { filter:brightness(1.06); }
.mnn-btn-retry:active { transform:scale(.97); }
.mnn-btn-home     { padding:var(--sp-3); border-radius:var(--r-md); border:1.5px solid var(--border); font-size:14px; font-weight:600; color:var(--text-secondary); background:transparent; cursor:pointer; transition:all .15s; }
.mnn-btn-home:hover  { border-color:var(--border-strong); color:var(--text); }
.mnn-btn-home:active { transform:scale(.97); }

@media(max-width:380px) {
  .mnn-timer-value { font-size:38px; }
  .mnn-question-text { font-size:16px; padding:var(--sp-3); }
  .mnn-choice-text { font-size:14px; }
  .mnn-start-title { font-size:22px; }
  .mnn-image-container, .mnn-image-container img { max-height:260px; }
  .mnn-scroll-body { padding:var(--sp-3); }
  .mnn-question-card { gap:var(--sp-3); }
  .mnn-btn-next { min-width: 100px; height: 50px; font-size: 14px; }
  .mnn-btn-prev { height: 50px; min-width: 48px; }
}
    `;
    document.head.appendChild(style);
  }

  // ─── RENDER HELPERS ────────────────────────────────────────────────────────
  function _setSectionVars(name) {
    const meta = SECTION_META[name];
    const r = _state.container;
    r.style.setProperty('--section-color',     meta.color);
    r.style.setProperty('--section-color-dim', meta.colorDim);
  }

  function _renderHeader(sName, qIdx, qTotal) {
    const meta = SECTION_META[sName];
    const pct  = qTotal > 0 ? Math.round(qIdx / qTotal * 100) : 0;
    const dots  = SECTION_ORDER.map((s, i) => {
      let c = 'mnn-dot';
      if (i < _state.sectionIndex)  c += ' done';
      if (i === _state.sectionIndex) c += ' active';
      return `<span class="${c}"></span>`;
    }).join('');
    const tw = _formatCountdown(_state.timer.remaining);
    const warnClass = _state.timer.remaining <= 300 ? ' warn' : '';
    return `
      <div class="mnn-header">
        <div class="mnn-header-top">
          <span class="mnn-header-brand">JFT Simulation</span>
          <div class="mnn-header-actions">
            <div class="mnn-section-dots">${dots}</div>
            ${_renderThemeToggle()}
          </div>
        </div>
        <div class="mnn-timer-block">
          <span class="mnn-timer-value${warnClass}" id="mnn-timer-display">${tw}</span>
          <div class="mnn-timer-caption">Waktu Tersisa</div>
        </div>
        <div class="mnn-header-section">
          <span class="mnn-section-label">${meta.labelSub}</span>
          <span class="mnn-section-tag">Section ${_state.sectionIndex + 1}/${SECTION_ORDER.length}</span>
        </div>
        <div class="mnn-progress-row">
          <div class="mnn-prog-track">
            <div class="mnn-prog-fill" style="width:${pct}%"></div>
          </div>
          <span class="mnn-prog-pct">${pct}%</span>
        </div>
      </div>`;
  }

  // ─── THEME ─────────────────────────────────────────────────────────────────
  const THEME_STORAGE_KEY = 'mnn-exam-theme';
  function _getStoredTheme() { try { const v = localStorage.getItem(THEME_STORAGE_KEY); if (v === 'light' || v === 'dark' || v === 'auto') return v; } catch (e) {} return 'auto'; }
  function _applyTheme(theme) { _state.theme = theme; if (_state.container) _state.container.setAttribute('data-theme', theme); try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) {} }
  function setTheme(theme) { if (theme !== 'light' && theme !== 'dark' && theme !== 'auto') return; _applyTheme(theme); if (_state.running) renderQuestion(); }
  function _renderThemeToggle() {
    const t = _state.theme || 'auto';
    const opts = [{ id:'light', icon:'☀️', label:'Light' }, { id:'dark', icon:'🌙', label:'Dark' }, { id:'auto', icon:'🌗', label:'Auto' }];
    const btns = opts.map(o => `<button class="mnn-theme-btn${t === o.id ? ' active' : ''}" aria-label="${o.label}" title="${o.label}" onclick="window.MNNExamEngine.setTheme('${o.id}')">${o.icon}</button>`).join('');
    return `<div class="mnn-theme-toggle">${btns}</div>`;
  }

  // ─── DOKKAI PASSAGE DEDUP ─────────────────────────────────────────────────
  function _renderPassageBlock(sName, q) {
    if (!q.passage) return '';
    const questions = _state.sections[_state.sectionIndex];
    let isDuplicate = false;
    for (let i = 0; i < _state.questionIndex; i++) {
      const prev = questions[i];
      if (!prev || !prev.passage) continue;
      if ((q.passage_id && prev.passage_id && q.passage_id === prev.passage_id) || (!q.passage_id && prev.passage === q.passage)) { isDuplicate = true; break; }
    }
    if (!isDuplicate) {
      return `<div class="mnn-passage-box"><div class="mnn-passage-label">📄 Teks Bacaan</div>${q.passage}</div>`;
    }
    const qKey = q.id || (sName + '_' + _state.questionIndex);
    const expanded = !!_state.passageExpanded[qKey];
    if (expanded) {
      return `<div class="mnn-passage-box is-collapsible"><div class="mnn-passage-label">📄 Teks Bacaan (lanjutan)</div>${q.passage}<div style="margin-top:8px;text-align:right"><button class="mnn-passage-toggle" onclick="window.MNNExamEngine._togglePassage('${qKey}')">Sembunyikan ▲</button></div></div>`;
    }
    return `<div class="mnn-passage-collapsed"><span class="mnn-passage-collapsed-icon">📄</span><span class="mnn-passage-collapsed-text">Lanjutan dari teks bacaan sebelumnya.</span><button class="mnn-passage-toggle" onclick="window.MNNExamEngine._togglePassage('${qKey}')">Lihat teks ▼</button></div>`;
  }

  function _togglePassage(qKey) { _state.passageExpanded[qKey] = !_state.passageExpanded[qKey]; renderQuestion(); }

  // ─── ENGINE CORE ───────────────────────────────────────────────────────────
  function init(config) {
    if (!config || !config.container || !config.data) { console.error('[MNNExamEngine] init() requires {container,data}'); return false; }
    _injectStyles();
    const container = typeof config.container === 'string' ? document.querySelector(config.container) : config.container;
    if (!container) { console.error('[MNNExamEngine] Container not found'); return false; }
    container.id = 'mnn-exam-root';
    _state.config = config; _state.container = container;
    _state.initialized = true; _state.running = false;
    _state.audioPlayCount = {}; _state.audioUnlocked = {}; _state.passageExpanded = {};
    _state.savedChoices = {};
    _state.sections = _buildSections(config.data);
    _state.answers = {}; _state.scores = {};
    SECTION_ORDER.forEach(n => { _state.answers[n] = []; _state.scores[n] = { correct: 0, total: 0 }; });
    _state.sectionIndex = 0; _state.questionIndex = 0;
    _state.selectedChoice = null; _state.answered = false;
    _applyTheme(config.theme || _getStoredTheme());
    const mins = config.timerMinutes || 60;
    _state.timer.totalSeconds = mins * 60; _state.timer.remaining = _state.timer.totalSeconds;
    _renderStartScreen(); return true;
  }

  function startExam() {
    if (!_state.initialized) { console.error('[MNNExamEngine] Call init() first'); return; }
    _state.running = true; _state.startTime = Date.now();
    _state.sectionIndex = 0; _state.questionIndex = 0;
    _state.savedChoices = {};
    _startTimer(); loadSection(0);
  }

  function _startTimer() {
    _stopTimer();
    const mins = _state.config.timerMinutes || 60;
    _state.timer.totalSeconds = mins * 60; _state.timer.remaining = _state.timer.totalSeconds;
    _state.timer.intervalId = setInterval(_tickTimer, 1000);
    _updateTimerDOM();
  }
  function _stopTimer() { if (_state.timer.intervalId) { clearInterval(_state.timer.intervalId); _state.timer.intervalId = null; } }
  function _tickTimer() {
    if (_state.timer.remaining <= 0) { _stopTimer(); if (_state.running) { _state.running = false; showResultScreen(); } return; }
    _state.timer.remaining--; _updateTimerDOM();
  }
  function _updateTimerDOM() {
    const el = document.getElementById('mnn-timer-display');
    if (!el) return;
    el.textContent = _formatCountdown(_state.timer.remaining);
    el.classList.toggle('warn', _state.timer.remaining <= 300);
  }

  function loadSection(index) {
    _state.sectionIndex = index; _state.questionIndex = 0;
    _state.selectedChoice = null; _state.answered = false;
    renderQuestion();
  }

  function renderImage(image_ref, basePath) {
    if (!image_ref) return '';
    const base = (basePath || _state.config.imagePath || 'assets/images/').replace(/\/$/, '');
    const src  = base + '/' + image_ref + '.png';
    return [
      '<div class="mnn-image-container" id="wrap-' + image_ref + '">',
      '  <img',
      '    id="img-' + image_ref + '"',
      '    src="'  + src + '"',
      '    alt="'  + image_ref + '"',
      '    onerror="document.getElementById(\'wrap-' + image_ref + '\').classList.add(\'img-failed\')"',
      '  />',
      '  <div class="mnn-image-fallback">🖼️ Gambar tidak ditemukan: ' + image_ref + '.png</div>',
      '</div>',
    ].join('\n');
  }

  // ─── v9: ACTION BAR builder ────────────────────────────────────────────────
  /**
   * _renderActionBar
   * @param {string}  sName      - section name
   * @param {number}  qNum       - 1-based question number
   * @param {number}  qTotal     - total questions in section
   * @param {boolean} hasPrev    - show Previous button
   * @param {boolean} nextEnabled- Next button enabled
   * @param {string}  nextLabel  - label for Next button
   */
  function _renderActionBar(sName, qNum, qTotal, hasPrev, nextEnabled, nextLabel) {
    const meta = SECTION_META[sName];
    const prevBtn = hasPrev ? `
      <button class="mnn-btn-prev" id="mnn-btn-prev"
        ${_state.questionIndex === 0 ? 'disabled' : ''}
        onclick="window.MNNExamEngine.prevQuestion()">
        ← Sebelumnya
      </button>` : '';

    return `
      <div class="mnn-action-bar">
        <div class="mnn-action-info">
          <strong>${meta.labelSub}</strong>
          <span>${qNum} dari ${qTotal} soal</span>
        </div>
        <div class="mnn-btn-group">
          ${prevBtn}
          <button class="mnn-btn-next" id="mnn-btn-next"
            ${nextEnabled ? '' : 'disabled'}
            onclick="window.MNNExamEngine.nextQuestion()">
            ${nextLabel}
          </button>
        </div>
      </div>`;
  }

  // ─── renderQuestion ────────────────────────────────────────────────────────
  function renderQuestion() {
    const sName     = SECTION_ORDER[_state.sectionIndex];
    const questions = _state.sections[_state.sectionIndex];
    const q         = questions[_state.questionIndex];
    const meta      = SECTION_META[sName];
    _setSectionVars(sName);

    // v9: restore saved choice for this question (if revisiting via Prev)
    const savedKey = _savedKey(sName, _state.questionIndex);
    const restored = _state.savedChoices[savedKey];
    _state.selectedChoice = (restored !== undefined) ? restored : null;
    _state.answered = false; // always editable when rendering

    const qNum   = _state.questionIndex + 1;
    const qTotal = questions.length;
    const hasPrev = SECTIONS_WITH_PREV.has(sName);
    const nextEnabled = _state.selectedChoice !== null;
    const nextLabel = qNum === qTotal ? 'Selesai ✓' : 'Selanjutnya →';

    if (sName === 'choukai') {
      _renderChoukaiQuestion(q, meta, qNum, qTotal);
      return;
    }

    const letters = ['A','B','C','D'];
    let body = '';
    body += _renderPassageBlock(sName, q);
    body += renderImage(q.image_ref);
    body += `<div class="mnn-question-text">${q.question}</div>`;
    body += `<div class="mnn-choices" id="mnn-choices-list">`;
    q.choices.forEach((c, i) => {
      const text = _cleanChoice(c);
      const selClass = (restored !== undefined && restored === i) ? ' selected' : '';
      body += `<button class="mnn-choice${selClass}" onclick="window.MNNExamEngine.selectChoice(${i})">
        <span class="mnn-choice-letter">${letters[i]}</span>
        <span class="mnn-choice-text">${text}</span>
        <span class="mnn-choice-icon"></span>
      </button>`;
    });
    body += '</div>';

    _state.container.innerHTML = `
      ${_renderHeader(sName, _state.questionIndex, qTotal)}
      <div class="mnn-scroll-body">
        <div class="mnn-question-card">
          <div class="mnn-q-meta">
            <div class="mnn-q-num">${qNum}</div>
            <span class="mnn-q-chip">${q.question_type || 'soal'}</span>
            <span class="mnn-q-of">${qNum} / ${qTotal}</span>
          </div>
          ${body}
        </div>
      </div>
      ${_renderActionBar(sName, qNum, qTotal, hasPrev, nextEnabled, nextLabel)}`;
  }

  // ─── CHOUKAI (no Previous) ─────────────────────────────────────────────────
  function _renderChoukaiQuestion(q, meta, qNum, qTotal) {
    const letters   = ['A','B','C','D'];
    const audioId   = q.audio_id || '';
    const audioSrc  = _audioSrc(audioId);
    const qKey      = q.id || (audioId + '_' + qNum);
    const playCount = _state.audioPlayCount[qKey] || 0;
    const unlocked  = !!_state.audioUnlocked[qKey];
    const lockClass = unlocked ? '' : ' audio-locked';
    const atLimit   = playCount >= CHOUKAI_MAX_PLAYS;

    const playLabel = playCount === 0 ? 'Putar Audio'
      : atLimit ? `Batas Pemutaran (${CHOUKAI_MAX_PLAYS}/${CHOUKAI_MAX_PLAYS})`
      : `Putar Lagi (${playCount}/${CHOUKAI_MAX_PLAYS})`;

    const playerHTML = audioSrc ? `
      <div class="mnn-audio-card" id="audio-card-${qNum}">
        <div class="mnn-audio-header">
          <span class="mnn-audio-badge">🎧 Audio</span>
          <span class="mnn-audio-title">${audioId}</span>
          <span class="mnn-audio-plays" id="play-count-${qNum}">${playCount}/${CHOUKAI_MAX_PLAYS}x</span>
        </div>
        <audio id="mnn-audio-${qNum}" data-qkey="${qKey}" preload="metadata">
          <source src="${audioSrc}" type="audio/mpeg">
        </audio>
        <button class="mnn-audio-play-btn" id="mnn-play-btn-${qNum}"
          ${atLimit ? 'disabled' : ''}
          onclick="window.MNNExamEngine._toggleAudio(${qNum})">
          <span class="btn-icon" id="play-icon-${qNum}">▶</span>
          <span id="play-btn-label-${qNum}">${playLabel}</span>
        </button>
        <div class="mnn-audio-prog-track">
          <div class="mnn-audio-prog-fill" id="audio-prog-${qNum}" style="width:0%"></div>
        </div>
        <div class="mnn-audio-time">
          <span id="audio-cur-${qNum}">0:00</span>
          <span id="audio-dur-${qNum}">—</span>
        </div>
        <div id="audio-status-${qNum}" class="mnn-audio-status ${atLimit ? 'limit' : 'ready'}"
             style="display:${unlocked ? 'flex' : 'none'}">
          ${atLimit ? '🔒 Batas pemutaran tercapai — silakan jawab soal' : '✓ Audio siap — pilih jawaban di bawah'}
        </div>
      </div>` : `
      <div class="mnn-audio-card">
        <div class="mnn-audio-header">
          <span class="mnn-audio-badge">🎧 Audio</span>
          <span class="mnn-audio-title">${audioId || 'Audio tidak tersedia'}</span>
        </div>
        <div class="mnn-audio-status error" style="display:flex">
          ⚠ File audio tidak ditemukan — kamu tetap bisa menjawab soal ini
        </div>
      </div>`;

    const hintHTML = unlocked || !audioSrc ? '' : `
      <div class="mnn-audio-unlock-hint" id="audio-hint-${qNum}">
        🔊 Putar audio terlebih dahulu untuk membuka jawaban
      </div>`;

    let choicesHTML = `<div class="mnn-choices${lockClass}" id="mnn-choices-list">`;
    q.choices.forEach((c, i) => {
      const text = _cleanChoice(c);
      choicesHTML += `<button class="mnn-choice" onclick="window.MNNExamEngine.selectChoice(${i})">
        <span class="mnn-choice-letter">${letters[i]}</span>
        <span class="mnn-choice-text">${text}</span>
        <span class="mnn-choice-icon"></span>
      </button>`;
    });
    choicesHTML += '</div>';

    // v9: Choukai — NO Previous button
    const nextEnabled = _state.selectedChoice !== null;
    const nextLabel   = qNum === qTotal ? 'Selesai ✓' : 'Selanjutnya →';

    _state.container.innerHTML = `
      ${_renderHeader('choukai', _state.questionIndex, qTotal)}
      <div class="mnn-scroll-body">
        <div class="mnn-question-card">
          <div class="mnn-q-meta">
            <div class="mnn-q-num">${qNum}</div>
            <span class="mnn-q-chip">${q.question_type || 'choukai'}</span>
            <span class="mnn-q-of">${qNum} / ${qTotal}</span>
          </div>
          ${playerHTML}
          <div class="mnn-question-text">${q.question}</div>
          ${hintHTML}
          ${choicesHTML}
        </div>
      </div>
      ${_renderActionBar('choukai', qNum, qTotal, false, nextEnabled, nextLabel)}`;

    if (audioSrc) _bindAudioEvents(qNum, qKey, unlocked);
    if (!audioSrc) _unlockChoices(qNum, qKey);
  }

  function _bindAudioEvents(qNum, qKey, alreadyUnlocked) {
    const audio = document.getElementById('mnn-audio-' + qNum);
    if (!audio) return;
    audio.addEventListener('loadedmetadata', () => { const dur = document.getElementById('audio-dur-' + qNum); if (dur) dur.textContent = _fmtAudioTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      const prog = document.getElementById('audio-prog-' + qNum);
      const cur  = document.getElementById('audio-cur-'  + qNum);
      if (!audio.duration) return;
      if (prog) prog.style.width = (audio.currentTime / audio.duration * 100) + '%';
      if (cur)  cur.textContent  = _fmtAudioTime(audio.currentTime);
    });
    audio.addEventListener('play', () => {
      const icon  = document.getElementById('play-icon-'      + qNum);
      const label = document.getElementById('play-btn-label-' + qNum);
      if (icon)  icon.textContent = '⏸';
      if (label) label.textContent = 'Sedang Diputar...';
      if (audio.currentTime < 0.5) { _state.audioPlayCount[qKey] = (_state.audioPlayCount[qKey] || 0) + 1; const pc = document.getElementById('play-count-' + qNum); if (pc) pc.textContent = _state.audioPlayCount[qKey] + '/' + CHOUKAI_MAX_PLAYS + 'x'; }
      if (!_state.audioUnlocked[qKey]) _unlockChoices(qNum, qKey);
    });
    audio.addEventListener('pause', () => {
      const icon  = document.getElementById('play-icon-'      + qNum);
      const label = document.getElementById('play-btn-label-' + qNum);
      if (icon) icon.textContent = '▶';
      if (label && audio.currentTime > 0 && audio.currentTime < audio.duration) label.textContent = 'Lanjutkan';
    });
    audio.addEventListener('ended', () => {
      audio.currentTime = 0;
      const prog = document.getElementById('audio-prog-' + qNum);
      const icon = document.getElementById('play-icon-'  + qNum);
      const label = document.getElementById('play-btn-label-' + qNum);
      const btn  = document.getElementById('mnn-play-btn-' + qNum);
      const status = document.getElementById('audio-status-' + qNum);
      const count = _state.audioPlayCount[qKey] || 0;
      if (prog) prog.style.width = '0%';
      if (count >= CHOUKAI_MAX_PLAYS) {
        if (btn)   btn.disabled = true;
        if (icon)  icon.textContent = '🔒';
        if (label) label.textContent = `Batas Pemutaran (${CHOUKAI_MAX_PLAYS}/${CHOUKAI_MAX_PLAYS})`;
        if (status) { status.className = 'mnn-audio-status limit'; status.style.display = 'flex'; status.textContent = '🔒 Batas pemutaran tercapai — silakan jawab soal'; }
      } else {
        if (icon)  icon.textContent = '▶';
        if (label) label.textContent = `Putar Lagi (${count}/${CHOUKAI_MAX_PLAYS})`;
      }
    });
    audio.addEventListener('error', () => {
      const status = document.getElementById('audio-status-' + qNum);
      if (status) { status.className = 'mnn-audio-status error'; status.style.display = 'flex'; status.textContent = '⚠ Gagal memuat audio — kamu tetap bisa menjawab'; }
      _unlockChoices(qNum, qKey);
    });
    if (alreadyUnlocked) _unlockChoices(qNum, qKey);
  }

  function _unlockChoices(qNum, qKey) {
    const list   = document.getElementById('mnn-choices-list');
    const hint   = document.getElementById('audio-hint-'   + qNum);
    const status = document.getElementById('audio-status-' + qNum);
    if (list) list.classList.remove('audio-locked');
    if (hint) hint.classList.add('hidden');
    if (status && status.style.display === 'none' && !status.classList.contains('error')) status.style.display = 'flex';
    if (qKey) _state.audioUnlocked[qKey] = true;
  }

  function _toggleAudio(qNum) {
    const audio = document.getElementById('mnn-audio-' + qNum);
    if (!audio) return;
    const qKey  = audio.dataset.qkey;
    const count = _state.audioPlayCount[qKey] || 0;
    if (audio.paused) {
      if (audio.currentTime < 0.5 && count >= CHOUKAI_MAX_PLAYS) return;
      audio.play().catch(() => _unlockChoices(qNum, qKey));
    } else {
      audio.pause();
    }
  }

  // ── v9: selectChoice — save to savedChoices, enable Next immediately ───────
  function selectChoice(index) {
    _state.selectedChoice = index;
    const sName   = SECTION_ORDER[_state.sectionIndex];
    const savedKey = _savedKey(sName, _state.questionIndex);
    _state.savedChoices[savedKey] = index; // persist for Previous navigation

    const choices = document.querySelectorAll('.mnn-choice');
    choices.forEach((el, i) => el.classList.toggle('selected', i === index));
    const btn = _qs('#mnn-btn-next');
    if (btn) btn.disabled = false;
  }

  // ── v9: submitAnswer — records answer (used at advance time, not on click) ──
  function submitAnswer() {
    if (_state.answered) return;
    const chosen = _state.selectedChoice;
    if (chosen === null) return;
    const sName    = SECTION_ORDER[_state.sectionIndex];
    const questions = _state.sections[_state.sectionIndex];
    const q         = questions[_state.questionIndex];
    _state.answered = true;
    const isCorrect = (chosen === q.answer);
    _state.answers[sName].push({ questionId: q.id, chosen, correct: q.answer, isCorrect });
    _state.scores[sName].total++;
    if (isCorrect) _state.scores[sName].correct++;
  }

  // ── v9: nextQuestion — save answer, advance ────────────────────────────────
  function nextQuestion() {
    if (_state.selectedChoice === null) return;
    const sName = SECTION_ORDER[_state.sectionIndex];

    // For Choukai: submit immediately (no going back)
    if (sName === 'choukai') {
      if (!_state.answered) submitAnswer();
      _advance();
      return;
    }

    // For other sections: just advance; final scoring happens at section end
    _advance();
  }

  // ── v9: prevQuestion — go back one question ────────────────────────────────
  function prevQuestion() {
    if (_state.questionIndex === 0) return;
    _state.questionIndex--;
    _state.answered = false;
    renderQuestion();
  }

  // ── v9: _advance — move forward, score on final advance ───────────────────
  function _advance() {
    const sName   = SECTION_ORDER[_state.sectionIndex];
    const total   = _state.sections[_state.sectionIndex].length;
    const isChoukai = sName === 'choukai';

    if (_state.questionIndex + 1 < total) {
      _state.questionIndex++;
      _state.answered = false;
      renderQuestion();
    } else {
      // Reached end of section
      // For non-Choukai: score all answers now from savedChoices
      if (!isChoukai) {
        _scoreSection(sName);
      }
      if (_state.config.onSectionComplete) {
        _state.config.onSectionComplete(sName, _state.scores[sName]);
      }
      showWaitScreen();
    }
  }

  /**
   * _scoreSection — called when a non-Choukai section is completed.
   * Scores all questions based on savedChoices.
   */
  function _scoreSection(sName) {
    const questions = _state.sections[_state.sectionIndex];
    // Reset section scores (in case of re-entry, though sections are locked)
    _state.scores[sName] = { correct: 0, total: 0 };
    _state.answers[sName] = [];

    questions.forEach((q, idx) => {
      const key    = _savedKey(sName, idx);
      const chosen = _state.savedChoices[key];
      if (chosen === undefined) return; // unanswered (shouldn't happen in normal flow)
      const isCorrect = (chosen === q.answer);
      _state.answers[sName].push({ questionId: q.id, chosen, correct: q.answer, isCorrect });
      _state.scores[sName].total++;
      if (isCorrect) _state.scores[sName].correct++;
    });
  }

  function nextSection() {
    const next = _state.sectionIndex + 1;
    if (next < SECTION_ORDER.length) { loadSection(next); }
    else { showResultScreen(); }
  }

  // ─── WAIT SCREEN ───────────────────────────────────────────────────────────
  function showWaitScreen() {
    const sName    = SECTION_ORDER[_state.sectionIndex];
    const meta     = SECTION_META[sName];
    const score    = _state.scores[sName];
    const nextIdx  = _state.sectionIndex + 1;
    const isLast   = nextIdx >= SECTION_ORDER.length;
    const nextMeta = isLast ? null : SECTION_META[SECTION_ORDER[nextIdx]];
    const pct      = _pct(score.correct, score.total);
    const emoji    = pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '📝';
    const scoreBlock = `
      <div class="mnn-wait-score">
        <span class="mnn-score-big">${score.correct}</span>
        <span class="mnn-score-sep">/</span>
        <span class="mnn-score-den">${score.total}</span>
      </div>
      <div class="mnn-score-sub">Benar</div>
      <div class="mnn-acc-wrap">
        <div class="mnn-acc-label"><span>Akurasi</span><span style="color:var(--primary)">${pct}%</span></div>
        <div class="mnn-acc-track"><div class="mnn-acc-fill" style="width:${pct}%"></div></div>
      </div>`;
    const nextCard = nextMeta ? `
      <div class="mnn-wait-next-card">
        <div class="mnn-next-icon" style="background:color-mix(in srgb, ${nextMeta.color} 16%, var(--card-muted));color:${nextMeta.color}">${nextMeta.icon}</div>
        <div class="mnn-next-label"><small>Section Berikutnya</small><p>${nextMeta.labelSub}</p></div>
      </div>` : '';
    const btnLabel = isLast ? '🏁 Lihat Hasil' : `Lanjut ke ${nextMeta.labelSub} →`;
    _state.container.innerHTML = `
      <div class="mnn-page">
        <div class="mnn-page-topbar">${_renderThemeToggle()}</div>
        <div class="mnn-wait-screen">
          <div class="mnn-wait-pill">✓ Section Selesai</div>
          <div class="mnn-wait-ring">${emoji}</div>
          <div class="mnn-wait-title">${meta.labelSub}</div>
          <div class="mnn-wait-sub">${score.total} soal selesai dikerjakan.</div>
          ${scoreBlock}
          ${nextCard}
          <button class="mnn-btn-continue" onclick="window.MNNExamEngine.nextSection()">${btnLabel}</button>
        </div>
      </div>`;
  }

  // ─── RESULT SCREEN ─────────────────────────────────────────────────────────
  function showResultScreen() {
    _stopTimer(); _state.endTime = Date.now();
    const elapsed = _state.endTime - _state.startTime;
    let totalCorrect = 0, totalQ = 0;
    SECTION_ORDER.forEach(n => { totalCorrect += _state.scores[n].correct; totalQ += _state.scores[n].total; });
    const overallPct = _pct(totalCorrect, totalQ);
    const emoji = overallPct >= 80 ? '🏆' : overallPct >= 60 ? '🎉' : overallPct >= 40 ? '📚' : '💪';
    const label = overallPct >= 80 ? 'Luar Biasa!' : overallPct >= 60 ? 'Bagus!' : overallPct >= 40 ? 'Terus Berlatih!' : 'Jangan Menyerah!';
    const rows = SECTION_ORDER.map(name => {
      const meta = SECTION_META[name], score = _state.scores[name];
      const pct  = _pct(score.correct, score.total);
      return `<div class="mnn-result-row">
        <div class="mnn-row-top">
          <div class="mnn-row-icon" style="background:color-mix(in srgb, ${meta.color} 16%, var(--card-muted));color:${meta.color}">${meta.icon}</div>
          <div class="mnn-row-info"><h4>${meta.labelSub}</h4><small>${score.correct} / ${score.total} benar</small></div>
          <div class="mnn-row-pct" style="color:var(--primary)">${pct}%</div>
        </div>
        <div class="mnn-bar-track"><div class="mnn-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
    _state.container.innerHTML = `
      <div class="mnn-page">
        <div class="mnn-page-topbar">${_renderThemeToggle()}</div>
        <div class="mnn-result-screen">
          <div class="mnn-result-hero">
            <div class="mnn-result-emoji">${emoji}</div>
            <div class="mnn-result-title">${label}</div>
            <div class="mnn-result-sub">Simulasi JFT Basic · ${_state.config.package || 'V10'}</div>
          </div>
          <div class="mnn-result-ring-wrap">
            <div class="mnn-result-ring" style="--ring-pct:${overallPct}%">
              <div class="mnn-ring-inner">
                <div class="mnn-ring-pct">${overallPct}%</div>
                <div class="mnn-ring-label">Total</div>
              </div>
            </div>
            <div class="mnn-ring-detail">${totalCorrect} / ${totalQ} benar</div>
          </div>
          <div class="mnn-result-meta">
            <span class="mnn-meta-chip">⏱ ${_formatTime(elapsed)}</span>
            <span class="mnn-meta-chip">📝 ${totalQ} soal</span>
            <span class="mnn-meta-chip">📚 4 section</span>
          </div>
          <div class="mnn-result-rows">${rows}</div>
          <div class="mnn-result-btns">
            <button class="mnn-btn-retry" onclick="window.MNNExamEngine.restart()">↺ Coba Lagi</button>
            <button class="mnn-btn-home" onclick="window.MNNExamEngine._goHome()">← Kembali ke Beranda</button>
          </div>
        </div>
      </div>`;
    if (_state.config.onComplete) {
      _state.config.onComplete({ scores:{..._state.scores}, answers:{..._state.answers}, totalCorrect, totalQuestions:totalQ, overallPct, elapsed });
    }
  }

  // ─── RESTART / HOME ────────────────────────────────────────────────────────
  function restart() {
    _stopTimer();
    _state.sections = _buildSections(_state.config.data);
    SECTION_ORDER.forEach(n => { _state.answers[n] = []; _state.scores[n] = { correct: 0, total: 0 }; });
    _state.audioPlayCount = {}; _state.audioUnlocked = {}; _state.passageExpanded = {};
    _state.savedChoices = {};
    startExam();
  }

  function _goHome() {
    if (_state.config.onBackToHome) { _state.config.onBackToHome(); return; }
    _stopTimer(); _state.running = false;
    _state.audioPlayCount = {}; _state.audioUnlocked = {}; _state.passageExpanded = {};
    _state.savedChoices = {};
    _state.sections = _buildSections(_state.config.data);
    SECTION_ORDER.forEach(n => { _state.answers[n] = []; _state.scores[n] = { correct: 0, total: 0 }; });
    const mins = _state.config.timerMinutes || 60;
    _state.timer.totalSeconds = mins * 60; _state.timer.remaining = _state.timer.totalSeconds;
    _renderStartScreen();
  }

  // ─── START SCREEN ──────────────────────────────────────────────────────────
  function _renderStartScreen() {
    const pkg    = _state.config.package  || 'V10';
    const mins   = _state.config.timerMinutes || 60;
    const totalQ = SECTION_ORDER.reduce((s, n) => s + (_state.config.data[n]?.length || 0), 0);
    const chips  = SECTION_ORDER.map(name => {
      const meta  = SECTION_META[name];
      const count = _state.config.data[name]?.length || 0;
      return `<div class="mnn-chip">
        <div class="mnn-chip-icon" style="background:color-mix(in srgb, ${meta.color} 16%, var(--card-muted));color:${meta.color}">${meta.icon}</div>
        <div class="mnn-chip-name">
          <small>${meta.labelSub}</small>
          <p>${meta.label}</p>
          <div class="cnt">${count} soal</div>
        </div>
      </div>`;
    }).join('');
    _state.container.innerHTML = `
      <div class="mnn-page">
        <div class="mnn-page-topbar">${_renderThemeToggle()}</div>
        <div class="mnn-start-screen">
          <div class="mnn-start-flag">📘</div>
          <div class="mnn-start-eyebrow">JFT BASIC · SIMULATION</div>
          <div class="mnn-start-title">JFT Basic Simulation</div>
          <div class="mnn-start-pkg">Package ${pkg}</div>
          <div class="mnn-start-stats">
            <div class="mnn-stat"><div class="mnn-stat-i">📝</div><div class="mnn-stat-n">${totalQ}</div><div class="mnn-stat-l">Questions</div></div>
            <div class="mnn-stat"><div class="mnn-stat-i">📚</div><div class="mnn-stat-n">4</div><div class="mnn-stat-l">Sections</div></div>
            <div class="mnn-stat"><div class="mnn-stat-i">⏱</div><div class="mnn-stat-n">${mins}</div><div class="mnn-stat-l">Minutes</div></div>
          </div>
          <div class="mnn-start-chips">${chips}</div>
          <div class="mnn-start-hint">Jawab semua soal per section secara berurutan.<br>Kamu bisa kembali ke soal sebelumnya di section Kanji, Expression, dan Dokkai.<br>Section Choukai 🎧 tidak bisa kembali — sesuai ujian asli.</div>
          <button class="mnn-btn-start" onclick="window.MNNExamEngine.startExam()">Mulai Simulasi →</button>
        </div>
      </div>`;
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────────────
  global.MNNExamEngine = {
    init, startExam, restart,
    loadSection, nextSection,
    renderQuestion, selectChoice, submitAnswer, nextQuestion, prevQuestion,
    showWaitScreen, showResultScreen,
    stopTimer: _stopTimer,
    _advance, _goHome,
    _toggleAudio, _togglePassage,
    setTheme,
    getState:   () => ({ ..._state }),
    getScores:  () => ({ ..._state.scores }),
    getAnswers: () => ({ ..._state.answers }),
    getTimer:   () => ({ ..._state.timer }),
  };

})(window);
