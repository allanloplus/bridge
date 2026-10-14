/* =========================================================
 * 角色對話與語音（Web Speech API，台灣華語 zh-TW）
 * Allan 顧問：台灣男聲；阿拉蕾：年輕女聲
 * ========================================================= */
(function (global) {
  'use strict';

  const CHARS = {
    allan: { name: 'Allan 顧問', img: (e) => `assets/img/allan-${e}.jpg`, def: 'smile' },
    arale: { name: '阿拉蕾', img: (e) => `assets/img/arale-${e}.jpg`, def: 'wink' },
  };
  const EXPR = {
    allan: ['smile', 'laugh', 'think', 'confused', 'surprised', 'point', 'wink', 'worried'],
    arale: ['laugh', 'think', 'surprised', 'confused', 'talk', 'sad', 'wink', 'cheer'],
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('bridge.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bridge.' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式等 */ } },
  };

  /* ---------- 語音 ---------- */
  const Voice = {
    supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
    enabled: store.get('voiceOn', true),
    rate: store.get('voiceRate', 1),
    voices: [],
    choice: store.get('voiceChoice', { allan: '', arale: '' }),
    resolved: { allan: null, arale: null },
    maleFound: false,
    onChange: null,

    init() {
      if (!this.supported) return;
      const load = () => {
        this.voices = speechSynthesis.getVoices();
        this.resolve();
        if (this.onChange) this.onChange();
      };
      load();
      speechSynthesis.onvoiceschanged = load;
    },
    zhVoices() {
      const tw = this.voices.filter((v) => /zh[-_]TW|cmn[-_]Hant[-_]TW/i.test(v.lang) || /台灣|臺灣|Taiwan/i.test(v.name));
      const zh = this.voices.filter((v) => /^zh|^cmn/i.test(v.lang) && !tw.includes(v));
      return { tw, zh };
    },
    resolve() {
      const { tw, zh } = this.zhVoices();
      const all = tw.concat(zh);
      const maleRe = /YunJhe|Yunjhe|Zhiwei|Kangkang|Yunxi|Yunyang|Yunjian|Li-mu|Liang|(?<!fe)male|男/i;
      const femaleRe = /HsiaoChen|HsiaoYu|Hanhan|Yating|Mei-?Jia|Meijia|Sin-ji|Tingting|Xiaoxiao|female|女/i;
      const byName = (n) => this.voices.find((v) => v.name === n) || null;
      const male = tw.find((v) => maleRe.test(v.name)) || zh.find((v) => maleRe.test(v.name)) || null;
      const female = tw.find((v) => femaleRe.test(v.name)) || tw.find((v) => !maleRe.test(v.name)) || zh.find((v) => femaleRe.test(v.name)) || all[0] || null;
      this.maleFound = !!(byName(this.choice.allan) || male);
      this.resolved.allan = byName(this.choice.allan) || male || female;
      this.resolved.arale = byName(this.choice.arale) || female;
    },
    params(who) {
      const v = this.resolved[who];
      const isMale = v && /YunJhe|Yunjhe|Zhiwei|Kangkang|Yunxi|Yunyang|Yunjian|Li-mu|Liang|(?<!fe)male|男/i.test(v.name);
      if (who === 'allan') return { voice: v, pitch: isMale ? 0.95 : 0.55, rate: 0.95 * this.rate };
      return { voice: v, pitch: 1.35, rate: 1.08 * this.rate };
    },
    speakable(t) {
      return t
        .replace(/(\d)NT/g, '$1無王').replace(/\bNT\b/g, '無王')
        .replace(/♠/g, '黑桃').replace(/♥/g, '紅心').replace(/♦/g, '方塊').replace(/♣/g, '梅花')
        .replace(/\bXX\b/g, '再賭倍').replace(/\bX\b/g, '賭倍').replace(/\bPass\b/gi, '派司')
        .replace(/(\d+)[–-](\d+)/g, '$1到$2').replace(/HCP/g, '大牌點')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/[「」]/g, '');
    },
    speak(who, text, priority = 1) {
      if (!this.supported || !this.enabled) return;
      // 避免語音排隊太久：低優先的話語在忙碌時略過
      if (priority < 1 && (speechSynthesis.speaking || speechSynthesis.pending)) return;
      const u = new SpeechSynthesisUtterance(this.speakable(text));
      const p = this.params(who);
      if (p.voice) u.voice = p.voice;
      u.lang = (p.voice && p.voice.lang) || 'zh-TW';
      u.pitch = p.pitch; u.rate = p.rate;
      speechSynthesis.speak(u);
    },
    stop() { if (this.supported) speechSynthesis.cancel(); },
    save() { store.set('voiceOn', this.enabled); store.set('voiceRate', this.rate); store.set('voiceChoice', this.choice); },
  };

  /* ---------- 台詞 ---------- */
  // 每個事件：多組變化，每組是一串 [角色, 表情, 台詞]
  const LINES = {
    welcome: [[
      ['arale', 'cheer', 'Allan 顧問！今天要跟我搭檔打橋牌嗎？我已經準備好了！'],
      ['allan', 'smile', '好啊阿拉蕾，我們一組，把對面兩位的漏洞通通找出來！'],
      ['arale', 'wink', '對面是「駭客小黑」跟「釣魚怪」，聽起來就很需要做風險評鑑耶～'],
    ]],
    newBoard: [
      [['arale', 'talk', '第 {n} 副牌，{dealer}家發牌，{vul}。']],
      [['arale', 'talk', '第 {n} 副！{dealer}家先叫，{vul}。'], ['allan', 'point', '先數大牌點：A 四點、K 三點、Q 兩點、J 一點。']],
      [['allan', 'smile', '第 {n} 副，{vul}，{dealer}家發牌。'], ['arale', 'cheer', '這副我們也要拿高分！']],
    ],
    yourBid: [
      [['arale', 'talk', '顧問，輪到你叫牌囉！']],
      [['arale', 'wink', '換你了～不確定的話可以按「阿拉蕾提示」喔！']],
      [['arale', 'talk', '顧問，請叫牌！']],
    ],
    araleBid: [
      [['arale', 'talk', '我叫 {bid}！{desc}']],
      [['arale', 'think', '嗯…我叫 {bid}。{desc}']],
    ],
    oppInterfere: [
      [['allan', 'think', '{opp}爭叫了，阿拉蕾小心！']],
      [['arale', 'surprised', '哇，{opp}插進來叫牌了！']],
    ],
    userBidAck: [
      [['arale', 'cheer', '收到！']],
      [['arale', 'talk', '了解，顧問叫 {bid}。']],
      [['arale', 'wink', 'OK～']],
    ],
    passOut: [[
      ['arale', 'sad', '四家都派司…這副牌沒人想打耶。'],
      ['allan', 'laugh', '沒關係，就當系統重新開機，下一副！'],
    ]],
    contractAllan: [[
      ['allan', 'point', '最後合約 {contract}，由我主打，需要拿 {need} 墩！'],
      ['arale', 'cheer', '我是夢家，牌攤給你看，顧問加油喔！'],
    ]],
    contractArale: [[
      ['arale', 'talk', '合約 {contract}，我是主打！可是…顧問來幫我打好不好？兩手牌都交給你操作！'],
      ['allan', 'smile', '沒問題，我先規劃一下打牌路線。需要 {need} 墩。'],
    ]],
    contractThem: [
      [['allan', 'think', '對方合約 {contract}，我們防守，要拿 {set} 墩才能打宕他們！'], ['arale', 'cheer', '防守就像資安防護，要團隊合作！']],
      [['arale', 'talk', '對手打 {contract}，我們要拿到 {set} 墩！'], ['allan', 'point', '仔細看夢家的牌，找出他們的弱點。']],
    ],
    yourLead: [[['arale', 'talk', '顧問，你要首引喔！']]],
    trickUs: [
      [['arale', 'cheer', '這墩是我們的！']],
      [['allan', 'laugh', '讚啦！']],
      [['arale', 'wink', '漂亮～']],
      [['allan', 'smile', '好，穩穩拿下。']],
    ],
    ruffUs: [
      [['arale', 'cheer', '王吃！漂亮！']],
      [['allan', 'laugh', '哈哈，王牌出擊！']],
    ],
    ruffThem: [
      [['arale', 'surprised', '啊！被王吃了…']],
      [['allan', 'worried', '唉呀，被對手王吃。']],
    ],
    araleWins: [
      [['arale', 'wink', '嘿嘿，這墩我拿下了～']],
      [['arale', 'cheer', '耶！我贏了這墩！']],
    ],
    madeUs: [
      [['arale', 'cheer', '做成了！{contract}{result}，得 {score} 分！'], ['allan', 'laugh', '團隊合作，滴水不漏！']],
      [['allan', 'laugh', '合約完成！{result}，{score} 分入袋。'], ['arale', 'cheer', '顧問好厲害！']],
    ],
    downUs: [
      [['arale', 'sad', '差了 {down} 墩…失 {pen} 分。'], ['allan', 'smile', '沒關係，PDCA 檢討一下，下一副持續改善！']],
      [['allan', 'worried', '倒了 {down} 墩，罰 {pen} 分。'], ['arale', 'talk', '顧問別難過，就當作是一次內部稽核的發現事項！']],
    ],
    madeThem: [
      [['allan', 'worried', '被對方做成了，失 {pen} 分…'], ['arale', 'talk', '下次我們防守要更嚴密！']],
      [['arale', 'sad', '對手做成 {contract} 了…'], ['allan', 'think', '矯正措施：下一副加強防守。']],
    ],
    downThem: [
      [['arale', 'cheer', '打宕對手了！我們得 {score} 分！'], ['allan', 'laugh', '這就是縱深防禦！']],
      [['allan', 'laugh', '對手倒 {down} 墩，我們拿 {score} 分！'], ['arale', 'cheer', '漏洞被我們抓到了～']],
    ],
    mustFollow: [[['arale', 'confused', '顧問，你手上還有{suit}，要跟出同花色喔！']]],
    notYourTurn: [[['arale', 'confused', '還沒輪到你喔～']]],
    hintBid: [[['arale', 'think', '我建議叫 {bid}。{why}']]],
    hintCard: [[['arale', 'think', '我建議出 {card}。{why}']]],
    hintNone: [[['arale', 'wink', '現在不用動作，等其他人出牌喔～']]],
    secret: [[['arale', 'wink', '比賽中不能偷偷告訴你我的牌喔～這是資訊安全！']]],
  };

  const TIPS = [
    '小提醒：兩家合計 25 點左右，就可以考慮叫到成局。',
    '高花黑桃、紅心成局只要叫到 4 線；低花梅花、方塊要 5 線。',
    '3NT 只要拿 9 墩就成局，是最常見的成局合約。',
    '主打前先數一數贏墩，就像先盤點資產再做風險評鑑！',
    '防守時，記得回攻夥伴首引的花色。',
    '跟牌規則：有同花色一定要跟，沒有才可以王吃或墊牌。',
    '局況很重要：有身價時倒一墩罰 100 分，被賭倍更痛！',
    '王牌合約時，主打方通常要先清王，免得小王牌被對手拿去王吃。',
    '開叫 1NT 表示 15 到 17 點的平均牌型，夥伴可以很精準地判斷合約。',
    '兩家合計 33 點左右，就可以考慮小滿貫了！',
    '夥伴開叫後，你只要有 6 點以上就應該回應，不要讓夥伴孤單。',
    '第二家出小、第三家出大，是防守的基本原則。',
  ];

  /* ---------- 對話面板 ---------- */
  const Talk = {
    chatEl: null, portraits: {}, queue: Promise.resolve(), muted: false,
    bind(chatEl, portraits) { this.chatEl = chatEl; this.portraits = portraits; },
    fill(t, vars) { return t.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '')); },
    say(who, expr, text, priority = 1) {
      const ch = CHARS[who];
      if (!EXPR[who].includes(expr)) expr = ch.def;
      if (this.portraits[who]) {
        const p = this.portraits[who];
        p.src = ch.img(expr);
        p.parentElement.classList.add('speaking');
        clearTimeout(p._t);
        p._t = setTimeout(() => p.parentElement.classList.remove('speaking'), 2600);
      }
      if (this.chatEl) {
        const row = document.createElement('div');
        row.className = `msg ${who}`;
        row.innerHTML = `<img class="av" src="${ch.img(expr)}" alt=""><div class="bubble"><b>${ch.name}</b><span></span></div>`;
        row.querySelector('span').innerHTML = colorSuits(escapeHtml(text));
        this.chatEl.appendChild(row);
        while (this.chatEl.children.length > 60) this.chatEl.firstChild.remove();
        this.chatEl.scrollTop = this.chatEl.scrollHeight;
      }
      const toast = document.getElementById('toast');
      if (toast) {
        toast.className = `toast show ${who}`;
        toast.querySelector('img').src = ch.img(expr);
        toast.querySelector('span').innerHTML = colorSuits(escapeHtml(text));
        clearTimeout(toast._t);
        toast._t = setTimeout(() => toast.classList.remove('show'), 3500);
      }
      Voice.speak(who, text, priority);
    },
    system(text) {
      if (!this.chatEl) return;
      const row = document.createElement('div');
      row.className = 'msg sys';
      row.innerHTML = colorSuits(escapeHtml(text));
      this.chatEl.appendChild(row);
      this.chatEl.scrollTop = this.chatEl.scrollHeight;
    },
    event(name, vars, { chance = 1, priority = 1 } = {}) {
      if (Math.random() > chance) return;
      const variants = LINES[name];
      if (!variants) return;
      const seq = variants[Math.floor(Math.random() * variants.length)];
      seq.forEach(([who, expr, t], i) => setTimeout(() => this.say(who, expr, this.fill(t, vars), priority), i * 450));
    },
    tip() { this.say('allan', 'point', '小教室：' + TIPS[Math.floor(Math.random() * TIPS.length)].replace(/^小提醒：/, ''), 0); },
  };

  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function colorSuits(s) { return s.replace(/([♥♦])/g, '<i class="red">$1</i>').replace(/([♠♣])/g, '<i class="blk">$1</i>'); }

  global.Characters = { CHARS, Voice, Talk, store, colorSuits, escapeHtml };
})(window);
