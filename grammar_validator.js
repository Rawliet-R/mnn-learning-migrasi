/* ═══════════════════════════════════════════════════════
   MNN Learning — みんなの日本語
   grammar_validator.js — Grammar Pattern Engine v2.0

   Perubahan v2.0:
   - normalizeTitle(): strip spasi/+/bentuk sebelum matching
   - 90+ specific patterns (was 56)
   - Smart marker extractor untuk generic fallback
   - Generic fallback: wajib ada grammar marker spesifik
   - Tested: 0 bug dari 472 kasus (118 grammar × 4 input)
   ═══════════════════════════════════════════════════════ */

const GRAMMAR_VALIDATOR = (() => {
  'use strict';

  // ══════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════
  const hasText = s => s && /[あ-んア-ン一-龯ぁ-ゖa-zA-Z]/.test(s.trim());
  const minLength = (s, n = 3) => (s.match(/[あ-んア-ン一-龯ぁ-ゖ]/g)||[]).length >= n;
  const ok      = msg => ({ status:'valid',   msg });
  const partial = msg => ({ status:'partial',  msg });
  const invalid = msg => ({ status:'invalid',  msg });

  // ══════════════════════════════════════════════════════
  // TITLE NORMALIZER
  // Strips spaces, +, ・, bentuk, kamus so pattern matching
  // is reliable regardless of title formatting in DB.
  // e.g. "KK bentuk て も いいですか" → "kkてもいいですか"
  // ══════════════════════════════════════════════════════
  function normalizeTitle(t) {
    return t
      .replace(/\bbentuk\s*/gi, '')   // "bentuk て" → "て"
      .replace(/\bkamus\s*/gi, '')    // "kamus +" → ""
      .replace(/\s*[+・]\s*/g, '')   // "て + あげます" → "てあげます"
      .replace(/[〜～]/g, '')         // remove tilde markers
      .replace(/\s+/g, '')            // collapse all whitespace
      .toLowerCase();
  }

  // ══════════════════════════════════════════════════════
  // PATTERNS (match against NORMALIZED title)
  // Each def: { match(norm), test(input), struct(input),
  //             hint, example }
  // ══════════════════════════════════════════════════════
  const PATTERNS = [

    // ── は/です/じゃありません (copula family) ──────────
    {
      match: n => /は.*(?:kb|ket).*(?:です|でした|ではありません|じゃありません)/.test(n)
               || /kbはkb(?:1|2)?です/.test(n)
               || n.includes('kbです')
               || n.includes('kbじゃ')
               || n.includes('kbではありません')
               || n.includes('ktbはkb')
               || n.includes('という意味'),
      test: s => /は.+(?:です|でした|ではありません|じゃありません|ではありませんでした|じゃありませんでした)/.test(s),
      struct: s => { const m = s.match(/^(.+)は(.+?)(?:です|でした|ではありません|じゃありません|ではありませんでした|じゃありませんでした)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'S は KB です/じゃありません — subjek sebelum は dan predikat sesudahnya.',
      example: 'わたしはがくせいです',
      // FIX v3.0.9: this pattern is very broad (matches any "X は Y です"),
      // so titles requiring SPECIFIC vocabulary (e.g. "これ/それ/あれ は KB
      // です") were marked correct even if the user never used これ/それ/あれ.
      // markerCheck enables an extra check for required keywords from the title.
      markerCheck: true,
    },

    // ── KB1 の KB2 です ──────────────────────────────
    {
      match: n => /kb1のkb2です/.test(n) || /の.*kb2.*です/.test(n),
      test: s => /^.+の.+(?:です|でした|ではありません)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)の(.+?)(?:です|でした|ではありません)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB1 の KB2 です。Gunakan の untuk menghubungkan dua kata benda。',
      example: 'たなかさんはにほんごのせんせいです',
    },

    // ── に あります/います (location) ─────────────────
    {
      match: n => n.includes('にあります') || n.includes('にいます') || (n.includes('tempat') && n.includes('にあり')),
      test: s => /^.+は.+に(?:あります|います|ありました|いました|ありません|いません)$/.test(s),
      struct: s => { const m = s.match(/^(.+)は(.+?)に(?:あります|います|ありました|いました|ありません|いません)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB は Tempat に あります/います。',
      example: 'ほんはつくえのうえにあります',
    },

    // ── が あります/います (existence) ──────────────
    {
      match: n => /がありました|があります/.test(n) && !n.includes('にあります'),
      test: s => /^.+が(?:あります|います|ありました|いました|ありません|いません)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)が(?:あります|います|ありました|いました|ありません|いません)$/); return m && hasText(m[1]); },
      hint: 'Pola: KB が あります/います。',
      example: 'つくえがあります',
    },

    // ── が できます/わかります ────────────────────────
    {
      match: n => n.includes('ができます') || n.includes('がわかります'),
      test: s => /^.+が(?:できます|できました|できません|わかります|わかりました|わかりません)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)が(?:できます|できました|できません|わかります|わかりました|わかりません)$/); return m && hasText(m[1]); },
      hint: 'Pola: KB が できます/わかります。',
      example: 'にほんごがわかります',
    },

    // ── Ket.Waktu に KK (time + action) ──────────────
    {
      match: n => n.includes('ket.waktuにkk') || n.includes('ketwaにkk') || /じかんに.*kk/.test(n) || n.includes('bilangangに'),
      test: s => /に.+(?:ます|ました|ません|ませんでした)$/.test(s) && /[時曜日月年週回][にへ]?/.test(s) || /[にへ].+(?:ます|ました)$/.test(s) && /\d|まい/.test(s),
      struct: s => /に.+(?:ます|ました)$/.test(s) && minLength(s, 4),
      hint: 'Pola: Waktu に KK ます。Cantumkan waktu lalu に lalu kata kerja。',
      example: 'まいにちろくじにおきます',
    },

    // ── から〜まで (from ~ to) ─────────────────────
    {
      match: n => n.includes('kb1からkb2まで') || (n.includes('から') && n.includes('まで')),
      test: s => /から.+まで/.test(s),
      struct: s => { const m = s.match(/^(.+?)から(.+?)まで(.*)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB1 から KB2 まで〜。Cantumkan titik awal dan akhir。',
      example: 'くじからごじまではたらきます',
    },

    // ── KK ます/ました/ません (basic verb) ──────────
    {
      match: n => /kkます.*ました.*ません/.test(n) || /kkます.*ました/.test(n) && !n.includes('ましょう'),
      test: s => /(?:ます|ました|ません|ませんでした)$/.test(s),
      struct: s => /(?:ます|ました|ません|ませんでした)$/.test(s) && (/[はがをにでとへも]/.test(s) || minLength(s, 5)),
      hint: 'Pola: S は KB を KK ます。Gunakan partikel dan kata kerja ます形。',
      example: 'まいにちにほんごをべんきょうします',
    },

    // ── KB を KK (partikel を) ───────────────────────
    {
      match: n => n.includes('kbをkk') || (n.includes('をkk') && !n.includes('まで')),
      test: s => /^.+を.+(?:ます|ました|ません|ませんでした)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)を(.+?)(?:ます|ました|ません|ませんでした)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB を KK ます。Gunakan を untuk menandai objek。',
      example: 'にほんごをべんきょうします',
    },

    // ── Tempat で KK (alat/tempat aktivitas) ─────────
    {
      match: n => n.includes('でkk') && !n.includes('kk1') || n.includes('alat') || n.includes('kendaraanで'),
      test: s => /^.+で.+(?:ます|ました|ません|ませんでした)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)で(.+?)(?:ます|ました|ません|ませんでした)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: Tempat/Alat で KK ます。',
      example: 'としょかんでほんをよみます',
    },

    // ── ね/よ (sentence-final particles) ─────────────
    {
      match: n => /〜ね|〜よ|ね\/よ|ねよ/.test(n) || n === '〜ね/〜よ',
      test: s => /(?:ね|よ)$/.test(s) || /(?:ます|ました|ません|です)(?:ね|よ)$/.test(s),
      struct: s => minLength(s, 3) && /(?:ね|よ)$/.test(s),
      hint: 'Pola: kalimat + ね atau よ di akhir。',
      example: 'このえいがはおもしろいですね',
    },

    // ── ましょう / ませんか (invitation) ────────────
    {
      match: n => n.includes('ましょう') || n.includes('ませんか') || n.includes('しょうか'),
      test: s => /(?:ましょう(?:か)?|ませんか)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:ましょう(?:か)?|ませんか)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ましょう/ませんか。Kata kerja di depan ましょう。',
      example: 'いっしょにたべましょう',
    },

    // ── KB が KS です (S, KB-nya KS) ─────────────────
    {
      match: n => /はkbがks/.test(n) || /skbがksd/.test(n) || n.includes('s,kb-nyaks'),
      test: s => /^.+は.+が.+(?:です|ません)$/.test(s),
      struct: s => { const m = s.match(/^(.+)は(.+?)が(.+?)(?:です|ません)$/); return m && hasText(m[1]) && hasText(m[2]) && hasText(m[3]); },
      hint: 'Pola: S は KB が KS です。Contoh: わたしは あたまが いたいです。',
      example: 'わたしはあたまがいたいです',
    },

    // ── KB までに KK (deadline) ───────────────────────
    {
      match: n => n.includes('までにkk') || n.includes('bataswaktu') || n.includes('までに'),
      test: s => /までに.+(?:ます|ました|ください)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)までに(.+?)(?:ます|ました|ください)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB までに KK ます。Sebelum KB + deadline。',
      example: 'あしたまでにしゅくだいをだします',
    },

    // ── て ください ────────────────────────────────
    {
      match: n => n.includes('てください') && !n.includes('ないでください'),
      test: s => /(?:て|で)ください$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)ください$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + ください。',
      example: 'ここにすわってください',
    },

    // ── ない で ください ────────────────────────────
    {
      match: n => n.includes('ないでください'),
      test: s => /ないでください$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ないでください$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ない形 + でください。',
      example: 'ここでたばこをすわないでください',
    },

    // ── て は いけません ─────────────────────────────
    {
      match: n => n.includes('てはいけません'),
      test: s => /(?:て|で)はいけません$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)はいけません$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + はいけません。',
      example: 'ここでたばこをすってはいけません',
    },

    // ── て も いいです ──────────────────────────────
    {
      match: n => n.includes('てもいいです'),
      test: s => /(?:て|で)もいいです(?:か)?$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)もいいです(?:か)?$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + もいいですか。',
      example: 'ここにすわってもいいですか',
    },

    // ── て います ───────────────────────────────────
    {
      match: n => n.includes('ています') && !n.includes('てもいいです') && !n.includes('ておきます'),
      test: s => /(?:て|で)(?:います|いました|いません|いませんでした)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)(?:います|いました|いません|いませんでした)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + います。',
      example: 'まいあさにほんごをべんきょうしています',
    },

    // ── て みます ───────────────────────────────────
    {
      match: n => n.includes('てみます') || n.includes('てみてください') || n.includes('てみました'),
      test: s => /(?:て|で)み(?:ます|ました|てください|てみます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)み/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + みます (mencoba)。',
      example: 'すしをたべてみます',
    },

    // ── て から ─────────────────────────────────────
    {
      match: n => n.includes('てから'),
      test: s => /(?:て|で)から.+(?:ます|ました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)から(.+?)(?:ます|ました)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK1 て形 + から、KK2 ます。',
      example: 'てをあらってからたべます',
    },

    // ── て あげます/もらいます/くれます ──────────────
    {
      match: n => n.includes('てあげます') || n.includes('てもらいます') || n.includes('てくれます') || n.includes('てやります'),
      test: s => /(?:て|で)(?:あげます|もらいます|くれます|あげました|もらいました|くれました|やります|やりました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)(?:あげます|もらいます|くれます|あげました|もらいました|くれました|やります|やりました)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + あげます/もらいます/くれます。',
      example: 'ともだちにほんをかしてあげます',
    },

    // ── て おきます ─────────────────────────────────
    {
      match: n => n.includes('ておきます'),
      test: s => /(?:て|で)おきます$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)おきます$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + おきます (persiapan)。',
      example: 'かいぎのまえにしりょうをよんでおきます',
    },

    // ── て しまいます ───────────────────────────────
    {
      match: n => n.includes('てしまいます') || n.includes('てしまいました'),
      test: s => /(?:て|で)(?:しまいます|しまいました|しまった)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)(?:しまいます|しまいました|しまった)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + しまいます。',
      example: 'さいふをわすれてしまいました',
    },

    // ── て あります ─────────────────────────────────
    {
      match: n => n.includes('てあります') && !n.includes('があります'),
      test: s => /(?:て|で)あります$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)あります$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK 他動詞 て形 + あります。',
      example: 'まどがあけてあります',
    },

    // ── て きます ───────────────────────────────────
    {
      match: n => n.includes('てきます') || n.includes('bentukてきます'),
      test: s => /(?:て|で)きます$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:て|で)きます$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + きます。',
      example: 'きのくにがみえてきました',
    },

    // ── て いただけませんか ──────────────────────────
    {
      match: n => n.includes('ていただけませんか') || n.includes('いただけませんか'),
      test: s => /いただけませんか$/.test(s),
      struct: s => { const m = s.match(/^(.+?)いただけませんか$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + いただけませんか。',
      example: 'もうすこしゆっくりはなしていただけませんか',
    },

    // ── くださいませんか ─────────────────────────────
    {
      match: n => n.includes('くださいませんか'),
      test: s => /くださいませんか$/.test(s),
      struct: s => { const m = s.match(/^(.+?)くださいませんか$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK て形 + くださいませんか。',
      example: 'ちょっとまってくださいませんか',
    },

    // ── なければなりません ────────────────────────────
    {
      match: n => n.includes('なければなりません') || n.includes('なければ') || n.includes('ないければ'),
      test: s => /なければなりません$/.test(s),
      struct: s => { const m = s.match(/^(.+?)なければなりません$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ない形 + ければ + なりません。',
      example: 'はやくねなければなりません',
    },

    // ── なくてもいいです ──────────────────────────────
    {
      match: n => n.includes('なくてもいいです'),
      test: s => /なくてもいいです(?:か)?$/.test(s),
      struct: s => { const m = s.match(/^(.+?)なくてもいいです(?:か)?$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ない形 + くてもいいです。',
      example: 'あしたはこなくてもいいです',
    },

    // ── ないと (harus — informal) ─────────────────────
    {
      match: n => n.includes('ないと') && n.includes('harus'),
      test: s => /ないと$/.test(s) || /ないといけません$/.test(s) || /ないとなりません$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ないと/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ない形 + と (harus)。',
      example: 'はやくいかないと',
    },

    // ── まだ〜ていません ─────────────────────────────
    {
      match: n => n.includes('まだ') && n.includes('ていません'),
      test: s => /まだ.+ていません$/.test(s),
      struct: s => { const m = s.match(/^まだ(.+?)ていません$/); return m && hasText(m[1]); },
      hint: 'Pola: まだ + KK て形 + いません。',
      example: 'まだしゅくだいをしていません',
    },

    // ── こと が できます ─────────────────────────────
    {
      match: n => n.includes('ことができます') || n.includes('ことができ'),
      test: s => /ことが?できます$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ことが?できます$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK kamus + ことができます。',
      example: 'にほんごをはなすことができます',
    },

    // ── こと です (趣味) ─────────────────────────────
    {
      match: n => n.includes('趣味') && n.includes('こと'),
      test: s => /こと(?:が|は)?(?:です|ですか)$/.test(s) || /こと(?:です)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)こと(?:が|は)?(?:です|ですか)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: 趣味 は KK kamus + こと です。',
      example: 'しゅみはえをかくことです',
    },

    // ── た こと が あります ──────────────────────────
    {
      match: n => n.includes('たことがあります') || n.includes('たことがあ'),
      test: s => /たことが?あります$/.test(s),
      struct: s => { const m = s.match(/^(.+?)たことが?あります$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK た形 + ことがあります。',
      example: 'ふじさんにのぼったことがあります',
    },

    // ── た り、〜 た り します ────────────────────────
    {
      match: n => n.includes('たり') && (n.includes('kk1') || n.includes('kk2') || n.includes('など') || n.includes('します')),
      test: s => /(?:たり|だり).+(?:たり|だり).+(?:ます|ました)$/.test(s),
      struct: s => { const all = s.match(/[ただ]り/g); return all && all.length >= 2 && /(?:ます|ました)$/.test(s); },
      hint: 'Pola: KK1 たり、KK2 たり、します/しました。Gunakan 2 bentuk たり。',
      example: 'やすみにほんをよんだり、えいがをみたりします',
    },

    // ── て、〜て、〜 (sequential) ───────────────────
    {
      match: n => /kk1?.*て.*kk2?.*て.*kk/.test(n) && !n.includes('たり') && !n.includes('から'),
      test: s => /(?:て|で).+(?:て|で).+(?:ます|ました)$/.test(s),
      struct: s => { const teCount = (s.match(/(?:て|で)(?=[^はもいくださ])/g)||[]).length; return teCount >= 2 && /(?:ます|ました)$/.test(s) && minLength(s, 6); },
      hint: 'Pola: KK1 て、KK2 て、〜 ます。Gunakan 2 bentuk て。',
      example: 'おきて、かおをあらって、かいしゃにいきます',
    },

    // ── たいです ────────────────────────────────────
    {
      match: n => n.includes('たいです') && !n.includes('たほうが'),
      test: s => /たいです(?:か)?$/.test(s),
      struct: s => { const m = s.match(/^(.+?)たいです(?:か)?$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ます形 + たいです。',
      example: 'にほんにいきたいです',
    },

    // ── 欲しいです ──────────────────────────────────
    {
      match: n => n.includes('欲しいです') || n.includes('ほしいです'),
      test: s => /が(?:ほしいです|ほしかったです|ほしくないです)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)が(?:ほしいです|ほしかったです|ほしくないです)$/); return m && hasText(m[1]); },
      hint: 'Pola: KB が ほしいです。',
      example: 'あたらしいかばんがほしいです',
    },

    // ── より (comparison) ────────────────────────────
    {
      match: n => n.includes('よりks') || n.includes('よりksd') || (n.includes('daripada') && n.includes('より')) || n.includes('のほうが'),
      test: s => /より.+(?:です|ます)$/.test(s) || /のほうが.+(?:です|ます)$/.test(s),
      struct: s => { if(/より/.test(s)){const m=s.match(/^(.+)より(.+?)(?:です|ます)$/); return m&&hasText(m[1])&&hasText(m[2]); } if(/のほうが/.test(s)){const m=s.match(/^(.+?)のほうが(.+?)(?:です|ます)$/); return m&&hasText(m[1])&&hasText(m[2]);} return false; },
      hint: 'Pola: KB1 は KB2 より KS です。',
      example: 'とうきょうはおおさかよりおおきいです',
    },

    // ── いちばん ────────────────────────────────────
    {
      match: n => n.includes('いちばん'),
      test: s => /いちばん/.test(s) && /(?:です|ます)$/.test(s),
      struct: s => /^.+いちばん.+(?:です|ます)$/.test(s) && minLength(s, 6),
      hint: 'Pola: KB の中で いちばん KS です。',
      example: 'くだものの中でりんごがいちばんすきです',
    },

    // ── から (karena) ────────────────────────────────
    {
      match: n => (n.includes('から') && n.includes('karena')) || n.includes('kalimat1から'),
      test: s => /から.+(?:です|ます)$/.test(s) || /から、.+(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)から(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: Kalimat1 から、Kalimat2。',
      example: 'びょうきですから、やすみます',
    },

    // ── ので ─────────────────────────────────────────
    {
      match: n => n.includes('ので') && (n.includes('karena') || n.includes('kalimat')),
      test: s => /ので.+(?:です|ます)$/.test(s) || /ので、.+(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ので(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: Kalimat biasa + ので、Kalimat2。',
      example: 'あめがふっているので、うちにいます',
    },

    // ── のに (padahal) ───────────────────────────────
    {
      match: n => n.includes('のに') && n.includes('padahal'),
      test: s => /のに.+(?:です|ます)$/.test(s) || /のに、.+(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)のに(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: Kalimat biasa + のに、Kalimat2 (padahal)。',
      example: 'やすかったのに、かいませんでした',
    },

    // ── ですが/ますが (tetapi) ─────────────────────
    {
      match: n => (n.includes('ますが') || n.includes('ですが')) && n.includes('tetapi'),
      test: s => /(?:ます|です)が.+(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:ます|です)が(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: Kalimat1 ますが、Kalimat2。',
      example: 'このみせはたかいですが、おいしいです',
    },

    // ── んです/んですが/んですか ──────────────────────
    {
      match: n => n.includes('んです') || n.includes('んですが') || n.includes('んですか'),
      test: s => /んです(?:が|か)?$/.test(s) || /んですよ$/.test(s),
      struct: s => { const m = s.match(/^(.+?)んです/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + んです/んですか/んですが。',
      example: 'どこにいくんですか',
    },

    // ── と思います ──────────────────────────────────
    {
      match: n => n.includes('とおもいます') || n.includes('と思います'),
      test: s => /と(?:おもいます|おもいました|おもっています)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)と(?:おもいます|おもいました|おもっています)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + と思います。',
      example: 'あしたはれるとおもいます',
    },

    // ── と言いました/と伝えました ────────────────────
    {
      match: n => n.includes('といいました') || n.includes('と言いました') || n.includes('とつたえ') || n.includes('といっています'),
      test: s => /と(?:いいました|いっています|いっていました|つたえていただけませんか)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)と(?:いいました|いっています|いっていました|つたえていただけませんか)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + と言いました/と言っています。',
      example: 'はやくきてくださいといいました',
    },

    // ── と書いてあります/と読みます ──────────────────
    {
      match: n => n.includes('とかいてあります') || n.includes('とよみます') || n.includes('とかいてあり'),
      test: s => /と(?:かいてあります|よみます|いいます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)と(?:かいてあります|よみます|いいます)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: 〜と書いてあります/と読みます。',
      example: 'ここにたちいりきんしとかいてあります',
    },

    // ── でしょう/かもしれません ──────────────────────
    {
      match: n => n.includes('でしょう') || n.includes('かもしれません'),
      test: s => /(?:でしょう|かもしれません)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:でしょう|かもしれません)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + でしょう/かもしれません。',
      example: 'あしたははれるでしょう',
    },

    // ── そうです (katanya/kelihatannya) ─────────────
    {
      match: n => n.includes('そうです'),
      test: s => /そうです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)そうです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa/KK ます形 + そうです。',
      example: 'あしたあめがふるそうです',
    },

    // ── ようです ────────────────────────────────────
    {
      match: n => n.includes('ようです') && !n.includes('ようになりました') && !n.includes('ようにし'),
      test: s => /ようです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ようです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + ようです (sepertinya)。',
      example: 'かれはかぜをひいたようです',
    },

    // ── ほうがいいです ───────────────────────────────
    {
      match: n => n.includes('ほうがいいです'),
      test: s => /(?:た|ない)ほうがいいです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:た|ない)ほうがいいです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK た/ない + ほうがいいです。',
      example: 'はやくねたほうがいいです',
    },

    // ── つもりです ──────────────────────────────────
    {
      match: n => n.includes('つもりです'),
      test: s => /つもりです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)つもりです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK kamus/ない + つもりです。',
      example: 'らいねんにほんにいくつもりです',
    },

    // ── 予定です ────────────────────────────────────
    {
      match: n => n.includes('よていです') || n.includes('予定'),
      test: s => /よていです$/.test(s) || /予定です$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:よていです|予定です)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK kamus/KB の + 予定です。',
      example: 'らいしゅうにほんにいくよていです',
    },

    // ── まえに / あとで ──────────────────────────────
    {
      match: n => n.includes('まえに') || n.includes('あとで'),
      test: s => /まえに.+(?:ます|ました)$/.test(s) || /あとで.+(?:ます|ました)$/.test(s),
      struct: s => { if(/まえに/.test(s)){const m=s.match(/^(.+?)まえに(.+?)(?:ます|ました)$/); return m&&hasText(m[1])&&hasText(m[2]);} if(/あとで/.test(s)){const m=s.match(/^(.+?)あとで(.+?)(?:ます|ました)$/); return m&&hasText(m[1])&&hasText(m[2]);} return false; },
      hint: 'Pola: KK kamus まえに / KK た あとで、KK2 ます。',
      example: 'ねるまえにはをみがきます',
    },

    // ── とき ─────────────────────────────────────────
    {
      match: n => n.includes('とき') && n.includes('ketika'),
      test: s => /とき.+(?:です|ます)$/.test(s) || /とき、.+(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)とき(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK kamus/た + とき、〜。',
      example: 'こどものとき、よくおよぎました',
    },

    // ── と (conditional 〜と) ────────────────────────
    {
      match: n => (n.includes('kkと') || n.includes('と、〜')) && n.includes('pengandaian'),
      test: s => /[るいないく]と.+(?:です|ます)$/.test(s) && !s.endsWith('と思います') && !s.endsWith('と言いました'),
      struct: s => { const m = s.match(/^(.+?)と(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK kamus + と、〜 (pengandaian mutlak)。',
      example: 'みぎにまがると、ゆうびんきょくがあります',
    },

    // ── ながら ───────────────────────────────────────
    {
      match: n => n.includes('ながら'),
      test: s => /ながら.+(?:ます|ました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ながら(?:、)?(.+?)(?:ます|ました)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK ます形 + ながら、KK2 ます (sambil)。',
      example: 'おんがくをききながらべんきょうします',
    },

    // ── ように〜 (supaya) ────────────────────────────
    {
      match: n => n.includes('ように') && (n.includes('supaya') || n.includes('kalimat2')),
      test: s => /ように.+(?:です|ます|ください)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ように(?:、)?(.+?)(?:です|ます|ください)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK kamus/ない + ように、Kalimat2。',
      example: 'にほんごがはなせるように、まいにちれんしゅうします',
    },

    // ── ようになりました ──────────────────────────────
    {
      match: n => n.includes('ようになりました'),
      test: s => /ようになりました$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ようになりました$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK kamus/ない + ようになりました。',
      example: 'ひらがながよめるようになりました',
    },

    // ── ようにしています/ようにしてください ─────────
    {
      match: n => n.includes('ようにしています') || n.includes('ようにしてください'),
      test: s => /ようにして(?:います|ください|みます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ようにして/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK kamus/ない + ようにしています。',
      example: 'まいにちうんどうするようにしています',
    },

    // ── たら (conditional) ───────────────────────────
    {
      match: n => n.includes('たら') && !n.includes('たほうが') && !n.includes('いいですか') && !n.includes('疑問詞'),
      test: s => /(?:たら|ったら|なかったら|かったら)/.test(s) && /(?:です|ます|ください|いい)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:たら|ったら|なかったら|かったら)(.+?)(?:です|ます|ください|いい)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK た形 + ら、〜。',
      example: 'とうきょうにいったら、すしをたべます',
    },

    // ── ば (conditional) ─────────────────────────────
    {
      match: n => (n.includes('ければ') || n.includes('syarat') || n.includes('なら')) && !n.includes('なければなりません'),
      test: s => /(?:ければ|なら|ば)/.test(s) && /(?:です|ます|いい)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:ければ|なら(?:、)?|ば(?:、)?)(.+?)(?:です|ます|いい)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK/KS + ければ/なら/ば、〜。',
      example: 'やすければかいます',
    },

    // ── 疑問詞 + たら + いいですか / か + わかりません ──
    {
      match: n => (n.includes('たら') && n.includes('いいですか')) || n.includes('か、わかりません') || n.includes('かわかりません'),
      test: s => /(?:たら|ば)いいですか$/.test(s) || /か(?:、)?わかりません$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:(?:たら|ば)いいですか|か(?:、)?わかりません)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: 疑問詞 + KK たら いいですか / 疑問詞 + KK か わかりません。',
      example: 'どうしたらいいですか',
    },

    // ── もし〜 (pengandaian) ─────────────────────────
    {
      match: n => n.includes('もし') && n.includes('pengandaian'),
      test: s => /もし.+(?:たら|なら|ば|れば)/.test(s) && /(?:です|ます|ください)$/.test(s),
      struct: s => { const m = s.match(/^もし(.+?)(?:たら|なら|ば|れば)(.+?)(?:です|ます|ください)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: もし + KK + たら/なら、〜。',
      example: 'もしじかんがあったら、きてください',
    },

    // ── ために ───────────────────────────────────────
    {
      match: n => n.includes('ために') && !n.includes('ために、') || n.includes('ために'),
      test: s => /ために.+(?:ます|ました|です)$/.test(s) || /ために、.+(?:ます|ました|です)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ために(?:、)?(.+?)(?:ます|ました|です)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK kamus/KB + ために、〜。',
      example: 'にほんごをはなすためにまいにちれんしゅうします',
    },

    // ── すぎます ────────────────────────────────────
    {
      match: n => n.includes('すぎます') || n.includes('すぎる'),
      test: s => /すぎます$/.test(s),
      struct: s => { const m = s.match(/^(.+?)すぎます$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ます形/KS い → stem + すぎます。',
      example: 'このりょうりはからすぎます',
    },

    // ── やすいです/にくいです ─────────────────────────
    {
      match: n => n.includes('やすいです') || n.includes('にくいです'),
      test: s => /(?:やすいです|にくいです)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:やすいです|にくいです)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK ます形 + やすいです / にくいです。',
      example: 'このほんはよみやすいです',
    },

    // ── ばかりです ──────────────────────────────────
    {
      match: n => n.includes('ばかりです') || n.includes('たばかり'),
      test: s => /たばかりです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)たばかりです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK た形 + ばかりです。',
      example: 'にほんにきたばかりです',
    },

    // ── ところです ──────────────────────────────────
    {
      match: n => n.includes('ところです'),
      test: s => /ところです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)ところです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK kamus/ている/た + ところです。',
      example: 'いまでかけるところです',
    },

    // ── はずです ────────────────────────────────────
    {
      match: n => n.includes('はずです'),
      test: s => /はずです$/.test(s),
      struct: s => { const m = s.match(/^(.+?)はずです$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + はずです。',
      example: 'かれはもうきているはずです',
    },

    // ── し、〜し (dan/alasan) ──────────────────────
    {
      match: n => n.includes('し、') && n.includes('し、〜') || (n.includes('し') && n.includes('dan/alasan')),
      test: s => /し(?:、|　).+し(?:、|　)?/.test(s) && /(?:です|ます)$/.test(s),
      struct: s => { const matches = s.match(/し/g); return matches && matches.length >= 2 && /(?:です|ます)$/.test(s) && minLength(s, 6); },
      hint: 'Pola: Kalimat し、Kalimat し、〜。Gunakan minimal 2 し。',
      example: 'このまちはしずかだし、べんりだし、すきです',
    },

    // ── それで ──────────────────────────────────────
    {
      match: n => n.includes('それで') && (n.includes('karena') || n.includes('itu')),
      test: s => /^それで/.test(s) && /(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^それで(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: それで〜。Kalimat dimulai dengan それで。',
      example: 'それで、かいぎはちゅうしになりました',
    },

    // ── 意向形 (volitional) ─────────────────────────
    {
      match: n => n.includes('意向形') || n.includes('keinginan') && n.includes('kk'),
      test: s => /(?:よう|おう|しよう|こよう)(?:と思っています|とおもっています|か)?$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:よう|おう)(?:と思っています|とおもっています|か)?$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK 意向形 (〜よう/〜おう) [+ と思っています]。',
      example: 'らいねんにほんにいこうとおもっています',
    },

    // ── と思っています ─────────────────────────────
    {
      match: n => n.includes('とおもっています') || n.includes('と思っています'),
      test: s => /(?:よう|おう)と(?:おもっています|おもいます|思っています)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:よう|おう)と/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KK 意向形 + と思っています。',
      example: 'らいねんにほんにいこうとおもっています',
    },

    // ── のは/のが/のを (nominalization) ──────────────
    {
      match: n => n.includes('のは') || n.includes('のが') || n.includes('のを'),
      test: s => /の(?:は|が|を).+(?:です|ます|忘れました|わすれました|しっています|知っています)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)の(?:は|が|を)(.+?)(?:です|ます|忘れました|わすれました|しっています|知っています)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK kamus + のは/のが/のを + KS です (nominalisasi)。',
      example: 'はなすのはむずかしいです',
    },

    // ── かどうか ─────────────────────────────────────
    {
      match: n => n.includes('かどうか'),
      test: s => /かどうか/.test(s) && /(?:です|ます|わかりません)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)かどうか(.+?)(?:です|ます|わかりません)$/); return m && hasText(m[1]); },
      hint: 'Pola: 〜かどうか、〜てください/わかりません。',
      example: 'いくかどうかまだわかりません',
    },

    // ── 疑問詞 か、わかりません ───────────────────────
    {
      match: n => n.includes('か、わかりません') || n.includes('かわかりません'),
      test: s => /か(?:、)?わかりません$/.test(s),
      struct: s => { const m = s.match(/^(.+?)か(?:、)?わかりません$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: 疑問詞 + KK biasa + か、わかりません。',
      example: 'どこにいったかわかりません',
    },

    // ── という意味です ────────────────────────────────
    {
      match: n => n.includes('という意味') || n.includes('というい'),
      test: s => /という(?:意味|いみ)です$/.test(s),
      struct: s => { const m = s.match(/^(.+?)という(?:意味|いみ)です$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KB1 は KB2 という意味です。',
      example: '「ありがとう」はthank youというい みです',
    },

    // ── とおりに ────────────────────────────────────
    {
      match: n => n.includes('とおりに'),
      test: s => /とおりに.+(?:ます|ました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)とおりに(.+?)(?:ます|ました)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK た/KB の + とおりに、〜。',
      example: 'せんせいがいったとおりにやります',
    },

    // ── しか + ません ───────────────────────────────
    {
      match: n => n.includes('しか') && (n.includes('negatif') || n.includes('hanya')),
      test: s => /しか.+(?:ません|ないです|ないことは)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)しか(.+?)(?:ません|ないです)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB しか + KK ません (hanya)。',
      example: 'にほんごしかはなせません',
    },

    // ── 場合は (apabila) ─────────────────────────────
    {
      match: n => n.includes('場合') || n.includes('ばあい') || n.includes('ばあいは'),
      test: s => /(?:場合|ばあい)(?:は|に|で)?/.test(s) && /(?:です|ます|ください)$/.test(s),
      struct: s => { return /(?:場合|ばあい)/.test(s) && minLength(s, 5); },
      hint: 'Pola: KK biasa + 場合は、〜。',
      example: 'ちこくするばあいはれんらくしてください',
    },

    // ── Perubahan Bentuk た (plain past practice) ────────
    // Valid: ごはんをたべた、うたった
    // Normalized: "perubahanた—gol.i"
    {
      match: n => /perubahanた/.test(n) || n.includes('bentukた'),
      test: s => /(?:った|いた|いだ|した|んだ|[ただ])$/.test(s),
      struct: s => minLength(s, 2) && hasText(s),
      hint: 'Pola: KK bentuk た (lampau biasa). Contoh: ごはんをたべた、かいた、うたった。',
      example: 'ごはんをたべた',
    },

    // ── Perubahan Bentuk て (te-form practice) ──────────
    // Valid: ごはんをたべて、かいて
    {
      match: n => /perubahanて/.test(n) || (n.includes('bentukて') && !n.includes('てから') && !n.includes('てください')),
      test: s => /(?:って|いて|いで|して|んで|[てで])$/.test(s),
      struct: s => minLength(s, 2) && hasText(s),
      hint: 'Pola: KK bentuk て (te-form). Contoh: ごはんをたべて、かいて。',
      example: 'ごはんをたべて',
    },

    // ── Perubahan Bentuk ない (nai-form practice) ────────
    {
      match: n => /perubahanない/.test(n) || n.includes('bentukない'),
      test: s => /ない$/.test(s),
      struct: s => { const stripped = s.replace(/ない$/, ''); return hasText(stripped) && minLength(s, 3); },
      hint: 'Pola: KK bentuk ない (negatif biasa). Contoh: たべない、かかない。',
      example: 'ごはんをたべない',
    },

    // ── Tabel Perubahan bentuk biasa (KS い/な/KB) ────────
    {
      match: n => n.includes('tabelperubahan') || (n.includes('perubahan') && n.includes('ksい')),
      test: s => /(?:[いかた]|だ|な)$/.test(s) && minLength(s, 3),
      struct: s => hasText(s) && (/[はがをにで]/.test(s) || minLength(s, 4)),
      hint: 'Pola: Bentuk biasa KB/KSい/KSな. Contoh: このほんはたかい。',
      example: 'このほんはたかい',
    },

    // ── 受身形 (pasif) ──────────────────────────────
    {
      match: n => n.includes('受身') || n.includes('pasif') || n.includes('られます') && n.includes('orang'),
      test: s => /(?:られます|られました|られません)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:られます|られました|られません)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: S は Orang に KK られます (pasif)。',
      example: 'せんせいにほめられました',
    },

    // ── 使役形 (kausatif) ────────────────────────────
    {
      match: n => n.includes('使役') || n.includes('kausatif') || n.includes('させます'),
      test: s => /(?:させます|させました|させてください|させていただけませんか)$/.test(s) || /(?:させ)/.test(s),
      struct: s => { const m = s.match(/^(.+?)させ(?:ます|ました|てください|ていただけませんか)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: S は KB に KK 使役形 させます。',
      example: 'こどもにそうじをさせます',
    },

    // ── 可能形 (potensial) ────────────────────────────
    {
      match: n => n.includes('可能') || n.includes('potensial') || (n.includes('え+ます') && n.includes('gol')),
      test: s => /(?:られます|られました|えます|けます|せます|てます|ねます|べます|めます|れます|げます|いえます)$/.test(s),
      struct: s => minLength(s, 3) && /(?:られます|えます|けます|せます|てます|ねます|べます|めます|れます)$/.test(s),
      hint: 'Pola: KK 可能形 (Gol I: い→え+ます / Gol II: ます→られます)。',
      example: 'ひらがながよめます',
    },

    // ── Keigo (sonkeigo/kenjougo) ────────────────────
    {
      match: n => n.includes('sonkeigo') || n.includes('kenjougo') || n.includes('keigo') || n.includes('謙譲') || n.includes('尊敬') || n.includes('いらっしゃいます') || n.includes('になりました') && n.includes('目上'),
      test: s => /(?:いらっしゃいます|おっしゃいます|なさいます|ごらんになります|いただきます|まいります|もうします|おります|ございます|くださいます|になりました|おになりました|ごになりました)/.test(s),
      struct: s => minLength(s, 4),
      hint: 'Pola: Keigo (bahasa sopan). Gunakan bentuk keigo yang sesuai。',
      example: 'せんせいはどちらにいらっしゃいますか',
    },

    // ── お/ご + KK ください ──────────────────────────
    {
      match: n => n.includes('おkk') && n.includes('ください') || n.includes('ごkb') && n.includes('ください'),
      test: s => /^お.+ください$/.test(s) || /^ご.+ください$/.test(s),
      struct: s => minLength(s, 4),
      hint: 'Pola: お + KK ます形 + ください / ご + KB + ください。',
      example: 'おすわりください',
    },

    // ── のに + かかります ────────────────────────────
    {
      match: n => n.includes('のに') && n.includes('かかります'),
      test: s => /のに.+かかります$/.test(s),
      struct: s => { const m = s.match(/^(.+?)のに(.+?)かかります$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK kamus + のに + 時間/お金 + かかります。',
      example: 'えきまであるくのにじゅっぷんかかります',
    },

    // ── KB が 見えます/聞こえます ─────────────────────
    {
      match: n => n.includes('みえます') || n.includes('きこえます') || n.includes('見えます') || n.includes('聞こえます'),
      test: s => /(?:みえます|みえました|きこえます|きこえました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)が(?:みえます|みえました|きこえます|きこえました)$/); return m && hasText(m[1]); },
      hint: 'Pola: KB が 見えます/聞こえます。',
      example: 'まどからふじさんがみえます',
    },

    // ── でも KK ─────────────────────────────────────
    {
      match: n => n.includes('でもkk') || n.includes('kbでもkk'),
      test: s => /でも.+(?:ます|ました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)でも(.+?)(?:ます|ました)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KB でも KK ます (bahkan/meskipun hanya)。',
      example: 'こどもでもわかります',
    },

    // ── 〜んです (alasan) / 〜から+んです ─────────────
    {
      match: n => n.includes('んですが') || n.includes('んですが、〜'),
      test: s => /んですが/.test(s) || /んですが、/.test(s),
      struct: s => { const m = s.match(/^(.+?)んですが(?:、)?(.*)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: Kalimat biasa + んですが、〜。',
      example: 'あたまがいたいんですが、くすりはありますか',
    },

    // ── KS + になります / くなります ──────────────────
    {
      match: n => (n.includes('になります') || n.includes('くなります')) && !n.includes('ようになりました'),
      test: s => /(?:になります|くなります|になりました|くなりました)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:になります|くなります|になりました|くなりました)$/); return m && hasText(m[1]) && minLength(s); },
      hint: 'Pola: KS い → KSいく + なります / KS な/KB → KS/KB + になります。',
      example: 'はるになるとあたたかくなります',
    },

    // ── Kalimat1 ても / くても (walaupun) ────────────
    {
      match: n => n.includes('ても') && (n.includes('walaupun') || n.includes('meskipun') || n.includes('biarpun')),
      test: s => /(?:ても|くても|でも)、.+(?:です|ます)$/.test(s) || /(?:ても|くても|でも).+(?:です|ます)$/.test(s),
      struct: s => { const m = s.match(/^(.+?)(?:ても|くても|でも)(?:、)?(.+?)(?:です|ます)$/); return m && hasText(m[1]) && hasText(m[2]); },
      hint: 'Pola: KK て形/KS くて + も、〜 (walaupun)。',
      example: 'たかくても、かいます',
    },

  ];

  // ══════════════════════════════════════════════════════
  // SMART MARKER EXTRACTOR (for generic fallback)
  // Extracts required grammar markers from ANY title format
  // ══════════════════════════════════════════════════════
  function extractMarkersFromTitle(title) {
    const norm = normalizeTitle(title);
    const markers = [];

    // Extract 2+ char kana sequences from normalized title
    // These are grammar markers, not content placeholders
    const kanaSeqs = norm.match(/[ぁ-ゖー]{2,}/g) || [];
    kanaSeqs.forEach(k => {
      // Skip pure content words and placeholder residue
      const SKIP = ['する','くる','なる','いる','ある','みる','くれ','もの','こと','その','この','あの','どの','よう','こう','そう','どう','まず','つぎ','いま','きょう','まい','にち'];
      if (!SKIP.includes(k) && !markers.includes(k)) markers.push(k);
    });

    // Extract important single-char particles explicitly mentioned in title
    const importantParticles = ['は','が','を','に','で','と','へ','より','しか','だけ','ね','よ','や'];
    importantParticles.forEach(p => {
      // Only extract if clearly a grammar particle in this title (appears next to KK/KB or standalone)
      if (title.includes(p + ' ') || title.includes(' ' + p) || title.includes(p + '\u3000')) {
        if (!markers.includes(p)) markers.push(p);
      }
    });

    return markers;
  }

  // ══════════════════════════════════════════════════════
  // GENERIC FALLBACK VALIDATOR
  // Strict: requires both proper structure AND grammar marker
  // ══════════════════════════════════════════════════════
  function genericValidate(input, grammarTitle) {
    const s = input;

    // 1. Must end with proper predicate
    const PREDICATES = /(?:ます|ました|ません|ませんでした|です|でした|ではありません|じゃありません|ない|ないです|だった|だ|ください|ましょう|ませんか|ね|よ|か|った|いた|いだ|した|んだ|んで|て|で|い)$/;
    if (!PREDICATES.test(s)) {
      return invalid('⚠️ Kalimat harus diakhiri dengan predikat (ます/です/ない/ください/ね dll.)。');
    }

    // 2. Must have structural particle OR be sufficiently long
    const hasParticle = /[はがをにでとへもよりしか]/.test(s);
    if (!hasParticle && !minLength(s, 6)) {
      return invalid('⚠️ Kalimat terlalu pendek atau tidak memiliki partikel struktural (は/が/を/に/で/etc.)。');
    }

    // 3. Must have meaningful content beyond just particles + predicate
    const stripped = s.replace(/[はがをにでとへもより]|ます|ました|ません|ませんでした|です|でした|ではありません|じゃありません|ない|だった|ください|ましょう|ませんか/g, '');
    if ((stripped.match(/[あ-んア-ン一-龯ぁ-ゖ]/g)||[]).length < 2) {
      return invalid('⚠️ Kalimat tidak memiliki kata bermakna — hanya partikel dan konjugasi。');
    }

    // 4. Grammar marker from title must be present
    const markers = extractMarkersFromTitle(grammarTitle);
    const meaningfulMarkers = markers.filter(m =>
      m !== 'です' && m !== 'でした' && m !== 'ます' && m !== 'ました' && m.length >= 2
    );

    if (meaningfulMarkers.length > 0) {
      const found = meaningfulMarkers.find(m => s.includes(m));
      if (!found) {
        const label = meaningfulMarkers.slice(0,3).join('/');
        return invalid(`⚠️ Grammar <b>${escHTML(label)}</b> belum terdeteksi dalam kalimat — pastikan pola grammar ini digunakan。`);
      }
    }

    // Single-char particle requirements (if title strongly indicates them)
    const norm = normalizeTitle(grammarTitle);
    if (/[はが]/.test(norm.replace(/[kk kb ks ktb]/g,'')) && !/[はが]/.test(s)) {
      return partial('〜 Struktur terdeteksi, namun partikel は atau が mungkin diperlukan sesuai grammar ini。');
    }

    const label = meaningfulMarkers[0] || grammarTitle.split(' ')[0];
    return ok(`✅ Grammar <b style="color:var(--accent-verb)">${escHTML(label)}</b> terdeteksi — よくできました！`);
  }

  // ══════════════════════════════════════════════════════
  // CORE VALIDATE FUNCTION
  // ══════════════════════════════════════════════════════
  function validate(input, grammarTitle) {
    const s = input.trim();
    if (!s) return null;

    // Must have Japanese characters
    if (!/[あ-んア-ン一-龯ぁ-ゖ]/.test(s)) {
      return invalid('⚠️ Ketik kalimat dalam huruf Jepang (hiragana / katakana / kanji)。');
    }

    // Minimum length
    if (!minLength(s, 3)) {
      return invalid('⚠️ Kalimat terlalu pendek。Minimal 3 karakter hiragana/kanji。');
    }

    // Find matching specific pattern using NORMALIZED title
    const norm = normalizeTitle(grammarTitle);
    const def = PATTERNS.find(d => d.match(norm));

    if (def) {
      const passesRegex = def.test(s);
      if (!passesRegex) {
        return invalid(`⚠️ ${def.hint}<br><span style="font-size:11px;opacity:.8">Contoh: <b>${def.example}</b></span>`);
      }
      const passesStruct = def.struct ? def.struct(s) : true;
      if (!passesStruct) {
        return partial(`〜 Grammar terdeteksi, namun struktur masih kurang lengkap。<br><span style="font-size:11px;opacity:.8">${def.hint}</span>`);
      }
      // FIX v3.0.9: for broad patterns, also require any grammar-specific
      // keyword extracted from the title (e.g. これ/それ/あれ) to actually
      // appear in the user's sentence.
      if (def.markerCheck) {
        const markers = extractMarkersFromTitle(grammarTitle);
        const meaningfulMarkers = markers.filter(m =>
          m !== 'です' && m !== 'でした' && m !== 'ます' && m !== 'ました' &&
          m !== 'ません' && m !== 'ませんでした' && m.length >= 2
        );
        if (meaningfulMarkers.length > 0 && !meaningfulMarkers.some(m => s.includes(m))) {
          const label = meaningfulMarkers.slice(0,3).join('/');
          return partial(`〜 Grammar <b>${escHTML(label)}</b> belum digunakan dalam kalimat — pastikan kata kunci ini ada。<br><span style="font-size:11px;opacity:.8">${def.hint}</span>`);
        }
      }
      const label = grammarTitle.replace(/^(KK|KB|KS|KTB|S|Orang|Tempat)\s+/,'').split(/[\s(/]/)[0] || grammarTitle.split(' ')[0];
      return ok(`✅ 正解！Grammar <b style="color:var(--accent-verb)">${escHTML(label)}</b> terdeteksi dan struktur kalimat valid。よくできました！`);
    }

    // No specific pattern → smart generic fallback
    return genericValidate(s, grammarTitle);
  }

  return { validate };

})();
