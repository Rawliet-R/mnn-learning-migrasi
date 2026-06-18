/* ═══════════════════════════════════════════════════════════════
   MNN Learning — みんなの日本語
   sentence_engine.js — Example Sentence Engine v1.0

   Arsitektur:
     Kotoba/Kanji
       ↓ classify(word)        → tipe kata (verb/noun/i-adj/na-adj/place/time)
       ↓ getVerbForms(word)    → konjugasi via VERB_ENGINE (kalau kata kerja)
       ↓ TEMPLATES[type][diff] → pilih template berdasarkan kesulitan
       ↓ build(word, forms)    → kalimat contoh JP + ID

   Prinsip:
   - Offline, tanpa API, tanpa database statis per kata
   - Reuse VERB_ENGINE.lookup() + conjugate() yang sudah ada
   - Template dipilih deterministik (hash kana) → konsisten per kata
   - Support easy / medium / hard sesuai level grammar MNN
   - Graceful fallback jika kata tidak bisa diproses

   Dipanggil oleh getVocabExample() di app.js sebagai tahap ke-3:
     1. w.ex (field manual)  → langsung pakai
     2. bunpou contoh        → auto-extract dari data.js
     3. SENTENCE_ENGINE      → generate dari template ← (file ini)

   Referensi grammar:
   - Easy   → L1-L13  (です/ます, を, に, が, て-form dasar)
   - Medium → L14-L20 (てください, ている, たい, できます, てから)
   - Hard   → L21+    (たことがある, と思います, ないでください, たら)
   ═══════════════════════════════════════════════════════════════ */

const SENTENCE_ENGINE = (() => {
  'use strict';

  // ══════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════

  /** Bersihkan field arti untuk embed dalam kalimat Indonesia */
  function cleanArti(arti) {
    if (!arti) return '';
    return arti
      .replace(/[（(][^)）]*[)）]/g, '') // hapus tanda kurung: "makan (nasi)" → "makan"
      .replace(/[〜～]/g, '')
      .split(/[\/、,]/)[0]               // ambil makna pertama saja
      .trim()
      .toLowerCase();
  }

  /** Ambil bentuk Jepang utama dari word object (kompatibel DB + master_kotoba) */
  function jpMain(word) {
    return word.kanji || word.jp || word.kana || '';
  }

  /** Hash deterministik berdasarkan kana → index template yang konsisten */
  function stableIdx(word, n) {
    const s = word.kana || word.jp || word.kanji || '';
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h, 31) ^ s.charCodeAt(i);
    }
    return Math.abs(h) % n;
  }

  // ══════════════════════════════════════════════════════
  // WORD TYPE SETS
  // ══════════════════════════════════════════════════════

  /** Kata sifat na — dikenal secara eksplisit (sebagian berakhiran い tapi bukan i-adj) */
  const NA_ADJ_SET = new Set([
    // Pelajaran 8-9 MNN
    'きれい','綺麗',
    'にぎやか','賑やか',
    'しずか','静か',
    'べんり','便利',
    'ゆうめい','有名',
    'しんせつ','親切',
    'たいせつ','大切',
    'だいじょうぶ','大丈夫',
    'じょうず','上手',
    'へた','下手',
    'すき','好き',
    'きらい','嫌い',
    'ひま','暇',
    'げんき','元気',
    // Pelajaran 9+ MNN
    'ていねい','丁寧',
    'まじめ','真面目',
    'ふくざつ','複雑',
    'かんたん','簡単',
    'たいへん','大変',
    'とくべつ','特別',
    'ひつよう','必要',
    'あんぜん','安全',
    'きけん','危険',
    'じゆう','自由',
    'じょうぶ','丈夫',
    'すてき','素敵',
    'しあわせ','幸せ',
    'ふべん','不便',
    'りっぱ','立派',
    'ハンサム',
    'さかん','盛ん',
    'ざんねん','残念',
    'たしか','確か',
    'むり','無理',
    'だいすき','大好き',
    'だいきらい','大嫌い',
    'ふつう','普通',
    'いろいろ','色々',
  ]);

  /** Kata benda tempat */
  const PLACE_SET = new Set([
    'うち','家','いえ',
    'がっこう','学校',
    'えき','駅',
    'かいしゃ','会社',
    'びょういん','病院',
    'デパート',
    'としょかん','図書館',
    'レストラン',
    'きょうしつ','教室',
    'しょくどう','食堂',
    'ぎんこう','銀行',
    'ゆうびんきょく','郵便局',
    'こうえん','公園',
    'スーパー',
    'コンビニ',
    'ホテル',
    'くうこう','空港',
    'だいがく','大学',
    'じむしょ','事務所',
    'ロビー',
    'うけつけ','受付',
    'へや','部屋',
    'きっさてん','喫茶店',
    'みせ','店',
    'スタジアム',
    'じんじゃ','神社',
    'おてら','お寺',
    'びじゅつかん','美術館',
    'はくぶつかん','博物館',
    'うみ','海',
    'やま','山',
  ]);

  /** Kata keterangan waktu */
  const TIME_SET = new Set([
    'きょう','今日',
    'あした','明日',
    'あさって','明後日',
    'きのう','昨日',
    'おととい','一昨日',
    'らいしゅう','来週',
    'せんしゅう','先週',
    'こんしゅう','今週',
    'らいげつ','来月',
    'こんげつ','今月',
    'さくねん','去年','きょねん',
    'らいねん','来年',
    'ことし','今年',
    'まいにち','毎日',
    'まいしゅう','毎週',
    'まいつき','毎月',
    'まいあさ','毎朝',
    'まいばん','毎晩',
    'いま','今',
    'あさ','朝',
    'ひる','昼',
    'よる','夜',
    'ごぜん','午前',
    'ごご','午後',
    'げつようび','月曜日',
    'かようび','火曜日',
    'すいようび','水曜日',
    'もくようび','木曜日',
    'きんようび','金曜日',
    'どようび','土曜日',
    'にちようび','日曜日',
  ]);

  // ══════════════════════════════════════════════════════
  // NOUN EXCEPTIONS — kata yang berakhiran い di kana tapi bukan i-adj
  // (karena heuristic berbasis ending 'い' bisa false-positive)
  // ══════════════════════════════════════════════════════
  const FORCE_NOUN_SET = new Set([
    // Profesi / orang
    'せんせい','先生','がくせい','学生','かいしゃいん','会社員',
    'しゃいん','社員','ぎんこういん','銀行員','いしゃ','医者',
    'けんきゅうしゃ','けいさつかん','警察官',
    // Benda
    'とけい','時計','でんき','電気','おてあらい','お手洗い',
    'えんぴつ','鉛筆','てんき','天気','えき','駅','かい','会',
    'しょうがっこう','小学校','ちゅうがっこう','中学校',
    // Ekspresi/partikel
    'はい','いいえ','さかい',
  ]);

  // ══════════════════════════════════════════════════════
  // CLASSIFY
  // ══════════════════════════════════════════════════════

  function classify(word) {
    const j = jpMain(word);
    const k = word.kana || '';

    // Guard: skip ekspresi khusus atau partikel
    if (!j || j.startsWith('〜') || j.startsWith('～')) return 'skip';

    // VERB: lookup di VERB_ENGINE (masu-keyed)
    if (typeof VERB_ENGINE !== 'undefined') {
      if (VERB_ENGINE.lookup(j) || VERB_ENGINE.lookup(k)) return 'verb';
    }
    // Fallback verb: berakhiran ます dan bukan ekspresi
    if ((j.endsWith('ます') || k.endsWith('ます')) && j.length > 3) return 'verb';

    // FORCE NOUN: kata yang berakhiran い di kana tapi bukan adjektif
    if (FORCE_NOUN_SET.has(j) || FORCE_NOUN_SET.has(k)) return 'noun';

    // NA-ADJ: cek set eksplisit SEBELUM i-adj (きれい berakhiran い tapi na-adj)
    if (NA_ADJ_SET.has(j) || NA_ADJ_SET.has(k)) return 'na-adj';

    // I-ADJ: berakhiran い, bukan verb, bukan waktu/tempat
    if ((k.endsWith('い') || j.endsWith('い'))
        && !TIME_SET.has(j) && !TIME_SET.has(k)
        && !PLACE_SET.has(j) && !PLACE_SET.has(k)
        && k.length >= 3) {
      return 'i-adj';
    }

    // PLACE
    if (PLACE_SET.has(j) || PLACE_SET.has(k)) return 'place';

    // TIME
    if (TIME_SET.has(j) || TIME_SET.has(k)) return 'time';

    return 'noun';
  }

  // ══════════════════════════════════════════════════════
  // VERB CONJUGATION — via VERB_ENGINE
  // ══════════════════════════════════════════════════════

  function getVerbForms(word) {
    if (typeof VERB_ENGINE === 'undefined') return null;
    const j = jpMain(word);
    const k = word.kana || '';
    const entry = VERB_ENGINE.lookup(j) || VERB_ENGINE.lookup(k);
    if (!entry) return null;
    return VERB_ENGINE.conjugate(entry.dict, entry.type, entry.label);
  }

  /** Ambil ます-stem: 食べます → 食べ (untuk たい / ながら) */
  function masuStem(masuForm) {
    return masuForm ? masuForm.slice(0, -2) : '';
  }

  // ══════════════════════════════════════════════════════
  // ADJECTIVE CONJUGATION HELPERS
  // ══════════════════════════════════════════════════════

  function iAdjForms(adj) {
    const stem = adj.endsWith('い') ? adj.slice(0, -1) : adj;
    return {
      base:  adj,
      ku:    stem + 'く',
      te:    stem + 'くて',
      nai:   stem + 'くない',
      past:  stem + 'かった',
      naru:  stem + 'くなります',
    };
  }

  function naAdjForms(adj) {
    return {
      base:  adj,
      na:    adj + 'な',
      de:    adj + 'で',
      dewa:  adj + 'ではない',
      datta: adj + 'だった',
      ni:    adj + 'に',
    };
  }

  // ══════════════════════════════════════════════════════
  // TEMPLATE BANK
  // Setiap builder: (word, forms?) → { jp, id, pattern }
  // ══════════════════════════════════════════════════════

  const TEMPLATES = {

    // ─── VERB ──────────────────────────────────────────
    verb: {
      easy: [
        (w, f) => ({
          jp:      `私は毎日${f.masu}。`,
          id:      `Saya ${cleanArti(w.arti)} setiap hari.`,
          pattern: 'S は 毎日 KK ます',
        }),
        (w, f) => ({
          jp:      `昨日、私は${f.ta}。`,
          id:      `Kemarin, saya sudah ${cleanArti(w.arti)}.`,
          pattern: 'KK た (lampau)',
        }),
        (w, f) => ({
          jp:      `田中さんも${f.masu}か。`,
          id:      `Apakah Tanaka juga ${cleanArti(w.arti)}?`,
          pattern: 'S も KK ますか',
        }),
        (w, f) => ({
          jp:      `私は${f.masu}。`,
          id:      `Saya ${cleanArti(w.arti)}.`,
          pattern: 'S は KK ます',
        }),
      ],
      medium: [
        (w, f) => ({
          jp:      `${f.te}ください。`,
          id:      `Tolong ${cleanArti(w.arti)}.`,
          pattern: 'KK て ください',
        }),
        (w, f) => ({
          jp:      `今、${f.te}います。`,
          id:      `Sekarang sedang ${cleanArti(w.arti)}.`,
          pattern: 'KK て います',
        }),
        (w, f) => {
          const stem = masuStem(f.masu);
          return {
            jp:      `${stem}たいです。`,
            id:      `Saya ingin ${cleanArti(w.arti)}.`,
            pattern: 'KK たいです',
          };
        },
        (w, f) => ({
          jp:      `${f.dict}ことができます。`,
          id:      `Saya bisa ${cleanArti(w.arti)}.`,
          pattern: 'KK こと が できます',
        }),
        (w, f) => ({
          jp:      `${f.te}から、休みます。`,
          id:      `Setelah ${cleanArti(w.arti)}, istirahat.`,
          pattern: 'KK て から、〜',
        }),
      ],
      hard: [
        (w, f) => ({
          jp:      `${f.ta}ことがあります。`,
          id:      `Pernah ${cleanArti(w.arti)}.`,
          pattern: 'KK た こと が あります',
        }),
        (w, f) => ({
          jp:      `明日も${f.masu}と思います。`,
          id:      `Saya pikir besok juga akan ${cleanArti(w.arti)}.`,
          pattern: 'KK と思います',
        }),
        (w, f) => ({
          jp:      `${f.nai}でください。`,
          id:      `Tolong jangan ${cleanArti(w.arti)}.`,
          pattern: 'KK ない で ください',
        }),
        (w, f) => ({
          jp:      `${f.ta}ら、連絡してください。`,
          id:      `Kalau sudah ${cleanArti(w.arti)}, tolong hubungi saya.`,
          pattern: 'KK たら、〜',
        }),
        (w, f) => ({
          jp:      `${f.te}いるところです。`,
          id:      `Sedang dalam proses ${cleanArti(w.arti)}.`,
          pattern: 'KK て いる ところ です',
        }),
      ],
    },

    // ─── NOUN ──────────────────────────────────────────
    noun: {
      easy: [
        (w) => ({
          jp:      `これは${jpMain(w)}です。`,
          id:      `Ini adalah ${cleanArti(w.arti)}.`,
          pattern: 'これ は KB です',
        }),
        (w) => ({
          jp:      `${jpMain(w)}があります。`,
          id:      `Ada ${cleanArti(w.arti)}.`,
          pattern: 'KB が あります',
        }),
        (w) => ({
          jp:      `${jpMain(w)}はどこですか。`,
          id:      `Di mana ${cleanArti(w.arti)}?`,
          pattern: 'KB は どこですか',
        }),
        (w) => ({
          jp:      `あの${jpMain(w)}は田中さんのです。`,
          id:      `${cleanArti(w.arti)} itu milik Tanaka.`,
          pattern: 'KB は 人 の です',
        }),
        (w) => ({
          jp:      `${jpMain(w)}は何ですか。`,
          id:      `Apa itu ${cleanArti(w.arti)}?`,
          pattern: 'KB は 何ですか',
        }),
      ],
      medium: [
        (w) => ({
          jp:      `${jpMain(w)}が欲しいです。`,
          id:      `Saya ingin ${cleanArti(w.arti)}.`,
          pattern: 'KB が 欲しいです',
        }),
        (w) => ({
          jp:      `昨日、${jpMain(w)}を買いました。`,
          id:      `Kemarin, saya membeli ${cleanArti(w.arti)}.`,
          pattern: 'KB を 買いました',
        }),
        (w) => ({
          jp:      `毎日${jpMain(w)}を使います。`,
          id:      `Saya menggunakan ${cleanArti(w.arti)} setiap hari.`,
          pattern: 'KB を 使います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}はどんなですか。`,
          id:      `Seperti apa ${cleanArti(w.arti)} itu?`,
          pattern: 'KB は どんな ですか',
        }),
        (w) => ({
          jp:      `${jpMain(w)}を持っています。`,
          id:      `Saya memiliki ${cleanArti(w.arti)}.`,
          pattern: 'KB を 持って います',
        }),
      ],
      hard: [
        (w) => ({
          jp:      `${jpMain(w)}があると思います。`,
          id:      `Saya pikir ada ${cleanArti(w.arti)}.`,
          pattern: 'KB が ある と思います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}を使ったことがあります。`,
          id:      `Pernah menggunakan ${cleanArti(w.arti)}.`,
          pattern: 'KB を 使った こと が あります',
        }),
        (w) => ({
          jp:      `${jpMain(w)}は大切だと思います。`,
          id:      `Saya pikir ${cleanArti(w.arti)} itu penting.`,
          pattern: 'KB は 大切 だ と思います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}があれば、いいと思います。`,
          id:      `Kalau ada ${cleanArti(w.arti)}, saya pikir sudah cukup.`,
          pattern: 'KB が あれば、〜',
        }),
      ],
    },

    // ─── I-ADJ ─────────────────────────────────────────
    'i-adj': {
      easy: [
        (w) => ({
          jp:      `この映画は${jpMain(w)}です。`,
          id:      `Film ini ${cleanArti(w.arti)}.`,
          pattern: 'KB は KS い です',
        }),
        (w) => ({
          jp:      `今日の天気は${jpMain(w)}ですね。`,
          id:      `Cuaca hari ini ${cleanArti(w.arti)} ya.`,
          pattern: 'KB は KS い ですね',
        }),
        (w) => ({
          jp:      `とても${jpMain(w)}です。`,
          id:      `Sangat ${cleanArti(w.arti)}.`,
          pattern: 'とても KS い です',
        }),
        (w) => ({
          jp:      `この料理は${jpMain(w)}ですよ。`,
          id:      `Masakan ini ${cleanArti(w.arti)} loh.`,
          pattern: 'KB は KS い ですよ',
        }),
      ],
      medium: [
        (w) => {
          const f = iAdjForms(jpMain(w));
          return {
            jp:      `${f.te}、好きです。`,
            id:      `Karena ${cleanArti(w.arti)}, saya suka.`,
            pattern: 'KS い くて、〜',
          };
        },
        (w) => {
          const _f = iAdjForms(jpMain(w));
          return {
            jp:      `あまり${_f.nai}です。`,
            id:      `Tidak terlalu ${cleanArti(w.arti)}.`,
            pattern: 'あまり KS い くない',
          };
        },
        (w) => {
          const f = iAdjForms(jpMain(w));
          return {
            jp:      `もっと${f.naru}と思います。`,
            id:      `Saya pikir akan semakin ${cleanArti(w.arti)}.`,
            pattern: 'KS い → く なります',
          };
        },
        (w) => ({
          jp:      `${jpMain(w)}から、好きです。`,
          id:      `Karena ${cleanArti(w.arti)}, saya suka.`,
          pattern: 'KS い から、〜',
        }),
      ],
      hard: [
        (w) => ({
          jp:      `${jpMain(w)}と思います。`,
          id:      `Saya pikir ${cleanArti(w.arti)}.`,
          pattern: 'KS い と思います',
        }),
        (w) => {
          const f = iAdjForms(jpMain(w));
          return {
            jp:      `${f.past}ら、教えてください。`,
            id:      `Kalau sudah ${cleanArti(w.arti)}, tolong beritahu.`,
            pattern: 'KS い かったら、〜',
          };
        },
        (w) => {
          const f = iAdjForms(jpMain(w));
          return {
            jp:      `${f.te}も、大丈夫です。`,
            id:      `Walaupun ${cleanArti(w.arti)}, tidak apa-apa.`,
            pattern: 'KS い くても、〜',
          };
        },
        (w) => ({
          jp:      `${jpMain(w)}ほど、いいと思います。`,
          id:      `Semakin ${cleanArti(w.arti)}, semakin baik saya pikir.`,
          pattern: 'KS い ほど、〜',
        }),
      ],
    },

    // ─── NA-ADJ ────────────────────────────────────────
    'na-adj': {
      easy: [
        (w) => ({
          jp:      `この町は${jpMain(w)}です。`,
          id:      `Kota ini ${cleanArti(w.arti)}.`,
          pattern: 'KB は KS な です',
        }),
        (w) => {
          const f = naAdjForms(jpMain(w));
          return {
            jp:      `${f.na}仕事ですね。`,
            id:      `Pekerjaan yang ${cleanArti(w.arti)} ya.`,
            pattern: 'KS な + KB',
          };
        },
        (w) => ({
          jp:      `とても${jpMain(w)}です。`,
          id:      `Sangat ${cleanArti(w.arti)}.`,
          pattern: 'とても KS な です',
        }),
        (w) => ({
          jp:      `田中さんはとても${jpMain(w)}な人です。`,
          id:      `Tanaka adalah orang yang sangat ${cleanArti(w.arti)}.`,
          pattern: 'KB は KS な 人 です',
        }),
      ],
      medium: [
        (w) => ({
          jp:      `${jpMain(w)}になりたいです。`,
          id:      `Ingin menjadi ${cleanArti(w.arti)}.`,
          pattern: 'KS な に なりたい',
        }),
        (w) => {
          const f = naAdjForms(jpMain(w));
          return {
            jp:      `${f.de}、いいです。`,
            id:      `Karena ${cleanArti(w.arti)}, baik sekali.`,
            pattern: 'KS な で、〜',
          };
        },
        (w) => ({
          jp:      `あまり${jpMain(w)}ではないです。`,
          id:      `Tidak terlalu ${cleanArti(w.arti)}.`,
          pattern: 'あまり KS な では ない',
        }),
        (w) => ({
          jp:      `${jpMain(w)}になりました。`,
          id:      `Sudah menjadi ${cleanArti(w.arti)}.`,
          pattern: 'KS な に なりました',
        }),
      ],
      hard: [
        (w) => ({
          jp:      `${jpMain(w)}だと思います。`,
          id:      `Saya pikir ${cleanArti(w.arti)}.`,
          pattern: 'KS な だ と思います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}なら、大丈夫です。`,
          id:      `Kalau ${cleanArti(w.arti)}, tidak apa-apa.`,
          pattern: 'KS な なら、〜',
        }),
        (w) => ({
          jp:      `${jpMain(w)}であれば、いいと思います。`,
          id:      `Asalkan ${cleanArti(w.arti)}, saya pikir tidak apa-apa.`,
          pattern: 'KS な であれば、〜',
        }),
        (w) => {
          const f = naAdjForms(jpMain(w));
          return {
            jp:      `${f.datta}のに、残念です。`,
            id:      `Padahal sudah ${cleanArti(w.arti)}, sayang sekali.`,
            pattern: 'KS な だった のに、〜',
          };
        },
      ],
    },

    // ─── PLACE ─────────────────────────────────────────
    place: {
      easy: [
        (w) => ({
          jp:      `私は${jpMain(w)}に行きます。`,
          id:      `Saya pergi ke ${cleanArti(w.arti)}.`,
          pattern: 'Ket.Tempat に 行きます',
        }),
        (w) => ({
          jp:      `${jpMain(w)}はどこですか。`,
          id:      `Di mana ${cleanArti(w.arti)}?`,
          pattern: 'KB は どこですか',
        }),
        (w) => ({
          jp:      `${jpMain(w)}で食べます。`,
          id:      `Makan di ${cleanArti(w.arti)}.`,
          pattern: 'Ket.Tempat で KK',
        }),
        (w) => ({
          jp:      `${jpMain(w)}はここです。`,
          id:      `${cleanArti(w.arti)} ada di sini.`,
          pattern: 'KB は Ket.Tempat です',
        }),
      ],
      medium: [
        (w) => ({
          jp:      `${jpMain(w)}で働いています。`,
          id:      `Bekerja di ${cleanArti(w.arti)}.`,
          pattern: 'Ket.Tempat で KK て います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}まで歩きます。`,
          id:      `Jalan kaki sampai ke ${cleanArti(w.arti)}.`,
          pattern: 'KB まで KK',
        }),
        (w) => ({
          jp:      `${jpMain(w)}で勉強したいです。`,
          id:      `Ingin belajar di ${cleanArti(w.arti)}.`,
          pattern: 'Ket.Tempat で KK たいです',
        }),
        (w) => ({
          jp:      `${jpMain(w)}に電話します。`,
          id:      `Menelepon ke ${cleanArti(w.arti)}.`,
          pattern: 'KB に 電話します',
        }),
      ],
      hard: [
        (w) => ({
          jp:      `${jpMain(w)}に行ったことがあります。`,
          id:      `Pernah pergi ke ${cleanArti(w.arti)}.`,
          pattern: 'KK た こと が あります',
        }),
        (w) => ({
          jp:      `${jpMain(w)}が好きだと思います。`,
          id:      `Saya pikir suka ${cleanArti(w.arti)}.`,
          pattern: 'KB が 好き だ と思います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}に行けたら、うれしいです。`,
          id:      `Kalau bisa pergi ke ${cleanArti(w.arti)}, senang sekali.`,
          pattern: 'KK たら、〜',
        }),
        (w) => ({
          jp:      `${jpMain(w)}に着いたら、連絡してください。`,
          id:      `Kalau sudah sampai di ${cleanArti(w.arti)}, tolong hubungi.`,
          pattern: 'KK たら、〜',
        }),
      ],
    },

    // ─── TIME ──────────────────────────────────────────
    time: {
      easy: [
        (w) => ({
          jp:      `${jpMain(w)}は休みです。`,
          id:      `${cleanArti(w.arti)} libur.`,
          pattern: 'Ket.Waktu は KB です',
        }),
        (w) => ({
          jp:      `${jpMain(w)}、来てください。`,
          id:      `Tolong datang pada ${cleanArti(w.arti)}.`,
          pattern: 'Ket.Waktu に KK て ください',
        }),
        (w) => ({
          jp:      `${jpMain(w)}、学校に行きます。`,
          id:      `Pada ${cleanArti(w.arti)}, pergi ke sekolah.`,
          pattern: 'Ket.Waktu、KK ます',
        }),
        (w) => ({
          jp:      `${jpMain(w)}、何をしますか。`,
          id:      `${cleanArti(w.arti)}, apa yang akan dilakukan?`,
          pattern: 'Ket.Waktu、何 を しますか',
        }),
      ],
      medium: [
        (w) => ({
          jp:      `${jpMain(w)}までに終わります。`,
          id:      `Selesai sebelum ${cleanArti(w.arti)}.`,
          pattern: 'KB まで に KK',
        }),
        (w) => ({
          jp:      `${jpMain(w)}から始めます。`,
          id:      `Mulai dari ${cleanArti(w.arti)}.`,
          pattern: 'KB から KK',
        }),
        (w) => ({
          jp:      `${jpMain(w)}に勉強したいです。`,
          id:      `Ingin belajar pada ${cleanArti(w.arti)}.`,
          pattern: 'KK たいです',
        }),
        (w) => ({
          jp:      `${jpMain(w)}はいつも忙しいです。`,
          id:      `Pada ${cleanArti(w.arti)}, selalu sibuk.`,
          pattern: 'Ket.Waktu は いつも KS い',
        }),
      ],
      hard: [
        (w) => ({
          jp:      `${jpMain(w)}に来たら、連絡してください。`,
          id:      `Kalau sudah ${cleanArti(w.arti)}, tolong hubungi.`,
          pattern: 'KK たら、〜',
        }),
        (w) => ({
          jp:      `${jpMain(w)}になると思います。`,
          id:      `Saya pikir akan menjadi ${cleanArti(w.arti)}.`,
          pattern: 'KB に なる と思います',
        }),
        (w) => ({
          jp:      `${jpMain(w)}のうちに、準備します。`,
          id:      `Selagi masih ${cleanArti(w.arti)}, saya bersiap.`,
          pattern: 'KB の うちに、〜',
        }),
      ],
    },

  };

  // ══════════════════════════════════════════════════════
  // MAIN GENERATE FUNCTION
  // ══════════════════════════════════════════════════════

  /**
   * generate(word, lessonId, difficulty)
   *
   * @param  {Object} word       — vocab item dari DB atau master_kotoba
   * @param  {number} lessonId   — ID pelajaran saat ini (untuk konteks)
   * @param  {string} difficulty — 'easy' | 'medium' | 'hard' (default: 'easy')
   * @return {Object|null}       — { ex, ex_romaji, ex_id, ex_pattern, source, type, difficulty }
   *                               atau null jika kata tidak bisa diproses
   */
  function generate(word, lessonId, difficulty) {
    if (!word) return null;

    const j = jpMain(word);
    // Skip ekspresi khusus (〜verb, partikel, dsb)
    if (!j || j.startsWith('〜') || j.startsWith('～')) return null;
    // Skip ekspresi sangat panjang (frasa, bukan kata tunggal)
    if (j.length > 12 && !j.endsWith('ます')) return null;

    const diff = (difficulty === 'medium' || difficulty === 'hard') ? difficulty : 'easy';
    const type = classify(word);
    if (type === 'skip') return null;

    // Ambil template pool untuk tipe + kesulitan ini
    const bank = TEMPLATES[type] || TEMPLATES.noun;
    let pool = bank[diff];
    if (!pool || !pool.length) pool = bank.easy || [];
    if (!pool.length) return null;

    // Pilih template deterministik berdasarkan hash kana
    const idx = stableIdx(word, pool.length);
    const builder = pool[idx];

    try {
      // Untuk kata kerja, ambil konjugasi dulu
      let forms = null;
      if (type === 'verb') {
        forms = getVerbForms(word);
        if (!forms) {
          // Fallback: tidak bisa konjugasi → gunakan template noun
          const fallbackPool = TEMPLATES.noun[diff] || TEMPLATES.noun.easy;
          const result = fallbackPool[stableIdx(word, fallbackPool.length)](word);
          if (!result || !result.jp) return null;
          return { ex: result.jp, ex_romaji: '', ex_id: result.id || '',
                   ex_pattern: result.pattern || '', source: 'engine',
                   type: 'noun', difficulty: diff };
        }
      }

      const result = builder(word, forms, lessonId);
      if (!result || !result.jp) return null;

      return {
        ex:         result.jp,
        ex_romaji:  '',
        ex_id:      result.id     || '',
        ex_pattern: result.pattern || '',
        source:     'engine',       // untuk debug: membedakan dari bunpou/manual
        type:       type,
        difficulty: diff,
      };
    } catch (e) {
      console.warn('[SENTENCE_ENGINE] Error building sentence:', word, e);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════

  return {
    generate,
    classify,
    DIFFICULTY_LABELS: { easy: '🟢 Mudah', medium: '🟡 Sedang', hard: '🔴 Sulit' },
    DIFFICULTY_DESCS: {
      easy:   'Pola dasar (は/が/を ～ ます)',
      medium: 'Pola lanjutan (てください/ている/たい)',
      hard:   'Pola tinggi (たことがある/と思います/たら)',
    },
  };

})();

// Expose untuk debugging
window.SENTENCE_ENGINE = SENTENCE_ENGINE;
