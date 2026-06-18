/* ═══════════════════════════════════════════════════════
   MNN Learning — みんなの日本語
   verb_engine.js — Verb Engine Lite v1.1 (FIX: masu-keyed)

   ROOT CAUSE FIX:
   DB stores verbs in MASU form (食べます, 書きます), not dict
   form (食べる, 書く). Previous v1.0 keyed by dict form → never
   matched. This version keys by masu form (kanji & kana both).

   Cara kerja:
   1. Lookup: v.kanji (e.g. "食べます") → {type, dict}
   2. Conjugate: dict form "食べる" → all forms
   3. Display panel in flashcard (flipped state only)

   Untuk tambah verb baru di masa depan:
     VERB_DICTIONARY['新しいます'] = { type: 'ichidan', dict: '新しいる' };
     VERB_DICTIONARY['あたらしいます'] = { type: 'ichidan', dict: '新しいる' };

   ═══════════════════════════════════════════════════════ */

const VERB_ENGINE = (() => {
  'use strict';

  // ══════════════════════════════════════════════════════
  // VERB DICTIONARY
  // Key  : masu form (kanji atau kana) — sesuai isi DB
  // Value: { type, dict }
  //   type : 'ichidan' | 'godan' | 'irregular-suru' | 'irregular-kuru'
  //   dict : bentuk kamus (untuk konjugasi)
  // ══════════════════════════════════════════════════════
  const VERB_DICTIONARY = {

    // ── IRREGULAR ──────────────────────────────────────
    'します':       { type: 'irregular-suru', dict: 'する'  },
    '来ます':       { type: 'irregular-kuru', dict: '来る'  },
    'きます':       { type: 'irregular-kuru', dict: '来る'  }, // fallback kana

    // suru-compounds (stem + します)
    '勉強します':   { type: 'irregular-suru', dict: '勉強する',  label: '勉強' },
    'べんきょうします': { type: 'irregular-suru', dict: '勉強する', label: '勉強' },
    '散歩します':   { type: 'irregular-suru', dict: '散歩する',  label: '散歩' },
    'さんぽします': { type: 'irregular-suru', dict: '散歩する',  label: '散歩' },
    '結婚します':   { type: 'irregular-suru', dict: '結婚する',  label: '結婚' },
    'けっこんします': { type: 'irregular-suru', dict: '結婚する', label: '結婚' },
    '準備します':   { type: 'irregular-suru', dict: '準備する',  label: '準備' },
    'じゅんびします': { type: 'irregular-suru', dict: '準備する', label: '準備' },
    '食事します':   { type: 'irregular-suru', dict: '食事する',  label: '食事' },
    'しょくじします': { type: 'irregular-suru', dict: '食事する', label: '食事' },
    '仕事します':   { type: 'irregular-suru', dict: '仕事する',  label: '仕事' },
    'しごとします': { type: 'irregular-suru', dict: '仕事する',  label: '仕事' },
    '相談します':   { type: 'irregular-suru', dict: '相談する',  label: '相談' },
    'そうだんします': { type: 'irregular-suru', dict: '相談する', label: '相談' },
    '安心します':   { type: 'irregular-suru', dict: '安心する',  label: '安心' },
    'あんしんします': { type: 'irregular-suru', dict: '安心する', label: '安心' },
    '連絡します':   { type: 'irregular-suru', dict: '連絡する',  label: '連絡' },
    'れんらくします': { type: 'irregular-suru', dict: '連絡する', label: '連絡' },

    // ── ICHIDAN (Kelompok 2 · る) ──────────────────────
    // → stem = remove ます, dict = stem + る
    '食べます':     { type: 'ichidan', dict: '食べる'  },
    'たべます':     { type: 'ichidan', dict: '食べる'  },
    '見ます':       { type: 'ichidan', dict: '見る'    },
    'みます':       { type: 'ichidan', dict: '見る'    },
    '起きます':     { type: 'ichidan', dict: '起きる'  },  // 起きる (bukan 置く!)
    'おきます':     { type: 'ichidan', dict: '起きる'  },  // fallback: wake up (common)
    '寝ます':       { type: 'ichidan', dict: '寝る'    },
    'ねます':       { type: 'ichidan', dict: '寝る'    },
    '着ます':       { type: 'ichidan', dict: '着る'    },  // memakai (baju atas)
    // 'きます' → sudah mapped ke irregular-kuru (来ます) di atas
    '出ます':       { type: 'ichidan', dict: '出る'    },
    'でます':       { type: 'ichidan', dict: '出る'    },
    '教えます':     { type: 'ichidan', dict: '教える'  },
    'おしえます':   { type: 'ichidan', dict: '教える'  },
    '開けます':     { type: 'ichidan', dict: '開ける'  },  // 開ける (他動詞 transitive)
    'あけます':     { type: 'ichidan', dict: '開ける'  },
    '閉めます':     { type: 'ichidan', dict: '閉める'  },
    'しめます':     { type: 'ichidan', dict: '閉める'  },
    '覚えます':     { type: 'ichidan', dict: '覚える'  },
    'おぼえます':   { type: 'ichidan', dict: '覚える'  },
    '忘れます':     { type: 'ichidan', dict: '忘れる'  },
    'わすれます':   { type: 'ichidan', dict: '忘れる'  },
    '考えます':     { type: 'ichidan', dict: '考える'  },
    'かんがえます': { type: 'ichidan', dict: '考える'  },
    '借ります':     { type: 'ichidan', dict: '借りる'  },
    'かります':     { type: 'ichidan', dict: '借りる'  },
    '出かけます':   { type: 'ichidan', dict: '出かける' },
    'でかけます':   { type: 'ichidan', dict: '出かける' },
    '調べます':     { type: 'ichidan', dict: '調べる'  },
    'しらべます':   { type: 'ichidan', dict: '調べる'  },
    '見せます':     { type: 'ichidan', dict: '見せる'  },
    'みせます':     { type: 'ichidan', dict: '見せる'  },
    '建てます':     { type: 'ichidan', dict: '建てる'  },
    'たてます':     { type: 'ichidan', dict: '建てる'  },
    '伝えます':     { type: 'ichidan', dict: '伝える'  },
    'つたえます':   { type: 'ichidan', dict: '伝える'  },
    '辞めます':     { type: 'ichidan', dict: '辞める'  },
    'やめます':     { type: 'ichidan', dict: '辞める'  },
    '褒めます':     { type: 'ichidan', dict: '褒める'  },
    'ほめます':     { type: 'ichidan', dict: '褒める'  },
    '浴びます':     { type: 'ichidan', dict: '浴びる'  },
    'あびます':     { type: 'ichidan', dict: '浴びる'  },
    '続けます':     { type: 'ichidan', dict: '続ける'  },
    'つづけます':   { type: 'ichidan', dict: '続ける'  },
    '答えます':     { type: 'ichidan', dict: '答える'  },
    'こたえます':   { type: 'ichidan', dict: '答える'  },
    '入れます':     { type: 'ichidan', dict: '入れる'  },
    'いれます':     { type: 'ichidan', dict: '入れる'  },
    '集めます':     { type: 'ichidan', dict: '集める'  },
    'あつめます':   { type: 'ichidan', dict: '集める'  },
    '決めます':     { type: 'ichidan', dict: '決める'  },
    'きめます':     { type: 'ichidan', dict: '決める'  },
    '離れます':     { type: 'ichidan', dict: '離れる'  },
    'はなれます':   { type: 'ichidan', dict: '離れる'  },
    '楽しみます':   { type: 'ichidan', dict: '楽しむ'  }, // godan-mu actually
    '落ちます':     { type: 'ichidan', dict: '落ちる'  },
    'おちます':     { type: 'ichidan', dict: '落ちる'  },
    '起こします':   { type: 'godan',   dict: '起こす'  }, // 起こす godan -su
    'おこします':   { type: 'godan',   dict: '起こす'  },

    // ── GODAN (Kelompok 1) ─────────────────────────────

    // -きます (-ku)
    '書きます':     { type: 'godan', dict: '書く'   },
    'かきます':     { type: 'godan', dict: '書く'   },
    '聞きます':     { type: 'godan', dict: '聞く'   },
    'ききます':     { type: 'godan', dict: '聞く'   },
    '歩きます':     { type: 'godan', dict: '歩く'   },
    'あるきます':   { type: 'godan', dict: '歩く'   },
    '働きます':     { type: 'godan', dict: '働く'   },
    'はたらきます': { type: 'godan', dict: '働く'   },
    '置きます':     { type: 'godan', dict: '置く'   },  // 置く (bukan 起きる!)
    '着きます':     { type: 'godan', dict: '着く'   },  // tiba/sampai
    'つきます':     { type: 'godan', dict: '着く'   },
    '磨きます':     { type: 'godan', dict: '磨く'   },
    'みがきます':   { type: 'godan', dict: '磨く'   },
    '泣きます':     { type: 'godan', dict: '泣く'   },
    'なきます':     { type: 'godan', dict: '泣く'   },
    '引きます':     { type: 'godan', dict: '引く'   },
    'ひきます':     { type: 'godan', dict: '引く'   },
    '開きます':     { type: 'godan', dict: '開く'   },  // 開く 自動詞 intransitive
    'ひらきます':   { type: 'godan', dict: '開く'   },
    '焼きます':     { type: 'godan', dict: '焼く'   },
    'やきます':     { type: 'godan', dict: '焼く'   },
    '繰り返します': { type: 'godan', dict: '繰り返す' },
    'くりかえします':{ type: 'godan', dict: '繰り返す' },

    // -きます special: 行きます (いく → いって, not いいて)
    '行きます':     { type: 'godan', dict: '行く'   },
    'いきます':     { type: 'godan', dict: '行く'   },

    // -ぎます (-gu)
    '泳ぎます':     { type: 'godan', dict: '泳ぐ'   },
    'およぎます':   { type: 'godan', dict: '泳ぐ'   },
    '急ぎます':     { type: 'godan', dict: '急ぐ'   },
    'いそぎます':   { type: 'godan', dict: '急ぐ'   },

    // -します (-su)
    '話します':     { type: 'godan', dict: '話す'   },
    'はなします':   { type: 'godan', dict: '話す'   },
    '貸します':     { type: 'godan', dict: '貸す'   },
    'かします':     { type: 'godan', dict: '貸す'   },
    '出します':     { type: 'godan', dict: '出す'   },
    'だします':     { type: 'godan', dict: '出す'   },
    '消します':     { type: 'godan', dict: '消す'   },
    'けします':     { type: 'godan', dict: '消す'   },
    '押します':     { type: 'godan', dict: '押す'   },
    'おします':     { type: 'godan', dict: '押す'   },
    '返します':     { type: 'godan', dict: '返す'   },
    'かえします':   { type: 'godan', dict: '返す'   },
    '直します':     { type: 'godan', dict: '直す'   },
    'なおします':   { type: 'godan', dict: '直す'   },
    '落とします':   { type: 'godan', dict: '落とす'  },
    'おとします':   { type: 'godan', dict: '落とす'  },
    '盗みます':     { type: 'godan', dict: '盗む'   },  // godan -mu
    'ぬすみます':   { type: 'godan', dict: '盗む'   },
    '壊します':     { type: 'godan', dict: '壊す'   },
    'こわします':   { type: 'godan', dict: '壊す'   },
    '汚します':     { type: 'godan', dict: '汚す'   },
    'よごします':   { type: 'godan', dict: '汚す'   },
    '叱ります':     { type: 'godan', dict: '叱る'   }, // godan -ru
    'しかります':   { type: 'godan', dict: '叱る'   },

    // -ちます (-tsu)
    '待ちます':     { type: 'godan', dict: '待つ'   },
    'まちます':     { type: 'godan', dict: '待つ'   },
    '持ちます':     { type: 'godan', dict: '持つ'   },
    'もちます':     { type: 'godan', dict: '持つ'   },
    '立ちます':     { type: 'godan', dict: '立つ'   },
    'たちます':     { type: 'godan', dict: '立つ'   },
    '役に立ちます': { type: 'godan', dict: '役に立つ' },
    'やくにたちます':{ type: 'godan', dict: '役に立つ' },

    // -にます (-nu)
    '死にます':     { type: 'godan', dict: '死ぬ'   },
    'しにます':     { type: 'godan', dict: '死ぬ'   },

    // -びます (-bu)
    '遊びます':     { type: 'godan', dict: '遊ぶ'   },
    'あそびます':   { type: 'godan', dict: '遊ぶ'   },
    '呼びます':     { type: 'godan', dict: '呼ぶ'   },
    'よびます':     { type: 'godan', dict: '呼ぶ'   },
    '飛びます':     { type: 'godan', dict: '飛ぶ'   },
    'とびます':     { type: 'godan', dict: '飛ぶ'   },
    '運びます':     { type: 'godan', dict: '運ぶ'   },
    'はこびます':   { type: 'godan', dict: '運ぶ'   },
    '選びます':     { type: 'godan', dict: '選ぶ'   },
    'えらびます':   { type: 'godan', dict: '選ぶ'   },
    '申し込みます': { type: 'godan', dict: '申し込む' },
    'もうしこみます':{ type: 'godan', dict: '申し込む' },

    // -みます (-mu)
    '飲みます':     { type: 'godan', dict: '飲む'   },
    'のみます':     { type: 'godan', dict: '飲む'   },
    '読みます':     { type: 'godan', dict: '読む'   },
    'よみます':     { type: 'godan', dict: '読む'   },
    '住みます':     { type: 'godan', dict: '住む'   },
    'すみます':     { type: 'godan', dict: '住む'   },
    '休みます':     { type: 'godan', dict: '休む'   },
    'やすみます':   { type: 'godan', dict: '休む'   },
    '頼みます':     { type: 'godan', dict: '頼む'   },
    'たのみます':   { type: 'godan', dict: '頼む'   },
    '楽しみます':   { type: 'godan', dict: '楽しむ'  },
    'たのしみます': { type: 'godan', dict: '楽しむ'  },

    // -ります (-ru) ← GODAN! (bukan ichidan meski akhiran -ru)
    '帰ります':     { type: 'godan', dict: '帰る'   },
    'かえります':   { type: 'godan', dict: '帰る'   },
    '作ります':     { type: 'godan', dict: '作る'   },
    'つくります':   { type: 'godan', dict: '作る'   },
    '入ります':     { type: 'godan', dict: '入る'   },
    'はいります':   { type: 'godan', dict: '入る'   },
    '走ります':     { type: 'godan', dict: '走る'   },
    'はしります':   { type: 'godan', dict: '走る'   },
    '知ります':     { type: 'godan', dict: '知る'   },
    'しります':     { type: 'godan', dict: '知る'   },
    '切ります':     { type: 'godan', dict: '切る'   },
    'きります':     { type: 'godan', dict: '切る'   },
    '終わります':   { type: 'godan', dict: '終わる'  },
    'おわります':   { type: 'godan', dict: '終わる'  },
    '始まります':   { type: 'godan', dict: '始まる'  },
    'はじまります': { type: 'godan', dict: '始まる'  },
    '分かります':   { type: 'godan', dict: '分かる'  },
    'わかります':   { type: 'godan', dict: '分かる'  },
    '送ります':     { type: 'godan', dict: '送る'   },
    'おくります':   { type: 'godan', dict: '送る'   },
    '乗ります':     { type: 'godan', dict: '乗る'   },
    'のります':     { type: 'godan', dict: '乗る'   },
    '降ります':     { type: 'godan', dict: '降る'   },  // 降る (hujan) — same kanji/kana as 降ります (turun kendaraan)
    'ふります':     { type: 'godan', dict: '降る'   },
    'おります':     { type: 'godan', dict: '降りる'  },  // 降りる (turun dari kendaraan) ichidan!
    '取ります':     { type: 'godan', dict: '取る'   },
    'とります':     { type: 'godan', dict: '取る'   },
    '売ります':     { type: 'godan', dict: '売る'   },
    'うります':     { type: 'godan', dict: '売る'   },
    '渡ります':     { type: 'godan', dict: '渡る'   },
    'わたります':   { type: 'godan', dict: '渡る'   },
    '泊まります':   { type: 'godan', dict: '泊まる'  },
    'とまります':   { type: 'godan', dict: '泊まる'  },
    '止まります':   { type: 'godan', dict: '止まる'  },
    '曲がります':   { type: 'godan', dict: '曲がる'  },
    'まがります':   { type: 'godan', dict: '曲がる'  },
    '上がります':   { type: 'godan', dict: '上がる'  },
    'あがります':   { type: 'godan', dict: '上がる'  },
    '下がります':   { type: 'godan', dict: '下がる'  },
    'さがります':   { type: 'godan', dict: '下がる'  },
    '変わります':   { type: 'godan', dict: '変わる'  },
    'かわります':   { type: 'godan', dict: '変わる'  },
    '登ります':     { type: 'godan', dict: '登る'   },
    'のぼります':   { type: 'godan', dict: '登る'   },
    '掛かります':   { type: 'godan', dict: '掛かる'  },
    'かかります':   { type: 'godan', dict: '掛かる'  },
    '座ります':     { type: 'godan', dict: '座る'   },
    'すわります':   { type: 'godan', dict: '座る'   },

    // -います (-u)
    '買います':     { type: 'godan', dict: '買う'   },
    'かいます':     { type: 'godan', dict: '買う'   },
    '会います':     { type: 'godan', dict: '会う'   },
    'あいます':     { type: 'godan', dict: '会う'   },
    '言います':     { type: 'godan', dict: '言う'   },
    'いいます':     { type: 'godan', dict: '言う'   },
    '思います':     { type: 'godan', dict: '思う'   },
    'おもいます':   { type: 'godan', dict: '思う'   },
    '使います':     { type: 'godan', dict: '使う'   },
    'つかいます':   { type: 'godan', dict: '使う'   },
    '洗います':     { type: 'godan', dict: '洗う'   },
    'あらいます':   { type: 'godan', dict: '洗う'   },
    '手伝います':   { type: 'godan', dict: '手伝う'  },
    'てつだいます': { type: 'godan', dict: '手伝う'  },
    '習います':     { type: 'godan', dict: '習う'   },
    'ならいます':   { type: 'godan', dict: '習う'   },
    '払います':     { type: 'godan', dict: '払う'   },
    'はらいます':   { type: 'godan', dict: '払う'   },
    '歌います':     { type: 'godan', dict: '歌う'   },
    'うたいます':   { type: 'godan', dict: '歌う'   },
    '吸います':     { type: 'godan', dict: '吸う'   },
    'すいます':     { type: 'godan', dict: '吸う'   },
  };

  // ══════════════════════════════════════════════════════
  // GODAN ENDING MAP  (dict form末尾 → conjugation rules)
  // ══════════════════════════════════════════════════════
  const GODAN_MAP = {
    'く': { masu_stem: 'き', te: 'いて', ta: 'いた', nai_stem: 'か' },
    'ぐ': { masu_stem: 'ぎ', te: 'いで', ta: 'いだ', nai_stem: 'が' },
    'す': { masu_stem: 'し', te: 'して', ta: 'した', nai_stem: 'さ' },
    'つ': { masu_stem: 'ち', te: 'って', ta: 'った', nai_stem: 'た' },
    'ぬ': { masu_stem: 'に', te: 'んで', ta: 'んだ', nai_stem: 'な' },
    'ぶ': { masu_stem: 'び', te: 'んで', ta: 'んだ', nai_stem: 'ば' },
    'む': { masu_stem: 'み', te: 'んで', ta: 'んだ', nai_stem: 'ま' },
    'る': { masu_stem: 'り', te: 'って', ta: 'った', nai_stem: 'ら' },
    'う': { masu_stem: 'い', te: 'って', ta: 'った', nai_stem: 'わ' }, // special: う→わない
  };

  // Special: 行く → て形 = 行って (bukan 行いて)
  const SPECIAL_TE_TA = {
    '行く':    { te: '行って',  ta: '行った'  },
    '役に立つ':{ te: '役に立って', ta: '役に立った' },
  };

  // ══════════════════════════════════════════════════════
  // CONJUGATE — dict form → all forms
  // ══════════════════════════════════════════════════════
  function conjugate(dict, type, label) {
    if (!dict || !type) return null;
    const f = { dict };

    if (type === 'ichidan') {
      const stem  = dict.slice(0, -1);   // remove る
      f.masu  = stem + 'ます';
      f.masen = stem + 'ません';
      f.ta    = stem + 'た';
      f.te    = stem + 'て';
      f.nai   = stem + 'ない';
    }
    else if (type === 'godan') {
      const ending = dict.slice(-1);
      const stem   = dict.slice(0, -1);
      const map    = GODAN_MAP[ending];
      if (!map) return null;
      const sp     = SPECIAL_TE_TA[dict];
      f.masu  = stem + map.masu_stem + 'ます';
      f.masen = stem + map.masu_stem + 'ません';
      f.ta    = sp ? sp.ta : stem + map.ta;
      f.te    = sp ? sp.te : stem + map.te;
      f.nai   = stem + map.nai_stem + 'ない';
    }
    else if (type === 'irregular-suru') {
      // compound する: label = '勉強', dict = '勉強する'
      const stem = label || '';
      f.dict  = dict;
      f.masu  = stem + 'します';
      f.masen = stem + 'しません';
      f.ta    = stem + 'した';
      f.te    = stem + 'して';
      f.nai   = stem + 'しない';
    }
    else if (type === 'irregular-kuru') {
      const isKanji = dict === '来る';
      f.masu  = isKanji ? '来ます'  : 'きます';
      f.masen = isKanji ? '来ません' : 'きません';
      f.ta    = isKanji ? '来た'    : 'きた';
      f.te    = isKanji ? '来て'    : 'きて';
      f.nai   = isKanji ? '来ない'  : 'こない';
    }
    else { return null; }

    return f;
  }

  // ══════════════════════════════════════════════════════
  // LOOKUP — dari masu form ke {type, dict}
  // ══════════════════════════════════════════════════════
  function lookup(word) {
    if (!word) return null;
    return VERB_DICTIONARY[word] || null;
  }

  // ══════════════════════════════════════════════════════
  // RENDER PANEL — HTML string untuk flashcard
  // Dipanggil dengan: v.kanji || v.kana (masu form dari DB)
  // ══════════════════════════════════════════════════════
  function renderPanel(word) {
    if (!word) return '';
    const entry = lookup(word);
    if (!entry) return '';

    const f = conjugate(entry.dict, entry.type, entry.label);
    if (!f) return '';

    const TYPE_LABELS = {
      'ichidan':        'Kelompok 2 · Ichidan · る動詞',
      'godan':          'Kelompok 1 · Godan · う動詞',
      'irregular-suru': 'Irregular · する',
      'irregular-kuru': 'Irregular · 来る (くる)',
    };
    const typeLabel = TYPE_LABELS[entry.type] || entry.type;

    return `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap">
    <span style="font-size:10px;font-weight:800;color:var(--accent-verb);letter-spacing:.05em">📖 BENTUK KATA KERJA</span>
    <span style="font-size:9px;color:var(--text-muted);background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:2px 7px;white-space:nowrap">${typeLabel}</span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
    ${_row('辞書形', f.dict,  'var(--text-secondary)')}
    ${_row('ます形', f.masu,  'var(--accent-primary)')}
    ${_row('ません形', f.masen,'var(--accent-danger)')}
    ${_row('た形',   f.ta,   'var(--accent-verb)')}
    ${_row('て形',   f.te,   '#f59e0b')}
  </div>
</div>`;
  }

  function _row(label, form, color) {
    return `<div style="background:var(--bg-card-hover);border:1px solid var(--border);border-radius:8px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;min-width:0">
  <span style="font-size:9px;color:var(--text-muted);font-weight:700;flex-shrink:0">${label}</span>
  <span style="font-family:'Noto Sans JP',sans-serif;font-size:15px;font-weight:700;color:${color};margin-left:6px">${form}</span>
</div>`;
  }

  // ══════════════════════════════════════════════════════
  // DERIVE KANA FORMS
  // Hitung kana readings untuk setiap bentuk konjugasi
  // dari v.kana (masu form kana, misal 'たべます')
  // ══════════════════════════════════════════════════════
  function deriveKanaForms(kana, type) {
    if (!kana) return null;
    let kanaDict = '', label;

    if (type === 'ichidan') {
      if (!kana.endsWith('ます')) return null;
      kanaDict = kana.slice(0, -2) + 'る';              // たべます → たべる
    }
    else if (type === 'godan') {
      if (!kana.endsWith('ます')) return null;
      const stem = kana.slice(0, -2);                    // かきます → かき
      const MASU_TO_END = { き:'く', ぎ:'ぐ', し:'す', ち:'つ',
                            に:'ぬ', び:'ぶ', み:'む', り:'る', い:'う' };
      const ending = MASU_TO_END[stem.slice(-1)];
      if (!ending) return null;
      kanaDict = stem.slice(0, -1) + ending;             // か + く = かく
    }
    else if (type === 'irregular-suru') {
      if (kana.endsWith('します')) {
        kanaDict = kana.slice(0, -3) + 'する';           // べんきょうします → べんきょうする
        label    = kanaDict.slice(0, -2) || undefined;   // べんきょう
      } else {
        kanaDict = 'する';
      }
    }
    else if (type === 'irregular-kuru') {
      kanaDict = 'くる';
    }
    else { return null; }

    if (!kanaDict) return null;
    return conjugate(kanaDict, type, label);
  }

  // ══════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════
  return { lookup, conjugate, renderPanel, deriveKanaForms, VERB_DICTIONARY };

})();
