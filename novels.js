(async function(){
  /* =========================================================
     ExamPilot — Novel & Library
     =========================================================
     STORAGE ARCHITECTURE
     - Text-based books (study guides, chapter notes):
         content lives in public.Novels.chapters (JSONB).
     - Storage-backed novels (e.g. Othello PDF):
         content_storage_path + storage_bucket columns point
         to a file in Supabase Storage (private bucket).
         A short-lived signed URL is generated at open-time.
         The `chapters` column is '[]' for these rows.

     READING PRIVACY
     - Reading progress (chapter, percent, last-opened) is
       stored in localStorage only ('jambLibraryProgress').
     - Bookmarks are stored in localStorage only
       ('jambLibraryBookmarks').
     - No reading data is transmitted to Supabase at any point.
     - PDF-backed novels do not track page or position at all.
     ========================================================= */

  if (typeof window.ensurePremiumFeatureAccess === 'function') {
    const allowed = await window.ensurePremiumFeatureAccess({ featureName: 'Novel & Library', featureKey: 'novels' });
    if (!allowed) return;
  }

  // ── Built-in study materials (empty; all library materials loaded dynamically from DB) ──
  const builtInBooks=[];

  let books=[...builtInBooks];
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

  // ── Normalise a raw database row into a consistent book object ────────────
  function normalizeBook(row){
    let chapters=row?.chapters;
    if(typeof chapters==='string'){try{chapters=JSON.parse(chapters)}catch{chapters=[]}}
    if(!Array.isArray(chapters)) chapters=[];
    chapters=chapters.map((c,i)=>({title:String(c?.title||`Chapter ${i+1}`),paragraphs:Array.isArray(c?.paragraphs)?c.paragraphs.map(String):[String(c?.content||'')]})).filter(c=>c.paragraphs.some(Boolean));
    return {
      id:String(row.id),
      title:String(row.title||'Untitled'),
      author:String(row.author||'ExamPilot Study Library'),
      category:String(row.category||'JAMB Novel'),
      icon:String(row.icon||'📘'),
      description:String(row.description||''),
      premium:Boolean(row.premium),
      chapters,
      // Storage-backed novel fields (null for chapter-based books)
      content_storage_path:row.content_storage_path||null,
      storage_bucket:row.storage_bucket||null
    };
  }

  // ── Load Library catalogue from Supabase DB ───────────────────────────────
  // Merges remote DB entries with built-in study materials.
  // Remote books override built-ins that share the same id (UUID vs string, so
  // no conflict in practice). Built-in study guides always remain visible.
  async function loadLibraryContent(){
    try{
      if(typeof supabase==='undefined') return;
      const {data,error}=await window.supabaseClient
        .from('Novels')
        .select('id,title,author,category,description,icon,premium,chapters,is_active,content_storage_path,storage_bucket')
        .eq('is_active',true)
        .order('created_at',{ascending:true});
      if(error) throw error;
      const remote=(data||[]).map(normalizeBook)
        // Accept chapter-based books that have content, and Storage-backed books
        .filter(b=>b.chapters.length||b.content_storage_path);
      if(remote.length){
        // Keep built-ins (fallback guides) alongside DB books.
        // If a DB row has the same id as a built-in it takes precedence.
        const remoteIds=new Set(remote.map(b=>b.id));
        books=[...builtInBooks.filter(b=>!remoteIds.has(b.id)),...remote];
      }
    }catch(e){console.warn('Novel library database unavailable; using built-in study materials.',e)}
  }

  // ── NEW: Fetch a short-lived signed URL from Supabase Storage ────────────
  // Called only when opening a Storage-backed novel.
  // The signed URL is valid for 1 hour and is used only client-side.
  // It is NOT stored or transmitted elsewhere.
  async function fetchSignedUrl(bucket,path){
    if(!window.supabaseClient) return null;
    try{
      const {data,error}=await window.supabaseClient.storage
        .from(bucket)
        .createSignedUrl(path,3600);  // 1-hour signed URL
      if(error) throw error;
      return data?.signedUrl||null;
    }catch(e){
      console.error('Storage signed URL error:',e);
      return null;
    }
  }

  // ── Application state ─────────────────────────────────────────────────────
  const state={category:'All',query:'',book:null,chapter:0,font:18,bookmarksOnly:false,subscribed:false};

  function isPremiumSubscriptionRecord(row){
    if(!row) return false;
    const status=String(row.status ?? row.subscription_status ?? row.plan_status ?? row.payment_status ?? '').trim().toLowerCase();
    const expiry=row.expires_at ?? row.expiresAt ?? row.current_period_end ?? row.ends_at ?? null;
    const isStatusActive = ['active','paid','premium','subscribed','success','successful','succeeded','completed'].includes(status);
    let notExpired = true;
    if (expiry) {
      const exp = new Date(expiry);
      notExpired = !Number.isNaN(exp.getTime()) ? exp > new Date() : true;
    }
    return isStatusActive && notExpired;
  }

  // ── Reading progress & bookmarks — localStorage ONLY ─────────────────────
  // These are never sent to Supabase. PDF-backed novels do not write progress.
  const getProgress=()=>{try{return JSON.parse(localStorage.getItem('jambLibraryProgress')||'{}')}catch{return{}}};
  const saveProgress=p=>localStorage.setItem('jambLibraryProgress',JSON.stringify(p));
  const getBookmarks=()=>{try{return JSON.parse(localStorage.getItem('jambLibraryBookmarks')||'[]')}catch{return[]}};
  const setBookmarks=v=>localStorage.setItem('jambLibraryBookmarks',JSON.stringify(v));

  async function checkSubscription(){
    try{
      if (typeof window.ensurePremiumFeatureAccess !== 'function') {
        state.subscribed = false;
        localStorage.setItem('studentSubscribed', 'false');
        return false;
      }
      state.subscribed = await window.ensurePremiumFeatureAccess({ featureName: 'Novel & Library', featureKey: 'novels' });
      localStorage.setItem('studentSubscribed', state.subscribed ? 'true' : 'false');
      return state.subscribed;
    } catch (e) {
      console.warn('Library subscription check:', e);
      state.subscribed = false;
      localStorage.setItem('studentSubscribed', 'false');
      return false;
    }
  }

  // ── UI rendering ──────────────────────────────────────────────────────────
  function renderFilters(){
    const cats=['All',...new Set(books.map(b=>b.category))];
    $('#categoryFilters').innerHTML=cats.map(c=>`<button class="filter-chip ${c===state.category?'active':''}" data-cat="${c}">${c}</button>`).join('');
    $$('.filter-chip[data-cat]').forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;renderFilters();renderBooks()});
    const bf=$('#bookmarkFilter'); if(bf){bf.classList.toggle('active',state.bookmarksOnly);bf.textContent=state.bookmarksOnly?'★ Bookmarked':'☆ Bookmarked'}
  }
  function filtered(){
    const bm=getBookmarks();
    return books.filter(b=>(state.category==='All'||b.category===state.category)&&(!state.bookmarksOnly||bm.includes(b.id))&&`${b.title} ${b.author} ${b.category}`.toLowerCase().includes(state.query.toLowerCase()));
  }
  function renderBooks(){
    if(!state.subscribed){
      $('#libraryCount').textContent='0';
      $('#bookGrid').innerHTML='<div class="empty-state"><div>🔒</div><h3>Premium access required</h3><p>Novels and the study library are available only to premium students.</p><button id="libraryUpgradeButton" class="primary-button">Upgrade to premium</button></div>';
      $('#emptyState').hidden=false;
      const upgrade=$('#libraryUpgradeButton'); if(upgrade) upgrade.onclick=()=>{window.location.href='dashboard.html?upgrade=1&feature=novels';};
      const status=$('#libraryStatus'); if(status) status.textContent='Premium-only feature';
      $('#recentGrid').innerHTML='<p class="book-desc">Your reading history will unlock after premium activation.</p>';
      return;
    }
    const list=filtered(), p=getProgress(), bm=getBookmarks();
    $('#libraryCount').textContent=books.length;
    $('#bookGrid').innerHTML=list.map(b=>{
      const x=p[b.id]||{};
      const isPdf=!!(b.content_storage_path&&b.storage_bucket);
      // For PDF books: show "PDF" instead of chapter count; no progress bar.
      const chapLabel=isPdf?'PDF novel':`${b.chapters.length} chapters`;
      const openLabel=isPdf?'Open reader':(x.percent?'Continue reading':'Open reader');
      const progressLabel=isPdf?'':(x.percent?x.percent+'% complete':'Not started');
      const progressWidth=isPdf?0:(x.percent||0);
      const progressHtml=isPdf?'':`<div class="book-progress"><span>${progressLabel}</span><div class="progress-bar"><i style="width:${progressWidth}%"></i></div></div>`;
      return `<article class="book-card"><div class="book-cover">${b.icon}</div><h3>${b.title}</h3><div class="book-author">${b.author}</div><p class="book-desc">${b.description}</p><div class="book-meta"><span class="meta-pill">${b.category}</span><span class="meta-pill">${chapLabel}</span><span class="meta-pill">${b.premium?'Premium':'Free'}</span></div>${progressHtml}<div class="book-actions"><button class="primary-button" data-read="${b.id}">${openLabel}</button><button class="secondary-button" data-bookmark="${b.id}" aria-label="Bookmark ${b.title}">${bm.includes(b.id)?'★':'☆'}</button></div></article>`;
    }).join('');
    $('#emptyState').hidden=list.length>0;
    $$('.book-card [data-read]').forEach(b=>b.onclick=()=>openReader(b.dataset.read));
    $$('.book-card [data-bookmark]').forEach(b=>b.onclick=()=>toggleBookmark(b.dataset.bookmark));
    const status=$('#libraryStatus'); if(status)status.textContent=state.bookmarksOnly?`${list.length} bookmarked material${list.length===1?'':'s'}.`:'';
    renderRecent();
  }
  function renderRecent(){
    // Uses localStorage progress only — no Supabase reads.
    const p=getProgress();
    const recent=books.filter(b=>p[b.id]&&!b.content_storage_path) // PDF books have no chapter progress to restore
      .sort((a,b)=>(p[b.id].updated||0)-(p[a.id].updated||0)).slice(0,3);
    $('#recentGrid').innerHTML=recent.length?recent.map(b=>{const x=p[b.id];return `<div class="recent-card" data-recent="${b.id}"><strong>${b.title}</strong><span>${x.percent}% complete</span><div class="progress-bar"><i style="width:${x.percent}%"></i></div></div>`}).join(''):'<p class="book-desc">Your reading history will appear here after you open a material.</p>';
    $$('[data-recent]').forEach(x=>x.onclick=()=>openReader(x.dataset.recent));
  }
  function toggleBookmark(id){let b=getBookmarks();b=b.includes(id)?b.filter(x=>x!==id):[...b,id];setBookmarks(b);renderBooks();if(state.book?.id===id)updateBookmarkButton()}

  // ── Reader: open ──────────────────────────────────────────────────────────
  async function openReader(id){
    const b=books.find(x=>x.id===id);if(!b)return;
    if(b.premium&&!(await checkSubscription())){showAccess();return}
    state.book=b;

    // Populate shared reader header regardless of mode
    $('#readerTitle').textContent=b.title;
    $('#readerCategory').textContent=b.category.toUpperCase();
    $('#readerMeta').textContent=b.author;
    updateBookmarkButton();
    $('#readerOverlay').hidden=false;
    document.body.style.overflow='hidden';

    if(b.content_storage_path&&b.storage_bucket){
      // ── PDF Storage mode ─────────────────────────────────────────────────
      setPdfMode(true);
      showPdfState('loading');
      const url=await fetchSignedUrl(b.storage_bucket,b.content_storage_path);
      if(!url){
        showPdfState('error');
        return;
      }
      // Apply the signed URL to the iframe and the fallback open-link.
      // The URL is not stored anywhere beyond these two DOM attributes.
      $('#pdfFrame').src=url;
      $('#pdfOpenLink').href=url;
      showPdfState('ready');
    } else {
      // ── Text chapter mode (unchanged logic) ──────────────────────────────
      setPdfMode(false);
      const p=getProgress()[id]||{};
      state.chapter=Math.min(p.chapter||0,Math.max(0,b.chapters.length-1));
      state.font=18;
      renderChapter();
    }
  }

  // ── NEW: Toggle between PDF reader UI and text reader UI ─────────────────
  function setPdfMode(on){
    const pdfSection=$('#pdfReaderSection');
    const controls=$('#readerControls');
    const content=$('#readerContent');
    const nav=$('#readerNav');
    if(pdfSection) pdfSection.hidden=!on;
    if(controls)   controls.hidden=on;
    if(content)    content.hidden=on;
    if(nav)        nav.hidden=on;
  }

  // ── NEW: Switch PDF loading/ready/error state ─────────────────────────────
  function showPdfState(state){
    const loading=$('#pdfLoadingState');
    const frame=$('#pdfFrame');
    const error=$('#pdfErrorState');
    const linkWrap=$('#pdfOpenLinkWrap');
    if(!loading||!frame||!error||!linkWrap) return;
    loading.hidden  = state!=='loading';
    frame.hidden    = state!=='ready';
    linkWrap.hidden = state!=='ready';
    error.hidden    = state!=='error';
  }

  // ── Reader: close ─────────────────────────────────────────────────────────
  function closeReader(){
    $('#readerOverlay').hidden=true;
    document.body.style.overflow='';
    state.book=null;
    // Clear iframe src to stop any ongoing PDF download/streaming
    const frame=$('#pdfFrame');
    if(frame) frame.src='about:blank';
    // Reset UI to text mode for next open
    setPdfMode(false);
  }

  function updateBookmarkButton(){if(!state.book)return;$('#bookmarkButton').textContent=getBookmarks().includes(state.book.id)?'★ Bookmarked':'☆ Bookmark'}
  function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  // ── Text chapter rendering (unchanged) ────────────────────────────────────
  // saveProgress writes to localStorage only — never to Supabase.
  function renderChapter(){
    const b=state.book,c=b.chapters[state.chapter];
    $('#readerTitle').textContent=b.title;$('#readerCategory').textContent=b.category.toUpperCase();$('#readerMeta').textContent=`${b.author} • Chapter ${state.chapter+1} of ${b.chapters.length}`;$('#chapterLabel').textContent=c.title;
    $('#readerContent').style.fontSize=state.font+'px';$('#readerContent').innerHTML=`<h3>${escapeHTML(c.title)}</h3>${c.paragraphs.map(x=>`<p>${escapeHTML(x)}</p>`).join('')}`;
    const percent=Math.round(((state.chapter+1)/b.chapters.length)*100);$('#readerProgress').textContent=percent+'%';
    // localStorage only — no Supabase write
    const all=getProgress();all[b.id]={chapter:state.chapter,percent,updated:Date.now()};saveProgress(all);
    $('#prevChapter').disabled=state.chapter===0;$('#nextChapter').disabled=state.chapter===b.chapters.length-1;renderRecent();
  }

  function showAccess(){$('#accessModal').hidden=false;document.body.style.overflow='hidden'}
  function closeAccess(){$('#accessModal').hidden=true;document.body.style.overflow=''}

  // ── Event listeners (unchanged) ───────────────────────────────────────────
  $('#searchInput').oninput=e=>{state.query=e.target.value;renderBooks()};
  $('#clearSearch').onclick=()=>{state.query='';state.category='All';state.bookmarksOnly=false;$('#searchInput').value='';renderFilters();renderBooks()};
  $('#bookmarkFilter').onclick=()=>{state.bookmarksOnly=!state.bookmarksOnly;renderFilters();renderBooks()};
  $('#closeReader').onclick=closeReader;$('#closeAccess').onclick=closeAccess;
  $('#bookmarkButton').onclick=()=>toggleBookmark(state.book.id);
  $('#prevChapter').onclick=()=>{if(state.chapter>0){state.chapter--;renderChapter()}};
  $('#nextChapter').onclick=()=>{if(state.chapter<state.book.chapters.length-1){state.chapter++;renderChapter()}};
  $('#fontDown').onclick=()=>{state.font=Math.max(14,state.font-1);$('#readerContent').style.fontSize=state.font+'px'};
  $('#fontUp').onclick=()=>{state.font=Math.min(25,state.font+1);$('#readerContent').style.fontSize=state.font+'px'};
  $('#fontReset').onclick=()=>{state.font=18;$('#readerContent').style.fontSize='18px'};
  $('#goSubscribe').onclick=()=>{closeAccess();window.location.href='dashboard.html?upgrade=1&feature=novels'};
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#readerOverlay').hidden)closeReader()});

  // ── Init ──────────────────────────────────────────────────────────────────
  (async()=>{
    await checkSubscription();
    await loadLibraryContent();
    $('#accessBadge').textContent=state.subscribed?'Premium reading active':'Free library access';
    renderFilters();
    renderBooks();
  })();
})();
