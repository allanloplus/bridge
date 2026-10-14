/* =========================================================
 * 橋牌引擎：牌組、叫牌、打牌、計分、AI
 * 座位：0=北(N) 1=東(E) 2=南(S) 3=西(W)
 * 花色：0=♣ 1=♦ 2=♥ 3=♠ ；王牌/叫品花色 4=NT
 * ========================================================= */
(function (global) {
  'use strict';

  const SUITS = ['♣', '♦', '♥', '♠'];
  const STRAINS = ['♣', '♦', '♥', '♠', 'NT'];
  const SUIT_NAMES = ['梅花', '方塊', '紅心', '黑桃', '無王'];
  const SEAT_NAMES = ['北', '東', '南', '西'];
  const RANK_STR = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 10: '10' };
  const rankStr = (r) => RANK_STR[r] || String(r);
  const partnerOf = (p) => (p + 2) % 4;
  const sameSide = (a, b) => a % 2 === b % 2;
  const isMajor = (s) => s === 2 || s === 3;

  /* ---------- 牌組 ---------- */
  function newDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ s, r });
    return d;
  }
  function shuffle(a, rnd = Math.random) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sortHand(h) {
    // 黑桃、紅心、梅花、方塊 交錯顏色排序
    const order = { 3: 0, 2: 1, 0: 2, 1: 3 };
    return h.sort((a, b) => order[a.s] - order[b.s] || b.r - a.r);
  }
  function deal() {
    const d = shuffle(newDeck());
    const hands = [[], [], [], []];
    d.forEach((c, i) => hands[i % 4].push(c));
    return hands.map(sortHand);
  }
  const cardStr = (c) => SUITS[c.s] + rankStr(c.r);
  const cardEq = (a, b) => a.s === b.s && a.r === b.r;

  /* ---------- 牌力評估 ---------- */
  const hcpOf = (h) => h.reduce((t, c) => t + Math.max(0, c.r - 10), 0);
  const lensOf = (h) => [0, 1, 2, 3].map((s) => h.filter((c) => c.s === s).length);
  function isBalanced(h) {
    const L = lensOf(h).sort((a, b) => a - b);
    return L[0] >= 2 && L[1] >= 3;
  }
  const suitHcp = (h, s) => hcpOf(h.filter((c) => c.s === s));
  const has = (h, s, r) => h.some((c) => c.s === s && c.r === r);
  function stopper(h, s) {
    const L = lensOf(h)[s];
    return has(h, s, 14) || (has(h, s, 13) && L >= 2) || (has(h, s, 12) && L >= 3) || (has(h, s, 11) && L >= 4);
  }
  function shortPts(h, trump, light = false) {
    return lensOf(h).reduce((t, n, s) => (s === trump ? t : t + (n === 0 ? (light ? 3 : 5) : n === 1 ? (light ? 2 : 3) : n === 2 ? 1 : 0)), 0);
  }
  const lenPts = (h) => lensOf(h).reduce((t, n) => t + Math.max(0, n - 4), 0);

  /* ---------- 叫品 ---------- */
  // call: {t:'bid', level, strain} | {t:'pass'} | {t:'X'} | {t:'XX'}
  const bidIdx = (c) => (c.level - 1) * 5 + c.strain;
  const mkBid = (level, strain) => ({ t: 'bid', level, strain });
  const PASS = { t: 'pass' }, DBL = { t: 'X' }, RDBL = { t: 'XX' };
  function callStr(c) {
    if (c.t === 'pass') return 'Pass';
    if (c.t === 'X') return 'X';
    if (c.t === 'XX') return 'XX';
    return c.level + STRAINS[c.strain];
  }
  function callSpeech(c) {
    if (c.t === 'pass') return '派司';
    if (c.t === 'X') return '賭倍';
    if (c.t === 'XX') return '再賭倍';
    return '一二三四五六七'[c.level - 1] + SUIT_NAMES[c.strain];
  }

  class Auction {
    constructor(dealer) { this.dealer = dealer; this.calls = []; }
    seatAt(i) { return (this.dealer + i) % 4; }
    get next() { return this.seatAt(this.calls.length); }
    lastBid() {
      for (let i = this.calls.length - 1; i >= 0; i--)
        if (this.calls[i].t === 'bid') return { call: this.calls[i], seat: this.seatAt(i), idx: i };
      return null;
    }
    dblState() { // 0 無, 1 賭倍, 2 再賭倍（自最後叫品之後）
      let st = 0;
      for (let i = this.calls.length - 1; i >= 0; i--) {
        const c = this.calls[i];
        if (c.t === 'bid') break;
        if (c.t === 'X') { st = Math.max(st, 1); break; }
        if (c.t === 'XX') { st = 2; break; }
      }
      return st;
    }
    isLegal(c, seat = this.next) {
      const lb = this.lastBid();
      if (c.t === 'pass') return true;
      if (c.t === 'bid') return c.level >= 1 && c.level <= 7 && (!lb || bidIdx(c) > bidIdx(lb.call));
      if (c.t === 'X') return !!lb && !sameSide(lb.seat, seat) && this.dblState() === 0;
      if (c.t === 'XX') return !!lb && sameSide(lb.seat, seat) && this.dblState() === 1;
      return false;
    }
    add(c) { if (!this.isLegal(c)) throw new Error('illegal call'); this.calls.push(c); }
    isOver() {
      const n = this.calls.length;
      if (n < 4) return false;
      const lb = this.lastBid();
      if (!lb) return true; // 四家派司
      return this.calls.slice(-3).every((c) => c.t === 'pass');
    }
    contract() {
      const lb = this.lastBid();
      if (!lb) return null;
      const { level, strain } = lb.call;
      let declarer = -1;
      for (let i = 0; i < this.calls.length; i++) {
        const c = this.calls[i], s = this.seatAt(i);
        if (c.t === 'bid' && c.strain === strain && sameSide(s, lb.seat)) { declarer = s; break; }
      }
      return { level, strain, dbl: this.dblState(), declarer };
    }
    callsBy(seat) { return this.calls.map((c, i) => ({ c, i, s: this.seatAt(i) })).filter((x) => x.s === seat); }
  }

  /* ---------- 叫品解讀（AI 推估夥伴牌力 & 解說） ---------- */
  function analyzeCall(auction, idx) {
    const seat = auction.seatAt(idx);
    const c = auction.calls[idx];
    const prior = auction.calls.slice(0, idx).map((cc, i) => ({ c: cc, s: auction.seatAt(i), i }));
    const priorBids = prior.filter((x) => x.c.t === 'bid');
    const myPrev = priorBids.filter((x) => x.s === seat);
    const pPrev = priorBids.filter((x) => x.s === partnerOf(seat));
    const oppPrev = priorBids.filter((x) => !sameSide(x.s, seat));
    const pDoubled = prior.some((x) => x.s === partnerOf(seat) && x.c.t === 'X');
    const info = { min: 0, max: 40, len: [0, 0, 0, 0], bal: false };
    const lim = (a, b) => { info.min = a; info.max = b; };
    let d = '';
    const sn = (s) => SUIT_NAMES[s];
    const lastPrior = priorBids.length ? priorBids[priorBids.length - 1].c : null;
    const jump = lastPrior && c.t === 'bid' ? (c.level - lastPrior.level) - (c.strain > lastPrior.strain ? 0 : 1) : 0;

    if (c.t === 'pass') {
      if (!priorBids.length) { lim(0, 11); d = '派司：沒有足夠的開叫牌力（約 11 點以下）'; }
      else d = '派司';
      return { desc: d, info };
    }
    if (c.t === 'X') {
      const lb = priorBids[priorBids.length - 1];
      if (!myPrev.length && !pPrev.length && lb && lb.c.level <= 2) {
        lim(12, 40);
        for (let s = 0; s < 4; s++) if (!oppPrev.some((o) => o.c.strain === s)) info.len[s] = 3;
        d = '技術性賭倍（Takeout Double）：12 點以上，對方叫過的花色短，支持其他花色，請夥伴叫牌';
      } else { d = '懲罰性賭倍：認為對方合約做不成'; }
      return { desc: d, info };
    }
    if (c.t === 'XX') return { desc: '再賭倍：認為我方合約一定做得成', info };

    const { level: L, strain: S } = c;
    const B = `${L}${STRAINS[S]}`;
    if (!priorBids.length) { // 開叫
      if (L === 1 && S === 4) { lim(15, 17); info.bal = true; d = `${B} 開叫：15–17 點，平均牌型`; }
      else if (L === 1 && isMajor(S)) { lim(12, 21); info.len[S] = 5; d = `${B} 開叫：12–21 點，5 張以上${sn(S)}`; }
      else if (L === 1) { lim(12, 21); info.len[S] = 3; d = `${B} 開叫：12–21 點，3 張以上${sn(S)}`; }
      else if (L === 2 && S === 0) { lim(22, 40); d = '2♣ 開叫：22 點以上的強牌，逼叫'; }
      else if (L === 2 && S === 4) { lim(20, 21); info.bal = true; d = '2NT 開叫：20–21 點，平均牌型'; }
      else if (L === 2) { lim(5, 10); info.len[S] = 6; d = `${B} 弱二開叫：5–10 點，6 張${sn(S)}`; }
      else if (S === 4) { lim(25, 27); info.bal = true; d = `${B} 開叫：非常強的平均牌`; }
      else { lim(5, 10); info.len[S] = L >= 4 ? 8 : 7; d = `${B} 阻塞開叫：牌力弱，${info.len[S]} 張以上長${sn(S)}`; }
      return { desc: d, info };
    }
    const pOpen = pPrev.length && priorBids[0].s === partnerOf(seat) ? priorBids[0].c : null;
    if (!myPrev.length && pOpen && pPrev.length === 1) { // 回應夥伴開叫
      const ps = pOpen.strain, pl = pOpen.level;
      if (pl === 1 && ps === 4 && oppPrev.length === 0) {
        if (L === 2 && S === 0) { lim(8, 40); d = '2♣ 史蒂曼問叫（Stayman）：8 點以上，詢問夥伴有無 4 張高花'; }
        else if (L === 2 && S < 4) { lim(0, 7); info.len[S] = 5; d = `${B}：0–7 點，5 張以上${sn(S)}，示弱停叫`; }
        else if (L === 2 && S === 4) { lim(8, 9); info.bal = true; d = '2NT：8–9 點，邀請成局'; }
        else if (L === 3 && S === 4) { lim(10, 15); info.bal = true; d = '3NT：10–15 點，直接進局'; }
        else if (L === 3 && isMajor(S)) { lim(10, 15); info.len[S] = 5; d = `${B}：10 點以上，5 張${sn(S)}，請夥伴選擇 4${STRAINS[S]} 或 3NT`; }
        else if (L === 4 && isMajor(S)) { lim(10, 15); info.len[S] = 6; d = `${B}：6 張以上${sn(S)}，進局`; }
        else if (L === 4 && S === 4) { lim(16, 17); d = '4NT：16–17 點，邀請小滿貫'; }
        else if (L >= 6) { lim(18, 40); d = `${B}：牌力足夠滿貫`; }
        return { desc: d || `${B}`, info };
      }
      if (pl === 2 && ps === 0) {
        if (L === 2 && S === 1) { lim(0, 40); d = '2♦：等待叫，請夥伴描述牌型'; }
        else { lim(8, 40); if (S < 4) info.len[S] = 5; d = `${B}：積極回應，8 點以上`; }
        return { desc: d, info };
      }
      if (pl === 1 && ps < 4) {
        if (S === ps) {
          info.len[S] = isMajor(S) ? 3 : 5;
          if (L === 2) { lim(6, 9); d = `${B}：單加，6–9 點，支持夥伴${sn(S)}`; }
          else if (L === 3) { lim(10, 12); d = `${B}：跳加邀請，10–12 點，支持${sn(S)}`; }
          else { lim(13, 18); d = `${B}：直接進局，支持${sn(S)}`; }
        } else if (S === 4) {
          if (L === 1) { lim(6, 10); d = '1NT：6–10 點，沒有適合的花色可叫'; }
          else if (L === 2) { lim(11, 12); info.bal = true; d = '2NT：11–12 點平均牌，邀請進局'; }
          else { lim(13, 15); info.bal = true; d = '3NT：13–15 點平均牌，進局'; }
        } else if (jump >= 1) { lim(17, 40); info.len[S] = 5; d = `${B}：跳叫新花，17 點以上強牌`; }
        else if (L === 1) { lim(6, 40); info.len[S] = 4; d = `${B}：6 點以上，4 張以上${sn(S)}，逼叫一輪`; }
        else { lim(10, 40); info.len[S] = (S === 2 && ps === 3) ? 5 : 4; d = `${B}：二線新花，10 點以上，${info.len[S]} 張以上${sn(S)}`; }
        return { desc: d, info };
      }
      if (ps < 4 && pl >= 2) { // 回應阻塞叫
        if (S === ps) { lim(6, 40); info.len[S] = 3; d = `${B}：支持夥伴的${sn(S)}`; }
        else if (S === 4) { lim(15, 40); d = `${B}：強牌，有各門擋張`; }
        else { lim(15, 40); info.len[S] = 5; d = `${B}：強牌，5 張以上${sn(S)}`; }
        return { desc: d, info };
      }
      if (ps === 4 && pl === 2) { lim(4, 40); if (S < 4) info.len[S] = L === 4 ? 6 : 5; d = `${B}：足夠進局`; return { desc: d, info }; }
    }
    // 對方開叫，我方首次叫牌（爭叫）
    if (!myPrev.length && !pPrev.length && !pDoubled && oppPrev.length) {
      if (S === 4 && L === 1) { lim(15, 18); info.bal = true; d = '1NT 爭叫：15–18 點平均牌，有對方花色擋張'; }
      else if (S === 4) { lim(15, 40); d = `${B}：強牌，有擋張`; }
      else if (jump >= 1) { lim(5, 10); info.len[S] = 6; d = `${B}：弱跳爭叫，6 張${sn(S)}，牌力弱`; }
      else if (L === 1) { lim(8, 16); info.len[S] = 5; d = `${B} 爭叫：8–16 點，5 張以上${sn(S)}`; }
      else { lim(11, 16); info.len[S] = 5; d = `${B} 爭叫：11–16 點，5 張以上${sn(S)}`; }
      return { desc: d, info };
    }
    // 回應夥伴的爭叫 / 技術性賭倍
    if (!myPrev.length && (pPrev.length || pDoubled) && !pOpen) {
      if (pDoubled && !pPrev.length) {
        if (S === 4) { lim(L === 1 ? 6 : L === 2 ? 10 : 13, 40); d = `${B}：回應夥伴的賭倍，有擋張`; }
        else { info.len[S] = 4; if (jump >= 1) { lim(9, 11); d = `${B}：回應賭倍，9–11 點，4 張以上${sn(S)}`; } else { lim(0, 8); d = `${B}：回應夥伴賭倍，0–8 點，4 張以上${sn(S)}`; } }
        return { desc: d, info };
      }
      const ps = pPrev[0].c.strain;
      if (S === ps) { info.len[S] = 3; lim(jump >= 1 ? 10 : 6, jump >= 1 ? 12 : 9); if (L >= 4) lim(13, 40); d = `${B}：支持夥伴的${sn(S)}`; }
      else if (S === 4) { lim(L === 1 ? 8 : L === 2 ? 11 : 13, 40); d = `${B}：有對方花色擋張`; }
      else { lim(8, 40); info.len[S] = 5; d = `${B}：5 張以上${sn(S)}`; }
      return { desc: d, info };
    }
    // 再叫
    const myStrains = myPrev.map((x) => x.c.strain);
    const pStrains = pPrev.map((x) => x.c.strain);
    if (S < 4 && myStrains.includes(S)) {
      info.len[S] = myPrev[0].c.strain === S && myPrev[0].c.level === 1 && !isMajor(S) ? 5 : 6;
      d = jump >= 1 ? `${B}：跳叫再叫原花，${info.len[S]} 張以上，牌力較強` : `${B}：再叫原花色，${info.len[S]} 張以上${sn(S)}`;
      if (jump >= 1) lim(15, 40);
    } else if (S < 4 && pStrains.includes(S)) {
      info.len[S] = 3; d = `${B}：支持夥伴的${sn(S)}`;
      const iOpened = priorBids[0].s === seat;
      const strongP = pOpen && pOpen.level === 2 && pOpen.strain === 0;
      if (jump >= 1 && !strongP) { if (iOpened) lim(15, 21); else lim(10, 12); }
    } else if (S === 4) {
      info.bal = true;
      d = `${B}：平均牌型`;
      if (pOpen && pOpen.strain === 4 && pOpen.level === 1) { if (L === 2) lim(8, 9); else lim(10, 15); }
      else if (L === 1) lim(12, 14); else if (L === 2) lim(myPrev[0] && myPrev[0].i === priorBids[0].i ? 18 : 11, myPrev[0] && myPrev[0].i === priorBids[0].i ? 19 : 12);
    } else {
      info.len[S] = 4;
      d = jump >= 1 ? `${B}：跳叫新花色，強牌逼叫` : `${B}：新花色，4 張以上${sn(S)}`;
      if (jump >= 1) lim(17, 40);
    }
    // 史蒂曼回答
    if (pOpen === null && myPrev.length === 1 && myPrev[0].c.level === 1 && myPrev[0].c.strain === 4 && pPrev.length === 1 && pPrev[0].c.level === 2 && pPrev[0].c.strain === 0 && L === 2) {
      info.len = [0, 0, 0, 0]; info.bal = true;
      if (S === 1) d = '2♦：回答史蒂曼，沒有 4 張高花';
      else { info.len[S] = 4; d = `${B}：回答史蒂曼，有 4 張${sn(S)}`; }
    }
    return { desc: d, info };
  }

  function partnerInfo(auction, seat) {
    const p = partnerOf(seat);
    const agg = { min: 0, max: 40, len: [0, 0, 0, 0], bal: false, bids: 0, passedOpen: false };
    auction.calls.forEach((c, i) => {
      if (auction.seatAt(i) !== p) return;
      const a = analyzeCall(auction, i).info;
      if (c.t === 'bid') agg.bids++;
      agg.min = Math.max(agg.min, a.min);
      agg.max = Math.min(agg.max, a.max);
      if (agg.max < agg.min) agg.max = agg.min;
      for (let s = 0; s < 4; s++) agg.len[s] = Math.max(agg.len[s], a.len[s]);
      if (a.bal) agg.bal = true;
    });
    agg.est = agg.max - agg.min <= 5 ? (agg.min + agg.max) / 2 : agg.min + 1;
    return agg;
  }

  /* ---------- AI 叫牌 ---------- */
  function cheapest(auction, strain, minLevel = 1) {
    const lb = auction.lastBid();
    let lv = minLevel;
    while (lv <= 7 && lb && bidIdx(mkBid(lv, strain)) <= bidIdx(lb.call)) lv++;
    return lv <= 7 ? mkBid(lv, strain) : null;
  }
  const legalOr = (auction, c) => (c && auction.isLegal(c) ? c : null);

  function chooseBid(auction, hand) {
    const seat = auction.next;
    const r = chooseBidRaw(auction, hand, seat);
    let call = r && r.call && auction.isLegal(r.call) ? r.call : null;
    if (!call) { const g = genericBid(auction, hand, seat); call = g.call && auction.isLegal(g.call) ? g.call : PASS; return { call, why: g.why }; }
    return { call, why: r.why };
  }

  function chooseBidRaw(auction, h, seat) {
    const hcp = hcpOf(h), L = lensOf(h), bal = isBalanced(h);
    const bids = auction.calls.map((c, i) => ({ c, s: auction.seatAt(i), i })).filter((x) => x.c.t === 'bid');
    const my = bids.filter((x) => x.s === seat);
    const pb = bids.filter((x) => x.s === partnerOf(seat));
    const opp = bids.filter((x) => !sameSide(x.s, seat));
    const pDbl = auction.calls.some((c, i) => c.t === 'X' && auction.seatAt(i) === partnerOf(seat) && !pb.length);
    const myCalls = auction.callsBy(seat);
    const myActs = myCalls.filter((x) => x.c.t !== 'pass');

    if (!bids.length) return openingBid(h, auction);
    const opener = bids[0].s;
    // 回應夥伴開叫
    if (opener === partnerOf(seat) && !my.length && pb.length === 1) return responseBid(auction, h, bids[0].c);
    // 開叫者再叫
    if (opener === seat && my.length === 1 && pb.length === 1 && myCalls.length === 1) return openerRebid(auction, h, bids[0].c, pb[0].c);
    // 1NT/2♣ 後續
    if (opener === partnerOf(seat) && my.length === 1 && pb.length === 2) {
      const r = responderSecond(auction, h, bids[0].c, my[0].c, pb[1].c); if (r) return r;
    }
    // 爭叫
    if (!opp.length) return null;
    if (opener !== seat && opener !== partnerOf(seat) && !myActs.length && !pb.length && !pDbl) return overcallBid(auction, h, opp);
    if (!myActs.length && (pb.length === 1 || (pDbl && !pb.length)) && opener !== partnerOf(seat)) return advanceBid(auction, h, pb, pDbl, opp);
    return null;
  }

  function openingBid(h, auction) {
    const hcp = hcpOf(h), L = lensOf(h), bal = isBalanced(h);
    const pos = auction.calls.length; // 0..3
    const top2 = [...L].sort((a, b) => b - a);
    let open = hcp >= 12 || (hcp >= 10 && hcp + top2[0] + top2[1] >= 20);
    if (pos === 3) open = hcp + L[3] >= 15 && hcp >= 10;
    if (bal && hcp >= 15 && hcp <= 17) return { call: mkBid(1, 4), why: '15–17 點平均牌型，開叫 1NT' };
    if (bal && hcp >= 20 && hcp <= 21) return { call: mkBid(2, 4), why: '20–21 點平均牌，開叫 2NT' };
    if (hcp >= 22) return { call: mkBid(2, 0), why: '22 點以上強牌，開叫 2♣' };
    if (open) {
      if (L[2] >= 5 || L[3] >= 5) {
        const s = L[2] > L[3] ? 2 : 3;
        return { call: mkBid(1, s), why: `${hcp} 點，有 5 張以上${SUIT_NAMES[s]}，開叫一${SUIT_NAMES[s]}` };
      }
      const s = L[1] > L[0] ? 1 : L[0] > L[1] ? 0 : (L[0] === 3 ? 0 : 1);
      return { call: mkBid(1, s), why: `${hcp} 點，沒有五張高花，開叫低花 1${SUITS[s]}` };
    }
    if (pos < 3 && hcp >= 5 && hcp <= 10) {
      for (const s of [3, 2, 1, 0]) {
        const q = suitHcp(h, s);
        if (L[s] >= 8 && isMajor(s)) return { call: mkBid(4, s), why: `8 張${SUIT_NAMES[s]}，阻塞開叫` };
        if (L[s] >= 7 && q >= 3) return { call: mkBid(3, s), why: `7 張${SUIT_NAMES[s]}，阻塞開叫` };
      }
      for (const s of [3, 2, 1]) if (L[s] === 6 && suitHcp(h, s) >= 4) return { call: mkBid(2, s), why: `6 張好的${SUIT_NAMES[s]}，弱二開叫` };
    }
    return { call: PASS, why: `只有 ${hcp} 點，牌力不足開叫` };
  }

  function responseBid(auction, h, po) {
    const hcp = hcpOf(h), L = lensOf(h), bal = isBalanced(h);
    const ps = po.strain, pl = po.level;
    const lb = auction.lastBid();
    const interfered = lb.call !== po;
    const lastOppS = interfered ? lb.call.strain : -1;
    const W = (call, why) => ({ call: legalOr(auction, call), why });

    if (pl === 1 && ps === 4) {
      if (interfered) return null;
      const m = L[3] >= L[2] ? 3 : 2;
      if (L[m] >= 5) {
        if (hcp <= 7) return W(mkBid(2, m), `0–7 點有 5 張以上${SUIT_NAMES[m]}，示弱停叫`);
        if (L[m] >= 6 && hcp >= 10) return W(mkBid(4, m), `6 張${SUIT_NAMES[m]}且牌力足夠，直接進局`);
        if (hcp >= 10) return W(mkBid(3, m), `10 點以上、5 張${SUIT_NAMES[m]}，請夥伴選擇合約`);
        return W(L[m] >= 6 ? mkBid(3, m) : mkBid(2, 4), '8–9 點，邀請進局');
      }
      if ((L[2] === 4 || L[3] === 4) && hcp >= 8) return W(mkBid(2, 0), '8 點以上有 4 張高花，使用史蒂曼問叫');
      if (hcp <= 7) return L[1] >= 6 ? W(mkBid(2, 1), '牌弱但有長方塊，停在 2♦') : { call: PASS, why: `${hcp} 點，加上夥伴 15–17 點也不夠成局` };
      if (hcp <= 9) return W(mkBid(2, 4), '8–9 點，邀請 3NT');
      if (hcp <= 15) return W(mkBid(3, 4), '10–15 點，合計足夠成局 3NT');
      if (hcp <= 17) return W(mkBid(4, 4), '16–17 點，邀請滿貫');
      return W(mkBid(6, 4), '18 點以上，合計 33 點，叫滿貫');
    }
    if (pl === 2 && ps === 0) {
      if (interfered) return null;
      if (hcp >= 8) for (const s of [3, 2, 0, 1]) if (L[s] >= 5) return W(cheapest(auction, s, 2), `8 點以上有 5 張${SUIT_NAMES[s]}，積極回應`);
      return W(mkBid(2, 1), '2♦ 等待叫，讓夥伴描述牌型');
    }
    if (pl === 2 && ps === 4) {
      if (interfered) return null;
      if (hcp < 4) return { call: PASS, why: '點數太少' };
      for (const s of [3, 2]) if (L[s] >= 6) return W(mkBid(4, s), `6 張${SUIT_NAMES[s]}，進局`);
      return W(mkBid(3, 4), '合計夠成局，叫 3NT');
    }
    if (pl >= 2 && ps < 4) { // 夥伴阻塞
      const sup = L[ps];
      if (sup >= 3 && hcp >= 15 && (isMajor(ps) ? pl < 4 : pl < 5)) return W(cheapest(auction, ps, isMajor(ps) ? 4 : 5), '牌力很強又有支持，直接進局');
      if (sup >= 3 && pl === 2 && hcp >= 6 && !interfered) return W(mkBid(3, ps), '有支持，加叫阻塞對方');
      if (hcp >= 16 && bal && stopperAll(h, ps)) return W(cheapest(auction, 4, 3), '強平均牌，叫 3NT');
      return { call: PASS, why: '夥伴阻塞叫，牌力不足以進局，派司' };
    }
    // 夥伴開叫一線花色
    if (hcp < 6) return { call: PASS, why: `只有 ${hcp} 點，派司` };
    const sup = L[ps];
    const dpts = hcp + shortPts(h, ps, L[ps] < 4);
    if (isMajor(ps) && sup >= 3) {
      if (dpts >= 13) return W(cheapest(auction, ps, 4), `支持夥伴${SUIT_NAMES[ps]}，${dpts} 支持點，直接進局`);
      if (dpts >= 10) return W(cheapest(auction, ps, 3), `支持${SUIT_NAMES[ps]}，10–12 點，跳加邀請`);
      return W(cheapest(auction, ps, 2), `支持${SUIT_NAMES[ps]}，6–9 點，單加`);
    }
    // 一線新花
    const oneLevel = [];
    if (ps === 0 && L[1] >= 4 && L[1] > Math.max(L[2], L[3]) && hcp < 13) oneLevel.push(1);
    if (L[2] >= 4 && L[3] >= 4) oneLevel.push(L[3] > L[2] ? 3 : 2);
    else { if (L[3] >= 4) oneLevel.push(3); if (L[2] >= 4) oneLevel.push(2); }
    for (const s of oneLevel) {
      if (s > ps && s !== lastOppS) {
        const c = mkBid(1, s);
        if (auction.isLegal(c)) return { call: c, why: `${hcp} 點，4 張以上${SUIT_NAMES[s]}，一線叫新花色` };
      }
    }
    if (!isMajor(ps) && sup >= (ps === 1 ? 4 : 5) && !bal) {
      if (hcp <= 9) return W(cheapest(auction, ps, 2), `支持夥伴${SUIT_NAMES[ps]}，6–9 點`);
      if (hcp <= 12) return W(cheapest(auction, ps, 3), '支持夥伴低花，10–12 點邀請');
    }
    if (hcp >= 10) {
      let best = -1;
      for (const s of [3, 2, 1, 0]) if (s !== ps && s !== lastOppS && L[s] >= (s === 2 && ps === 3 ? 5 : 4) && (best < 0 || L[s] > L[best])) best = s;
      if (best >= 0 && !(bal && hcp >= 13 && !isMajor(best))) {
        const c = cheapest(auction, best, 1);
        if (c && c.level <= 2) return { call: c, why: `${hcp} 點，${L[best]} 張${SUIT_NAMES[best]}，叫新花色（逼叫）` };
      }
    }
    const stopOk = !interfered || stopper(h, lastOppS);
    if (bal && hcp >= 13 && hcp <= 15 && stopOk) return W(cheapest(auction, 4, 3), '13–15 點平均牌，直接 3NT');
    if (bal && hcp >= 11 && hcp <= 12 && stopOk) return W(cheapest(auction, 4, 2), '11–12 點平均牌，2NT 邀請');
    if (hcp <= 10 && stopOk) { const c = mkBid(1, 4); if (auction.isLegal(c)) return { call: c, why: '6–10 點，沒有適合的花色，叫 1NT' }; }
    if (sup >= 3 && hcp <= 10) return W(cheapest(auction, ps, 2), '有一些支持，簡單加叫');
    return null;
  }
  function stopperAll(h, except) { return [0, 1, 2, 3].every((s) => s === except || stopper(h, s)); }

  function openerRebid(auction, h, myOpen, pResp) {
    const hcp = hcpOf(h), L = lensOf(h), bal = isBalanced(h);
    const ms = myOpen.strain, rs = pResp.strain, rl = pResp.level;
    const W = (call, why) => ({ call: legalOr(auction, call), why });
    if (myOpen.level === 1 && ms === 4) { // 1NT 開叫者
      if (rl === 2 && rs === 0) {
        if (L[2] >= 4) return W(mkBid(2, 2), '回答史蒂曼：有 4 張紅心');
        if (L[3] >= 4) return W(mkBid(2, 3), '回答史蒂曼：有 4 張黑桃');
        return W(mkBid(2, 1), '回答史蒂曼：沒有 4 張高花');
      }
      if (rl === 2 && rs === 4) return hcp >= 16 ? W(mkBid(3, 4), '高限 16–17 點，接受邀請') : { call: PASS, why: '低限 15 點，拒絕邀請' };
      if (rl === 3 && isMajor(rs)) return L[rs] >= 3 ? W(mkBid(4, rs), `有 3 張${SUIT_NAMES[rs]}支持，進局`) : W(mkBid(3, 4), '支持不足，選擇 3NT');
      if (rl === 4 && rs === 4) return hcp >= 17 ? W(mkBid(6, 4), '高限，接受滿貫邀請') : { call: PASS, why: '低限，停在 4NT' };
      return { call: PASS, why: '夥伴已決定合約，派司' };
    }
    if (myOpen.level === 2 && ms === 0) { // 2♣
      if (bal && hcp <= 24) return W(cheapest(auction, 4, 2), '22–24 點平均牌，叫 2NT');
      let best = 3; for (const s of [3, 2, 1, 0]) if (L[s] > L[best]) best = s;
      return W(cheapest(auction, best, 2), `描述最長的${SUIT_NAMES[best]}`);
    }
    if (myOpen.level >= 2) return { call: PASS, why: '已經描述過牌力，派司' };
    // 一線花色開叫者
    if (rs === ms) { // 被加叫
      const pts = hcp + shortPts(h, ms, true);
      if (rl === 2) {
        if (isMajor(ms)) { if (pts >= 19) return W(cheapest(auction, ms, 4), '牌力強，直接進局'); if (pts >= 16) return W(cheapest(auction, ms, 3), '中等牌力，邀請進局'); }
        else if (hcp >= 18 && stopperAll(h, ms)) return W(cheapest(auction, 4, 3), '強牌，試 3NT');
        return { call: PASS, why: '低限開叫，夥伴只是單加，停在部分合約' };
      }
      if (rl === 3) {
        if (isMajor(ms) && pts >= 14) return W(mkBid(4, ms), '接受夥伴邀請，進局');
        if (!isMajor(ms) && hcp >= 14 && stopperAll(h, ms)) return W(mkBid(3, 4), '各門有擋張，叫 3NT');
        return { call: PASS, why: '低限，拒絕邀請' };
      }
      return { call: PASS, why: '夥伴已進局' };
    }
    if (rs === 4) {
      if (rl === 1) {
        if (bal && hcp >= 18) return W(mkBid(3, 4), '18–19 點，加上夥伴牌力足以成局');
        for (const s of [3, 2, 1, 0]) if (L[s] >= 6) return W(cheapest(auction, s, hcp >= 16 ? 3 : 2), `${L[s]} 張${SUIT_NAMES[s]}，再叫原花`);
        for (const s of [1, 0]) if (s < ms && L[s] >= 4) return W(cheapest(auction, s, 2), `再叫第二套${SUIT_NAMES[s]}`);
        return { call: PASS, why: '低限平均，1NT 合約不錯' };
      }
      if (rl === 2) { if (hcp >= 13) return W(mkBid(3, 4), '高於低限，叫 3NT'); if (L[ms] >= 6 && isMajor(ms)) return W(mkBid(3, ms), '6 張高花，叫回原花'); return { call: PASS, why: '低限，派司' }; }
      if (L[ms] >= 6 && isMajor(ms)) return W(mkBid(4, ms), '6 張高花，改叫 4 線');
      return { call: PASS, why: '夥伴已叫成局' };
    }
    if (rl >= 4) return { call: PASS, why: '夥伴已叫成局' };
    // 夥伴叫新花（逼叫）
    if (rs < 4 && L[rs] >= 4 && (isMajor(rs) || L[rs] >= 5)) {
      const pts = hcp + shortPts(h, rs, true);
      if (pts >= 19) return W(cheapest(auction, rs, isMajor(rs) ? 4 : 5), `支持夥伴${SUIT_NAMES[rs]}，牌力強，直接進局`);
      if (pts >= 16) { const c = cheapest(auction, rs, 1); return W(c && mkBid(c.level + 1, rs), `支持${SUIT_NAMES[rs]}，跳加邀請`); }
      return W(cheapest(auction, rs, 1), `4 張${SUIT_NAMES[rs]}支持，加叫夥伴`);
    }
    if (L[ms] >= 6) { const c = cheapest(auction, ms, 1); return W(hcp >= 16 && c ? mkBid(c.level + 1, ms) : c, `${L[ms]} 張${SUIT_NAMES[ms]}，再叫原花色`); }
    for (const s of [3, 2]) if (s !== ms && s !== rs && L[s] >= 4) { const c = mkBid(1, s); if (auction.isLegal(c)) return { call: c, why: `一線叫出 4 張${SUIT_NAMES[s]}` }; }
    if (bal) {
      if (rl === 1 && hcp <= 14) return W(cheapest(auction, 4, 1), '12–14 點平均牌，再叫 1NT');
      if (rl === 2 && hcp <= 14) return W(cheapest(auction, 4, 2), '平均牌，叫 2NT');
      if (hcp >= 18) return W(cheapest(auction, 4, rl === 1 ? 2 : 3), '18–19 點平均牌，跳叫 NT');
    }
    for (const s of [3, 2, 1, 0]) if (s !== ms && s !== rs && L[s] >= 4 && (s < ms || hcp >= 16)) {
      const c = cheapest(auction, s, 1);
      if (c && c.level <= 2) return { call: c, why: `再叫第二套花色${SUIT_NAMES[s]}` };
    }
    if (L[rs] >= 3 && rs < 4) return W(cheapest(auction, rs, 1), `3 張${SUIT_NAMES[rs]}，暫時加叫`);
    return W(cheapest(auction, ms, 1), '再叫原花色');
  }

  function responderSecond(auction, h, po, myFirst, pRebid) {
    const hcp = hcpOf(h), L = lensOf(h);
    const W = (call, why) => ({ call: legalOr(auction, call), why });
    if (po.level === 1 && po.strain === 4 && myFirst.level === 2 && myFirst.strain === 0) { // 史蒂曼後續
      const rs = pRebid.strain;
      if (isMajor(rs) && L[rs] >= 4) return hcp >= 10 ? W(mkBid(4, rs), '找到 4-4 高花配合，進局') : W(mkBid(3, rs), '高花配合，8–9 點邀請');
      if (rs === 2 && L[3] >= 4) return hcp >= 10 ? W(mkBid(3, 4), '沒有配合，叫 3NT') : W(mkBid(2, 4), '沒有配合，2NT 邀請');
      return hcp >= 10 ? W(cheapest(auction, 4, 3), '沒有高花配合，叫 3NT') : W(cheapest(auction, 4, 2), '沒有高花配合，2NT 邀請');
    }
    if (po.level === 2 && po.strain === 0 && myFirst.level === 2 && myFirst.strain === 1) { // 2♣-2♦ 後
      const rs = pRebid.strain;
      if (rs === 4) return hcp >= 3 ? W(mkBid(3, 4), '合計足夠成局') : { call: PASS, why: '牌力太弱' };
      if (L[rs] >= 3) return W(cheapest(auction, rs, isMajor(rs) ? 4 : 5), `支持夥伴${SUIT_NAMES[rs]}，進局`);
      for (const s of [3, 2, 1, 0]) if (s !== rs && L[s] >= 5 && hcp >= 4) return W(cheapest(auction, s, 2), `5 張${SUIT_NAMES[s]}`);
      return W(cheapest(auction, 4, 2), '沒有配合，叫無王');
    }
    return null;
  }

  function overcallBid(auction, h, opp) {
    const hcp = hcpOf(h), L = lensOf(h), bal = isBalanced(h);
    const oppS = new Set(opp.map((x) => x.c.strain));
    const lb = auction.lastBid();
    const balancing = auction.calls.length >= 3 && auction.calls.slice(-2).every((c) => c.t === 'pass');
    const adj = balancing ? 3 : 0;
    const ls = lb.call.strain;
    if (bal && hcp >= 15 - adj && hcp <= 18 && (ls === 4 || stopper(h, ls))) {
      const c = cheapest(auction, 4, 1);
      if (c && c.level === 1) return { call: c, why: '15–18 點平均牌，有擋張，1NT 爭叫' };
    }
    let best = -1;
    for (const s of [3, 2, 1, 0]) if (!oppS.has(s) && L[s] >= 5 && (suitHcp(h, s) >= 3 || L[s] >= 6) && (best < 0 || L[s] > L[best])) best = s;
    if (best >= 0) {
      const c = cheapest(auction, best, 1);
      if (c && c.level <= 3) {
        if (hcp <= 10 && hcp >= 5 && L[best] >= 6 && c.level <= 2 && !balancing) {
          const j = mkBid(c.level + 1, best);
          return { call: j, why: `弱牌但有 6 張${SUIT_NAMES[best]}，弱跳爭叫` };
        }
        const need = c.level === 1 ? 8 : c.level === 2 ? (L[best] >= 6 ? 10 : 11) : 13;
        if (hcp >= need - adj && hcp <= 17) return { call: c, why: `${hcp} 點，${L[best]} 張${SUIT_NAMES[best]}，爭叫` };
      }
    }
    if (lb.call.level <= 2 && ls < 4 && auction.isLegal(DBL)) {
      const unbid = [0, 1, 2, 3].filter((s) => !oppS.has(s));
      const shape = L[ls] <= 2 && unbid.every((s) => L[s] >= 3);
      if ((hcp >= 12 - adj && shape) || hcp >= 18) return { call: DBL, why: `${hcp} 點，${SUIT_NAMES[ls]}短，技術性賭倍` };
    }
    return { call: PASS, why: '沒有適合的爭叫，派司' };
  }

  function advanceBid(auction, h, pb, pDbl, opp) {
    const hcp = hcpOf(h), L = lensOf(h);
    const oppS = new Set(opp.map((x) => x.c.strain));
    const lb = auction.lastBid();
    const rhoActed = !sameSide(lb.seat, auction.next) && lb.seat === (auction.next + 3) % 4 && pDbl && !pb.length && auction.calls[auction.calls.length - 1].t === 'bid';
    if (pDbl && !pb.length) {
      if (rhoActed && hcp <= 5) return { call: PASS, why: '對方已經叫牌，牌弱就派司' };
      let best = -1;
      for (const s of [3, 2, 1, 0]) if (!oppS.has(s) && (best < 0 || L[s] > L[best] || (L[s] === L[best] && isMajor(s) && !isMajor(best)))) best = s;
      const ls = lb.call.strain;
      if (hcp >= 12) {
        if (isMajor(best) && L[best] >= 4) return { call: cheapest(auction, best, 4), why: '牌力足夠，直接進局' };
        if (ls < 4 && stopper(h, ls)) return { call: cheapest(auction, 4, 3), why: '有擋張，叫 3NT' };
      }
      if (hcp >= 6 && hcp <= 9 && L[best] < 4 && ls < 4 && stopper(h, ls)) { const c = cheapest(auction, 4, 1); if (c && c.level === 1) return { call: c, why: '6–9 點有擋張，叫 1NT' }; }
      const c = cheapest(auction, best, 1);
      if (!c || c.level > 3) return { call: PASS, why: '' };
      if (hcp >= 9 && c.level <= 2) return { call: mkBid(c.level + 1, best), why: `9–11 點，跳叫${SUIT_NAMES[best]}` };
      return { call: c, why: `回應夥伴的賭倍，叫最長的${SUIT_NAMES[best]}` };
    }
    const ps = pb[0].c.strain;
    if (ps < 4 && L[ps] >= 3) {
      const P = partnerInfo(auction, auction.next);
      const pts = hcp + shortPts(h, ps, L[ps] < 4);
      const total = pts + P.est;
      const c = cheapest(auction, ps, 1);
      const gl = isMajor(ps) ? 4 : 5;
      if (c && total >= (isMajor(ps) ? 25 : 29) && c.level <= gl) return { call: mkBid(gl, ps), why: `支持夥伴${SUIT_NAMES[ps]}，合計牌力足以成局` };
      if (c && total >= 22 && c.level <= 3) return { call: mkBid(3, ps), why: '支持夥伴，加叫到三線' };
      const lott = L[ps] + Math.max(P.len[ps], 5) - 6;
      if (c && pts >= 6 && c.level <= Math.min(3, lott)) return { call: c, why: `支持夥伴${SUIT_NAMES[ps]}，加叫競爭` };
    }
    const ls = lb.call.strain;
    if (hcp >= 8 && ls < 4 && stopper(h, ls)) {
      const c = cheapest(auction, 4, hcp >= 13 ? 3 : 1);
      if (c && (c.level <= 2 || hcp >= 13)) return { call: c, why: '有對方花色擋張，叫無王' };
    }
    for (const s of [3, 2, 1, 0]) if (!oppS.has(s) && s !== ps && L[s] >= 5 && hcp >= 8) { const c = cheapest(auction, s, 1); if (c && c.level <= 2) return { call: c, why: `叫出 5 張${SUIT_NAMES[s]}` }; }
    return { call: PASS, why: '牌力不足，派司' };
  }

  function genericBid(auction, h, seat) {
    const hcp = hcpOf(h), L = lensOf(h), bal = isBalanced(h);
    const P = partnerInfo(auction, seat);
    const lb = auction.lastBid();
    const ourContract = lb && sameSide(lb.seat, seat);
    // 找配合
    let fit = -1, fitLen = 0;
    for (const s of [3, 2, 1, 0]) {
      const t = L[s] + P.len[s];
      if (P.len[s] > 0 || L[s] >= 6) {
        const tt = P.len[s] > 0 ? t : L[s] + 2;
        if (tt >= 8 && (tt > fitLen + (isMajor(s) ? 0 : 1) || fit < 0)) { fit = s; fitLen = tt; }
      }
    }
    let strain;
    if (fit >= 0 && (isMajor(fit) || !(bal || P.bal))) strain = fit;
    else if (fit >= 0 && !isMajor(fit)) strain = 4;
    else strain = 4;
    const myPts = strain < 4 ? hcp + (L[strain] >= 3 && P.len[strain] >= 4 ? shortPts(h, strain, L[strain] < 4) : lenPts(h)) : hcp;
    const total = myPts + P.est;
    const hcpTotal = hcp + P.est;
    let target;
    if (total >= 37 && hcpTotal >= 35) target = 7; else if (total >= 33 && hcpTotal >= 31) target = 6;
    else if (strain === 4) target = total >= 25 ? 3 : total >= 23 ? 2 : 1;
    else if (isMajor(strain)) target = total >= 25 ? 4 : total >= 22 ? 3 : 2;
    else { if (total >= 25 && total < 29) { strain = 4; target = 3; } else target = total >= 29 ? 5 : total >= 22 ? 3 : 2; }

    if (!lb) return { call: PASS, why: '' };
    if (ourContract) {
      if (lb.seat === seat) return { call: PASS, why: '我已表達牌力，派司' };
      const cur = lb.call;
      const gameLevel = (st) => (st === 4 ? 3 : isMajor(st) ? 4 : 5);
      if (cur.strain === strain && cur.level >= target) return { call: PASS, why: '夥伴的合約剛好，派司' };
      if (cur.level >= gameLevel(cur.strain) && target < 6) return { call: PASS, why: '已經成局，派司' };
      if (cur.strain < 4 && cur.strain !== strain && L[cur.strain] >= 2 && target <= cur.level + (cur.strain === 4 ? 0 : 0) && total < 25) return { call: PASS, why: '牌力有限，接受夥伴的合約' };
      const c = cheapest(auction, strain, Math.min(target, 7));
      if (c && c.level <= target) return { call: c, why: `合計約 ${Math.round(total)} 點，目標 ${target}${STRAINS[strain]}` };
      return { call: PASS, why: '派司' };
    }
    // 對方擁有合約：競爭或賭倍
    const st = auction.dblState();
    const oppLevel = lb.call.level;
    if (fit >= 0 && P.bids + (auction.callsBy(seat).some((x) => x.c.t === 'bid') ? 1 : 0) > 0) {
      const lott = fitLen - 6;
      const c = cheapest(auction, strain === 4 ? fit : strain, 1);
      const tLv = strain === 4 ? target : target;
      if (c && (c.level <= tLv || (c.level <= lott && c.level <= 3))) return { call: c, why: `我方有 ${fitLen} 張配合，競叫` };
    }
    const oppStrain = lb.call.strain;
    const trumpsHeld = oppStrain < 4 ? L[oppStrain] : 0;
    if (st === 0 && auction.isLegal(DBL)) {
      const ptsTot = hcp + P.est;
      if ((oppLevel >= 3 && ptsTot >= 23 && (oppStrain === 4 ? hcp >= 10 : trumpsHeld >= 3 && suitHcp(h, oppStrain) >= 3)) || (oppLevel >= 2 && trumpsHeld >= 5 && hcp >= 10 && P.bids > 0))
        return { call: DBL, why: '我方牌力佔優勢，懲罰性賭倍' };
    }
    return { call: PASS, why: '派司' };
  }

  /* ---------- 打牌 ---------- */
  function trickWinner(trick, trump) {
    // trick: [{seat, card}], 第一張為首引
    let w = trick[0];
    for (const t of trick.slice(1)) {
      const a = w.card, b = t.card;
      if (b.s === a.s && b.r > a.r) w = t;
      else if (trump < 4 && b.s === trump && a.s !== trump) w = t;
    }
    return w;
  }
  function legalCards(hand, trick) {
    if (!trick.length) return hand.slice();
    const led = trick[0].card.s;
    const f = hand.filter((c) => c.s === led);
    return f.length ? f : hand.slice();
  }

  /* 打牌 AI。game: {hands, trick, trump, declarer, dummyShown, played:Set, history:[tricks], contract, auction} */
  function chooseCard(g, seat) {
    const hand = g.hands[seat];
    const legal = legalCards(hand, g.trick);
    if (legal.length === 1) return { card: legal[0], why: '只有這張可以出' };
    const trump = g.trump;
    const dummy = partnerOf(g.declarer);
    const isDecl = seat === g.declarer || seat === dummy;
    const visible = new Set();
    const key = (c) => c.s * 100 + c.r;
    hand.forEach((c) => visible.add(key(c)));
    if (g.dummyShown) g.hands[dummy].forEach((c) => visible.add(key(c)));
    if (seat === dummy) g.hands[g.declarer].forEach((c) => visible.add(key(c)));
    const partnerHandVisible = isDecl ? g.hands[partnerOf(seat)] : (partnerOf(seat) === dummy && g.dummyShown ? g.hands[dummy] : null);
    const unseen = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) { const k = s * 100 + r; if (!visible.has(k) && !g.played.has(k)) unseen.push({ s, r }); }
    // 本墩已出的牌視為已出
    g.trick.forEach((t) => { const i = unseen.findIndex((u) => cardEq(u, t.card)); if (i >= 0) unseen.splice(i, 1); });
    const isMaster = (c) => !unseen.some((u) => u.s === c.s && u.r > c.r) && !(isDecl ? [] : (g.dummyShown && seat !== dummy ? g.hands[dummy] : [])).some((u) => u.s === c.s && u.r > c.r);
    const lowest = (cs) => cs.reduce((a, b) => (b.r < a.r ? b : a));
    const highest = (cs) => cs.reduce((a, b) => (b.r > a.r ? b : a));
    const bySuit = (cs, s) => cs.filter((c) => c.s === s).sort((a, b) => b.r - a.r);

    function discard(cs) {
      const nonT = cs.filter((c) => c.s !== trump);
      const pool = nonT.length ? nonT : cs;
      const nonMaster = pool.filter((c) => !isMaster(c));
      const p2 = nonMaster.length ? nonMaster : pool;
      const Ls = lensOf(hand);
      return p2.reduce((a, b) => (b.r < a.r || (b.r === a.r && Ls[b.s] > Ls[a.s]) ? b : a));
    }
    function leadFromSuit(cs) {
      if (cs.length === 1) return cs[0];
      if (cs[0].r >= 10 && cs[1].r === cs[0].r - 1) return cs[0];
      if (cs.length === 2) return cs[0];
      if (cs.length >= 4) return cs[3];
      return cs[0].r >= 11 ? cs[cs.length - 1] : cs[0];
    }

    if (!g.trick.length) { // 首引
      const firstLead = g.history.length === 0;
      const ls = lensOf(hand);
      if (!isDecl) {
        const pBids = g.auction.callsBy(partnerOf(seat)).filter((x) => x.c.t === 'bid' && x.c.strain < 4 && x.c.strain !== trump).map((x) => x.c.strain);
        if (firstLead) {
          for (const s of pBids) if (ls[s]) return { card: leadFromSuit(bySuit(hand, s)), why: `首引夥伴叫過的${SUIT_NAMES[s]}` };
          for (let s = 0; s < 4; s++) if (s !== trump && has(hand, s, 14) && has(hand, s, 13)) return { card: { s, r: 14 }, why: '首引 A（持有 AK）' };
          for (let s = 3; s >= 0; s--) { const cs = bySuit(hand, s); if (s !== trump && cs.length >= 3 && cs[0].r >= 12 && cs[1].r === cs[0].r - 1) return { card: cs[0], why: '首引連張大牌的頂張' }; }
          if (trump < 4 && ls[trump] >= 1 && ls[trump] <= 3) for (let s = 0; s < 4; s++) if (s !== trump && ls[s] === 1 && hand.find((c) => c.s === s).r < 13) return { card: hand.find((c) => c.s === s), why: '首引單張，希望之後王吃' };
          let best = -1, bestScore = -99;
          for (let s = 0; s < 4; s++) {
            if (!ls[s] || (s === trump && ls[s] < hand.length)) continue;
            let sc = ls[s] * 2 + suitHcp(hand, s) * 0.3;
            if (trump < 4 && has(hand, s, 14) && !has(hand, s, 13)) sc -= 6;
            if (g.auction.calls.some((c, i) => c.t === 'bid' && c.strain === s && !sameSide(g.auction.seatAt(i), seat))) sc -= 4;
            if (sc > bestScore) { bestScore = sc; best = s; }
          }
          if (best < 0) best = hand[0].s;
          return { card: leadFromSuit(bySuit(hand, best)), why: trump === 4 ? `無王首引最長的${SUIT_NAMES[best]}（第四張）` : `首引${SUIT_NAMES[best]}` };
        }
        // 防守後續首攻
        const pLeads = g.history.filter((t) => t[0].seat === partnerOf(seat)).map((t) => t[0].card.s);
        for (const s of pLeads) if (ls[s] && s !== trump) { const cs = bySuit(hand, s); return { card: cs.length <= 2 ? cs[0] : cs[cs.length - 1], why: `回攻夥伴的${SUIT_NAMES[s]}` }; }
        const masters = legal.filter((c) => isMaster(c) && c.s !== trump);
        if (masters.length) return { card: highest(masters), why: '兌現大牌贏墩' };
        let best = -1;
        for (let s = 0; s < 4; s++) if (ls[s] && s !== trump && (best < 0 || ls[s] > ls[best])) best = s;
        if (best < 0) best = hand[0].s;
        return { card: leadFromSuit(bySuit(hand, best)), why: `出${SUIT_NAMES[best]}` };
      }
      // 主打方首攻
      const ph = g.hands[partnerOf(seat)];
      if (trump < 4) {
        const oppTrumps = unseen.filter((c) => c.s === trump).length;
        const ourT = hand.filter((c) => c.s === trump).length + ph.filter((c) => c.s === trump).length;
        if (oppTrumps > 0 && ourT > oppTrumps) {
          const mt = hand.filter((c) => c.s === trump && isMaster(c));
          if (mt.length) return { card: highest(mt), why: '清王牌' };
          const myT = bySuit(hand, trump);
          if (myT.length && ph.some((c) => c.s === trump && isMaster(c))) return { card: myT[myT.length - 1], why: '出小王牌，清王' };
        }
        if (seat === g.declarer && ph.some((c) => c.s === trump)) {
          for (let s = 0; s < 4; s++) {
            if (s === trump || ph.some((c) => c.s === s)) continue;
            const mine = bySuit(hand, s).filter((c) => !isMaster(c));
            if (mine.length) return { card: lowest(mine), why: '出夢家缺門的花色，讓夢家王吃' };
          }
        }
      }
      const lsH = lensOf(hand), lsP = lensOf(ph);
      if (trump === 4 && g.history.length < 8) {
        // 無王：先樹立雙手合計最長的花色
        const tricksNeed = g.contract.level + 6 - g.history.filter((t) => sameSide(trickWinner(t, trump).seat, seat)).length;
        let sure = 0;
        for (let s = 0; s < 4; s++) {
          const both = hand.concat(ph).filter((c) => c.s === s).sort((x, y) => y.r - x.r);
          let k = 0; const unS = unseen.filter((u) => u.s === s).sort((x, y) => y.r - x.r);
          while (k < both.length && (!unS.length || both[k].r > unS[0].r)) k++;
          sure += Math.min(k, Math.max(lsH[s], lsP[s]));
        }
        if (sure < tricksNeed) {
          let ls = -1;
          for (let s = 0; s < 4; s++) if (lsH[s] && (ls < 0 || lsH[s] + lsP[s] > lsH[ls] + lsP[ls])) ls = s;
          if (ls >= 0 && lsH[ls] + lsP[ls] >= 7) {
            const mine = bySuit(hand, ls);
            const pm = bySuit(ph, ls);
            const m = mine.filter(isMaster);
            if (m.length && (lsH[ls] <= lsP[ls] || !pm.some(isMaster))) return { card: m[0], why: '先兌現長門的大牌' };
            return { card: mine[mine.length - 1], why: '樹立長門' };
          }
        }
      }
      const masters = legal.filter((c) => isMaster(c) && (trump === 4 || c.s !== trump));
      if (masters.length) {
        // 從短的一手先出大牌（解封）
        masters.sort((a, b) => (hand.filter((c) => c.s === a.s).length - ph.filter((c) => c.s === a.s).length) - (hand.filter((c) => c.s === b.s).length - ph.filter((c) => c.s === b.s).length) || b.r - a.r);
        return { card: masters[0], why: '兌現大牌' };
      }
      for (let s = 0; s < 4; s++) if (s !== trump && ph.some((c) => c.s === s && isMaster(c)) && hand.some((c) => c.s === s)) return { card: lowest(bySuit(hand, s)), why: '出小牌到夥伴的大牌' };
      const ls2 = lensOf(hand), lp = lensOf(ph);
      let best = -1;
      for (let s = 0; s < 4; s++) {
        if (!ls2[s]) continue;
        const sc = ls2[s] + lp[s] - (s === trump ? 20 : 0);
        if (best < 0 || sc > ls2[best] + lp[best] - (best === trump ? 20 : 0)) best = s;
      }
      return { card: lowest(bySuit(hand, best)), why: '建立長門' };
    }

    // 跟牌
    const pos = g.trick.length;
    const win = trickWinner(g.trick, trump);
    const partnerWinning = win.seat === partnerOf(seat);
    const led = g.trick[0].card.s;
    const canFollow = hand.some((c) => c.s === led);
    const beats = (c) => trickWinner(g.trick.concat([{ seat, card: c }]), trump).seat === seat;
    const winners = legal.filter(beats);
    const secure = partnerWinning && (pos === 3 || isMaster(win.card) || (win.card.s === trump && led !== trump && trump < 4));
    if (canFollow) {
      if (secure) return { card: lowest(legal), why: '夥伴已贏，墊小牌' };
      if (pos === 1) {
        // 第二家出小，但若手中大牌可確定贏墩且第四家為可見夢家、不能蓋過時就拿
        const masterWin = winners.filter(isMaster);
        if (masterWin.length && led !== trump && (g.history.length > 6 || win.card.r >= 11)) return { card: lowest(masterWin), why: '用大牌拿下這墩' };
        return { card: lowest(legal), why: '第二家出小牌' };
      }
      if (winners.length) {
        if (pos === 2) {
          // 若第四家是可見的夢家，確保贏過夢家
          const fourth = (seat + 1) % 4;
          const fourthVis = g.dummyShown && fourth === dummy ? g.hands[dummy] : null;
          if (fourthVis) {
            const ok = winners.filter((c) => !fourthVis.some((d) => (d.s === c.s && d.r > c.r) || (trump < 4 && !fourthVis.some((x) => x.s === led) && d.s === trump && c.s !== trump)));
            if (ok.length) return { card: lowest(ok), why: '第三家出夠大的牌' };
            if (partnerWinning) return { card: lowest(legal), why: '墊小牌' };
          }
          return { card: lowest(winners), why: '第三家出大牌' };
        }
        return { card: lowest(winners), why: '用最小的牌贏下這墩' };
      }
      return { card: lowest(legal), why: '贏不了，出小牌' };
    }
    if (secure) return { card: discard(legal), why: '夥伴已贏，墊牌' };
    if (trump < 4) {
      const ts = legal.filter((c) => c.s === trump && beats(c));
      if (ts.length) return { card: lowest(ts), why: '缺門，用王牌王吃！' };
    }
    return { card: discard(legal), why: '缺門，墊掉沒用的牌' };
  }

  /* ---------- 計分 ---------- */
  const VUL_TABLE = ['none', 'ns', 'ew', 'both', 'ns', 'ew', 'both', 'none', 'ew', 'both', 'none', 'ns', 'both', 'none', 'ns', 'ew'];
  const boardVul = (n) => VUL_TABLE[(n - 1) % 16];
  const boardDealer = (n) => (n - 1) % 4;
  const isVul = (vul, seat) => vul === 'both' || (vul === 'ns' && seat % 2 === 0) || (vul === 'ew' && seat % 2 === 1);

  function score(contract, tricks, vul) {
    // 回傳主打方得分（負數代表失分）與明細
    const { level, strain, dbl } = contract;
    const v = vul;
    const need = level + 6;
    const det = [];
    if (tricks >= need) {
      const per = strain <= 1 ? 20 : 30;
      let base = strain === 4 ? 40 + (level - 1) * 30 : level * per;
      const mult = dbl === 2 ? 4 : dbl === 1 ? 2 : 1;
      base *= mult;
      let s = base; det.push(`合約墩分 ${base}`);
      if (base >= 100) { const b = v ? 500 : 300; s += b; det.push(`成局獎分 ${b}`); }
      else { s += 50; det.push('部分合約獎分 50'); }
      if (level === 6) { const b = v ? 750 : 500; s += b; det.push(`小滿貫獎分 ${b}`); }
      if (level === 7) { const b = v ? 1500 : 1000; s += b; det.push(`大滿貫獎分 ${b}`); }
      if (dbl) { const b = dbl === 2 ? 100 : 50; s += b; det.push(`${dbl === 2 ? '再' : ''}賭倍完成獎分 ${b}`); }
      const over = tricks - need;
      if (over > 0) {
        const op = dbl ? (v ? 200 : 100) * (dbl === 2 ? 2 : 1) : (strain === 4 ? 30 : per);
        s += over * op; det.push(`超額 ${over} 墩 ${over * op}`);
      }
      return { score: s, det, made: true, diff: over };
    }
    const down = need - tricks;
    let pen = 0;
    if (!dbl) pen = down * (v ? 100 : 50);
    else {
      for (let i = 1; i <= down; i++) {
        if (v) pen += i === 1 ? 200 : 300;
        else pen += i === 1 ? 100 : i <= 3 ? 200 : 300;
      }
      if (dbl === 2) pen *= 2;
    }
    det.push(`倒 ${down} 墩，罰分 ${pen}`);
    return { score: -pen, det, made: false, diff: -down };
  }

  global.Bridge = {
    SUITS, STRAINS, SUIT_NAMES, SEAT_NAMES, rankStr, partnerOf, sameSide, isMajor,
    deal, sortHand, cardStr, cardEq, hcpOf, lensOf, isBalanced,
    Auction, mkBid, PASS, DBL, RDBL, bidIdx, callStr, callSpeech, analyzeCall, chooseBid,
    trickWinner, legalCards, chooseCard,
    boardVul, boardDealer, isVul, score,
  };
})(typeof window !== 'undefined' ? window : globalThis);
