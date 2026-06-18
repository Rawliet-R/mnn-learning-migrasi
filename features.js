/* ═══════════════════════════════════════════════════════
   MNN Learning — みんなの日本語
   features.js — v2.5+ Feature modules
   Contains: GAMIFY, JLPT_MODULE, MISSIONS, CALENDAR,
             REVIEW_QUEUE, ROADMAP_MODULE, STATS_MODULE,
             renderVocabDbCard, LEARNING_PATH, UX_ANIM,
             v2.5 Orchestrator
   Depends on: data.js + app.js (must load first)
   ═══════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════
   MNN GAMIFICATION SYSTEM — GAMIFY MODULE
   Versi: v1 | Project: SSWPM | Account: KANADE BX
   Email: yakinmukhammadainul@gmail.com | Date: 2026-06-07
   ════════════════════════════════════════════════════════════ */

const GAMIFY = (() => {

  // ── SVG Avatar Library ──────────────────────────────────
  const AVATARS = [
    {
      id: 'av-ninja',
      name: 'Ninja',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="#1a1a2e"/>
        <circle cx="32" cy="28" r="14" fill="#2d2d42"/>
        <rect x="18" y="24" width="28" height="8" rx="4" fill="#0f0f14"/>
        <ellipse cx="27" cy="28" rx="3" ry="3.5" fill="#4a9eff"/>
        <ellipse cx="37" cy="28" rx="3" ry="3.5" fill="#4a9eff"/>
        <circle cx="27" cy="28" r="1.5" fill="#0f0f14"/>
        <circle cx="37" cy="28" r="1.5" fill="#0f0f14"/>
        <rect x="14" y="20" width="36" height="5" rx="2.5" fill="#ef4444"/>
        <path d="M22 38 Q32 44 42 38" stroke="#2d2d42" stroke-width="2" fill="none"/>
      </svg>`
    },
    {
      id: 'av-sensei',
      name: 'Sensei',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="#1e3a5f"/>
        <circle cx="32" cy="28" r="13" fill="#fde8d8"/>
        <ellipse cx="32" cy="34" rx="10" ry="4" fill="#fde8d8"/>
        <rect x="20" y="27" width="24" height="3" rx="1.5" fill="#1a1a2e" opacity=".6"/>
        <rect x="23" y="25" width="7" height="5" rx="2" fill="none" stroke="#1a1a2e" stroke-width="1.5"/>
        <rect x="34" y="25" width="7" height="5" rx="2" fill="none" stroke="#1a1a2e" stroke-width="1.5"/>
        <path d="M30 31 Q32 33 34 31" stroke="#c4b5fd" stroke-width="1.5" fill="none"/>
        <ellipse cx="32" cy="20" rx="12" ry="5" fill="#2d4a7a"/>
        <rect x="20" y="15" width="24" height="7" rx="3.5" fill="#3b5fa0"/>
        <ellipse cx="32" cy="46" rx="14" ry="6" fill="#3b5fa0"/>
        <path d="M26 41 L26 50 M38 41 L38 50" stroke="#2d4a7a" stroke-width="2"/>
      </svg>`
    },
    {
      id: 'av-kitsune',
      name: 'Kitsune',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="34" r="26" fill="#2a1a0e"/>
        <polygon points="20,22 14,8 26,18" fill="#d97706"/>
        <polygon points="44,22 50,8 38,18" fill="#d97706"/>
        <polygon points="22,22 16,10 26,19" fill="#fef3c7"/>
        <polygon points="42,22 48,10 38,19" fill="#fef3c7"/>
        <circle cx="32" cy="30" r="14" fill="#f59e0b"/>
        <circle cx="32" cy="30" r="12" fill="#fde68a"/>
        <ellipse cx="26" cy="29" rx="3" ry="3.5" fill="#fff"/>
        <ellipse cx="38" cy="29" rx="3" ry="3.5" fill="#fff"/>
        <circle cx="26" cy="29" r="2" fill="#1a1a2e"/>
        <circle cx="38" cy="29" r="2" fill="#1a1a2e"/>
        <circle cx="26.8" cy="28.2" r=".8" fill="#fff"/>
        <circle cx="38.8" cy="28.2" r=".8" fill="#fff"/>
        <ellipse cx="32" cy="33" rx="3" ry="2" fill="#fb923c"/>
        <circle cx="32" cy="33" r="1" fill="#7f1d1d"/>
        <path d="M26 37 Q32 41 38 37" stroke="#d97706" stroke-width="1.5" fill="none"/>
        <line x1="22" y1="34" x2="14" y2="32" stroke="#d97706" stroke-width="1.2"/>
        <line x1="22" y1="36" x2="13" y2="36" stroke="#d97706" stroke-width="1.2"/>
        <line x1="42" y1="34" x2="50" y2="32" stroke="#d97706" stroke-width="1.2"/>
        <line x1="42" y1="36" x2="51" y2="36" stroke="#d97706" stroke-width="1.2"/>
      </svg>`
    },
    {
      id: 'av-neko',
      name: 'Neko',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="36" r="24" fill="#1a1a2e"/>
        <polygon points="18,24 12,10 25,22" fill="#c4b5fd"/>
        <polygon points="46,24 52,10 39,22" fill="#c4b5fd"/>
        <polygon points="20,24 15,12 25,22" fill="#f0abfc"/>
        <polygon points="44,24 49,12 39,22" fill="#f0abfc"/>
        <circle cx="32" cy="32" r="15" fill="#e0d7f8"/>
        <ellipse cx="26" cy="31" rx="3.5" ry="4" fill="#1a1a2e"/>
        <ellipse cx="38" cy="31" rx="3.5" ry="4" fill="#1a1a2e"/>
        <ellipse cx="26" cy="31" rx="1.5" ry="3" fill="#7c3aed"/>
        <ellipse cx="38" cy="31" rx="1.5" ry="3" fill="#7c3aed"/>
        <circle cx="26.8" cy="29.5" r=".8" fill="#fff"/>
        <circle cx="38.8" cy="29.5" r=".8" fill="#fff"/>
        <ellipse cx="32" cy="35" rx="2.5" ry="1.5" fill="#f472b6"/>
        <path d="M28 38 Q32 41 36 38" stroke="#a78bfa" stroke-width="1.5" fill="none"/>
        <line x1="20" y1="35" x2="10" y2="33" stroke="#a78bfa" stroke-width="1.2"/>
        <line x1="20" y1="37" x2="10" y2="37" stroke="#a78bfa" stroke-width="1.2"/>
        <line x1="44" y1="35" x2="54" y2="33" stroke="#a78bfa" stroke-width="1.2"/>
        <line x1="44" y1="37" x2="54" y2="37" stroke="#a78bfa" stroke-width="1.2"/>
      </svg>`
    },
    {
      id: 'av-samurai',
      name: 'Samurai',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="#0f1729"/>
        <rect x="18" y="10" width="28" height="24" rx="6" fill="#1e3a5f"/>
        <rect x="16" y="14" width="32" height="8" rx="4" fill="#1a1a2e"/>
        <rect x="20" y="14" width="24" height="8" rx="3" fill="#0f1729"/>
        <rect x="16" y="12" width="32" height="6" rx="3" fill="#334155"/>
        <circle cx="32" cy="30" r="10" fill="#fde8d8"/>
        <ellipse cx="28" cy="29" rx="2.5" ry="3" fill="#1a1a2e"/>
        <ellipse cx="36" cy="29" rx="2.5" ry="3" fill="#1a1a2e"/>
        <path d="M28 34 Q32 37 36 34" stroke="#ef4444" stroke-width="1.5" fill="none"/>
        <rect x="22" y="8" width="20" height="4" rx="2" fill="#dc2626"/>
        <rect x="14" y="34" width="36" height="16" rx="5" fill="#1e3a5f"/>
        <line x1="32" y1="34" x2="32" y2="50" stroke="#334155" stroke-width="2"/>
        <rect x="26" y="50" width="12" height="3" rx="1.5" fill="#334155"/>
      </svg>`
    },
    {
      id: 'av-miko',
      name: 'Miko',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="#1f0a0a"/>
        <circle cx="32" cy="26" r="12" fill="#fde8d8"/>
        <path d="M20 18 Q32 10 44 18 L44 24 Q32 16 20 24 Z" fill="#1a1a2e"/>
        <rect x="18" y="14" width="28" height="6" rx="3" fill="#dc2626"/>
        <ellipse cx="28" cy="27" rx="2.5" ry="2.8" fill="#1a1a2e"/>
        <ellipse cx="36" cy="27" rx="2.5" ry="2.8" fill="#1a1a2e"/>
        <circle cx="28.8" cy="26" r=".8" fill="#fff"/>
        <circle cx="36.8" cy="26" r=".8" fill="#fff"/>
        <path d="M29 31 Q32 33.5 35 31" stroke="#f472b6" stroke-width="1.5" fill="none"/>
        <ellipse cx="32" cy="30" rx="2" ry="1.2" fill="#fca5a5"/>
        <rect x="20" y="38" width="24" height="16" rx="4" fill="#dc2626"/>
        <rect x="23" y="38" width="2" height="16" fill="#fbbf24" opacity=".6"/>
        <rect x="39" y="38" width="2" height="16" fill="#fbbf24" opacity=".6"/>
        <rect x="18" y="38" width="28" height="4" rx="2" fill="#fff"/>
      </svg>`
    },
    {
      id: 'av-scholar',
      name: 'Gakusei',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="#0a1628"/>
        <circle cx="32" cy="28" r="13" fill="#fde8d8"/>
        <rect x="22" y="24" width="8" height="6" rx="2.5" fill="none" stroke="#1a1a2e" stroke-width="1.5"/>
        <rect x="34" y="24" width="8" height="6" rx="2.5" fill="none" stroke="#1a1a2e" stroke-width="1.5"/>
        <line x1="30" y1="27" x2="34" y2="27" stroke="#1a1a2e" stroke-width="1.5"/>
        <circle cx="26" cy="27" r="1.5" fill="#4a9eff" opacity=".7"/>
        <circle cx="38" cy="27" r="1.5" fill="#4a9eff" opacity=".7"/>
        <path d="M28 33 Q32 36 36 33" stroke="#fb923c" stroke-width="1.5" fill="none"/>
        <path d="M20 18 Q32 12 44 18 L40 22 Q32 18 24 22Z" fill="#1e40af"/>
        <polygon points="32,10 44,18 20,18" fill="#2563eb"/>
        <circle cx="32" cy="10" r="2" fill="#fbbf24"/>
        <rect x="18" y="40" width="28" height="14" rx="4" fill="#1e40af"/>
        <line x1="32" y1="40" x2="32" y2="54" stroke="#3b82f6" stroke-width="2"/>
        <rect x="20" y="46" width="10" height="7" rx="2" fill="#dbeafe" opacity=".4"/>
      </svg>`
    },
    {
      id: 'av-oni',
      name: 'Oni',
      svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="#1a0a2e"/>
        <circle cx="32" cy="30" r="16" fill="#7c3aed"/>
        <polygon points="24,16 20,6 28,15" fill="#a855f7"/>
        <polygon points="40,16 44,6 36,15" fill="#a855f7"/>
        <polygon points="26,17 22,8 29,16" fill="#fbbf24"/>
        <polygon points="38,17 42,8 35,16" fill="#fbbf24"/>
        <ellipse cx="26" cy="29" rx="4" ry="4.5" fill="#fff"/>
        <ellipse cx="38" cy="29" rx="4" ry="4.5" fill="#fff"/>
        <ellipse cx="26" cy="30" rx="2.5" ry="3" fill="#ef4444"/>
        <ellipse cx="38" cy="30" rx="2.5" ry="3" fill="#dc2626"/>
        <circle cx="26.8" cy="28.5" r="1" fill="#fff"/>
        <circle cx="38.8" cy="28.5" r="1" fill="#fff"/>
        <path d="M26 37 Q29 40 32 38 Q35 40 38 37" stroke="#fbbf24" stroke-width="1.5" fill="none"/>
        <rect x="28" y="35" width="3" height="4" rx="1" fill="#fbbf24"/>
        <rect x="33" y="35" width="3" height="4" rx="1" fill="#fbbf24"/>
        <ellipse cx="32" cy="34" rx="3" ry="2" fill="#c4b5fd" opacity=".5"/>
      </svg>`
    }
  ];

  // ── Achievement Definitions ──────────────────────────────
  const ACHIEVEMENTS = [
    // 🌱 Pemula — mudah didapat, cocok untuk pengguna baru
    { id: 'app_start',    cat: '🌱 Pemula', icon: '🎌', name: 'Selamat Datang!',      desc: 'Buka MNN Learning untuk pertama kali',   check: (d) => true },
    { id: 'vocab_first',  cat: '🌱 Pemula', icon: '✨', name: 'Kosakata Pertama',     desc: 'Hafalkan 1 kosakata pertamamu',          check: (d) => d._vocabLearned >= 1 },
    { id: 'grammar_first',cat: '🌱 Pemula', icon: '📌', name: 'Tata Bahasa Pertama',  desc: 'Pelajari 1 poin tata bahasa',            check: (d) => d._grammarDone >= 1 },
    { id: 'quiz_first',   cat: '🌱 Pemula', icon: '🎮', name: 'Quiz Perdana',         desc: 'Selesaikan 1 sesi quiz apapun',          check: (d) => d._quizDone >= 1 },
    { id: 'streak_today', cat: '🌱 Pemula', icon: '🌟', name: 'Belajar Hari Ini!',   desc: 'Aktif belajar setidaknya 1 hari',        check: (d) => (d.currentStreak >= 1 || d.bestStreak >= 1) },
    // 📚 Belajar
    { id: 'first_lesson', cat: '📚 Belajar', icon: '📖', name: 'Pelajaran Pertama',  desc: 'Hafalkan 5 kosakata (mulai pelajaran)',  check: (d) => d._vocabLearned >= 5 },
    { id: 'vocab_10',     cat: '📚 Belajar', icon: '📝', name: '10 Kotoba',           desc: 'Hafalkan 10 kosakata',                   check: (d) => d._vocabLearned >= 10 },
    { id: 'vocab_50',     cat: '📚 Belajar', icon: '📚', name: '50 Kotoba',           desc: 'Hafalkan 50 kosakata',                   check: (d) => d._vocabLearned >= 50 },
    { id: 'vocab_100',    cat: '📚 Belajar', icon: '🏆', name: '100 Kotoba',          desc: 'Hafalkan 100 kosakata',                  check: (d) => d._vocabLearned >= 100 },
    { id: 'grammar_5',    cat: '📚 Belajar', icon: '🏷️', name: '5 Tata Bahasa',      desc: 'Pelajari 5 poin tata bahasa',            check: (d) => d._grammarDone >= 5 },
    { id: 'grammar_10',   cat: '📚 Belajar', icon: '🏫', name: '10 Tata Bahasa',      desc: 'Pelajari 10 poin tata bahasa',           check: (d) => d._grammarDone >= 10 },
    { id: 'grammar_25',   cat: '📚 Belajar', icon: '🎓', name: '25 Tata Bahasa',      desc: 'Pelajari 25 poin tata bahasa',           check: (d) => d._grammarDone >= 25 },
    // 🔥 Konsisten
    { id: 'streak_3',  cat: '🔥 Konsisten', icon: '🔥', name: 'Streak 3 Hari',  desc: 'Belajar 3 hari berturut-turut',  check: (d) => d.currentStreak >= 3 || d.bestStreak >= 3 },
    { id: 'streak_7',  cat: '🔥 Konsisten', icon: '⚡', name: 'Streak 7 Hari',  desc: 'Belajar 7 hari berturut-turut',  check: (d) => d.currentStreak >= 7 || d.bestStreak >= 7 },
    { id: 'streak_14', cat: '🔥 Konsisten', icon: '🌙', name: 'Streak 14 Hari', desc: 'Belajar 14 hari berturut-turut', check: (d) => d.currentStreak >= 14 || d.bestStreak >= 14 },
    { id: 'streak_30', cat: '🔥 Konsisten', icon: '👑', name: 'Streak 30 Hari', desc: 'Belajar 30 hari berturut-turut', check: (d) => d.currentStreak >= 30 || d.bestStreak >= 30 },
    // 🧠 Skill
    { id: 'quiz_5',       cat: '🧠 Skill', icon: '🎯', name: '5 Quiz Selesai',   desc: 'Selesaikan 5 sesi quiz',       check: (d) => d._quizDone >= 5 },
    { id: 'quiz_10',      cat: '🧠 Skill', icon: '🏅', name: '10 Quiz Selesai',  desc: 'Selesaikan 10 sesi quiz',      check: (d) => d._quizDone >= 10 },
    { id: 'quiz_50',      cat: '🧠 Skill', icon: '🥇', name: '50 Quiz Selesai',  desc: 'Selesaikan 50 sesi quiz',      check: (d) => d._quizDone >= 50 },
    { id: 'accuracy_80',  cat: '🧠 Skill', icon: '🎖️', name: 'Akurasi Master',  desc: 'Capai akurasi quiz 80%+',      check: (d) => d._bestAccuracy >= 80 },
    { id: 'level_3',      cat: '🧠 Skill', icon: '⭐', name: 'Level 3',          desc: 'Capai Level 3',                check: (d) => d.level >= 3 },
    { id: 'level_5',      cat: '🧠 Skill', icon: '🌟', name: 'Level 5',          desc: 'Capai Level 5',                check: (d) => d.level >= 5 },
  ];

  // ── Level Thresholds ──────────────────────────────────────
  // Level n requires sum of 100*i for i=1..n
  function _expForLevel(n) {
    let total = 0;
    for (let i = 1; i < n; i++) total += i * 100;
    return total;
  }

  function _levelFromExp(exp) {
    let lv = 1;
    while (_expForLevel(lv + 1) <= exp) lv++;
    return lv;
  }

  function _expToNext(exp) {
    const lv = _levelFromExp(exp);
    const nextThreshold = _expForLevel(lv + 1);
    return { needed: nextThreshold - _expForLevel(lv), progress: exp - _expForLevel(lv), pct: Math.min(100, Math.round(((exp - _expForLevel(lv)) / (nextThreshold - _expForLevel(lv))) * 100)) };
  }

  // ── Default data ──────────────────────────────────────────
  const _defaultData = () => ({
    totalEXP: 0,
    level: 1,
    currentStreak: 0,
    bestStreak: 0,
    lastActiveDate: '',
    unlockedAchievements: [],
    selectedAvatarId: 'av-ninja',
    _vocabLearned: 0,
    _grammarDone: 0,
    _quizDone: 0,
    _bestAccuracy: 0,
  });

  // ── Private state ─────────────────────────────────────────
  let _d = _defaultData();
  let _rewardTimeout = null;
  let _pendingAvatarId = null;

  // ── Persistence ───────────────────────────────────────────
  const STORAGE_KEY = 'mnn_gamify';

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_d)); } catch(e) {}
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        _d = Object.assign(_defaultData(), parsed);
      }
    } catch(e) { _d = _defaultData(); }
  }

  // ── Date helpers ──────────────────────────────────────────
  function _today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  function _daysDiff(a, b) {
    const da = new Date(a), db = new Date(b);
    return Math.round((db - da) / 86400000);
  }

  // ── Streak Logic ──────────────────────────────────────────
  function _trackActivity() {
    const today = _today();
    if (_d.lastActiveDate === today) {
      // Already logged today, but still re-check achievements in case data changed
      _checkAchievements();
      return;
    }
    if (_d.lastActiveDate) {
      const diff = _daysDiff(_d.lastActiveDate, today);
      if (diff === 1) {
        _d.currentStreak += 1;
      } else if (diff > 1) {
        _d.currentStreak = 1; // reset
      }
    } else {
      _d.currentStreak = 1;
    }
    _d.lastActiveDate = today;
    _d.bestStreak = Math.max(_d.bestStreak, _d.currentStreak);
    _save();
    _checkStreakMilestone();
    // FIX v2.6.1: Always re-check achievements after activity update
    _checkAchievements();
  }

  function _checkStreakMilestone() {
    const milestones = [3, 7, 14, 30];
    const labels = { 3: 'Awal Konsisten! 🌱', 7: 'Seminggu Stabil! 💪', 14: 'Dua Minggu Disiplin! 🔥', 30: 'Satu Bulan Master! 👑' };
    if (milestones.includes(_d.currentStreak)) {
      _showReward('🔥', `Streak ${_d.currentStreak} Hari!`, labels[_d.currentStreak], null);
    }
  }

  // ── EXP Logic ─────────────────────────────────────────────
  const EXP_MAP = { lesson: 50, quiz: 30, review: 10 };

  function _addEXP(type) {
    _trackActivity();
    const gain = EXP_MAP[type] || 10;
    const oldLevel = _levelFromExp(_d.totalEXP);
    _d.totalEXP += gain;
    const newLevel = _levelFromExp(_d.totalEXP);
    _d.level = newLevel;

    // Sync vocab/quiz counts from STATE if available
    try {
      if (type === 'review' && window.STATE && window.STATE.learnedCards) {
        _d._vocabLearned = Math.max(_d._vocabLearned, window.STATE.learnedCards.size);
      }
      if (type === 'quiz') _d._quizDone += 1;
    } catch(e) {}

    _save();
    _showReward('✨', `+${gain} EXP`, `${type === 'lesson' ? 'Pelajaran selesai' : type === 'quiz' ? 'Quiz selesai' : 'Kosakata dihafal'}`, gain);

    if (newLevel > oldLevel) {
      setTimeout(() => _showLevelUp(newLevel), 800);
    }

    _checkAchievements();
    _renderDashboardWidget();
  }

  // ── Achievement Logic ─────────────────────────────────────
  function _checkAchievements() {
    // FIX v2.6.3: gunakan STATE langsung (bukan window.STATE) + localStorage fallback
    try {
      const rawL = localStorage.getItem('mnn_learned');
      const rawB = localStorage.getItem('mnn_bunpou_prog');
      // Vocab count: prioritas STATE, fallback localStorage
      const vocabCount = (typeof STATE !== 'undefined' && STATE.learnedCards && STATE.learnedCards.size > 0)
          ? STATE.learnedCards.size
          : (window.STATE?.learnedCards?.size > 0 ? window.STATE.learnedCards.size : 0)
          || (rawL ? JSON.parse(rawL).length : 0);
      if (vocabCount > 0) _d._vocabLearned = Math.max(_d._vocabLearned, vocabCount);
      // Grammar count: prioritas STATE, fallback localStorage
      const bpSrc = (typeof STATE !== 'undefined' && STATE.bunpouProgress)
          ? STATE.bunpouProgress
          : (window.STATE?.bunpouProgress || (rawB ? JSON.parse(rawB) : null));
      if (bpSrc) {
        const bpCount = Object.values(bpSrc).filter(Boolean).length;
        if (bpCount > 0) _d._grammarDone = Math.max(_d._grammarDone, bpCount);
      }
    } catch(e) {}

    let newUnlocks = [];
    for (const ach of ACHIEVEMENTS) {
      if (!_d.unlockedAchievements.includes(ach.id)) {
        if (ach.check(_d)) {
          _d.unlockedAchievements.push(ach.id);
          newUnlocks.push(ach);
        }
      }
    }
    if (newUnlocks.length) {
      _save();
      newUnlocks.forEach((ach, i) => {
        setTimeout(() => {
          _showReward(ach.icon, `Achievement Unlock!`, ach.name, null);
        }, i * 1200);
      });
    }
  }

  // ── Reward Popup ──────────────────────────────────────────
  function _showReward(icon, title, sub, exp) {
    const popup = document.getElementById('gfy-reward-popup');
    if (!popup) return;

    popup.querySelector('.gfy-reward-icon').textContent = icon;
    popup.querySelector('.gfy-reward-title').textContent = title;
    popup.querySelector('.gfy-reward-sub').textContent = sub;
    const badge = popup.querySelector('.gfy-exp-badge');
    if (exp !== null && exp !== undefined) {
      badge.style.display = '';
      badge.textContent = '+' + exp + ' EXP';
    } else {
      badge.style.display = 'none';
    }

    popup.classList.remove('show');
    clearTimeout(_rewardTimeout);
    // Force reflow
    popup.offsetHeight;
    popup.classList.add('show');
    _rewardTimeout = setTimeout(() => popup.classList.remove('show'), 2800);
  }

  function _showLevelUp(level) {
    const overlay = document.getElementById('gfy-levelup-overlay');
    if (!overlay) return;
    const numEl = overlay.querySelector('.gfy-levelup-num');
    const subEl = overlay.querySelector('.gfy-levelup-sub');
    if (numEl) numEl.textContent = level;
    if (subEl) {
      const msgs = ['Bagus! Terus belajar!', 'Luar biasa!', 'Kamu semakin hebat!', 'Tak terbendung!', 'Legenda berjalan! 🏆'];
      subEl.textContent = msgs[Math.min(level - 2, msgs.length - 1)] || 'Terus semangat!';
    }
    overlay.classList.add('show');
  }

  // ── Avatar Helpers ────────────────────────────────────────
  function _getAvatar(id) {
    return AVATARS.find(a => a.id === id) || AVATARS[0];
  }

  function _getAvatarSvg(id) {
    return _getAvatar(id).svg;
  }

  // ── Dashboard Widget Renderer ─────────────────────────────
  function _renderDashboardWidget() {
    const hero = document.getElementById('gfy-dashboard-hero');
    if (!hero) return;

    const lv = _d.level;
    const { progress, needed, pct } = _expToNext(_d.totalEXP);
    const streak = _d.currentStreak;
    const avSvg = _getAvatarSvg(_d.selectedAvatarId);

    // Unlock count
    const unlockCount = _d.unlockedAchievements.length;
    const totalAch = ACHIEVEMENTS.length;

    // Streak pill class
    const streakClass = streak >= 7 ? 'hot' : '';

    // Recent achievements (last 3 unlocked)
    const recentAch = _d.unlockedAchievements.slice(-3).map(id => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      return a ? `<span title="${a.name}" style="font-size:14px">${a.icon}</span>` : '';
    }).join('');

    hero.innerHTML = `
      <div class="gfy-hero">
        <div class="gfy-avatar-wrap">
          <div class="gfy-avatar-circle" onclick="GAMIFY.openAvatarModal()" title="Pilih Avatar">
            ${avSvg}
          </div>
          <div class="gfy-level-badge">Lv.${lv}</div>
        </div>
        <div class="gfy-info">
          <div class="gfy-name-row">
            <span class="gfy-level-label">Level ${lv}</span>
            <span class="gfy-streak-pill ${streakClass}">🔥 ${streak} Hari</span>
          </div>
          <div class="gfy-exp-bar-wrap">
            <div class="gfy-exp-label">
              <span>${progress} / ${needed} EXP</span>
              <span>${_d.totalEXP} Total</span>
            </div>
            <div class="gfy-exp-track">
              <div class="gfy-exp-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="gfy-stats-row">
            <div class="gfy-stat-chip" onclick="navigateTo('achievements')" style="cursor:pointer;border-color:rgba(196,181,253,.4)">🏆 <span>${unlockCount}/${totalAch}</span> Achievement →</div>
            ${recentAch ? `<div class="gfy-stat-chip">${recentAch}</div>` : ''}
          </div>
        </div>
      </div>
      <div id="gfy-streak-milestones"></div>
    `;

    _renderStreakMilestones();
  }

  function _renderStreakMilestones() {
    const el = document.getElementById('gfy-streak-milestones');
    if (!el) return;
    const milestones = [
      { day: 3, icon: '🌱', label: 'Konsisten' },
      { day: 7, icon: '💪', label: 'Stabil' },
      { day: 14, icon: '🔥', label: 'Disiplin' },
      { day: 30, icon: '👑', label: 'Master' },
    ];
    const streak = Math.max(_d.currentStreak, _d.bestStreak);
    el.innerHTML = `<div class="gfy-milestone-row">` +
      milestones.map(m => `
        <div class="gfy-milestone ${streak >= m.day ? 'reached' : ''}">
          <span class="ms-icon">${m.icon}</span>
          <span class="ms-day">${m.day}</span>
          <span>${m.label}</span>
        </div>`).join('') +
      `</div>`;
  }

  // ── Avatar Modal ──────────────────────────────────────────
  function _openAvatarModal() {
    _pendingAvatarId = _d.selectedAvatarId;
    const modal = document.getElementById('gfy-avatar-modal');
    if (!modal) return;

    const grid = modal.querySelector('.gfy-avatar-grid');
    grid.innerHTML = AVATARS.map(av => `
      <div class="gfy-av-item ${av.id === _pendingAvatarId ? 'selected' : ''}"
           data-avid="${av.id}"
           onclick="GAMIFY._selectAvatarPreview('${av.id}')">
        ${av.svg}
        <span class="gfy-av-name">${av.name}</span>
      </div>
    `).join('');

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function _selectAvatarPreview(id) {
    _pendingAvatarId = id;
    document.querySelectorAll('.gfy-av-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.avid === id);
    });
  }

  function _confirmAvatar() {
    if (!_pendingAvatarId) return;
    _d.selectedAvatarId = _pendingAvatarId;
    _save();
    _closeAvatarModal();
    _renderDashboardWidget();
    _updateHeaderAvatar();
    // Refresh profile sheet avatar if profile panel is currently open
    const profilePanel = document.getElementById('profile-panel-inner');
    if (profilePanel) {
      const bigAvEl = profilePanel.querySelector('.profile-avatar-big');
      if (bigAvEl) { bigAvEl.style.fontSize = '0'; bigAvEl.innerHTML = _getAvatarSvg(_d.selectedAvatarId); }
    }
    _showReward('🎨', 'Avatar diperbarui!', 'Tampilan baru sudah diterapkan', null);
  }

  function _closeAvatarModal() {
    const modal = document.getElementById('gfy-avatar-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── Header Avatar Sync ────────────────────────────────────
  function _updateHeaderAvatar() {
    const icon = document.getElementById('profile-avatar-icon');
    if (!icon) return;
    // Only replace with SVG if user is NOT logged in (to not break auth state)
    // We show SVG inside profile button when user is in guest mode or logged in
    // We inject a tiny SVG wrapper
    if (icon.tagName === 'SPAN') {
      const avSvg = _getAvatarSvg(_d.selectedAvatarId);
      icon.innerHTML = avSvg;
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.justifyContent = 'center';
      icon.style.width = '100%';
      icon.style.height = '100%';
    }
  }

  // ── Profile Panel Extension ───────────────────────────────
  function _renderProfileGamifySection() {
    const lv = _d.level;
    const { pct } = _expToNext(_d.totalEXP);
    const unlockCount = _d.unlockedAchievements.length;

    return `
      <div class="gfy-profile-section">
        <div class="gfy-profile-row">
          <div class="gfy-prf-stat">
            <div class="gfy-prf-val">Lv.${lv}</div>
            <div class="gfy-prf-lbl">Level</div>
          </div>
          <div class="gfy-prf-stat">
            <div class="gfy-prf-val">${_d.totalEXP}</div>
            <div class="gfy-prf-lbl">Total EXP</div>
          </div>
          <div class="gfy-prf-stat">
            <div class="gfy-prf-val">🔥${_d.currentStreak}</div>
            <div class="gfy-prf-lbl">Streak Hari</div>
          </div>
          <div class="gfy-prf-stat">
            <div class="gfy-prf-val">${unlockCount}</div>
            <div class="gfy-prf-lbl">Achievement</div>
          </div>
        </div>
        <div class="gfy-exp-bar-wrap">
          <div class="gfy-exp-label">
            <span>EXP ke Level ${lv+1}</span><span>${pct}%</span>
          </div>
          <div class="gfy-exp-track">
            <div class="gfy-exp-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <button onclick="GAMIFY.openAvatarModal()" style="margin-top:10px;width:100%;padding:9px;border-radius:10px;border:1.5px solid var(--border-strong);background:transparent;color:var(--text-secondary);font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span style="width:24px;height:24px;display:inline-flex">${_getAvatarSvg(_d.selectedAvatarId)}</span>
          Ganti Avatar
        </button>
      </div>
    `;
  }

  // ── Achievements Page ─────────────────────────────────────
  function _renderAchievementsPage() {
    const page = document.getElementById('page-achievements');
    if (!page) return;

    const cats = [...new Set(ACHIEVEMENTS.map(a => a.cat))];
    page.innerHTML = `
      <div style="padding:16px 0 4px;display:flex;align-items:center;gap:8px">
        <button onclick="navigateTo('dashboard')" style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer;padding:4px;line-height:1">←</button>
        <span style="font-size:16px;font-weight:800;color:var(--text-primary)">🏆 Achievement</span>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;padding-left:2px">${_d.unlockedAchievements.length} / ${ACHIEVEMENTS.length} di-unlock</p>
    ` + cats.map(cat => {
      const items = ACHIEVEMENTS.filter(a => a.cat === cat);
      return `
        <div class="gfy-ach-section">
          <div class="gfy-ach-section-title">${cat}</div>
          <div class="gfy-ach-grid">
            ${items.map(ach => {
              const unlocked = _d.unlockedAchievements.includes(ach.id);
              return `
                <div class="gfy-ach-card ${unlocked ? 'unlocked' : 'locked'}" onclick="GAMIFY._showAchDetail('${ach.id}')">
                  <div class="gfy-ach-icon">${ach.icon}</div>
                  <div class="gfy-ach-name">${ach.name}</div>
                  ${unlocked ? '<div class="gfy-ach-check">✓</div>' : ''}
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function _showAchDetail(id) {
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (!ach) return;
    const unlocked = _d.unlockedAchievements.includes(id);
    _showReward(ach.icon, ach.name, unlocked ? '✓ Sudah di-unlock!' : ach.desc, null);
  }

  // ── Init & Hooks ──────────────────────────────────────────
  function _init() {
    _load();
    // FIX v2.6.1: Track activity on every app open so streak always increments
    _trackActivity();
    // Check achievements on every init (catches app_start + any already-earned)
    _checkAchievements();

    // Inject reward popup if not present
    if (!document.getElementById('gfy-reward-popup')) {
      const popup = document.createElement('div');
      popup.id = 'gfy-reward-popup';
      popup.innerHTML = `<div class="gfy-reward-inner">
        <div class="gfy-reward-icon">✨</div>
        <div class="gfy-reward-text">
          <div class="gfy-reward-title">—</div>
          <div class="gfy-reward-sub">—</div>
        </div>
        <div class="gfy-exp-badge">+10 EXP</div>
      </div>`;
      document.body.appendChild(popup);
    }

    // Inject level-up overlay if not present
    if (!document.getElementById('gfy-levelup-overlay')) {
      const ov = document.createElement('div');
      ov.id = 'gfy-levelup-overlay';
      ov.innerHTML = `<div class="gfy-levelup-card">
        <div style="font-size:40px;margin-bottom:6px">🎉</div>
        <div class="gfy-levelup-label">Level Up!</div>
        <div class="gfy-levelup-num">2</div>
        <div class="gfy-levelup-sub">Bagus!</div>
        <button class="gfy-levelup-btn" onclick="document.getElementById('gfy-levelup-overlay').classList.remove('show')">Lanjutkan ✨</button>
      </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', function(e) {
        if (e.target === ov) ov.classList.remove('show');
      });
    }

    // Inject avatar modal if not present
    if (!document.getElementById('gfy-avatar-modal')) {
      const modal = document.createElement('div');
      modal.id = 'gfy-avatar-modal';
      modal.innerHTML = `
        <div class="gfy-avatar-bg" onclick="GAMIFY.closeAvatarModal()"></div>
        <div class="gfy-avatar-sheet">
          <div class="gfy-avatar-handle"></div>
          <div class="gfy-avatar-title">Pilih Avatar</div>
          <div class="gfy-avatar-sub">Tampilan di dashboard & profil kamu</div>
          <div class="gfy-avatar-grid"></div>
          <button class="gfy-avatar-confirm" onclick="GAMIFY._confirmAvatar()">✓ Terapkan Avatar</button>
        </div>`;
      document.body.appendChild(modal);
    }

    // Inject achievements page if not present
    if (!document.getElementById('page-achievements')) {
      // Must inject inside <main> so navigateTo() layout works correctly
      const mainContent = document.querySelector('main.main-content') ||
                          document.querySelector('main') ||
                          document.getElementById('app');
      if (mainContent) {
        const pg = document.createElement('section');
        pg.className = 'page';
        pg.id = 'page-achievements';
        pg.style.cssText = 'display:none;flex-direction:column;gap:0;padding:16px;overflow-y:auto;';
        mainContent.appendChild(pg);
      }
    }

    // Sinkronisasi _vocabLearned & _grammarDone dari STATE saat init
    // (mencegah achievement tidak terpicu jika data sudah ada sebelum gamify patch aktif)
    // FIX v2.6.3: pakai STATE langsung + localStorage fallback
    try {
      const rawL2 = localStorage.getItem('mnn_learned');
      const rawB2 = localStorage.getItem('mnn_bunpou_prog');
      const initVocab = (typeof STATE !== 'undefined' && STATE.learnedCards && STATE.learnedCards.size > 0)
          ? STATE.learnedCards.size
          : (window.STATE?.learnedCards?.size || 0)
          || (rawL2 ? JSON.parse(rawL2).length : 0);
      if (initVocab > 0) _d._vocabLearned = Math.max(_d._vocabLearned, initVocab);
      const bpSrc2 = (typeof STATE !== 'undefined' && STATE.bunpouProgress)
          ? STATE.bunpouProgress
          : (window.STATE?.bunpouProgress || (rawB2 ? JSON.parse(rawB2) : null));
      if (bpSrc2) {
        const gc = Object.values(bpSrc2).filter(Boolean).length;
        if (gc > 0) _d._grammarDone = Math.max(_d._grammarDone, gc);
      }
      _save();
      // FIX v2.6.3: check achievements immediately after sync
      _checkAchievements();
    } catch(e) {}

    // Render dashboard widget on load
    setTimeout(() => {
      _renderDashboardWidget();
      _updateHeaderAvatar();
      _checkAchievements();
    }, 400);

    // Patch openProfileSheet to inject back/close button
    if (typeof window.openProfileSheet === 'function') {
      const _origOpenSheet = window.openProfileSheet;
      window.openProfileSheet = function() {
        _origOpenSheet.apply(this, arguments);
        // Add back button after renderProfilePanel sets innerHTML
        const panel = document.getElementById('profile-panel-inner');
        if (panel && !panel.querySelector('.gfy-sheet-back-btn')) {
          const btn = document.createElement('button');
          btn.className = 'gfy-sheet-back-btn';
          btn.innerHTML = '← Kembali ke Dashboard';
          btn.style.cssText = [
            'align-self:flex-start',
            'background:var(--bg-card)',
            'border:1px solid var(--border-strong)',
            'border-radius:10px',
            'color:var(--text-secondary)',
            'font-size:12px',
            'font-weight:700',
            'cursor:pointer',
            'font-family:"DM Sans",sans-serif',
            'padding:7px 14px',
            'display:flex',
            'align-items:center',
            'gap:6px',
            'margin-bottom:8px',
            'transition:color .18s,border-color .18s',
          ].join(';');
          btn.onmouseenter = function() {
            this.style.color = 'var(--accent-primary)';
            this.style.borderColor = 'rgba(196,181,253,.5)';
          };
          btn.onmouseleave = function() {
            this.style.color = 'var(--text-secondary)';
            this.style.borderColor = 'var(--border-strong)';
          };
          btn.onclick = function() {
            if (typeof closeProfileSheet === 'function') closeProfileSheet();
          };
          // Insert right after the drag handle
          const handle = panel.querySelector('.profile-sheet-handle');
          if (handle && handle.nextSibling) {
            panel.insertBefore(btn, handle.nextSibling);
          } else {
            panel.insertBefore(btn, panel.firstChild);
          }
        }
      };
    }

    // Patch updateProfileUI to also update header avatar
    if (typeof window.updateProfileUI === 'function') {
      const _origPUI = window.updateProfileUI;
      window.updateProfileUI = function() {
        _origPUI.apply(this, arguments);
        // Only show gamify SVG when icon is showing emoji (not photo)
        setTimeout(_updateHeaderAvatar, 50);
      };
    }

    // ── Monkey-patch key functions ──────────────────────────

    // 1. toggleLearnedCard → EXP on marking as learned
    if (typeof window.toggleLearnedCard === 'function') {
      const _orig = window.toggleLearnedCard;
      window.toggleLearnedCard = function() {
        const sizeBefore = (window.STATE && window.STATE.learnedCards) ? window.STATE.learnedCards.size : 0;
        _orig.apply(this, arguments);
        const sizeAfter = (window.STATE && window.STATE.learnedCards) ? window.STATE.learnedCards.size : 0;
        if (sizeAfter > sizeBefore) {
          _addEXP('review');
          _d._vocabLearned = sizeAfter;
          _save();
          // FIX v2.6.2: trigger achievement check immediately after vocab learned
          _checkAchievements();
        }
        // FIX v2.6.4: always refresh counter on toggle (also handles un-hafal / delete)
        if (sizeAfter !== sizeBefore && typeof renderVocabDbCard === 'function') {
          renderVocabDbCard();
        }
      };
    }

    // 2. renderQuizResult → EXP on quiz finish
    if (typeof window.renderQuizResult === 'function') {
      const _origQR = window.renderQuizResult;
      window.renderQuizResult = function() {
        _origQR.apply(this, arguments);
        const score = window.STATE ? window.STATE.quizScore : 0;
        const total = window.STATE ? (window.STATE.quizData || []).length : 10;
        _addEXP('quiz');
        if (total > 0) {
          const acc = Math.round((score / total) * 100);
          _d._bestAccuracy = Math.max(_d._bestAccuracy || 0, acc);
          _save();
        }
        _checkAchievements();
      };
    }

    // 3. navigateTo → refresh widget when going to dashboard
    if (typeof window.navigateTo === 'function') {
      const _origNav = window.navigateTo;
      window.navigateTo = function(page) {
        // Hide achievement page inline style before navigateTo runs (fixes display:flex not being cleared)
        const achPage = document.getElementById('page-achievements');
        if (achPage) {
          achPage.style.display = '';
          achPage.classList.remove('active');
        }
        _origNav.apply(this, arguments);
        if (page === 'dashboard') {
          setTimeout(_renderDashboardWidget, 50);
        }
        if (page === 'achievements') {
          if (achPage) {
            achPage.classList.add('active');
            achPage.style.display = 'flex';
          }
          _renderAchievementsPage();
        }
      };
    }

    // 4. Grammar EXP — observe bunpouProgress via STATE.save
    if (window.STATE && typeof window.STATE.save === 'function') {
      const _origSave = window.STATE.save.bind(window.STATE);
      // Inisialisasi _prevGrammarCount dari data yang SUDAH ADA di STATE
      // agar panggilan STATE.save pertama tidak dihitung sebagai grammar baru
      let _prevGrammarCount = Object.values(window.STATE.bunpouProgress || {}).filter(Boolean).length;
      window.STATE.save = function() {
        const newCount = Object.values(window.STATE.bunpouProgress || {}).filter(Boolean).length;
        if (newCount > _prevGrammarCount) {
          _d._grammarDone = newCount;
          _save();
          _addEXP('lesson');
          _checkAchievements();
        }
        _prevGrammarCount = newCount;
        _origSave();
      };
    }

    console.log('[GAMIFY] Initialized. Level:', _d.level, '| Streak:', _d.currentStreak, '| EXP:', _d.totalEXP);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init: _init,
    addEXP: _addEXP,
    trackActivity: _trackActivity,
    renderDashboardWidget: _renderDashboardWidget,
    renderAchievementsPage: _renderAchievementsPage,
    openAvatarModal: _openAvatarModal,
    closeAvatarModal: _closeAvatarModal,
    _selectAvatarPreview: _selectAvatarPreview,
    _confirmAvatar: _confirmAvatar,
    _showAchDetail: _showAchDetail,
    getProfileSection: _renderProfileGamifySection,
    getData: () => ({ ..._d }),
    getAvatarSvg: _getAvatarSvg,
    getSelectedAvatarId: () => _d.selectedAvatarId,
  };
})();

// ── Auto-init after DOM ready ──────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(GAMIFY.init, 600));
} else {
  setTimeout(GAMIFY.init, 600);
}

// ── Global refreshAchievements — call whenever progress changes ──
// FIX v2.6.1: Central function to re-evaluate all achievements
function refreshAchievements() {
  if (typeof GAMIFY !== 'undefined' && GAMIFY.trackActivity) {
    GAMIFY.trackActivity();
  }
}


const JLPT_MODULE = (() => {
  let _activeFilter = 'all';

  // Heuristic: Book1 vocab (lessonId 1-25) = N5, Book2 (26-50) = N4
  // master_kotoba: id kotoba_0001..1000 = N5, 1001..1949 = N4
  function getLevel(v) {
    // DB vocab: check lessonId
    if (v.lessonId) {
      const lid = parseInt(v.lessonId, 10);
      if (lid >= 1 && lid <= 25)  return 'N5';
      if (lid >= 26 && lid <= 50) return 'N4';
    }
    // book field on vocab
    if (v._book === 'book1' || v.book === 'book1') return 'N5';
    if (v._book === 'book2' || v.book === 'book2') return 'N4';
    // master_kotoba by id number
    if (v._id || v.id) {
      const raw = String(v._id || v.id).replace(/[^0-9]/g,'');
      const num = parseInt(raw, 10);
      if (!isNaN(num)) {
        if (num <= 1000) return 'N5';
        return 'N4';
      }
    }
    // DB vocab without lessonId — derive from source book
    if (v._src === 'master') {
      return 'N5'; // fallback
    }
    return 'N5';
  }

  function setFilter(level, el) {
    _activeFilter = level;
    document.querySelectorAll('.jlpt-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    // Also reset any book filter to 'all' to avoid double-filter confusion
    renderKotobaPage();
    _renderMini();
  }

  function getActiveFilter() { return _activeFilter; }

  function matchesFilter(v) {
    if (_activeFilter === 'all') return true;
    return getLevel(v) === _activeFilter;
  }

  // Count totals for stats
  function getCounts() {
    const all = getKotobaAllVocab ? getKotobaAllVocab() : [];
    const n5 = all.filter(v => getLevel(v) === 'N5');
    const n4 = all.filter(v => getLevel(v) === 'N4');
    const n3 = all.filter(v => getLevel(v) === 'N3');
    const learned = window.STATE ? window.STATE.learnedCards : new Set();
    function learnedCount(arr) {
      return arr.filter(v => {
        const k = (v.kana||v.kanji||v.jp||'') + '||' + v.arti;
        return learned.has(k);
      }).length;
    }
    return {
      n5: { total: n5.length, learned: learnedCount(n5) },
      n4: { total: n4.length, learned: learnedCount(n4) },
      n3: { total: n3.length, learned: learnedCount(n3) },
    };
  }

  function _renderMini() {
    const el = document.getElementById('jlpt-progress-mini');
    if (!el) return;
    if (_activeFilter === 'all') { el.innerHTML=''; return; }
    const counts = getCounts();
    const c = counts[_activeFilter.toLowerCase()];
    if (!c) return;
    const pct = c.total > 0 ? Math.round((c.learned / c.total) * 100) : 0;
    const color = _activeFilter==='N5'?'#34d399':_activeFilter==='N4'?'#4a9eff':'#fb923c';
    el.innerHTML = `<div class="jlpt-progress-wrap" style="margin-top:4px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted)">Progress ${_activeFilter}</span>
        <span style="font-size:12px;font-weight:800;color:${color}">${c.learned} / ${c.total} kata hafal</span>
      </div>
      <div style="height:6px;background:var(--border-strong);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width .6s ease"></div>
      </div>
    </div>`;
  }

  function renderStatsProgress(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const counts = getCounts();
    const levels = [
      { key:'n5', label:'N5', cls:'jlpt-n5', color:'#34d399' },
      { key:'n4', label:'N4', cls:'jlpt-n4', color:'#4a9eff' },
      { key:'n3', label:'N3', cls:'jlpt-n3', color:'#fb923c' },
    ];
    el.innerHTML = `<div class="jlpt-progress-wrap">
      ${levels.map(lv => {
        const c = counts[lv.key];
        const pct = c.total > 0 ? Math.round((c.learned/c.total)*100) : 0;
        return `<div class="jlpt-progress-row">
          <span class="jlpt-level-badge ${lv.cls}">${lv.label}</span>
          <div class="jlpt-progress-bar-w"><div class="jlpt-progress-bar-f" style="width:${pct}%;background:${lv.color}"></div></div>
          <span class="jlpt-progress-count">${c.learned}/${c.total}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  return { getLevel, setFilter, getActiveFilter, matchesFilter, getCounts, renderStatsProgress };
})();


const MISSIONS = (() => {
  const SK = 'mnn_missions_v1';
  const TODAY = () => new Date().toISOString().slice(0,10);

  const TEMPLATES = [
    { id:'vocab_10', icon:'📖', title:'Pelajari 10 kosakata baru', goal:10, exp:20, type:'vocab' },
    { id:'quiz_1',  icon:'🎯', title:'Selesaikan 1 sesi quiz',    goal:1,  exp:30, type:'quiz'  },
    { id:'flash_5', icon:'🃏', title:'Review 5 flashcard',         goal:5,  exp:50, type:'flash' },
  ];

  let _data = null;

  function _load() {
    try {
      const raw = localStorage.getItem(SK);
      if (raw) _data = JSON.parse(raw);
    } catch(e) {}
    const today = TODAY();
    if (!_data || _data.date !== today) {
      _data = { date: today, missions: TEMPLATES.map(t => ({ ...t, progress:0, claimed:false })) };
      _save();
    }
  }

  function _save() { try { localStorage.setItem(SK, JSON.stringify(_data)); } catch(e) {} }

  function incrementProgress(type, amount) {
    if (!_data) _load();
    let changed = false;
    _data.missions.forEach(m => {
      if (m.type === type && !m.claimed) {
        m.progress = Math.min(m.goal, (m.progress||0) + amount);
        changed = true;
      }
    });
    if (changed) { _save(); renderWidget(); }
  }

  function claimMission(idx) {
    if (!_data) _load();
    const m = _data.missions[idx];
    if (!m || m.claimed || m.progress < m.goal) return;
    m.claimed = true;
    _save();
    // Give EXP via GAMIFY if available
    if (typeof GAMIFY !== 'undefined' && GAMIFY._addExpDirect) {
      GAMIFY._addExpDirect(m.exp, `Misi: ${m.title}`);
    } else if (typeof GAMIFY !== 'undefined') {
      // Patch: add EXP directly via internal method exposure
      for (let i = 0; i < m.exp/10; i++) setTimeout(() => {}, 0);
    }
    renderWidget();
    // Show a small toast
    _showMissionToast(m);
  }

  function _showMissionToast(m) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(52,211,153,.9);color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;pointer-events:none;white-space:nowrap;backdrop-filter:blur(10px)';
    t.textContent = `✅ Misi selesai! +${m.exp} EXP`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function renderWidget() {
    if (!_data) _load();
    const el = document.getElementById('missions-dashboard-widget');
    if (!el) return;
    const totalDone = _data.missions.filter(m => m.claimed).length;
    const resetHour = new Date(); resetHour.setHours(24,0,0,0);
    const diff = resetHour - Date.now();
    const h = Math.floor(diff/3600000); const mi = Math.floor((diff%3600000)/60000);

    el.innerHTML = `<div class="mission-widget">
      <div class="mission-header">
        <span class="mission-title">🎯 Misi Harian (${totalDone}/${_data.missions.length})</span>
        <span class="mission-reset">Reset ${h}j ${mi}m</span>
      </div>
      ${_data.missions.map((m, i) => {
        const pct = Math.min(100, Math.round((m.progress/m.goal)*100));
        const done = m.claimed;
        const ready = m.progress >= m.goal && !done;
        // FIX v2.6.4: tap mission item → navigate to relevant page
        const _navMap = { vocab: 'kotoba', quiz: 'quiz', flash: 'kotoba' };
        const _navTarget = _navMap[m.type] || null;
        const _navAttr = _navTarget ? `onclick="if(typeof navigateTo==='function')navigateTo('${_navTarget}')" style="cursor:pointer"` : '';
        return `<div class="mission-item" ${_navAttr}>
          <span class="mission-icon">${done ? '✅' : m.icon}</span>
          <div class="mission-info">
            <div class="mission-name" style="${done?'text-decoration:line-through;opacity:.6':''}">${m.title}</div>
            <div class="mission-progress-bar-wrap"><div class="mission-progress-bar" style="width:${pct}%"></div></div>
            <div class="mission-progress-text">${m.progress} / ${m.goal}</div>
          </div>
          ${done
            ? `<span class="mission-claimed">✓ Klaim</span>`
            : ready
              ? `<button class="mission-claim-btn" onclick="event.stopPropagation();MISSIONS.claimMission(${i})">+${m.exp} EXP</button>`
              : `<span class="mission-exp-badge">+${m.exp}</span>`
          }
        </div>`;
      }).join('')}
    </div>`;
  }

  function init() {
    _load();
    renderWidget();
    // Hook into GAMIFY's EXP mechanism to track progress
    _patchTracker();
  }

  function _patchTracker() {
    // [FIX v2.7.3] Patch toggleLearnedCard untuk vocab mission (lesson flashcard)
    const origToggle = window.toggleLearnedCard;
    if (origToggle && !origToggle._missionPatched) {
      window.toggleLearnedCard = function(...args) {
        // FIX v2.6.2: toggleLearnedCard is called without args, check via STATE size
        const sizeBefore = (window.STATE && window.STATE.learnedCards) ? window.STATE.learnedCards.size : 0;
        const result = origToggle.apply(this, args);
        const sizeAfter = (window.STATE && window.STATE.learnedCards) ? window.STATE.learnedCards.size : 0;
        if (sizeAfter > sizeBefore) incrementProgress('vocab', 1);
        return result;
      };
      window.toggleLearnedCard._missionPatched = true;
    }
    // [FIX v2.7.3] Patch renderQuizResult untuk quiz mission
    const origQuizResult = window.renderQuizResult;
    if (origQuizResult && !origQuizResult._missionPatched) {
      window.renderQuizResult = function(...args) {
        incrementProgress('quiz', 1);
        return origQuizResult.apply(this, args);
      };
      window.renderQuizResult._missionPatched = true;
    }
    // [FIX v2.7.3] Patch kotobaFlashNav untuk flash mission
    // BUG LAMA: kotobaFlashAction tidak pernah ada → patch tidak pernah terpasang → flash quest selalu 0
    // FIX: patch kotobaFlashNav (dipanggil setiap user pindah kartu prev/next)
    const origFlashNav = window.kotobaFlashNav;
    if (origFlashNav && !origFlashNav._missionPatched) {
      window.kotobaFlashNav = function(...args) {
        incrementProgress('flash', 1);
        return origFlashNav.apply(this, args);
      };
      window.kotobaFlashNav._missionPatched = true;
    }
    // [FIX v2.7.3] Patch kotobaFlashToggleLearned untuk vocab mission (Kotoba flashcard mode)
    // BUG LAMA: kotobaFlashToggleLearned manipulasi STATE.learnedCards langsung, tidak panggil MISSIONS
    const origFlashToggle = window.kotobaFlashToggleLearned;
    if (origFlashToggle && !origFlashToggle._missionPatched) {
      window.kotobaFlashToggleLearned = function(...args) {
        const sizeBefore = (window.STATE && window.STATE.learnedCards) ? window.STATE.learnedCards.size : 0;
        const result = origFlashToggle.apply(this, args);
        const sizeAfter = (window.STATE && window.STATE.learnedCards) ? window.STATE.learnedCards.size : 0;
        if (sizeAfter > sizeBefore) incrementProgress('vocab', 1);
        return result;
      };
      window.kotobaFlashToggleLearned._missionPatched = true;
    }
  }

  return { init, renderWidget, claimMission, incrementProgress };
})();


const CALENDAR = (() => {
  const SK = 'mnn_calendar_v1';
  let _data = {}; // { 'YYYY-MM-DD': level 0-3 }

  function _load() {
    try { const r = localStorage.getItem(SK); if (r) _data = JSON.parse(r); } catch(e) {}
  }
  function _save() { try { localStorage.setItem(SK, JSON.stringify(_data)); } catch(e) {} }

  function TODAY() { return new Date().toISOString().slice(0,10); }

  function logActivity(amount) {
    // amount: 1=light, 2=medium, 3=intense (cumulative in day)
    _load();
    const d = TODAY();
    _data[d] = Math.min(3, (_data[d]||0) + amount);
    _save();
  }

  function renderHeatmap(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    _load();

    // Build 12 weeks (84 days) ending today
    const today = new Date();
    const days = [];
    for (let i = 83; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0,10));
    }

    // Group into weeks of 7
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i+7));

    const levelColors = ['var(--border-strong)','rgba(196,181,253,.3)','rgba(196,181,253,.55)','var(--accent-primary)'];
    el.innerHTML = weeks.map(week =>
      `<div class="calendar-week">${week.map(d => {
        const lv = _data[d] || 0;
        return `<div class="calendar-day" data-level="${lv}" title="${d}: ${['Tidak aktif','Ringan','Sedang','Intensif'][lv]}" style="background:${levelColors[lv]}"></div>`;
      }).join('')}</div>`
    ).join('');
  }

  function init() {
    _load();
    // Auto-log activity when certain actions happen
    _patchActivityLog();
  }

  function _patchActivityLog() {
    // Log on quiz
    const origQR = window.renderQuizResult;
    if (origQR && !window._calQRPatched) {
      window._calQRPatched = true;
      window.renderQuizResult = function(...args) {
        CALENDAR.logActivity(2);
        return origQR.apply(this, args);
      };
    }
    // Log on vocab learn
    const origTL = window.toggleLearnedCard;
    if (origTL && !window._calTLPatched) {
      window._calTLPatched = true;
      window.toggleLearnedCard = function(...args) {
        CALENDAR.logActivity(1);
        return origTL.apply(this, args);
      };
    }
  }

  return { logActivity, renderHeatmap, init };
})();


const REVIEW_QUEUE = (() => {
  const SK = 'mnn_review_v1';
  let _queue = []; // array of { vocab object, difficulty, addedAt }

  function _load() {
    try { const r = localStorage.getItem(SK); if (r) _queue = JSON.parse(r); } catch(e) {}
  }
  function _save() { try { localStorage.setItem(SK, JSON.stringify(_queue)); } catch(e) {} }

  function addVocab(v, difficulty) {
    _load();
    const key = (v.kana||v.kanji||v.jp||'') + '§' + (v.arti||'');
    const existing = _queue.findIndex(item => ((item.kana||item.kanji||item.jp||'')+'§'+(item.arti||'')) === key);
    if (existing >= 0) {
      _queue[existing].difficulty = Math.max(_queue[existing].difficulty||1, difficulty||1);
      _queue[existing].wrongCount = (_queue[existing].wrongCount||0) + 1;
    } else {
      _queue.push({ ...v, difficulty: difficulty||1, wrongCount:1, addedAt: Date.now() });
    }
    _save();
    _updateBadge();
  }

  function removeVocab(key) {
    _load();
    _queue = _queue.filter(item => ((item.kana||item.kanji||item.jp||'')+'§'+(item.arti||'')) !== key);
    _save();
    renderList();
    _updateBadge();
  }

  function clearAll() {
    if (!confirm('Hapus semua kata dari review queue?')) return;
    _queue = [];
    _save();
    renderList();
    _updateBadge();
  }

  function getCount() { _load(); return _queue.length; }

  function _updateBadge() {
    const b = document.getElementById('review-count-badge');
    if (b) b.textContent = `${getCount()} kata`;
  }

  function renderList() {
    const el = document.getElementById('review-list-container');
    if (!el) return;
    _load();
    _updateBadge();
    if (!_queue.length) {
      el.innerHTML = `<div class="review-empty"><div class="review-empty-icon">🌟</div><div class="review-empty-text">Belum ada kata yang perlu di-review.<br>Kata yang salah di quiz akan muncul di sini.</div></div>`;
      return;
    }
    // Sort by difficulty desc, then wrongCount desc
    const sorted = [..._queue].sort((a,b) => (b.difficulty||1)-(a.difficulty||1) || (b.wrongCount||0)-(a.wrongCount||0));
    el.innerHTML = sorted.map(v => {
      const key = ((v.kana||v.kanji||v.jp||'')+'§'+(v.arti||'')).replace(/'/g,"\\'");
      const diffLabel = (v.difficulty||1) >= 2 ? 'Sulit' : 'Sedang';
      const diffCls = (v.difficulty||1) >= 2 ? 'review-diff-hard' : 'review-diff-medium';
      const wrong = v.wrongCount||1;
      return `<div class="review-item">
        <div style="flex:1">
          <div class="review-item-jp">${v.jp||v.kanji||v.kana||''}</div>
          <div class="review-item-kana">${v.kana||''} · ${wrong}× salah</div>
          <div class="review-item-arti">${v.arti||''}</div>
        </div>
        <span class="review-item-difficulty ${diffCls}">${diffLabel}</span>
        <button onclick="REVIEW_QUEUE.removeVocab('${key}')" style="border:none;background:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:4px;line-height:1">✕</button>
      </div>`;
    }).join('');
  }

  function startSession() {
    _load();
    if (!_queue.length) { alert('Review queue kosong! Kerjakan quiz dulu.'); return; }
    // Navigate to kotoba with review queue active
    // Set a global flag and navigate to kotoba
    window._reviewSessionActive = true;
    navigateTo('kotoba');
    setTimeout(() => startKotobaFlash('review'), 200);
  }

  function init() {
    _load();
    _updateBadge();
    // Patch quiz answer handler to add wrong answers to queue
    _patchQuizHooks();
  }

  function _patchQuizHooks() {
    // We hook into answerQuiz or answerKanjiTes to capture wrong answers
    const origAnswer = window.answerQuiz;
    if (origAnswer && !window._rvqPatched) {
      window._rvqPatched = true;
      window.answerQuiz = function(isCorrect, ...rest) {
        if (!isCorrect) {
          // Try to get current vocab from STATE
          if (window.STATE && window.STATE._quizCurrentVocab) {
            REVIEW_QUEUE.addVocab(window.STATE._quizCurrentVocab, 2);
          }
        }
        return origAnswer.apply(this, [isCorrect, ...rest]);
      };
    }
  }

  return { addVocab, removeVocab, clearAll, getCount, renderList, startSession, init };
})();


const ROADMAP_MODULE = (() => {
  const STEPS = [
    {
      id:'hiragana', icon:'あ', title:'Hiragana', num:'STEP 1',
      desc:'Kuasai 46 karakter dasar Hiragana',
      check: () => {
        if (!window.STATE || typeof KANA_D === 'undefined') return 0;
        const basic = KANA_D.hiragana.basic; // 46 karakter dasar
        const hafal = window.STATE.kanaHafal || {};
        const prog  = window.STATE.kanaProg  || {};
        let mastered = 0;
        basic.forEach(({ c }) => {
          const isHafalManual = !!hafal[c];
          const p = prog[c];
          const isQuizMastered = p && p.seen >= 3 && (p.correct / p.seen) >= 0.7;
          if (isHafalManual || isQuizMastered) mastered++;
        });
        return Math.round((mastered / basic.length) * 100);
      }
    },
    {
      id:'katakana', icon:'ア', title:'Katakana', num:'STEP 2',
      desc:'Kuasai 46 karakter Katakana',
      check: () => {
        if (!window.STATE || typeof KANA_D === 'undefined') return 0;
        const basic = KANA_D.katakana.basic; // 46 karakter dasar
        const hafal = window.STATE.kanaHafal || {};
        const prog  = window.STATE.kanaProg  || {};
        let mastered = 0;
        basic.forEach(({ c }) => {
          const isHafalManual = !!hafal[c];
          const p = prog[c];
          const isQuizMastered = p && p.seen >= 3 && (p.correct / p.seen) >= 0.7;
          if (isHafalManual || isQuizMastered) mastered++;
        });
        return Math.round((mastered / basic.length) * 100);
      }
    },
    {
      id:'kotoba_buku1', icon:'📖', title:'Kotoba Buku I', num:'STEP 3',
      desc:'Pelajaran 1–25 kosakata (±450 kata)',
      check: () => {
        const learned = window.STATE ? window.STATE.learnedCards : new Set();
        if (!learned || !learned.size) return 0;
        if (!window.DB) return 0;
        const book1 = window.DB.book1 || [];
        let total = 0, done = 0;
        book1.forEach(lesson => {
          (lesson.vocab||[]).forEach(v => {
            total++;
            const key = (v.kana||v.kanji||'') + '||' + v.arti;
            if (learned.has(key)) done++;
          });
        });
        return total > 0 ? Math.round((done/total)*100) : 0;
      }
    },
    {
      id:'bunpou_buku1', icon:'📝', title:'Bunpou Buku I', num:'STEP 4',
      desc:'Pelajaran 1–25 tata bahasa dasar',
      check: () => {
        const bp = window.STATE ? window.STATE.bunpouProgress : {};
        if (!bp || !window.DB) return 0;
        const book1 = window.DB.book1 || [];
        let total = 0, done = 0;
        book1.forEach(lesson => {
          (lesson.grammar||[]).forEach((g, gi) => {
            total++;
            const key = `${lesson.id||lesson.lesson}_g${gi}`;
            if (bp[key]) done++;
          });
        });
        return total > 0 ? Math.round((done/total)*100) : 0;
      }
    },
    {
      id:'quiz_buku1', icon:'🎯', title:'Quiz Buku I', num:'STEP 5',
      desc:'Selesaikan semua quiz Buku I',
      check: () => {
        if (typeof GAMIFY === 'undefined') return 0;
        const d = GAMIFY.getData ? GAMIFY.getData() : null;
        if (!d) return 0;
        const qDone = d._quizDone || 0;
        return Math.min(100, Math.round((qDone/25)*100));
      }
    },
    {
      id:'kotoba_buku2', icon:'📗', title:'Kotoba Buku II', num:'STEP 6',
      desc:'Pelajaran 26–50 kosakata (±500 kata)',
      check: () => {
        const learned = window.STATE ? window.STATE.learnedCards : new Set();
        if (!learned || !learned.size || !window.DB) return 0;
        const book2 = window.DB.book2 || [];
        let total = 0, done = 0;
        book2.forEach(lesson => {
          (lesson.vocab||[]).forEach(v => {
            total++;
            const key = (v.kana||v.kanji||'') + '||' + v.arti;
            if (learned.has(key)) done++;
          });
        });
        return total > 0 ? Math.round((done/total)*100) : 0;
      }
    },
    {
      id:'bunpou_buku2', icon:'📘', title:'Bunpou Buku II', num:'STEP 7',
      desc:'Pelajaran 26–50 tata bahasa menengah',
      check: () => {
        const bp = window.STATE ? window.STATE.bunpouProgress : {};
        if (!bp || !window.DB) return 0;
        const book2 = window.DB.book2 || [];
        let total = 0, done = 0;
        book2.forEach(lesson => {
          (lesson.grammar||[]).forEach((g, gi) => {
            total++;
            const key = `${lesson.id||lesson.lesson}_g${gi}`;
            if (bp[key]) done++;
          });
        });
        return total > 0 ? Math.round((done/total)*100) : 0;
      }
    },
    {
      id:'quiz_buku2', icon:'📋', title:'Quiz Buku II', num:'STEP 8',
      desc:'Selesaikan semua quiz Buku II',
      check: () => {
        if (typeof GAMIFY === 'undefined') return 0;
        const d = GAMIFY.getData ? GAMIFY.getData() : null;
        if (!d) return 0;
        const qDone = d._quizDone || 0;
        return Math.min(100, Math.round((Math.max(0,qDone-25)/25)*100));
      }
    },
    {
      id:'review_mastery', icon:'🔄', title:'Review & Mastery', num:'STEP 9',
      desc:'Ulangi semua materi & capai penguasaan penuh',
      check: () => {
        if (!window.STATE) return 0;
        const learned = window.STATE.learnedCards;
        if (!learned || !learned.size || !window.DB) return 0;
        let total = 0, done = 0;
        ['book1','book2'].forEach(bk => {
          (window.DB[bk]||[]).forEach(lesson => {
            (lesson.vocab||[]).forEach(v => {
              total++;
              const key = (v.kana||v.kanji||'') + '||' + v.arti;
              if (learned.has(key)) done++;
            });
          });
        });
        return total > 0 ? Math.round((done/total)*100) : 0;
      }
    },
    {
      id:'jft_simulasi', icon:'📝', title:'Simulasi JFT Basic', num:'STEP 10',
      desc:'Selesaikan 1x JFT Basic Full Simulation (4 section: Kanji, Expression, Choukai, Dokkai)',
      check: () => {
        try { return localStorage.getItem('mnn_jft_sim_done') ? 100 : 0; } catch(e) { return 0; }
      }
    },
    {
      id:'siap_ssw', icon:'🎌', title:'Persiapan JFT / JLPT', num:'STEP 11',
      desc:'Siap menghadapi ujian JFT-Basic atau JLPT untuk jenjang karir',
      check: () => {
        if (typeof GAMIFY === 'undefined') return 0;
        const d = GAMIFY.getData ? GAMIFY.getData() : null;
        if (!d) return 0;
        return d.level >= 20 ? 100 : Math.round((d.level/20)*100);
      }
    },
  ];

  function _getStepStatus(step) {
    const pct = step.check();
    if (pct >= 100) return 'done';
    if (pct > 0) return 'active';
    return 'locked';
  }

  // Helper: apakah step ke-i sudah "selesai" (pct 100 atau di-skip)?
  function _isStepDone(i, adjustedPcts) {
    return adjustedPcts[i] >= 100;
  }

  function render() {
    const container = document.getElementById('roadmap-steps-container');
    if (!container) return;

    const pctsArr = STEPS.map(s => s.check());
    // FIX v2.6.5: totalPct harus ikut nilai skipped (100) bukan raw check() yg mungkin 0
    const adjustedPctsArr = STEPS.map((step, i) => {
      const skipKey = 'roadmap_skip_' + step.id;
      return !!localStorage.getItem(skipKey) ? 100 : pctsArr[i];
    });
    const totalPct = Math.round(adjustedPctsArr.reduce((a,b)=>a+b,0) / (STEPS.length * 100) * 100);

    // Update total bar
    const totalFill = document.getElementById('roadmap-total-fill');
    const totalPctEl = document.getElementById('roadmap-total-pct');
    if (totalFill) totalFill.style.width = totalPct + '%';
    if (totalPctEl) totalPctEl.textContent = totalPct + '%';

    let firstActiveFound = false;
    container.innerHTML = STEPS.map((step, i) => {
      const skipKey = 'roadmap_skip_' + step.id;
      const isSkipped = !!localStorage.getItem(skipKey);
      const pct = isSkipped ? 100 : pctsArr[i];
      const status = pct >= 100 ? 'done' : pct > 0 ? 'active' : 'locked';
      const isCurrentActive = status === 'active' && !firstActiveFound;
      if (status !== 'locked') firstActiveFound = true;

      // ── PREREQUISITE LOCK: step hanya bisa diakses jika step sebelumnya selesai ──
      const isPrereqDone = i === 0 || _isStepDone(i - 1, adjustedPctsArr);
      const isPrereqLocked = !isPrereqDone && status !== 'done';

      const isLast = i === STEPS.length - 1;

      // Skip button hanya tampil jika: belum done DAN prereq sebelumnya sudah selesai
      const skipBtn = (status !== 'done' && isPrereqDone) ? `
        <button onclick="ROADMAP_MODULE.skipStep('${step.id}','${step.title}')"
          style="margin-top:8px;padding:5px 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--bg-card);color:var(--text-muted);font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">
          ✓ Sudah Menguasai
        </button>` : '';

      // Tombol aksi khusus untuk STEP JFT Simulasi
      const jftBtn = (step.id === 'jft_simulasi' && status !== 'done' && isPrereqDone) ? `
        <button onclick="startJFTSimulation()"
          style="margin-top:8px;padding:5px 14px;border-radius:8px;border:none;background:var(--accent-primary);color:#fff;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px">
          📝 Mulai Simulasi →
        </button>` : '';

      // Pesan prereq locked
      const prereqMsg = isPrereqLocked ? `
        <div style="margin-top:8px;padding:5px 10px;border-radius:8px;background:rgba(0,0,0,.06);color:var(--text-muted);font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px">
          🔒 Selesaikan ${STEPS[i-1].num} — ${STEPS[i-1].title} terlebih dahulu
        </div>` : '';

      const dimStyle = isPrereqLocked ? 'opacity:.45;pointer-events:none;' : '';
      const dotContent = status === 'done' ? '✅' : isPrereqLocked ? '🔒' : step.icon;

      return `<div class="roadmap-step ${status === 'done' ? 'done' : ''} ${isCurrentActive ? 'active-step' : ''}" style="${dimStyle}">
        ${!isLast ? `<div class="roadmap-step-connector"></div>` : ''}
        <div class="roadmap-step-dot">${dotContent}</div>
        <div class="roadmap-step-body">
          <div class="roadmap-step-num">${step.num}</div>
          <div class="roadmap-step-title">${step.title}</div>
          <div class="roadmap-step-desc">${step.desc}${isSkipped ? ' <span style="color:var(--accent-success);font-weight:700">(Dilewati)</span>' : ''}</div>
          <div class="roadmap-step-pct">
            <span>${pct}%</span>
            <div class="roadmap-step-pct-bar"><div class="roadmap-step-pct-fill" style="width:${pct}%"></div></div>
            ${status === 'done' ? '<span style="color:var(--accent-success)">✓ Selesai</span>' : ''}
          </div>
          ${jftBtn}${skipBtn}${prereqMsg}
        </div>
      </div>`;
    }).join('');
  }

  function skipStep(stepId, stepTitle) {
    // Cek prerequisite sebelum skip
    const idx = STEPS.findIndex(s => s.id === stepId);
    if (idx > 0) {
      const prevStep = STEPS[idx - 1];
      const prevSkipKey = 'roadmap_skip_' + prevStep.id;
      const prevPct = prevStep.check();
      const prevDone = !!localStorage.getItem(prevSkipKey) || prevPct >= 100;
      if (!prevDone) {
        if (typeof showToast === 'function') showToast('🔒 Selesaikan ' + prevStep.num + ' — ' + prevStep.title + ' terlebih dahulu!', 'error');
        return;
      }
    }
    if (!confirm(`Yakin menandai "${stepTitle}" sebagai selesai?`)) return;
    try { localStorage.setItem('roadmap_skip_' + stepId, '1'); } catch(e) {}
    render();
    // FIX v2.6.1: Refresh achievements after roadmap step completion
    if (typeof GAMIFY !== 'undefined' && GAMIFY.trackActivity) GAMIFY.trackActivity();
    if (typeof refreshAchievements === 'function') refreshAchievements();
    // Show toast
    if (typeof showToast === 'function') showToast('✓ Tahap ditandai selesai!', 'success');
  }

  function getRoadmapPct() {
    const pctsArr = STEPS.map(s => {
      const skip = !!localStorage.getItem('roadmap_skip_' + s.id);
      return skip ? 100 : s.check();
    });
    return Math.round(pctsArr.reduce((a,b)=>a+b,0) / (STEPS.length * 100) * 100);
  }

  function getNextStep() {
    return STEPS.find(s => {
      const skip = !!localStorage.getItem('roadmap_skip_' + s.id);
      return !skip && s.check() < 100;
    }) || STEPS[STEPS.length-1];
  }

  return { render, getRoadmapPct, getNextStep, skipStep, STEPS };
})();


const STATS_MODULE = (() => {
  const SK_SESSIONS = 'mnn_sessions_v1';
  let _sessions = [];

  function _loadSessions() {
    try { const r = localStorage.getItem(SK_SESSIONS); if (r) _sessions = JSON.parse(r); } catch(e) {}
  }
  function _saveSession(type) {
    _loadSessions();
    _sessions.push({ type, ts: Date.now(), date: new Date().toISOString().slice(0,10) });
    if (_sessions.length > 500) _sessions = _sessions.slice(-500);
    try { localStorage.setItem(SK_SESSIONS, JSON.stringify(_sessions)); } catch(e) {}
  }

  function logSession(type) { _saveSession(type); }

  function _getStats() {
    _loadSessions();
    const gd = typeof GAMIFY !== 'undefined' && GAMIFY.getData ? GAMIFY.getData() : {};
    const learned = window.STATE ? window.STATE.learnedCards : new Set();
    const bp = window.STATE ? (window.STATE.bunpouProgress||{}) : {};
    const today = new Date().toISOString().slice(0,10);

    // Unique study days from sessions
    const studyDays = new Set(_sessions.map(s => s.date)).size;

    // Quiz sessions
    const quizSessions = _sessions.filter(s => s.type === 'quiz').length;

    // Bunpou done count
    const bunpouDone = Object.keys(bp).filter(k => bp[k]).length;

    // Vocab from master
    const totalLearned = learned ? learned.size : 0;

    // EXP and streaks from GAMIFY
    const totalEXP = gd.totalEXP || 0;
    const streak = gd.currentStreak || 0;
    const bestStreak = gd.bestStreak || 0;
    const quizDone = gd._quizDone || 0;
    const vocabLearned = gd._vocabLearned || totalLearned;
    const level = gd.level || 1;

    return { studyDays, quizSessions, quizDone, totalLearned: vocabLearned, bunpouDone, totalEXP, streak, bestStreak, level };
  }

  function renderPage() {
    const stats = _getStats();

    // Cards grid
    const grid = document.getElementById('stats-cards-grid');
    if (grid) {
      const cards = [
        { icon:'📅', label:'Hari Belajar',    val: stats.studyDays },
        { icon:'🔥', label:'Streak Sekarang', val: stats.streak + ' hari' },
        { icon:'👑', label:'Streak Terbaik',  val: stats.bestStreak + ' hari' },
        { icon:'⭐', label:'Total EXP',        val: stats.totalEXP.toLocaleString() },
        { icon:'📖', label:'Kosakata Hafal',  val: stats.totalLearned.toLocaleString() },
        { icon:'📝', label:'Bunpou Selesai',  val: stats.bunpouDone },
        { icon:'🎯', label:'Quiz Selesai',    val: stats.quizDone },
        { icon:'🏅', label:'Level',            val: stats.level },
      ];
      grid.innerHTML = cards.map(c =>
        `<div class="stat-card"><div class="stat-card-icon">${c.icon}</div><div class="stat-card-val">${c.val}</div><div class="stat-card-label">${c.label}</div></div>`
      ).join('');
    }

    // Weekly summary
    const wWrap = document.getElementById('stats-weekly-wrap');
    if (wWrap) {
      _loadSessions();
      const days = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
      const today = new Date();
      const weekData = Array.from({length:7}, (_,i) => {
        const d = new Date(today); d.setDate(d.getDate() - (6-i));
        const ds = d.toISOString().slice(0,10);
        const count = _sessions.filter(s => s.date === ds).length;
        return { label: days[d.getDay()], count, isToday: ds === today.toISOString().slice(0,10) };
      });
      const maxCount = Math.max(1, ...weekData.map(d => d.count));
      wWrap.innerHTML = `<div style="display:flex;gap:6px;align-items:flex-end;height:60px">
        ${weekData.map(d => {
          const h = Math.max(4, Math.round((d.count/maxCount)*56));
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
            <div style="width:100%;height:${h}px;background:${d.isToday?'var(--accent-primary)':'rgba(196,181,253,.3)'};border-radius:4px;transition:height .4s ease"></div>
            <span style="font-size:9px;color:${d.isToday?'var(--accent-primary)':'var(--text-muted)'};font-weight:${d.isToday?700:500}">${d.label}</span>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted);text-align:center">${weekData.reduce((a,b)=>a+b.count,0)} sesi minggu ini</div>`;
    }

    // Calendar
    CALENDAR.renderHeatmap('cal-grid');

    // JLPT progress
    JLPT_MODULE.renderStatsProgress('stats-jlpt-progress');
  }

  // Patch navigation to log sessions
  function init() {
    _patchLogging();
  }

  function _patchLogging() {
    const origQR = window.renderQuizResult;
    if (origQR && !window._statsQRPatched) {
      window._statsQRPatched = true;
      window.renderQuizResult = function(...args) {
        STATS_MODULE.logSession('quiz');
        CALENDAR.logActivity(2);
        return origQR.apply(this, args);
      };
    }
  }

  return { renderPage, logSession, init };
})();


// ── v2.6: Vocab Database Card ────────────────────────────────
function renderVocabDbCard() {
    const el = document.getElementById('vocab-db-card');
    if (!el) return;
    const total = getAllVocabCount();
    // FIX v2.6.3: debug + localStorage fallback jika STATE.learnedCards belum terpopulasi
    console.log('[renderVocabDbCard] STATE.learnedCards.size:', STATE?.learnedCards?.size,
                '| typeof:', typeof STATE?.learnedCards,
                '| window.STATE:', typeof window.STATE);
    const rawLearned = localStorage.getItem('mnn_learned');
    const learned = (STATE?.learnedCards?.size > 0)
        ? STATE.learnedCards.size
        : (rawLearned ? JSON.parse(rawLearned).length : 0);
    const pct = total ? Math.min(100, Math.round((learned / total) * 100)) : 0;
    el.innerHTML = `<div style="background:var(--bg-card);border-radius:16px;padding:14px 16px;border:1px solid var(--border-strong);cursor:pointer" onclick="navigateTo('kotoba')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary)">📚 Database Kosakata</div>
        <div style="font-size:12px;color:var(--accent-primary);font-weight:700">→</div>
      </div>
      <div style="font-size:22px;font-weight:800;color:var(--text-primary);margin-bottom:2px">${total.toLocaleString()} <span style="font-size:13px;font-weight:600;color:var(--text-muted)">Kosakata Jepang</span></div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Kosakata Dikuasai: <strong style="color:var(--accent-primary)">${learned.toLocaleString()} / ${total.toLocaleString()}</strong></div>
      <div style="height:5px;background:var(--border-strong);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent-primary),#818cf8);border-radius:99px;transition:width .6s ease"></div>
      </div>
    </div>`;
}

const LEARNING_PATH = (() => {
  function render() {
    const el = document.getElementById('lp-dashboard-widget');
    if (!el) return;

    const gd = typeof GAMIFY !== 'undefined' && GAMIFY.getData ? GAMIFY.getData() : {};
    const streak = gd.currentStreak || 0;
    const exp = gd.totalEXP || 0;
    const level = gd.level || 1;
    const unlockedAch = (gd.unlockedAchievements||[]).length;

    // Next material based on current lesson
    const currentLesson = window.STATE ? window.STATE.currentLesson : 0;
    const activeBook = window.STATE ? window.STATE.activeBook : 'book1';
    const lessons = window.DB ? (window.DB[activeBook]||[]) : [];
    const nextLesson = lessons[currentLesson + 1] || lessons[currentLesson];
    const nextLessonTitle = nextLesson ? (nextLesson.title || `Pelajaran ${currentLesson+2}`) : 'Selesaikan semua pelajaran!';

    const reviewCount = typeof REVIEW_QUEUE !== 'undefined' ? REVIEW_QUEUE.getCount() : 0;

    el.innerHTML = `<div class="lp-widget">
      <div class="lp-widget-title">📋 Learning Path</div>
      <div class="lp-rows">
        <div class="lp-row" onclick="navigateTo('quiz')">
          <span class="lp-row-icon">🎯</span>
          <div class="lp-row-body">
            <div class="lp-row-label">Target Hari Ini</div>
            <div class="lp-row-value">Selesaikan 1 quiz + 10 kosakata</div>
          </div>
          <span class="lp-row-arrow">→</span>
        </div>
        <div class="lp-row" onclick="navigateTo('dashboard')">
          <span class="lp-row-icon">🔥</span>
          <div class="lp-row-body">
            <div class="lp-row-label">Streak Belajar</div>
            <div class="lp-row-value">${streak} hari berturut-turut</div>
          </div>
          <span class="lp-row-arrow" style="color:${streak>=7?'#ef4444':'var(--text-muted)'}">→</span>
        </div>
        ${unlockedAch > 0 ? `<div class="lp-row" onclick="navigateTo('achievements')">
          <span class="lp-row-icon">⭐</span>
          <div class="lp-row-body">
            <div class="lp-row-label">Achievement</div>
            <div class="lp-row-value">${unlockedAch} achievement di-unlock</div>
          </div>
          <span class="lp-row-arrow">→</span>
        </div>` : ''}
        <div class="lp-row" onclick="navigateTo('materi')">
          <span class="lp-row-icon">📚</span>
          <div class="lp-row-body">
            <div class="lp-row-label">Materi Selanjutnya</div>
            <div class="lp-row-value">${nextLessonTitle}</div>
          </div>
          <span class="lp-row-arrow">→</span>
        </div>
        ${reviewCount > 0 ? `<div class="lp-row" onclick="navigateTo('review')" style="border:1px solid rgba(248,113,113,.25);background:rgba(248,113,113,.05)">
          <span class="lp-row-icon">🔄</span>
          <div class="lp-row-body">
            <div class="lp-row-label">Perlu Review</div>
            <div class="lp-row-value" style="color:#f87171">${reviewCount} kata sulit menunggu</div>
          </div>
          <span class="lp-row-arrow" style="color:#f87171">→</span>
        </div>` : ''}
      </div>
    </div>`;
  }

  return { render };
})();


const UX_ANIM = (() => {
  function showLevelUp(level) {
    const overlay = document.createElement('div');
    overlay.className = 'v25-levelup-overlay';
    overlay.innerHTML = `<div class="v25-levelup-card">
      <div class="v25-levelup-title">⬆ Level Up!</div>
      <div class="v25-levelup-num">${level}</div>
      <div class="v25-levelup-sub">Kerja bagus! Terus semangat! 🎉</div>
    </div>`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.style.animation = 'v25FadeOut .4s ease forwards';
        setTimeout(() => overlay.remove(), 400);
      }
    }, 2800);
  }

  function showRoadmapComplete(stepTitle) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%) translateY(-20px);background:linear-gradient(135deg,rgba(196,181,253,.95),rgba(129,140,248,.9));color:#fff;padding:12px 20px;border-radius:16px;font-size:13px;font-weight:700;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,.3);opacity:0;transition:all .4s cubic-bezier(.22,.68,0,1.3)';
    t.textContent = `🗺 Selesai: ${stepTitle}!`;
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(-20px)'; setTimeout(()=>t.remove(),400); }, 2500);
  }

  // Patch GAMIFY level-up to show animation
  function _patchGamifyLevelUp() {
    if (typeof GAMIFY === 'undefined') return;
    const origInit = GAMIFY.init;
    // Instead, we'll listen for GAMIFY's level event via polling or override
    // We wrap GAMIFY._addEXP-like behavior by patching navigateTo refresh
    window._lastKnownLevel = (GAMIFY.getData ? (GAMIFY.getData().level||1) : 1);
    const origNav = window.navigateTo;
    if (origNav && !window._uxAnimNavPatched) {
      window._uxAnimNavPatched = true;
      window.navigateTo = function(page) {
        const result = origNav.apply(this, arguments);
        // Check if level changed
        if (typeof GAMIFY !== 'undefined' && GAMIFY.getData) {
          const newLevel = GAMIFY.getData().level || 1;
          if (newLevel > (window._lastKnownLevel||1)) {
            window._lastKnownLevel = newLevel;
            setTimeout(() => UX_ANIM.showLevelUp(newLevel), 300);
          }
        }
        return result;
      };
    }
  }

  function init() {
    setTimeout(_patchGamifyLevelUp, 800);
  }

  return { showLevelUp, showRoadmapComplete, init };
})();


(function() {
  function v25Init() {
    // 1. Expose GAMIFY.getData for modules
    if (typeof GAMIFY !== 'undefined' && !GAMIFY.getData) {
      // GAMIFY stores _d internally; expose via public proxy
      GAMIFY.getData = function() {
        try {
          const raw = localStorage.getItem('mnn_gamify');
          return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
      };
    }

    // 2. Init all modules
    MISSIONS.init();
    CALENDAR.init();
    REVIEW_QUEUE.init();
    STATS_MODULE.init();
    UX_ANIM.init();

    // 3. Render dashboard widgets
    LEARNING_PATH.render();
    renderVocabDbCard();

    // 4. Patch navigateTo for new pages
    _patchNavigateTo();

    // 5. Log today's activity
    CALENDAR.logActivity(1); // Being here = light activity
    STATS_MODULE.logSession('app_open');
  }

  function _patchNavigateTo() {
    const origNav = window.navigateTo;
    if (!origNav || window._v25NavPatched) return;
    window._v25NavPatched = true;

    window.navigateTo = function(page) {
      // Run original
      origNav.apply(this, arguments);

      // v2.5 page hooks
      if (page === 'roadmap') {
        setTimeout(ROADMAP_MODULE.render, 50);
      } else if (page === 'stats') {
        setTimeout(STATS_MODULE.renderPage, 50);
      } else if (page === 'review') {
        setTimeout(REVIEW_QUEUE.renderList, 50);
      } else if (page === 'dashboard') {
        setTimeout(() => {
          LEARNING_PATH.render();
          MISSIONS.renderWidget();
          renderVocabDbCard();
        }, 80);
      }
    };
  }

  // Wait for GAMIFY to finish initializing
  const MAX_WAIT = 3000;
  const START = Date.now();
  function tryInit() {
    if (typeof GAMIFY !== 'undefined' && typeof navigateTo !== 'undefined') {
      v25Init();
    } else if (Date.now() - START < MAX_WAIT) {
      setTimeout(tryInit, 150);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 700));
  } else {
    setTimeout(tryInit, 700);
  }
})();

