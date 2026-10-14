/* =========================================================
 * 遊戲流程與畫面：南=Allan 顧問（玩家）、北=阿拉蕾（AI 夥伴）
 * 西=駭客小黑、東=釣魚怪（AI 對手）
 * ========================================================= */
(function () {
  'use strict';
  const B = window.Bridge;
  const { Voice, Talk, store, colorSuits } = window.Characters;
  const $ = (id) => document.getElementById(id);

  const USER = 2, PARTNER = 0;
  const NAMES = ['阿拉蕾', '釣魚怪', 'Allan 顧問', '駭客小黑'];
  const VUL_TEXT = { none: '雙方無身價', ns: '南北有身價', ew: '東西有身價', both: '雙方有身價' };

  const S = {
    board: 0, totals: { ns: 0, ew: 0 }, history: [],
    orig: null, hands: null, dealer: 0, vul: 'none', auction: null, phase: 'idle', play: null,
    waiting: null, hintMark: null, interfered: false, userAsked: false,
    auto: store.get('auto', false), tips: store.get('tips', true), speed: store.get('speed', 1),
  };
  let GEN = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * S.speed));
  const contractStr = (c) => `${c.level}${B.STRAINS[c.strain]}${c.dbl === 2 ? 'XX' : c.dbl === 1 ? 'X' : ''}`;
  const cardSpeech = (c) => `${B.SUIT_NAMES[c.s]}${B.rankStr(c.r)}`;
  const isNS = (s) => s % 2 === 0;

  function userControls(seat) {
    if (S.auto) return false;
    if (S.phase === 'playing' && S.play && isNS(S.play.declarer)) return seat === S.play.declarer || seat === S.play.dummy;
    return seat === USER;
  }

  /* ---------- 等待玩家 ---------- */
  function waitFor(kind, seat) {
    return new Promise((resolve) => { S.waiting = { kind, seat, resolve }; render(); });
  }
  function release(val) {
    const w = S.waiting; S.waiting = null; clearHint();
    if (w) w.resolve(val);
  }

  /* ---------- 開局 ---------- */
  async function startBoard(replay = false) {
    const gen = ++GEN;
    release(null);
    if (!replay || !S.orig) { S.board++; S.orig = B.deal(); }
    S.hands = S.orig.map((h) => h.slice());
    S.dealer = B.boardDealer(S.board);
    S.vul = B.boardVul(S.board);
    S.auction = new B.Auction(S.dealer);
    S.phase = 'bidding'; S.play = null; S.interfered = false; S.userAsked = false;
    $('bidMeaning').textContent = '';
    clearTrick();
    render();
    Talk.system(`—— 第 ${S.board} 副${replay ? '（重打）' : ''} ——`);
    Talk.event('newBoard', { n: S.board, dealer: B.SEAT_NAMES[S.dealer], vul: VUL_TEXT[S.vul] });
    if (S.tips && Math.random() < 0.45) setTimeout(() => gen === GEN && Talk.tip(), 2200);
    await sleep(1100);
    if (gen !== GEN) return;
    runAuction(gen);
  }

  /* ---------- 叫牌 ---------- */
  async function runAuction(gen) {
    const a = S.auction;
    while (!a.isOver()) {
      const s = a.next;
      setActive(s);
      let call;
      if (s === USER && !S.auto) {
        if (!S.userAsked) { S.userAsked = true; Talk.event('yourBid', {}, { chance: 0.6, priority: 0 }); }
        call = await waitFor('bid', s);
        if (gen !== GEN || !call) return;
      } else {
        await sleep(750);
        if (gen !== GEN) return;
        call = B.chooseBid(a, S.hands[s]).call;
      }
      a.add(call);
      const desc = B.analyzeCall(a, a.calls.length - 1).desc;
      renderAuction();
      showMeaning(a.calls.length - 1);
      if (s === PARTNER) {
        if (call.t !== 'pass') Talk.event('araleBid', { bid: B.callStr(call), desc: desc.replace(/^[^：]*：/, '') });
        else if (Math.random() < 0.35) Talk.say('arale', 'talk', '我派司。', 0);
      } else if (!isNS(s) && call.t !== 'pass' && !S.interfered) {
        const ourBid = a.calls.some((c, i) => c.t === 'bid' && isNS(a.seatAt(i)));
        if (ourBid) { S.interfered = true; Talk.event('oppInterfere', { opp: NAMES[s] }, { chance: 0.7 }); }
      } else if (s === USER && !S.auto && call.t !== 'pass') {
        Talk.event('userBidAck', { bid: B.callStr(call) }, { chance: 0.3, priority: 0 });
      }
    }
    setActive(-1);
    const c = a.contract();
    if (!c) {
      S.phase = 'done';
      Talk.event('passOut');
      S.history.push({ board: S.board, contract: '四家派司', result: '—', ns: 0 });
      render();
      await sleep(1500);
      if (gen !== GEN) return;
      showResult({ passOut: true });
      return;
    }
    startPlay(gen, c);
  }

  /* ---------- 打牌 ---------- */
  async function startPlay(gen, c) {
    const P = S.play = {
      contract: c, declarer: c.declarer, dummy: B.partnerOf(c.declarer), trump: c.strain,
      leader: (c.declarer + 1) % 4, trick: [], history: [], played: new Set(), tricks: [0, 0], dummyShown: false,
      auction: S.auction, hands: S.hands,
    };
    S.phase = 'playing';
    const need = c.level + 6;
    const vars = { contract: contractStr(c), need, set: 14 - need };
    if (isNS(c.declarer)) Talk.event(c.declarer === USER ? 'contractAllan' : 'contractArale', vars);
    else Talk.event('contractThem', vars);
    render();
    await sleep(1600);
    for (let t = 0; t < 13; t++) {
      P.trick = [];
      for (let k = 0; k < 4; k++) {
        if (gen !== GEN) return;
        const seat = (P.leader + k) % 4;
        setActive(seat);
        let card;
        if (userControls(seat)) {
          if (t === 0 && k === 0 && seat === USER) Talk.event('yourLead');
          card = await waitFor('card', seat);
          if (gen !== GEN || !card) return;
        } else {
          await sleep(k === 0 ? 900 : 700);
          if (gen !== GEN) return;
          card = B.chooseCard(P, seat).card;
        }
        playCard(seat, card);
      }
      const w = B.trickWinner(P.trick, P.trump);
      P.tricks[w.seat % 2]++;
      P.trick.forEach((x) => P.played.add(x.card.s * 100 + x.card.r));
      document.querySelector(`.slot.s${w.seat}`).classList.add('win');
      setActive(-1);
      renderStatus();
      const led = P.trick[0].card.s;
      const ruff = P.trump < 4 && w.card.s === P.trump && led !== P.trump;
      if (ruff) Talk.event(isNS(w.seat) ? 'ruffUs' : 'ruffThem', {}, { chance: 0.6, priority: 0 });
      else if (w.seat === PARTNER) Talk.event('araleWins', {}, { chance: 0.3, priority: 0 });
      else if (isNS(w.seat)) Talk.event('trickUs', {}, { chance: 0.2, priority: 0 });
      await sleep(1400);
      if (gen !== GEN) return;
      P.history.push(P.trick);
      P.trick = [];
      P.leader = w.seat;
      clearTrick();
      render();
    }
    finish(gen);
  }

  function playCard(seat, card) {
    const P = S.play;
    S.hands[seat] = S.hands[seat].filter((c) => !B.cardEq(c, card));
    P.hands = S.hands;
    P.trick.push({ seat, card });
    if (!P.dummyShown) P.dummyShown = true;
    const slot = document.querySelector(`.slot.s${seat}`);
    slot.innerHTML = '';
    slot.appendChild(cardEl(card));
    render();
  }

  function finish(gen) {
    const P = S.play, c = P.contract;
    const declTricks = P.tricks[c.declarer % 2];
    const vulDecl = B.isVul(S.vul, c.declarer);
    const sc = B.score(c, declTricks, vulDecl);
    const ns = isNS(c.declarer) ? sc.score : -sc.score;
    if (ns > 0) S.totals.ns += ns; else S.totals.ew += -ns;
    const resStr = sc.made ? (sc.diff > 0 ? `超 ${sc.diff} 墩` : '剛好做成') : `倒 ${-sc.diff} 墩`;
    S.history.push({ board: S.board, contract: `${contractStr(c)} ${B.SEAT_NAMES[c.declarer]}`, result: resStr, ns });
    S.phase = 'done';
    render();
    const vars = { contract: contractStr(c), result: sc.made ? (sc.diff > 0 ? `，超 ${sc.diff} 墩` : '') : '', score: Math.abs(ns), pen: Math.abs(ns), down: -sc.diff };
    if (isNS(c.declarer)) Talk.event(sc.made ? 'madeUs' : 'downUs', vars);
    else Talk.event(sc.made ? 'madeThem' : 'downThem', vars);
    setTimeout(() => gen === GEN && showResult({ c, sc, ns, declTricks, resStr }), 1800 * S.speed);
  }

  /* ---------- 結果 ---------- */
  function showResult(r) {
    const body = $('resultBody');
    let head;
    if (r.passOut) {
      head = `<div class="result-head"><img src="assets/img/arale-sad.jpg" alt=""><div><div class="big">四家派司</div><div>這副不計分，重新發牌吧！</div></div></div>`;
    } else {
      const good = r.ns >= 0;
      const img = good ? (isNS(r.c.declarer) ? 'arale-cheer' : 'allan-laugh') : (isNS(r.c.declarer) ? 'allan-worried' : 'arale-sad');
      head = `<div class="result-head"><img src="assets/img/${img}.jpg" alt=""><div>
        <div class="big">${colorSuits(contractStr(r.c))} ${B.SEAT_NAMES[r.c.declarer]}家主打・${r.resStr}</div>
        <div>主打方拿到 ${r.declTricks} 墩（需要 ${r.c.level + 6} 墩）・${VUL_TEXT[S.vul]}</div></div></div>
        <div class="result-score">本副南北（我方）：<b>${r.ns >= 0 ? '+' : ''}${r.ns}</b> 分</div>
        <ul class="result-det">${r.sc.det.map((d) => `<li>${d}</li>`).join('')}</ul>`;
    }
    const handsTxt = S.orig.map((h, s) => `<div><b>${B.SEAT_NAMES[s]}・${NAMES[s]}</b>（${B.hcpOf(h)} 點）<br>${[3, 2, 1, 0].map((su) => colorSuits(B.SUITS[su]) + (h.filter((c) => c.s === su).map((c) => B.rankStr(c.r)).join(' ') || '—')).join('<br>')}</div>`).join('');
    const hist = `<table class="hist"><thead><tr><th>副</th><th>合約</th><th>結果</th><th>南北</th><th>東西</th></tr></thead><tbody>${
      S.history.slice(-8).map((h) => `<tr><td>${h.board}</td><td>${colorSuits(h.contract)}</td><td>${h.result}</td><td>${h.ns > 0 ? h.ns : ''}</td><td>${h.ns < 0 ? -h.ns : ''}</td></tr>`).join('')
    }</tbody><tfoot><tr><th colspan="3">累計</th><th>${S.totals.ns}</th><th>${S.totals.ew}</th></tr></tfoot></table>`;
    body.innerHTML = `${head}<details><summary>查看四家原始牌</summary><div class="hands-review">${handsTxt}</div></details><h2 style="margin-top:12px">計分紀錄</h2><div class="tblwrap">${hist}</div>`;
    $('dlgResult').showModal();
  }

  /* ---------- 畫面 ---------- */
  function cardEl(c, opts = {}) {
    const el = document.createElement('button');
    el.type = 'button';
    const red = c.s === 1 || c.s === 2;
    el.className = 'card' + (red ? ' r' : '');
    el.innerHTML = `<span class="ix">${B.rankStr(c.r)}<i>${B.SUITS[c.s]}</i></span><span class="pip">${B.SUITS[c.s]}</span>`;
    el.setAttribute('aria-label', cardSpeech(c));
    if (opts.seat != null) { el.dataset.seat = opts.seat; el.dataset.s = c.s; el.dataset.r = c.r; }
    if (!opts.seat && opts.seat !== 0) el.tabIndex = -1;
    return el;
  }
  function backEl() { const el = document.createElement('div'); el.className = 'card back'; return el; }

  function visibleSeat(seat) {
    if (seat === USER) return true;
    if (S.phase === 'playing' && S.play) {
      if (S.play.dummyShown && seat === S.play.dummy) return true;
      if (userControls(seat)) return true;
    }
    return false;
  }

  function renderHands() {
    const W = S.waiting && S.waiting.kind === 'card' ? S.waiting : null;
    for (let seat = 0; seat < 4; seat++) {
      const box = $('hand' + seat);
      box.innerHTML = '';
      const hand = S.hands ? S.hands[seat] : [];
      const vis = visibleSeat(seat);
      const legal = W && W.seat === seat ? B.legalCards(hand, S.play.trick) : null;
      const side = seat === 1 || seat === 3;
      box.className = 'hand';
      if (!vis) {
        box.classList.add('backs');
        const n = side ? Math.min(hand.length, 5) : hand.length;
        for (let i = 0; i < n; i++) box.appendChild(backEl());
        if (side && hand.length) { const b = document.createElement('div'); b.className = 'count-badge'; b.textContent = `×${hand.length}`; box.appendChild(b); }
        continue;
      }
      if (side) {
        box.classList.add('rows');
        for (const su of [3, 2, 1, 0]) {
          const row = document.createElement('div');
          row.className = 'srow';
          row.innerHTML = `<span class="sym${su === 1 || su === 2 ? ' r' : ''}">${B.SUITS[su]}</span>`;
          hand.filter((c) => c.s === su).forEach((c) => {
            const ch = document.createElement('button');
            ch.type = 'button';
            ch.className = 'chip' + (su === 1 || su === 2 ? ' r' : '');
            ch.textContent = B.rankStr(c.r);
            ch.dataset.seat = seat; ch.dataset.s = c.s; ch.dataset.r = c.r;
            ch.setAttribute('aria-label', cardSpeech(c));
            mark(ch, c, legal, W, seat);
            row.appendChild(ch);
          });
          box.appendChild(row);
        }
      } else {
        box.classList.add('fan');
        if (seat === 0) box.classList.add('small');
        hand.forEach((c) => { const el = cardEl(c, { seat }); mark(el, c, legal, W, seat); box.appendChild(el); });
      }
    }
  }
  function mark(el, c, legal, W, seat) {
    if (!legal) return;
    if (legal.some((x) => B.cardEq(x, c))) el.classList.add('playable');
    else el.classList.add('dim');
    if (S.hintMark && S.hintMark.seat === seat && B.cardEq(S.hintMark.card, c)) el.classList.add('hint');
  }

  function setActive(seat) {
    for (let s = 0; s < 4; s++) $('seat' + s).classList.toggle('active', s === seat);
  }

  function renderTags() {
    for (let s = 0; s < 4; s++) {
      const pi = $('seat' + s).querySelector('.pinfo');
      let tag = pi.querySelector('.tag');
      let txt = '';
      if (S.play && (S.phase === 'playing' || S.phase === 'done')) {
        if (s === S.play.declarer) txt = '主打';
        else if (s === S.play.dummy) txt = '夢家';
      }
      if (s === S.dealer && S.phase === 'bidding') txt = '發牌';
      if (!txt) { if (tag) tag.remove(); continue; }
      if (!tag) { tag = document.createElement('span'); tag.className = 'tag'; pi.querySelector('div').appendChild(tag); }
      tag.textContent = txt;
    }
  }

  function renderStatus() {
    const st = $('status');
    const P = S.play;
    let contract = '—', tricks = '—';
    if (S.phase === 'bidding') contract = '叫牌中…';
    if (P) {
      contract = `${colorSuits(contractStr(P.contract))} <small>${B.SEAT_NAMES[P.declarer]}家主打</small>`;
      tricks = `南北 ${P.tricks[0]}・東西 ${P.tricks[1]}`;
    }
    st.innerHTML = `
      <div><span class="k">牌局</span><span class="v">第 ${S.board || '—'} 副・${B.SEAT_NAMES[S.dealer]}發牌</span></div>
      <div><span class="k">局況</span><span class="v ${S.vul !== 'none' ? 'vul' : ''}">${VUL_TEXT[S.vul]}</span></div>
      <div><span class="k">合約</span><span class="v">${contract}</span></div>
      <div><span class="k">墩數</span><span class="v">${tricks}</span></div>
      <div class="full"><span class="k">累計得分</span><span class="scoreline"><span class="us">我方 南北 ${S.totals.ns}</span><span>：</span><span class="them">東西 ${S.totals.ew}</span></span></div>`;
    const ci = $('centerInfo');
    if (S.phase === 'bidding') ci.innerHTML = '叫牌中…';
    else if (P) {
      const need = P.contract.level + 6;
      const side = isNS(P.declarer) ? '我方' : '對方';
      ci.innerHTML = `<div class="big">${colorSuits(contractStr(P.contract))}</div>${side}需要 ${need} 墩・已拿 ${P.tricks[P.declarer % 2]}`;
    } else ci.textContent = '';
  }

  function renderAuction() {
    const a = S.auction;
    const order = [3, 0, 1, 2];
    const tbl = $('auctionTbl');
    let html = '<thead><tr>' + order.map((s) => `<th class="${isNS(s) ? 'us' : ''}">${B.SEAT_NAMES[s]}<br><small>${NAMES[s]}</small></th>`).join('') + '</tr></thead><tbody>';
    if (a) {
      const start = order.indexOf(a.dealer);
      const cells = Array(start).fill('<td></td>');
      a.calls.forEach((c, i) => {
        const cls = c.t === 'pass' ? 'pass' : c.t === 'bid' ? '' : 'x';
        cells.push(`<td class="${cls}" data-i="${i}" tabindex="0">${colorSuits(B.callStr(c))}</td>`);
      });
      if (!a.isOver() && S.phase === 'bidding') cells.push('<td>?</td>');
      for (let i = 0; i < cells.length; i += 4) html += '<tr>' + cells.slice(i, i + 4).join('') + '</tr>';
    }
    tbl.innerHTML = html + '</tbody>';
  }
  function showMeaning(i) {
    const a = S.auction;
    if (!a || i == null || !a.calls[i]) return;
    const s = a.seatAt(i);
    const desc = B.analyzeCall(a, i).desc;
    $('bidMeaning').innerHTML = `<b>${B.SEAT_NAMES[s]}・${NAMES[s]}</b>：${colorSuits(desc)}`;
  }

  function renderBidBox() {
    const box = $('bidbox');
    const W = S.waiting && S.waiting.kind === 'bid' ? S.waiting : null;
    box.hidden = !W;
    if (!W) return;
    const a = S.auction;
    const grid = $('bidgrid');
    grid.innerHTML = '';
    for (let lv = 1; lv <= 7; lv++) for (let st = 0; st < 5; st++) {
      const b = document.createElement('button');
      b.type = 'button';
      const c = B.mkBid(lv, st);
      b.innerHTML = colorSuits(B.callStr(c));
      b.dataset.call = `${lv}-${st}`;
      b.disabled = !a.isLegal(c, USER);
      if (S.hintMark && S.hintMark.call && S.hintMark.call.t === 'bid' && S.hintMark.call.level === lv && S.hintMark.call.strain === st) b.classList.add('hint');
      grid.appendChild(b);
    }
    box.querySelectorAll('.bidcalls button').forEach((b) => {
      const c = { t: b.dataset.call };
      b.disabled = !a.isLegal(c, USER);
      b.classList.toggle('hint', !!(S.hintMark && S.hintMark.call && S.hintMark.call.t === c.t));
    });
  }

  function clearTrick() {
    document.querySelectorAll('.slot').forEach((s) => { s.innerHTML = ''; s.classList.remove('win'); });
  }
  function clearHint() { S.hintMark = null; }

  function render() { renderHands(); renderTags(); renderStatus(); renderAuction(); renderBidBox(); }

  /* ---------- 事件 ---------- */
  $('bidbox').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !S.waiting || S.waiting.kind !== 'bid') return;
    const v = b.dataset.call;
    let call;
    if (v === 'pass') call = B.PASS; else if (v === 'X') call = B.DBL; else if (v === 'XX') call = B.RDBL;
    else { const [lv, st] = v.split('-').map(Number); call = B.mkBid(lv, st); }
    if (!S.auction.isLegal(call)) return;
    release(call);
  });

  $('table').addEventListener('click', (e) => {
    const el = e.target.closest('[data-seat]');
    if (!el || S.phase !== 'playing') return;
    const seat = +el.dataset.seat;
    const card = { s: +el.dataset.s, r: +el.dataset.r };
    if (!userControls(seat)) return;
    const W = S.waiting;
    if (!W || W.kind !== 'card' || W.seat !== seat) { Talk.event('notYourTurn', {}, { priority: 0 }); return; }
    const legal = B.legalCards(S.hands[seat], S.play.trick);
    if (!legal.some((c) => B.cardEq(c, card))) {
      Talk.event('mustFollow', { suit: B.SUIT_NAMES[S.play.trick[0].card.s] });
      return;
    }
    release(card);
  });

  $('auctionTbl').addEventListener('mouseover', (e) => { const td = e.target.closest('td[data-i]'); if (td) showMeaning(+td.dataset.i); });
  $('auctionTbl').addEventListener('focusin', (e) => { const td = e.target.closest('td[data-i]'); if (td) showMeaning(+td.dataset.i); });
  $('auctionTbl').addEventListener('click', (e) => { const td = e.target.closest('td[data-i]'); if (td) showMeaning(+td.dataset.i); });

  $('btnHint').addEventListener('click', () => {
    const W = S.waiting;
    if (!W) { Talk.event('hintNone', {}); return; }
    if (W.kind === 'bid') {
      const r = B.chooseBid(S.auction, S.hands[USER]);
      S.hintMark = { call: r.call };
      Talk.event('hintBid', { bid: B.callStr(r.call), why: r.why || '' });
    } else {
      const r = B.chooseCard(S.play, W.seat);
      S.hintMark = { seat: W.seat, card: r.card };
      Talk.event('hintCard', { card: B.cardStr(r.card), why: r.why || '' });
    }
    render();
  });

  $('btnNew').addEventListener('click', () => { Voice.stop(); startBoard(false); });
  $('btnNext').addEventListener('click', () => { $('dlgResult').close(); startBoard(false); });
  $('btnReplay').addEventListener('click', () => { $('dlgResult').close(); startBoard(true); });

  function begin(withVoice) {
    Voice.enabled = withVoice; Voice.save();
    $('splash').hidden = true;
    Talk.event('welcome');
    setTimeout(() => startBoard(false), 2600);
  }
  $('btnStart').addEventListener('click', () => begin(true));
  $('btnStartMute').addEventListener('click', () => begin(false));

  /* ---------- 設定 ---------- */
  function fillVoiceSelects() {
    const { tw, zh } = Voice.zhVoices();
    const list = tw.concat(zh);
    for (const who of ['allan', 'arale']) {
      const sel = $(who === 'allan' ? 'optVoiceAllan' : 'optVoiceArale');
      sel.innerHTML = '<option value="">自動選擇</option>' + list.map((v) => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name}（${v.lang}）</option>`).join('');
      sel.value = Voice.choice[who] || '';
    }
    let note = '';
    if (!Voice.supported) note = '這個瀏覽器不支援語音合成，仍可閱讀文字對話。';
    else if (!list.length) note = '這台裝置沒有中文語音。可在系統設定加裝「中文（台灣）」語音後重新整理。';
    else if (!Voice.maleFound) note = '這台裝置沒有台灣男聲，已用較低的音調模擬 Allan 顧問。Windows 可加裝「Microsoft Yunjhe（中文-台灣）」男聲。';
    $('voiceNote').textContent = note;
  }
  $('btnSettings').addEventListener('click', () => {
    $('optVoice').checked = Voice.enabled;
    $('optRate').value = Voice.rate; $('optRateVal').textContent = Voice.rate + 'x';
    $('optAuto').checked = S.auto; $('optTips').checked = S.tips; $('optSpeed').value = String(S.speed);
    fillVoiceSelects();
    $('dlgSettings').showModal();
  });
  $('optVoice').addEventListener('change', (e) => { Voice.enabled = e.target.checked; if (!Voice.enabled) Voice.stop(); Voice.save(); });
  $('optRate').addEventListener('input', (e) => { Voice.rate = +e.target.value; $('optRateVal').textContent = Voice.rate + 'x'; Voice.save(); });
  $('optVoiceAllan').addEventListener('change', (e) => { Voice.choice.allan = e.target.value; Voice.resolve(); Voice.save(); });
  $('optVoiceArale').addEventListener('change', (e) => { Voice.choice.arale = e.target.value; Voice.resolve(); Voice.save(); });
  $('testAllan').addEventListener('click', () => { const on = Voice.enabled; Voice.enabled = true; Voice.speak('allan', '我是 Allan 顧問，一起來打橋牌吧！'); Voice.enabled = on; });
  $('testArale').addEventListener('click', () => { const on = Voice.enabled; Voice.enabled = true; Voice.speak('arale', '我是阿拉蕾，顧問的 AI 小助手！'); Voice.enabled = on; });
  $('optAuto').addEventListener('change', (e) => {
    S.auto = e.target.checked; store.set('auto', S.auto);
    if (S.auto && S.waiting) {
      // 立即由 AI 代打目前等待的動作
      const W = S.waiting;
      if (W.kind === 'bid') release(B.chooseBid(S.auction, S.hands[USER]).call);
      else release(B.chooseCard(S.play, W.seat).card);
    }
    render();
  });
  $('optTips').addEventListener('change', (e) => { S.tips = e.target.checked; store.set('tips', S.tips); });
  $('optSpeed').addEventListener('change', (e) => { S.speed = +e.target.value; store.set('speed', S.speed); });
  $('btnCloseSettings').addEventListener('click', () => $('dlgSettings').close());

  /* ---------- 初始化 ---------- */
  Talk.bind($('chat'), { allan: $('portAllan'), arale: $('portArale') });
  Voice.onChange = () => { if ($('dlgSettings').open) fillVoiceSelects(); };
  Voice.init();
  render();
})();
