(function(){
  "use strict";

  /* =========================================================
     1. PARSE RAW DATA INTO ROW OBJECTS
     ========================================================= */
  const COLS = ["date","time","sender","asvasam","poemNo","message","messageNo","refNo","refSender","topic1","meaning","bhavam"];
  const rawRows = firdowsi.slice(1).map(r => {
    const o = {};
    COLS.forEach((c,i)=> o[c] = r[i]);
    return o;
  });

  function normTopic(t){
    return (t||"").replace(/\s+/g," ").trim();
  }
  const TOPIC_TELUGU = "22. ఫిరదౌసి";
  const TOPIC_SANSKRIT = "27. ఫిరదౌసి సంస్కృతం";

  function dayKey(dateIso){
    return (dateIso||"").slice(0,10);
  }

  function fmtDate(dateIso, timeIso){
    try{
      const d = new Date(dateIso);
      const t = new Date(timeIso);
      const dd = d.toLocaleDateString("te-IN", {day:"numeric", month:"short", year:"numeric", timeZone:"UTC"});
      let hh = t.getUTCHours(), mm = t.getUTCMinutes();
      const ampm = hh >= 12 ? "PM" : "AM";
      hh = hh % 12; if(hh===0) hh = 12;
      const mmStr = mm.toString().padStart(2,"0");
      return dd + " · " + hh + ":" + mmStr + " " + ampm;
    }catch(e){ return ""; }
  }

  function stripTrailingNumber(text){
    const t = (text || "").trim();
    if(!t) return {text:t, num:null};
    const m = t.match(/[॥।|\s]*["'\u201d\u2019]*\s*(\d+)\s*[॥।|\s]*["'\u201d\u2019]*\s*$/);
    if(!m) return {text:t, num:null};
    return {text: t.slice(0, m.index).trim(), num: m[1]};
  }

  /* =========================================================
     Generic reply-tree helper
     - a row with refNo attaches directly under the row whose
       messageNo === refNo (single direct lookup, no chain-walking)
     - a row with no refNo (or an unresolved refNo) attaches to the
       end of its own day: the last anchor row on the same date,
       or the last anchor on the most recent earlier date.
     ========================================================= */
  function buildReplyIndex(rows, isAnchor, anchorAttachKey){
    const byMsgNo = new Map(rows.map(r => [r.messageNo, r]));
    const anchors = rows.filter(isAnchor).sort((a,b)=> a.messageNo - b.messageNo);
    function lastAnchorAtOrBefore(dk){
      let best = null;
      for(const a of anchors){
        if(dayKey(a.date) <= dk) best = a; else break;
      }
      return best;
    }
    const childrenOf = new Map();
    function addChild(parentMsgNo, row){
      if(!childrenOf.has(parentMsgNo)) childrenOf.set(parentMsgNo, []);
      childrenOf.get(parentMsgNo).push(row);
    }
    rows.forEach(r => {
      if(isAnchor(r)) return;
      let parentMsgNo = null;
      if(r.refNo !== "" && byMsgNo.has(r.refNo)){
        parentMsgNo = r.refNo;
      } else {
        const anchor = lastAnchorAtOrBefore(dayKey(r.date));
        if(anchor) parentMsgNo = anchorAttachKey(anchor);
      }
      if(parentMsgNo !== null) addChild(parentMsgNo, r);
    });
    childrenOf.forEach(list => list.sort((a,b)=> a.messageNo - b.messageNo));
    return childrenOf;
  }

  function renderReplyTree(childrenOf, rootMsgNo, depth, out){
    const kids = childrenOf.get(rootMsgNo);
    if(!kids) return;
    kids.forEach(k => {
      out.push({row:k, depth: depth});
      renderReplyTree(childrenOf, k.messageNo, depth+1, out);
    });
  }

  /* =========================================================
     2. TELUGU DECK
     ========================================================= */
  function buildTeluguDeck(){
    const rows = rawRows.filter(r => normTopic(r.topic1) === TOPIC_TELUGU)
                         .sort((a,b)=> a.messageNo - b.messageNo);

    const isAnchor = r => r.poemNo !== "";
    const childrenOf = buildReplyIndex(rows, isAnchor, r => r.messageNo);

    const cards = rows.filter(isAnchor).map(r => {
      const flat = [];
      renderReplyTree(childrenOf, r.messageNo, 0, flat);
      return {
        id: "t-" + r.messageNo,
        messageNo: r.messageNo,
        asvasam: r.asvasam,
        poemNo: r.poemNo,
        telugu: r.message,
        sanskrit: null,
        meaning: r.meaning,
        bhavam: r.bhavam,
        sender: r.sender,
        date: r.date, time: r.time,
        replies: flat
      };
    });
    return cards;
  }

  /* =========================================================
     3. SANSKRIT DECK
     Card content comes from telugu2sanskrit.js (one row = one
     combined card: Telugu block on top, Sanskrit block below).
     Poem No is read directly from the number embedded at the end
     of the Telugu verse text (now matched to the mulagrandha
     numbering, restarting per Asvasam - same convention as the
     Telugu deck).
     firdowsi.js's own "27. ఫిరదౌసి సంస్కృతం" rows are used only as
     the discussion/reply layer: rows that still carry the old
     <span> verse markup act as pass-through anchors (their
     messageNo is what telugu2sanskrit.js's "Corresponds to" points
     at); every other row is a real discussion comment, threaded
     the same way as the Telugu deck and attached to the LAST
     telugu2sanskrit.js card in its "Corresponds to" group.
     ========================================================= */
  function buildSanskritDeck(){
    const fRows = rawRows.filter(r => normTopic(r.topic1) === TOPIC_SANSKRIT)
                          .sort((a,b)=> a.messageNo - b.messageNo);
    const isSpanAnchor = r => r.message.indexOf("<span") !== -1;
    const childrenOf = buildReplyIndex(fRows, isSpanAnchor, r => r.messageNo);
    const msgNoToFRow = new Map(fRows.map(r => [r.messageNo, r]));

    const t2sRows = telugu2sanskrit.slice(1).map(r => ({
      asvasam: r[0], telugu: r[2], sanskrit: r[3], corresponds: r[4]
    }));

    let lastAsv = "";
    t2sRows.forEach(r => {
      if(r.asvasam === "") r.asvasam = lastAsv; else lastAsv = r.asvasam;
    });

    const groupLastIdx = new Map();
    t2sRows.forEach((r,i) => { groupLastIdx.set(r.corresponds, i); });

    return t2sRows.map((r,i) => {
      const isLastOfGroup = groupLastIdx.get(r.corresponds) === i;
      let replies = [];
      if(isLastOfGroup){
        renderReplyTree(childrenOf, r.corresponds, 0, replies);
      }
      const anchorRow = msgNoToFRow.get(r.corresponds);
      const tel = stripTrailingNumber(r.telugu);
      const san = stripTrailingNumber(r.sanskrit);
      return {
        id: "s-" + r.corresponds + "-" + i,
        messageNo: r.corresponds,
        asvasam: r.asvasam,
        poemNo: tel.num,
        telugu: tel.text,
        sanskrit: san.text,
        meaning: "",
        bhavam: "",
        sender: anchorRow ? anchorRow.sender : "",
        date: anchorRow ? anchorRow.date : null,
        time: anchorRow ? anchorRow.time : null,
        replies: replies
      };
    });
  }

  const DECKS = {
    telugu: buildTeluguDeck(),
    sanskrit: buildSanskritDeck()
  };

  /* =========================================================
     4. STATE + BOOKMARKS
     ========================================================= */
  const BOOKMARK_KEYS = { telugu: "firdowsi-telugu", sanskrit: "firdowsi-sanskrit" };
  let state = { version: "telugu", index: 0 };

  function getDeck(){ return DECKS[state.version]; }

  function loadBookmark(version){
    try{
      const raw = localStorage.getItem(BOOKMARK_KEYS[version]);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }
  function saveBookmark(version, index){
    try{
      const deck = DECKS[version];
      const card = deck[index];
      localStorage.setItem(BOOKMARK_KEYS[version], JSON.stringify({
        id: card.id, index: index, savedAt: Date.now()
      }));
    }catch(e){ /* storage unavailable */ }
  }
  function clearBookmark(version){
    try{ localStorage.removeItem(BOOKMARK_KEYS[version]); }catch(e){}
  }

  /* =========================================================
     5. RENDER
     ========================================================= */
  const cardEl = document.getElementById("card");
  const stageEl = document.getElementById("stage");
  const progressLabel = document.getElementById("progressLabel");
  const asvasamLabel = document.getElementById("asvasamLabel");
  const progressFill = document.getElementById("progressFill");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const clearBookmarkBtn = document.getElementById("clearBookmarkBtn");

  function depthClass(depth){
    if(depth <= 0) return "";
    if(depth === 1) return "depth-1";
    if(depth === 2) return "depth-2";
    return "depth-3plus";
  }

  function render(){
    const deck = getDeck();
    const card = deck[state.index];
    if(!card) return;

    progressLabel.textContent = "పుట " + (state.index+1) + " / " + deck.length;
    asvasamLabel.textContent = card.asvasam ? card.asvasam.trim() : "—";
    progressFill.style.width = (((state.index+1)/deck.length)*100) + "%";
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === deck.length - 1;
    clearBookmarkBtn.disabled = !loadBookmark(state.version);

    const wrapper = document.createElement("div");

    // header
    const header = document.createElement("div");
    header.className = "card-header";
    const badgeGroup = document.createElement("div");
    badgeGroup.className = "badge-group";
    const asv = document.createElement("div");
    asv.className = "asvasam-label";
    asv.textContent = card.asvasam ? card.asvasam.trim() : "చర్చ";
    badgeGroup.appendChild(asv);
    const pno = document.createElement("div");
    pno.className = "poem-no-label";
    pno.textContent = card.poemNo ? ("పద్యం " + card.poemNo) : "";
    badgeGroup.appendChild(pno);
    header.appendChild(badgeGroup);
    wrapper.appendChild(header);

    // body
    const body = document.createElement("div");
    body.className = "card-body";

    if(state.version === "sanskrit"){
      const telLabel = document.createElement("div");
      telLabel.className = "block-label tel";
      telLabel.textContent = "మూలం";
      body.appendChild(telLabel);
    }

    const poemText = document.createElement("div");
    poemText.className = "poem-text";
    poemText.textContent = card.telugu;
    body.appendChild(poemText);

    if(state.version === "sanskrit"){
      const sansWrap = document.createElement("div");
      sansWrap.className = "sanskrit-block";
      const sansLabel = document.createElement("div");
      sansLabel.className = "block-label sans";
      sansLabel.textContent = "అనువాదం";
      sansWrap.appendChild(sansLabel);
      if(card.sanskrit){
        const sansText = document.createElement("div");
        sansText.className = "poem-text";
        sansText.textContent = card.sanskrit;
        sansWrap.appendChild(sansText);
      } else {
        const pending = document.createElement("div");
        pending.className = "sanskrit-pending";
        pending.textContent = "అనువాదం లభ్యం కాలేదు";
        sansWrap.appendChild(pending);
      }
      body.appendChild(sansWrap);
    }

    if(card.meaning){
      body.appendChild(makeSection("పద్యార్థం", card.meaning, true));
    }
    if(card.bhavam){
      body.appendChild(makeSection("భావం", card.bhavam, true));
    }
    if(card.replies.length){
      body.appendChild(makeReplies(card.replies));
    }

    wrapper.appendChild(body);

    // footer
    const footer = document.createElement("div");
    footer.className = "card-footer";
    const senderSpan = document.createElement("span");
    senderSpan.className = "footer-sender";
    senderSpan.textContent = card.sender || "";
    const dateSpan = document.createElement("span");
    dateSpan.textContent = fmtDate(card.date, card.time);
    footer.appendChild(senderSpan);
    footer.appendChild(dateSpan);
    wrapper.appendChild(footer);

    cardEl.innerHTML = "";
    cardEl.appendChild(wrapper);
    stageEl.scrollTop = 0;
  }

  function makeSection(title, content, defaultOpen){
    const section = document.createElement("div");
    section.className = "section";
    const toggle = document.createElement("button");
    toggle.className = "section-toggle" + (defaultOpen ? " open" : "");
    toggle.innerHTML = '<span class="chevron">▸</span><span>' + title + "</span>";
    const contentEl = document.createElement("div");
    contentEl.className = "section-content" + (defaultOpen ? " open" : "");
    contentEl.textContent = content;
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("open");
      contentEl.classList.toggle("open");
    });
    section.appendChild(toggle);
    section.appendChild(contentEl);
    return section;
  }

  function makeReplies(flatReplies){
    const section = document.createElement("div");
    section.className = "section";
    const toggle = document.createElement("button");
    toggle.className = "section-toggle";
    toggle.innerHTML = '<span class="chevron">▸</span><span>చర్చ (' + flatReplies.length + ")</span>";
    const list = document.createElement("div");
    list.className = "replies-list section-content";
    flatReplies.forEach(({row:r, depth}) => {
      const item = document.createElement("div");
      item.className = "reply " + depthClass(depth);
      if(depth > 0 && r.refSender){
        const refLine = document.createElement("div");
        refLine.className = "reply-ref";
        refLine.textContent = "↩ " + r.refSender + " వ్యాఖ్యకు స్పందన";
        item.appendChild(refLine);
      }
      const senderEl = document.createElement("div");
      senderEl.className = "reply-sender";
      senderEl.textContent = r.sender || "";
      const textEl = document.createElement("div");
      textEl.className = "reply-text";
      textEl.textContent = r.message;
      item.appendChild(senderEl);
      item.appendChild(textEl);
      list.appendChild(item);
    });
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("open");
      list.classList.toggle("open");
    });
    section.appendChild(toggle);
    section.appendChild(list);
    return section;
  }

  let toastTimer = null;
  function showToast(msg){
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  }

  /* =========================================================
     6. NAVIGATION (prev/next also acts as the bookmark - every
     move saves position, so a separate bookmark control isn't
     needed beyond a way to clear it)
     ========================================================= */
  function goTo(index){
    const deck = getDeck();
    if(index < 0 || index >= deck.length) return;
    state.index = index;
    render();
    saveBookmark(state.version, state.index);
  }
  function next(){ goTo(state.index + 1); }
  function prev(){ goTo(state.index - 1); }

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  clearBookmarkBtn.addEventListener("click", () => {
    clearBookmark(state.version);
    state.index = 0;
    render();
    showToast("బుక్‌మార్క్ తొలగించబడింది");
  });
  document.addEventListener("keydown", (e) => {
    if(e.key === "ArrowRight") next();
    if(e.key === "ArrowLeft") prev();
  });

  // swipe (horizontal only, so vertical scroll within the stage is unaffected)
  const cardWrap = document.getElementById("cardWrap");
  let touchStartX = null, touchStartY = null;
  cardWrap.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, {passive:true});
  cardWrap.addEventListener("touchend", (e) => {
    if(touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)*1.5){
      if(dx < 0) next(); else prev();
    }
    touchStartX = null; touchStartY = null;
  }, {passive:true});

  /* =========================================================
     7. VERSION SWITCH
     ========================================================= */
  const versionToggle = document.getElementById("versionToggle");
  versionToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-version]");
    if(!btn) return;
    const v = btn.dataset.version;
    if(v === state.version) return;
    [...versionToggle.children].forEach(b => b.classList.toggle("active", b === btn));
    state.version = v;
    const bm = loadBookmark(v);
    state.index = bm ? Math.min(bm.index, DECKS[v].length-1) : 0;
    hideResumeBanner();
    render();
    maybeOfferResume();
  });

  /* =========================================================
     8. RESUME BANNER
     ========================================================= */
  const resumeBanner = document.getElementById("resumeBanner");
  const resumeText = document.getElementById("resumeText");
  document.getElementById("resumeGoBtn").addEventListener("click", () => {
    const bm = loadBookmark(state.version);
    if(bm) goTo(Math.min(bm.index, getDeck().length-1));
    hideResumeBanner();
  });
  document.getElementById("resumeDismissBtn").addEventListener("click", hideResumeBanner);

  function hideResumeBanner(){ resumeBanner.style.display = "none"; }

  function maybeOfferResume(){
    const bm = loadBookmark(state.version);
    if(bm && bm.index !== state.index){
      resumeText.textContent = "గత పఠనం పుట " + (bm.index+1) + " వద్ద ఆగింది";
      resumeBanner.style.display = "flex";
    }
  }

  /* =========================================================
     9. INIT
     ========================================================= */
  render();
  maybeOfferResume();

})();
