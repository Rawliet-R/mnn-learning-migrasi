// ═══════════════════════════════════════════════════════════════════
//  MNN Learning — AI JFT Simulation  (REBUILT v4.0)
//  Rawliet.ID / FrameProject
//
//  Arsitektur bersih — tidak ada akumulasi bug dari versi sebelumnya.
//  Model: anthropic/claude-3-5-haiku (lebih patuh instruksi JSON)
//  Generation: DUA API call terpisah (text + choukai) → tidak ada truncation
// ═══════════════════════════════════════════════════════════════════

var AI_JFT_SIM = (() => {
'use strict';

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────
const MODEL = 'openai/gpt-4o-mini';

const SECTION_ORDER  = ['kanji_kotoba','expression','choukai','dokkai'];

const LEVELS = { n5: 'N5', n4: 'N4' };

const MODES = {
    easy:   { label:'Easy',   soal:10, credit:5,  timer:900,
               sections:{ kanji_kotoba:3, expression:2, choukai:2, dokkai:3 } },
    normal: { label:'Normal', soal:20, credit:10, timer:1800,
               sections:{ kanji_kotoba:5, expression:4, choukai:5, dokkai:6 } },
    full:   { label:'Full',   soal:40, credit:20, timer:3600,
               sections:{ kanji_kotoba:10, expression:8, choukai:10, dokkai:12 } },
};

const SEC_LABEL = {
    kanji_kotoba:'📖 Kanji & Kotoba',
    expression:  '💬 Expression',
    choukai:     '🎧 Choukai',
    dokkai:      '📄 Dokkai',
};

// ─────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────
let _S   = null;   // active session
let _tid = null;   // timer interval id

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderText(s) {
    if (!s) return '';
    var e = esc(s);
    // literal \n (two chars) or actual newline → <br>
    return e.replace(/\\n/g,'<br>').replace(/\n/g,'<br>');
}

function renderKanjiQuestion(q) {
    // Kanji Reading: underline the highlighted kanji word in question
    var hl = q.highlight ? esc(q.highlight) : null;
    var txt = renderText(q.question);
    if (hl) txt = txt.replace(hl, '<u style="text-decoration-color:#4f8ef7"><b>'+hl+'</b></u>');
    return txt;
}

function fixJsonNewlines(str) {
    var inStr=false, esc2=false, out='';
    for (var i=0;i<str.length;i++) {
        var c=str[i];
        if (esc2){out+=c;esc2=false;continue;}
        if (c==='\\'&&inStr){out+=c;esc2=true;continue;}
        if (c==='"'){out+=c;inStr=!inStr;continue;}
        if (inStr&&c==='\n'){out+='\\n';continue;}
        if (inStr&&c==='\r'){continue;}
        out+=c;
    }
    return out;
}

function extractJSON(text) {
    var t = String(text||'').trim()
        .replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    var s=t.indexOf('{'), e=t.lastIndexOf('}');
    if (s===-1||e===-1||e<=s) return null;
    var c=t.slice(s,e+1);
    try{return JSON.parse(c);}catch(_){}
    try{return JSON.parse(fixJsonNewlines(c));}catch(_){}
    return null;
}

function norm(s){ return String(s||'').trim().replace(/\s+/g,' '); }

// ─────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────
function validateQ(q, sec) {
    if (!q || typeof q.question !== 'string') return false;
    var qt = q.question.trim();
    // Strip accidental Q="..." prefix from AI copying examples
    qt = qt.replace(/^[Qq]\s*[:=]\s*["']/, '').replace(/["']\s*$/, '').trim();
    if (qt) q.question = qt;
    if (!qt || qt.length < 3) return false;

    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (!q.options.every(function(o){ return typeof o==='string'&&o.trim(); })) return false;
    if (typeof q.answer !== 'string') return false;

    // Explanation fallback
    if (q.explanation == null) q.explanation = '';

    // For choukai: lenient — sanitize listeningScript
    if (sec === 'choukai') {
        if (q.listeningScript !== undefined) {
            if (!Array.isArray(q.listeningScript)||!q.listeningScript.length) {
                delete q.listeningScript;
            } else {
                q.listeningScript = q.listeningScript.filter(function(l){
                    return l && typeof l.text==='string'&&l.text.trim();
                });
                if (!q.listeningScript.length) delete q.listeningScript;
            }
        }
        // Loose answer match for choukai
        var cAns = norm(q.answer).toLowerCase();
        var cMatch = q.options.find(function(o){ return norm(o).toLowerCase()===cAns; });
        if (!cMatch) {
            cMatch = q.options.find(function(o){
                var co=norm(o).toLowerCase();
                return co.indexOf(cAns)!==-1||cAns.indexOf(co)!==-1;
            });
        }
        if (!cMatch) return false;
        q.answer = cMatch;
        return true;
    }

    // For dokkai: loose match (encoding/space differences)
    if (sec === 'dokkai') {
        var clean = function(s){ return String(s).replace(/[\s\u3000\u00a0]/g,'').replace(/[。、？！]/g,'').toLowerCase(); };
        var dAns = clean(q.answer);
        var dMatch = q.options.find(function(o){ return clean(o)===dAns; });
        if (!dMatch) dMatch = q.options.find(function(o){var co=clean(o);return co.indexOf(dAns)!==-1||dAns.indexOf(co)!==-1;});
        if (!dMatch) { console.warn('[DOKKAI rejected]', q.answer, q.options); return false; }
        q.answer = dMatch;
        return true;
    }

    // Normal: exact normalized match
    var nAns = norm(q.answer);
    var nMatch = q.options.find(function(o){ return norm(o)===nAns; });
    if (!nMatch) return false;
    q.answer = nMatch;

    // Duplicate options check
    var uniq = new Set(q.options.map(function(o){ return o.trim().toLowerCase(); }));
    if (uniq.size < 4) return false;

    // Anti-leak: kanji target not in options verbatim
    var km = q.question.match(/【([^】]+)】/);
    var tgt = km ? km[1] : null;
    if (tgt && q.options.some(function(o){ return o.trim()===tgt; })) return false;

    return true;
}

function parseResponse(raw, expectedSections) {
    if (!raw) return null;
    console.debug('[AI_JFT] raw length:', raw.length, '| first 200:', raw.slice(0,200));
    var parsed = extractJSON(raw);
    if (!parsed || typeof parsed !== 'object') {
        console.error('[AI_JFT] JSON parse failed');
        return null;
    }
    var src = (parsed.sections && typeof parsed.sections==='object') ? parsed.sections : parsed;
    var out = {}, total = 0;
    expectedSections.forEach(function(sec) {
        var arr = Array.isArray(src[sec]) ? src[sec] : [];
        var valid = arr.filter(function(q){ return validateQ(q, sec); });
        // Shuffle options
        valid.forEach(function(q) {
            var opts=q.options.slice();
            for(var i=opts.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=opts[i];opts[i]=opts[j];opts[j]=t;}
            q.options=opts;
        });
        out[sec] = valid;
        total += valid.length;
        console.debug('[AI_JFT]', sec, ':', valid.length + '/' + arr.length, 'valid');
    });
    return (total > 0) ? out : null;
}

// ─────────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────────
function levelDesc(lvl) {
    if (lvl==='n5') return 'N5 (JLPT N5 / CEFR A1): kosakata & kalimat sangat dasar. Dominan hiragana+katakana. Kanji hanya: 人日本水火木金土月山川大小中上下食飲見行来帰時間円店駅学校先生友達話聞書買休病院薬。Topik: salam, keluarga, makanan, angka, waktu, transportasi dasar.';
    return 'N4 (JLPT N4 / CEFR A2 = JFT-Basic standard): kosakata kerja & kehidupan sehari-hari di Jepang. Boleh pakai ~300 kanji umum. Topik: kantor, pabrik, konbini, stasiun, instruksi kerja, jadwal, pengumuman.';
}

function buildTextPrompt(lvl, n_kk, n_expr, n_dok) {
    var ld = levelDesc(lvl);
    var sys = 'You are a JFT-Basic exam question generator for MNN Learning.\n' +
        'Output ONLY valid JSON. No markdown fences, no explanation text.\n' +
        'LEVEL: ' + ld + '\n\n' +

        '=== SECTION 1: SCRIPT AND VOCABULARY (kanji_kotoba) — generate ' + n_kk + ' questions ===\n' +
        'Rotate through these 4 types evenly:\n\n' +

        'TYPE word_meaning — situation description → choose correct word/action.\n' +
        'question: describe a situation (no blank). options: 4 vocabulary words.\n' +
        'Ex N5: {"type":"word_meaning","question":"あさ おきて、かおを あらいます。どこで しますか。","options":["おふろ","トイレ","だいどころ","しんしつ"],"answer":"おふろ","explanation":"顔を洗うのはお風呂でします。"}\n\n' +

        'TYPE word_usage — sentence with （　）→ choose word that fits grammatically.\n' +
        'GRAMMAR RULE: if blank + ます → options must be verb STEMS (おき/ね/あらい), NOT dictionary form.\n' +
        'Ex N5: {"type":"word_usage","question":"まいあさ 6じに （　） ます。","options":["おき","ね","あらい","いき"],"answer":"おき","explanation":"毎朝6時に起きます。おき is the stem form of 起きる before ます."}\n' +
        'Ex N4: {"type":"word_usage","question":"だんだん 日本の しゅうかんに （　） きました。","options":["なれて","ふえて","すすんで","もどって"],"answer":"なれて","explanation":"慣れてきました means got accustomed to."}\n\n' +

        'TYPE kanji_reading — sentence with 【kanji word】→ choose correct HIRAGANA READING.\n' +
        'CRITICAL: All 4 options MUST be different hiragana pronunciations of 【THAT SAME WORD】.\n' +
        'Options must look similar (same first mora, different ending) to be challenging.\n' +
        'Ex N4: {"type":"kanji_reading","question":"水道が こわれた ときは でんわして ください。","highlight":"水道","options":["すいとう","すいどう","ずいどう","すいろ"],"answer":"すいどう","explanation":"水道(すいどう) = water supply/tap."}\n' +
        'Ex N5: {"type":"kanji_reading","question":"えきの まえで 【友達】 を まちました。","highlight":"友達","options":["ともだち","とおだち","ともたち","とうだち"],"answer":"ともだち","explanation":"友達(ともだち) = friend."}\n\n' +

        'TYPE kanji_meaning — sentence with （　）→ choose kanji word that fits.\n' +
        'Ex N4: {"type":"kanji_meaning","question":"とうきょうタワーが よる あかるく （　） いて、とても きれいでした。","options":["乗って","光って","通って","走って"],"answer":"光って","explanation":"光って(ひかって) = shining/lit up."}\n\n' +

        '=== SECTION 2: CONVERSATION AND EXPRESSION (expression) — generate ' + n_expr + ' questions ===\n' +
        'Alternate between 2 types:\n\n' +

        'TYPE grammar — dialog with [___] blank → choose correct grammar form.\n' +
        'Show 2+ lines of dialog. Blank is [___] inside dialog.\n' +
        'Ex N4: {"type":"grammar","question":"メイさんは エミさんに あかちゃんの おくりものを きいています。\\nメイ：あかちゃんに なにか [___] と おもいますか。\\nエミ：そうですね、えほんは どうでしょうか。","options":["あげない","あげよう","あげるため","あげるつもり"],"answer":"あげるつもり","explanation":"あげるつもり = intend to give."}\n\n' +

        'TYPE expression — situation + dialog with （　）→ choose natural expression.\n' +
        'Show complete dialog context. Blank is （　）.\n' +
        'Ex N4: {"type":"expression","question":"ひるやすみに スタッフルームで はなしています。\\nA：おべんとう おいしそうですね。\\nB：ありがとうございます。（　）。\\nA：えっ、ほんとうですか。いいですね。","options":["こちらこそ","もう いちど","また こんど","じぶんで つくりました"],"answer":"じぶんで つくりました","explanation":"自分で作りました = I made it myself."}\n\n' +

        '=== SECTION 3: READING COMPREHENSION (dokkai) — generate ' + n_dok + ' questions ===\n' +
        'Alternate between 2 types:\n\n' +

        'TYPE comprehend — short text (letter/email/chat/notice) + ONE question.\n' +
        'Text must contain ALL facts needed to answer. Question on separate line after blank line.\n' +
        'Ex: {"type":"comprehend","question":"ホアさんに メールが きました。\\n\\nホアさん、こんにちは。\\nらいしゅうの 土曜日 3時から 田中さんの うちで パーティーを します。\\nぜひ きてください。おかしを もってきてください。\\n\\nパーティーは どこで しますか。","doctype":"email","options":["ホアさんの うち","田中さんの うち","かいしゃ","えき"],"answer":"田中さんの うち","explanation":"メールに「田中さんのうちでパーティーをします」とあります。"}\n\n' +

        'TYPE infosearch — price list/schedule/notice → find specific information.\n' +
        'Include the actual table/list as text in the question. Answer MUST appear in text.\n' +
        'Ex: {"type":"infosearch","question":"スーパーのチラシです。\\n\\nりんご　100円\\nバナナ　150円\\nみかん　200円\\nぶどう　320円\\n\\nバナナは いくら ですか。","doctype":"flyer","options":["100円","150円","200円","320円"],"answer":"150円","explanation":"チラシにバナナ150円と書いてあります。"}\n\n' +

        'QUALITY RULES:\n' +
        '1. kanji_reading: ALL 4 options = hiragana readings of the HIGHLIGHTED word only.\n' +
        '2. word_usage with ます ending: options must be verb STEMS, not dictionary form.\n' +
        '3. expression/grammar: question MUST contain dialog lines AND a blank.\n' +
        '4. dokkai: text must explicitly contain information to answer the question.\n' +
        '5. Answer must match one option EXACTLY (character-for-character).\n' +
        '6. explanation field is required (in Indonesian or Japanese).\n\n' +

        'Return JSON: {"sections":{"kanji_kotoba":[...],"expression":[...],"dokkai":[...]}}';

    var usr = 'Generate for level ' + LEVELS[lvl] + ':\n' +
        '- kanji_kotoba: ' + n_kk + ' questions (rotate word_meaning/word_usage/kanji_reading/kanji_meaning)\n' +
        '- expression: ' + n_expr + ' questions (alternate grammar/expression)\n' +
        '- dokkai: ' + n_dok + ' questions (alternate comprehend/infosearch)\n\n' +
        'Return JSON only: {"sections":{"kanji_kotoba":[...],"expression":[...],"dokkai":[...]}}';

    return { system: sys, user: usr };
}

function buildChoukaiPrompt(lvl, n_cho) {
    var ld = levelDesc(lvl);
    var sys = 'You are a JFT-Basic listening comprehension question generator.\n' +
        'Output ONLY valid JSON. No markdown, no explanation.\n' +
        'LEVEL: ' + ld + '\n\n' +

        'Generate ' + n_cho + ' choukai (listening) questions. Each question:\n' +
        '{"listeningScript":[{"speaker":"male"|"female","text":"..."},...], "maxPlay":1|2, "question":"...", "options":["A","B","C","D"], "answer":"A", "explanation":"..."}\n\n' +

        'RULES:\n' +
        '- listeningScript: 2-6 speaker turns. Natural conversation, not robotic.\n' +
        '- maxPlay: 2 for conversations, 1 for announcements.\n' +
        '- question: ONE comprehension question ONLY. NOT a copy of the script.\n' +
        '- The ANSWER must be explicitly stated or clearly implied in the script.\n' +
        '- All 4 options must be plausible but only 1 is correct per script.\n\n' +

        '3 types, rotate evenly:\n\n' +

        'TYPE conversation — 2 people, information exchange or social talk.\n' +
        'Ex N4: script=[{m:"田中さん、お正月は どこに 行きましたか。"},{f:"家族と 京都に 行きました。古いお寺が たくさんあって、よかったです。"},{m:"いいですね。私は ずっと 家に いました。"}]\n' +
        'question: "女の人は お正月に どこに 行きましたか。"\n' +
        'options: ["きょうと","とうきょう","おおさか","うち"] answer: "きょうと"\n\n' +

        'TYPE shop — customer + staff at store/station/public place.\n' +
        'Ex N5: script=[{f:"いらっしゃいませ。"},{m:"すみません、コーヒーを ふたつ ください。"},{f:"かしこまりました。230円に なります。"},{m:"はい、どうぞ。"}]\n' +
        'question: "男の人は コーヒーを いくつ かいましたか。"\n' +
        'options: ["ひとつ","ふたつ","みっつ","よっつ"] answer: "ふたつ"\n\n' +

        'TYPE announcement — 1 speaker, work/public announcement. maxPlay:1.\n' +
        'Ex N4: script=[{f:"みなさんに おしらせします。あすの あさは 8時に こうじょうに あつまってください。くわしいことは けいじばんを みてください。"}]\n' +
        'question: "あしたは 何時に あつまりますか。"\n' +
        'options: ["7時","8時","9時","10時"] answer: "8時"\n\n' +

        'Return JSON: {"sections":{"choukai":[...]}}';

    var usr = 'Generate ' + n_cho + ' choukai questions for level ' + LEVELS[lvl] + '.\n' +
        'Rotate: conversation / shop / announcement.\n' +
        'Return JSON only: {"sections":{"choukai":[...]}}';

    return { system: sys, user: usr };
}

// ─────────────────────────────────────────────────────────────────
// API CALL
// ─────────────────────────────────────────────────────────────────
async function callAPI(system, user, maxTokens) {
    // Get Firebase ID token (same pattern as ai-sensei.js)
    var idToken = '';
    try {
        if (window.firebase && firebase.auth) {
            var cu = firebase.auth().currentUser;
            if (cu) idToken = await cu.getIdToken(false);
        }
    } catch(e) { console.warn('[AI_JFT] getIdToken:', e.message); }
    if (!idToken) throw new Error('Sesi login tidak valid. Silakan login ulang.');

    // response_format json_object — paksa gpt-4o-mini output valid JSON selalu
    var extraParams = {};
    if (MODEL.indexOf('gpt') !== -1 || MODEL.indexOf('openai') !== -1) {
        extraParams.response_format = { type: 'json_object' };
    }
    var body = JSON.stringify(Object.assign({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.8,
        messages: [
            { role: 'system', content: system },
            { role: 'user',   content: user   },
        ],
    }, extraParams));

    // Escape non-ASCII to avoid proxy ByteString issues
    var safeBody = body.replace(/[\u0080-\uFFFF]/g, function(c){
        return '\\u' + ('0000'+c.charCodeAt(0).toString(16)).slice(-4);
    });

    var res = await fetch('/api/ai-proxy', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + idToken,
        },
        body: safeBody,
    });

    if (!res.ok) {
        var errData = await res.json().catch(function(){ return {}; });
        throw new Error(errData.error || 'API error ' + res.status);
    }

    var data = await res.json();
    var raw  = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Respon AI kosong.');
    return raw;
}

// ─────────────────────────────────────────────────────────────────
// GENERATION (two separate API calls)
// ─────────────────────────────────────────────────────────────────
async function generateSession(levelId, modeId) {
    var cfg = MODES[modeId];
    var s   = cfg.sections;

    _showLoading('Membuat soal Kanji, Expression, Dokkai...');

    // ── CALL 1: Text sections ────────────────────────────────────
    var p1 = buildTextPrompt(levelId, s.kanji_kotoba, s.expression, s.dokkai);
    var tok1 = Math.max(4000, (s.kanji_kotoba + s.expression + s.dokkai) * 300);
    var raw1 = await callAPI(p1.system, p1.user, tok1);
    var sec1 = parseResponse(raw1, ['kanji_kotoba','expression','dokkai']);
    if (!sec1) throw new Error('Format soal (text) tidak valid. Coba lagi.');

    // ── CALL 2: Choukai ──────────────────────────────────────────
    _showLoading('Membuat soal Choukai (audio)...');
    var p2 = buildChoukaiPrompt(levelId, s.choukai);
    var tok2 = Math.max(2500, s.choukai * 450);
    var raw2 = await callAPI(p2.system, p2.user, tok2);
    var sec2 = parseResponse(raw2, ['choukai']);

    // Merge
    var allSections = {
        kanji_kotoba: sec1.kanji_kotoba || [],
        expression:   sec1.expression   || [],
        choukai:      (sec2 && sec2.choukai) ? sec2.choukai : [],
        dokkai:       sec1.dokkai       || [],
    };

    // Build flat question list in section order
    var flat = [];
    SECTION_ORDER.forEach(function(sec) {
        (allSections[sec] || []).forEach(function(q,i) {
            flat.push({ section: sec, q: q, secIdx: i });
        });
    });

    if (flat.length === 0) throw new Error('Tidak ada soal valid. Coba lagi.');

    return {
        levelId, modeId,
        sections: allSections,
        flat: flat,
        currentIdx: 0,
        answers: [],
        timerRemaining: cfg.timer,
        createdAt: Date.now(),
    };
}

// ─────────────────────────────────────────────────────────────────
// TTS (Speech Synthesis)
// ─────────────────────────────────────────────────────────────────
var _TTS = {
    _voices: null,
    _jpVoice: null,

    _init: function() {
        if (!window.speechSynthesis) return;
        var load = function() {
            _TTS._voices = window.speechSynthesis.getVoices();
            _TTS._jpVoice = _TTS._voices.find(function(v){
                return v.lang==='ja-JP'||v.lang==='ja';
            }) || null;
        };
        load();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = load;
        }
    },

    hasJp: function() { return !!_TTS._jpVoice; },

    speak: function(script, onDone) {
        if (!window.speechSynthesis || !_TTS._jpVoice) {
            if (onDone) onDone();
            return;
        }
        window.speechSynthesis.cancel();
        var lines = script.filter(function(l){ return l&&l.text; });
        var idx = 0;
        function next() {
            if (idx >= lines.length) { if (onDone) onDone(); return; }
            var u = new SpeechSynthesisUtterance(lines[idx].text);
            u.voice = _TTS._jpVoice;
            u.lang  = 'ja-JP';
            u.rate  = 0.9;
            u.pitch = lines[idx].speaker === 'male' ? 0.85 : 1.1;
            u.onend = function(){ idx++; next(); };
            u.onerror = function(){ idx++; next(); };
            window.speechSynthesis.speak(u);
            idx++;
        }
        // Only trigger 'next' once per utterance via onend
        idx = 0;
        var u0 = new SpeechSynthesisUtterance(lines[0].text);
        u0.voice = _TTS._jpVoice; u0.lang='ja-JP'; u0.rate=0.9;
        u0.pitch = lines[0].speaker==='male'?0.85:1.1;
        u0.onend = function(){
            idx=1;
            function playNext() {
                if (idx>=lines.length){if(onDone)onDone();return;}
                var u=new SpeechSynthesisUtterance(lines[idx].text);
                u.voice=_TTS._jpVoice;u.lang='ja-JP';u.rate=0.9;
                u.pitch=lines[idx].speaker==='male'?0.85:1.1;
                u.onend=function(){idx++;playNext();};
                window.speechSynthesis.speak(u);
                idx++;
            }
            playNext();
        };
        window.speechSynthesis.speak(u0);
    },
};

// ─────────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────────
function startTimer() {
    if (_tid) clearInterval(_tid);
    _tid = setInterval(function() {
        if (!_S) { clearInterval(_tid); return; }
        _S.timerRemaining--;
        syncTimer();
        if (_S.timerRemaining <= 0) {
            clearInterval(_tid);
            submitSession();
        }
    }, 1000);
}

function syncTimer() {
    if (!_S) return;
    var m  = Math.floor(_S.timerRemaining/60);
    var sc = _S.timerRemaining%60;
    var txt = m+':'+String(sc).padStart(2,'0');

    // Small timer in topbar
    var td = document.getElementById('aijs-timer-display');
    if (td) td.textContent = txt;

    // Hero timer
    var ht = document.getElementById('aijs-timer-hero-time');
    if (ht) {
        ht.textContent = txt;
        ht.classList.toggle('aijs-timer-hero-warning', _S.timerRemaining<=60);
    }

    // Section label in hero
    var cur = _S.flat[_S.currentIdx] || {};
    var secLabel = SEC_LABEL[cur.section] || '';
    var activeSecs = SECTION_ORDER.filter(function(s){ return (_S.sections[s]||[]).length>0; });
    var secPos = activeSecs.indexOf(cur.section)+1;
    var hs = document.getElementById('aijs-timer-hero-section');
    var hp = document.getElementById('aijs-timer-hero-pos');
    if (hs) hs.textContent = secLabel;
    if (hp) hp.textContent = secPos>0 ? 'Section '+secPos+'/'+activeSecs.length : '';
}

function injectTimerHero() {
    if (document.getElementById('aijs-timer-hero')) { syncTimer(); return; }
    var body = document.getElementById('aijs-session-body');
    if (!body) return;
    var hero = document.createElement('div');
    hero.id = 'aijs-timer-hero';
    hero.className = 'aijs-timer-hero';
    hero.innerHTML =
        '<div class="aijs-timer-hero-time" id="aijs-timer-hero-time">—</div>' +
        '<div class="aijs-timer-hero-label">WAKTU TERSISA</div>' +
        '<div class="aijs-timer-hero-section" id="aijs-timer-hero-section">—</div>' +
        '<div class="aijs-timer-hero-pos" id="aijs-timer-hero-pos"></div>';
    body.parentElement.insertBefore(hero, body);
    syncTimer();
}

// ─────────────────────────────────────────────────────────────────
// SESSION RENDERING
// ─────────────────────────────────────────────────────────────────
function _showLoading(msg) {
    var body = document.getElementById('aijs-session-body');
    if (body) body.innerHTML =
        '<div class="aijs-session-loading">' +
        '<div class="aijs-gen-spinner"></div>' +
        '<div style="margin-top:12px;opacity:.7">' + esc(msg||'Membuat soal...') + '</div>' +
        '</div>';
}

function updateTopbar() {
    if (!_S) return;
    var cur = _S.flat[_S.currentIdx] || {};
    var secLabel = SEC_LABEL[cur.section] || '';
    var el = document.getElementById('aijs-session-section-label');
    if (el) el.textContent = secLabel;

    var total = _S.flat.length;
    var cnt = document.getElementById('aijs-session-counter');
    if (cnt) cnt.textContent = (_S.currentIdx+1) + '/' + total;

    // Progress bar
    var pct = total > 0 ? ((_S.currentIdx+1)/total*100).toFixed(1) : 0;
    var fill = document.getElementById('aijs-session-progress-fill');
    if (fill) fill.style.width = pct + '%';
}

function renderCurrentQuestion() {
    var body = document.getElementById('aijs-session-body');
    if (!body || !_S) return;

    var cur = _S.flat[_S.currentIdx];
    if (!cur) return;

    var { section, q } = cur;

    updateTopbar();
    syncTimer();

    // Choukai: special audio flow
    if (section === 'choukai') {
        body.innerHTML = '';
        renderChoukaiQuestion(body, q);
        return;
    }

    // Build question HTML
    var questionHtml = '';
    if (q.type === 'kanji_reading') {
        questionHtml = renderKanjiQuestion(q);
    } else {
        questionHtml = renderText(q.question);
    }

    var optionsHtml = q.options.map(function(opt, i) {
        return '<button class="aijs-option-btn" data-idx="'+i+'">' + renderText(opt) + '</button>';
    }).join('');

    body.innerHTML =
        '<div class="aijs-q-card"><div class="aijs-q-text">' + questionHtml + '</div></div>' +
        '<div class="aijs-option-list" id="aijs-option-list">' + optionsHtml + '</div>' +
        '<div id="aijs-feedback-slot"></div>';

    document.querySelectorAll('#aijs-option-list .aijs-option-btn').forEach(function(btn) {
        btn.addEventListener('click', function(){ selectOption(parseInt(btn.dataset.idx,10)); });
    });
}

function renderChoukaiQuestion(body, q) {
    var hasAudio = _TTS.hasJp() && Array.isArray(q.listeningScript) && q.listeningScript.length > 0;
    var maxPlay  = (typeof q.maxPlay==='number' && q.maxPlay>=1) ? q.maxPlay : 2;
    var playHint = '(maks ' + maxPlay + '×)';

    body.innerHTML =
        '<div class="aijs-choukai-wrap">' +
        '<div class="aijs-q-card"><div class="aijs-choukai-q-text">' + renderText(q.question) + '</div></div>' +
        '<div class="aijs-choukai-player" id="aijs-choukai-player">' +
        (hasAudio
            ? '<div class="aijs-choukai-play-area">' +
              '<button class="aijs-play-btn" id="aijs-play-btn">▶ Putar Audio <span class="aijs-play-hint">'+playHint+'</span></button>' +
              '<p class="aijs-choukai-hint">Dengarkan audio, lalu pilih jawaban.</p>' +
              '</div>'
            : '<p class="aijs-choukai-noscript">⚠ Suara Jepang tidak tersedia — teks ditampilkan langsung.</p>') +
        '</div>' +
        '<div id="aijs-choukai-opts-slot"></div>' +
        '<div id="aijs-feedback-slot"></div>' +
        '</div>';

    if (hasAudio) {
        var playCount = 0;
        var playBtn = document.getElementById('aijs-play-btn');
        if (!playBtn) return;
        playBtn.addEventListener('click', function() {
            if (playCount >= maxPlay) return;
            playBtn.disabled = true;
            playBtn.innerHTML = '⏸ Memutar...';
            _TTS.speak(q.listeningScript, function() {
                playCount++;
                revealChoukaiOptions(q, playCount, maxPlay);
            });
        });
    } else {
        // Fallback: show script text, reveal options
        showChoukaiScript(q);
        revealChoukaiOptions(q, 1, 1);
    }
}

function showChoukaiScript(q) {
    var player = document.getElementById('aijs-choukai-player');
    if (!player || !Array.isArray(q.listeningScript)) return;
    var lines = q.listeningScript.map(function(l) {
        var icon = l.speaker==='male' ? '👨' : '👩';
        return '<div class="aijs-script-line">' +
               '<span class="aijs-script-icon">'+icon+'</span>' +
               '<span class="aijs-script-text">'+renderText(l.text||'')+'</span>' +
               '</div>';
    }).join('');
    player.innerHTML = '<div class="aijs-script-box">' + lines + '</div>';
}

function revealChoukaiOptions(q, playCount, maxPlay) {
    // Show script after first play
    var player = document.getElementById('aijs-choukai-player');
    if (player && Array.isArray(q.listeningScript) && q.listeningScript.length) {
        var lines = q.listeningScript.map(function(l) {
            var icon = l.speaker==='male' ? '👨' : '👩';
            return '<div class="aijs-script-line">' +
                   '<span class="aijs-script-icon">'+icon+'</span>' +
                   '<span class="aijs-script-text">'+renderText(l.text||'')+'</span>' +
                   '</div>';
        }).join('');
        var replayBtn = '';
        if (playCount < maxPlay && _TTS.hasJp()) {
            replayBtn = '<button class="aijs-replay-btn" id="aijs-replay-btn">▶ Putar Ulang ('+playCount+'/'+maxPlay+')</button>';
        }
        player.innerHTML = '<div class="aijs-script-box">'+lines+'</div>' + replayBtn;
        var rb = document.getElementById('aijs-replay-btn');
        if (rb) rb.addEventListener('click', function() {
            rb.disabled = true;
            rb.textContent = '⏸ Memutar...';
            _TTS.speak(q.listeningScript, function() {
                revealChoukaiOptions(q, playCount+1, maxPlay);
            });
        });
    }

    // Show options
    var slot = document.getElementById('aijs-choukai-opts-slot');
    if (!slot) return;
    var optHtml = q.options.map(function(opt, i) {
        return '<button class="aijs-option-btn" data-idx="'+i+'">'+renderText(opt)+'</button>';
    }).join('');
    slot.innerHTML = '<div class="aijs-option-list" id="aijs-option-list">'+optHtml+'</div>';
    document.querySelectorAll('#aijs-option-list .aijs-option-btn').forEach(function(btn) {
        btn.addEventListener('click', function(){ selectOption(parseInt(btn.dataset.idx,10)); });
    });
}

// ─────────────────────────────────────────────────────────────────
// ANSWER HANDLING
// ─────────────────────────────────────────────────────────────────
function selectOption(idx) {
    if (!_S) return;
    var cur = _S.flat[_S.currentIdx];
    if (!cur) return;
    var q = cur.q;
    var chosen = q.options[idx];
    var correct = (chosen === q.answer);

    // Record answer
    _S.answers.push({
        section: cur.section,
        question: q.question,
        chosen: chosen,
        correct: correct,
        answer: q.answer,
    });

    // Disable all buttons
    document.querySelectorAll('.aijs-option-btn').forEach(function(btn, i) {
        btn.disabled = true;
        if (q.options[i] === q.answer)  btn.classList.add('aijs-opt-correct');
        if (i === idx && !correct)       btn.classList.add('aijs-opt-wrong');
    });

    // Show feedback
    var fb = document.getElementById('aijs-feedback-slot');
    if (fb) {
        fb.innerHTML = correct
            ? '<div class="aijs-feedback aijs-fb-correct"><b>✅ Benar!</b><br>' + renderText(q.explanation||'') + '</div>' +
              '<button class="aijs-next-btn" id="aijs-next-btn">Lanjut →</button>'
            : '<div class="aijs-feedback aijs-fb-wrong"><b>❌ Kurang tepat.</b><br>' + renderText(q.explanation||'') + '</div>' +
              '<button class="aijs-next-btn" id="aijs-next-btn">Lanjut →</button>';
        var nb = document.getElementById('aijs-next-btn');
        if (nb) nb.addEventListener('click', nextQuestion);
    }
}

function nextQuestion() {
    if (!_S) return;
    _S.currentIdx++;
    if (_S.currentIdx >= _S.flat.length) {
        submitSession();
    } else {
        renderCurrentQuestion();
    }
}

function submitSession() {
    if (_tid) { clearInterval(_tid); _tid = null; }
    if (!_S) return;

    var total   = _S.answers.length;
    var correct = _S.answers.filter(function(a){ return a.correct; }).length;
    var pct     = total > 0 ? Math.round(correct/total*100) : 0;

    // Per-section scores
    var secScores = {};
    SECTION_ORDER.forEach(function(sec){ secScores[sec]={c:0,t:0}; });
    _S.answers.forEach(function(a){
        if (secScores[a.section]) {
            secScores[a.section].t++;
            if (a.correct) secScores[a.section].c++;
        }
    });

    // Save to Firestore
    _saveHistory(_S.levelId, _S.modeId, correct, total, _S.answers).catch(function(){});

    // Render score screen
    var body = document.getElementById('aijs-session-body');
    if (!body) return;

    var secRows = SECTION_ORDER.map(function(sec) {
        var sc = secScores[sec];
        return '<div class="aijs-score-row">' +
               '<span>' + esc(SEC_LABEL[sec]||sec) + '</span>' +
               '<span>' + sc.c + '/' + sc.t + '</span>' +
               '</div>';
    }).join('');

    body.innerHTML =
        '<div class="aijs-score-wrap">' +
        '<div class="aijs-score-pct">' + pct + '%</div>' +
        '<div class="aijs-score-sub">Skor keseluruhan · ' + total + ' soal</div>' +
        '<div class="aijs-score-table">' + secRows + '</div>' +
        '<button class="aijs-btn" id="aijs-retry-btn">↻ Ulangi Soal Ini</button>' +
        '<button class="aijs-btn-ghost" id="aijs-back-score-btn">← Kembali ke Setup</button>' +
        '</div>';

    document.getElementById('aijs-retry-btn')?.addEventListener('click', function() {
        _startSession(_S.levelId, _S.modeId, _S.sections, _S.flat);
    });
    document.getElementById('aijs-back-score-btn')?.addEventListener('click', function() {
        _S = null;
        window.navigateTo && navigateTo('ai-jft-setup');
    });
}

function _startSession(levelId, modeId, sections, flat) {
    _S = {
        levelId, modeId, sections, flat,
        currentIdx: 0,
        answers: [],
        timerRemaining: MODES[modeId].timer,
    };
    injectTimerHero();
    renderCurrentQuestion();
    startTimer();
}

// ─────────────────────────────────────────────────────────────────
// HISTORY (Firestore)
// ─────────────────────────────────────────────────────────────────
async function _saveHistory(levelId, modeId, correct, total, answers) {
    var uid = window.AUTH?.user?.uid;
    if (!uid || typeof _fbDb === 'undefined') return;
    try {
        var ref = _fbDb.collection('users').doc(uid).collection('aiJftHistory').doc();
        var ts = typeof firebase !== 'undefined' && firebase.firestore
            ? firebase.firestore.FieldValue.serverTimestamp()
            : new Date();
        await ref.set({
            levelId: levelId, modeId: modeId, correct: correct, total: total,
            score: total>0 ? Math.round(correct/total*100) : 0,
            createdAt: ts,
        });
    } catch(e) { console.warn('[AI_JFT] history save failed:', e.message); }
}

async function _loadHistory() {
    var uid = window.AUTH?.user?.uid;
    var el  = document.getElementById('aijs-history-list');
    if (!el) return;
    if (!uid || typeof _fbDb === 'undefined') {
        el.innerHTML = '<div class="aijs-history-empty">Login untuk melihat riwayat.</div>';
        return;
    }
    try {
        el.innerHTML = '<div class="aijs-history-empty">Memuat...</div>';
        var snap = await _fbDb.collection('users').doc(uid)
            .collection('aiJftHistory')
            .orderBy('createdAt','desc').limit(10).get();
        if (snap.empty) {
            el.innerHTML = '<div class="aijs-history-empty">Belum ada riwayat simulasi.</div>';
            return;
        }
        var html = '';
        snap.forEach(function(doc) {
            var d = doc.data();
            var mLabel = MODES[d.modeId]?.label || d.modeId || '?';
            var lLabel = LEVELS[d.levelId] || d.levelId || '?';
            var ts = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString('id') : '';
            html += '<div class="aijs-history-item">' +
                    '<div class="aijs-history-meta">' + esc(lLabel) + ' · ' + esc(mLabel) + ' · ' + esc(ts) + '</div>' +
                    '<div class="aijs-history-score">' + (d.score||0) + '%</div>' +
                    '</div>';
        });
        el.innerHTML = html;
    } catch(e) {
        el.innerHTML = '<div class="aijs-history-empty">Gagal memuat riwayat.</div>';
    }
}

// ─────────────────────────────────────────────────────────────────
// SETUP PAGE
// ─────────────────────────────────────────────────────────────────
function renderSetupPage() {
    _TTS._init();
    _loadHistory();

    var levelGrid = document.getElementById('aijs-level-grid');
    var modeList  = document.getElementById('aijs-mode-list');
    var startBtn  = document.getElementById('aijs-start-btn');
    var creditInfo= document.getElementById('aijs-start-credit-info');

    if (!levelGrid || !modeList || !startBtn) return;

    // Update level buttons to show N5/N4 only
    levelGrid.innerHTML =
        '<button class="aijs-level-btn" data-level="n5">N5 – Pemula</button>' +
        '<button class="aijs-level-btn" data-level="n4">N4 – Dasar</button>';

    var selLevel = null, selMode = null;

    function updateStart() {
        var credits = window.AI_CREDIT_STATE?.remaining ?? '?';
        if (selLevel && selMode) {
            var cost = MODES[selMode]?.credit || '?';
            startBtn.disabled = false;
            // Get live credit balance
            if (creditInfo) {
                creditInfo.textContent = 'Sesi ini membutuhkan ' + cost + ' credit · Memuat saldo...';
                if (window.AI_SENSEI?.getCredits) {
                    AI_SENSEI.getCredits().then(function(c){
                        if (creditInfo) creditInfo.textContent =
                            'Sesi ini membutuhkan ' + cost + ' credit · Sisa credit kamu: ' + (c.remaining??'?');
                    }).catch(function(){});
                }
            }
        } else {
            startBtn.disabled = true;
            if (creditInfo) creditInfo.textContent = 'Pilih level dan mode untuk memulai.';
        }
    }

    levelGrid.querySelectorAll('.aijs-level-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            levelGrid.querySelectorAll('.aijs-level-btn').forEach(function(b){ b.classList.remove('active'); });
            btn.classList.add('active');
            selLevel = btn.dataset.level;
            updateStart();
        });
    });

    modeList.querySelectorAll('.aijs-mode-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            modeList.querySelectorAll('.aijs-mode-btn').forEach(function(b){ b.classList.remove('active'); });
            btn.classList.add('active');
            selMode = btn.dataset.mode;
            updateStart();
        });
    });

    startBtn.addEventListener('click', async function() {
        if (!selLevel || !selMode) return;

        var cfg    = MODES[selMode];
        startBtn.disabled = true;
        startBtn.textContent = 'Memeriksa credit...';

        try {
            // Check credits
            var credits = { remaining: 0 };
            if (window.AI_SENSEI?.getCredits) {
                credits = await AI_SENSEI.getCredits().catch(function(){ return {remaining:0}; });
            }
            if ((credits.remaining ?? 0) < cfg.credit) {
                alert('Credit tidak cukup. Saldo: ' + (credits.remaining||0) + ', dibutuhkan: ' + cfg.credit);
                return;
            }

            // Navigate to session page (shows loading)
            window.navigateTo && navigateTo('ai-jft-session');
            startBtn.textContent = 'Membuat soal...';

            // Generate (two API calls)
            var session = await generateSession(selLevel, selMode);

            // Deduct credit AFTER successful generation
            if (window.AI_SENSEI?.deductCredit) {
                await AI_SENSEI.deductCredit(cfg.credit);
            }

            // Start session
            _startSession(session.levelId, session.modeId, session.sections, session.flat);

        } catch(e) {
            console.error('[AI_JFT] generate error:', e);
            var msg = e.message || 'Gagal membuat soal.';
            alert('❌ ' + msg + '\n\nCredit TIDAK terpotong. Silakan coba lagi.');
            window.navigateTo && navigateTo('ai-jft-setup');
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = 'Mulai Simulasi →';
        }
    });

    updateStart();
}

// ─────────────────────────────────────────────────────────────────
// SESSION PAGE (called by app.js when navigating to session)
// ─────────────────────────────────────────────────────────────────
function renderSessionPage() {
    // Exit button
    var exitBtn = document.getElementById('aijs-session-exit-btn');
    if (exitBtn) {
        exitBtn.onclick = function() {
            if (_tid) clearInterval(_tid);
            _S = null;
            window.navigateTo && navigateTo('ai-jft-setup');
        };
    }
    // If session already active (e.g. re-render after navigate back), resume
    if (_S && _S.flat && _S.currentIdx < _S.flat.length) {
        injectTimerHero();
        renderCurrentQuestion();
    }
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────
return {
    renderSetupPage:   renderSetupPage,
    renderSessionPage: renderSessionPage,
};

})(); // end AI_JFT_SIM IIFE
// Landscape mode kini ditangani via native CSS @media query (lihat styles.css
// untuk app shell, ai-jft-sim.css untuk polish khusus simulasi) — tidak butuh
// JS orientation listener lagi.

window.AI_JFT_SIM = AI_JFT_SIM;
