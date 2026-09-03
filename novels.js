(async function(){
  if (typeof window.ensurePremiumFeatureAccess === 'function') {
    const allowed = await window.ensurePremiumFeatureAccess({ featureName: 'Novel & Library', featureKey: 'novels' });
    if (!allowed) return;
  }
  const builtInBooks=[
    {id:'life-changer-guide',title:'The Life Changer — Study Guide',author:'JAMB Study Material',category:'JAMB Novel',icon:'📘',description:'Original revision notes, themes, characters, events and exam-focused prompts for studying the prescribed text. The full copyrighted novel is not reproduced here.',premium:true,chapters:[
      {title:'How to use this guide',paragraphs:['Use this guide alongside a legitimate copy of the prescribed text. Read a section first, then use the notes and prompts to test your memory.','Focus on characters, events, setting, conflict, themes, language and lessons.']},
      {title:'Characters and relationships',paragraphs:['Create a character map while reading. Record each important character, their role, relationships and major decisions.','For exam revision, connect each character to at least one major event and one theme.']},
      {title:'Themes and major ideas',paragraphs:['Identify the central ideas developed by the text and note the events that support each one.','When revising, explain each theme in your own words and attach two or three supporting events from your legitimate copy.']},
      {title:'Exam revision checklist',paragraphs:['Before attempting questions, make sure you can recall the major events in order, important relationships, settings, conflicts and lessons.','Use the Answers & Explanations section after revision to practise objective questions.']}
    ]},
    {id:'reading-skills',title:'JAMB Reading Skills',author:'JAMB CBT Study Series',category:'Study Guide',icon:'📖',description:'Original reading and comprehension guidance for faster, more accurate exam preparation.',premium:false,chapters:[
      {title:'Reading for meaning',paragraphs:['Read the question carefully and identify exactly what is being tested. Return to the relevant part of the passage before choosing an answer.','Do not choose an option simply because it repeats words from the passage. Compare the meaning of the option with the writer’s actual point.']},
      {title:'Inference and tone',paragraphs:['An inference must be supported by the passage. Tone describes the writer’s attitude, so pay attention to word choice, emphasis and context.']},
      {title:'Speed without guessing',paragraphs:['Use short focused reading passes. Eliminate clearly wrong options first, then compare the remaining choices against the passage.']}
    ]},
    {id:'exam-vocabulary',title:'Vocabulary Revision Notes',author:'JAMB CBT Study Series',category:'Study Guide',icon:'📝',description:'Short original vocabulary and context notes for Use of English revision.',premium:false,chapters:[
      {title:'Context clues',paragraphs:['When a word is unfamiliar, look at the words around it. Contrast, examples, definitions and cause-and-effect relationships can reveal meaning.']},
      {title:'Common traps',paragraphs:['Watch for options that are grammatically possible but do not fit the meaning of the sentence. Always use context before selecting a synonym or antonym.']},
      {title:'Revision practice',paragraphs:['Keep a personal list of difficult words and review them in short sessions. Write a sentence for each new word to reinforce meaning.']}
    ]}
  ];
  let books=[...builtInBooks];
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  function normalizeBook(row){
    let chapters=row?.chapters;
    if(typeof chapters==='string'){try{chapters=JSON.parse(chapters)}catch{chapters=[]}}
    if(!Array.isArray(chapters)) chapters=[];
    chapters=chapters.map((c,i)=>({title:String(c?.title||`Chapter ${i+1}`),paragraphs:Array.isArray(c?.paragraphs)?c.paragraphs.map(String):[String(c?.content||'')]})).filter(c=>c.paragraphs.some(Boolean));
    return {id:String(row.id),title:String(row.title||'Untitled'),author:String(row.author||'JAMB CBT Study Library'),category:String(row.category||'JAMB Novel'),icon:String(row.icon||'📘'),description:String(row.description||''),premium:Boolean(row.premium),chapters};
  }
  async function loadLibraryContent(){
    try{
      if(typeof supabase==='undefined') return;
      const {data,error}=await supabase.from('Novels').select('id,title,author,category,description,icon,premium,chapters,is_active').eq('is_active',true).order('created_at',{ascending:true});
      if(error) throw error;
      const remote=(data||[]).map(normalizeBook).filter(b=>b.chapters.length);
      if(remote.length) books=remote;
    }catch(e){console.warn('Novel library database unavailable; using built-in study materials.',e)}
  }

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
    $('#bookGrid').innerHTML=list.map(b=>{const x=p[b.id]||{percent:0};return `<article class="book-card"><div class="book-cover">${b.icon}</div><h3>${b.title}</h3><div class="book-author">${b.author}</div><p class="book-desc">${b.description}</p><div class="book-meta"><span class="meta-pill">${b.category}</span><span class="meta-pill">${b.chapters.length} chapters</span><span class="meta-pill">${b.premium?'Premium':'Free'}</span></div><div class="book-progress"><span>${x.percent?x.percent+'% complete':'Not started'}</span><div class="progress-bar"><i style="width:${x.percent||0}%"></i></div></div><div class="book-actions"><button class="primary-button" data-read="${b.id}">${x.percent?'Continue reading':'Open reader'}</button><button class="secondary-button" data-bookmark="${b.id}" aria-label="Bookmark ${b.title}">${bm.includes(b.id)?'★':'☆'}</button></div></article>`}).join('');
    $('#emptyState').hidden=list.length>0;
    $$('.book-card [data-read]').forEach(b=>b.onclick=()=>openReader(b.dataset.read));
    $$('.book-card [data-bookmark]').forEach(b=>b.onclick=()=>toggleBookmark(b.dataset.bookmark));
    const status=$('#libraryStatus'); if(status)status.textContent=state.bookmarksOnly?`${list.length} bookmarked material${list.length===1?'':'s'}.`:'';
    renderRecent();
  }
  function renderRecent(){
    const p=getProgress();
    const recent=books.filter(b=>p[b.id]).sort((a,b)=>(p[b.id].updated||0)-(p[a.id].updated||0)).slice(0,3);
    $('#recentGrid').innerHTML=recent.length?recent.map(b=>{const x=p[b.id];return `<div class="recent-card" data-recent="${b.id}"><strong>${b.title}</strong><span>${x.percent}% complete</span><div class="progress-bar"><i style="width:${x.percent}%"></i></div></div>`}).join(''):'<p class="book-desc">Your reading history will appear here after you open a material.</p>';
    $$('[data-recent]').forEach(x=>x.onclick=()=>openReader(x.dataset.recent));
  }
  function toggleBookmark(id){let b=getBookmarks();b=b.includes(id)?b.filter(x=>x!==id):[...b,id];setBookmarks(b);renderBooks();if(state.book?.id===id)updateBookmarkButton()}
  async function openReader(id){
    const b=books.find(x=>x.id===id);if(!b)return;
    if(b.premium && !(await checkSubscription())){showAccess();return}
    state.book=b;const p=getProgress()[id]||{};state.chapter=Math.min(p.chapter||0,b.chapters.length-1);state.font=18;$('#readerOverlay').hidden=false;document.body.style.overflow='hidden';renderChapter();updateBookmarkButton();
  }
  function closeReader(){$('#readerOverlay').hidden=true;document.body.style.overflow='';state.book=null}
  function updateBookmarkButton(){if(!state.book)return;$('#bookmarkButton').textContent=getBookmarks().includes(state.book.id)?'★ Bookmarked':'☆ Bookmark'}
  function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function renderChapter(){
    const b=state.book,c=b.chapters[state.chapter];
    $('#readerTitle').textContent=b.title;$('#readerCategory').textContent=b.category.toUpperCase();$('#readerMeta').textContent=`${b.author} • Chapter ${state.chapter+1} of ${b.chapters.length}`;$('#chapterLabel').textContent=c.title;
    $('#readerContent').style.fontSize=state.font+'px';$('#readerContent').innerHTML=`<h3>${escapeHTML(c.title)}</h3>${c.paragraphs.map(x=>`<p>${escapeHTML(x)}</p>`).join('')}`;
    const percent=Math.round(((state.chapter+1)/b.chapters.length)*100);$('#readerProgress').textContent=percent+'%';
    const all=getProgress();all[b.id]={chapter:state.chapter,percent,updated:Date.now()};saveProgress(all);
    $('#prevChapter').disabled=state.chapter===0;$('#nextChapter').disabled=state.chapter===b.chapters.length-1;renderRecent();
  }
  function showAccess(){$('#accessModal').hidden=false;document.body.style.overflow='hidden'}
  function closeAccess(){$('#accessModal').hidden=true;document.body.style.overflow=''}
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
  (async()=>{await checkSubscription();await loadLibraryContent();$('#accessBadge').textContent=state.subscribed?'Premium reading active':'Free library access';renderFilters();renderBooks()})();
})();
