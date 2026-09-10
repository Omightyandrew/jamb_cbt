(async function(){
  const subjectFilter=document.getElementById('subjectFilter');
  const typeFilter=document.getElementById('typeFilter');
  const topicFilter=document.getElementById('topicFilter');
  const explanationFilter=document.getElementById('explanationFilter');
  const searchInput=document.getElementById('searchInput');
  const list=document.getElementById('questionList');
  const totalCount=document.getElementById('totalCount');
  const subjectCount=document.getElementById('subjectCount');
  const explanationCount=document.getElementById('explanationCount');
  const visibleCount=document.getElementById('visibleCount');
  const resultSummary=document.getElementById('resultSummary');
  const expandAll=document.getElementById('expandAll');
  const clearFilters=document.getElementById('clearFilters');
  const loadMore=document.getElementById('loadMore');
  const localBank=(typeof window !== 'undefined' && (window.questionBanks || globalThis.questionBanks)) || {};
  const supabaseClient=typeof supabase !== 'undefined' && typeof supabase.from === 'function'
    ? supabase
    : (window.supabase ? window.supabase.createClient(
      'https://afdnfqmsjmpwlvhloopy.supabase.co',
      'sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V'
    ) : null);
  const pageSize=50;
  let renderLimit=50;
  let all=[];
  let expanded=false;
  let answerState={};
  let offset=0;
  let hasMore=true;
  let loading=false;
  let pendingReset=false;
  let loadError='';
  let requestToken=0;
  let searchTimer=null;

  list.innerHTML='<div class="empty"><div class="empty-icon">…</div><h2>Loading answers</h2><p>Connecting to the JAMB question bank…</p></div>';
  resultSummary.textContent='Loading questions…';

  if (typeof window.ensurePremiumFeatureAccess === 'function') {
    const allowed=await window.ensurePremiumFeatureAccess({ featureName:'Answers & Explanations', featureKey:'answers' });
    if (!allowed) return;
  }

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function letter(i){return String.fromCharCode(65+i);}

  function normalizeAnswer(value){
    if (value===null || value===undefined) return '';
    const raw=String(value).trim().toUpperCase();
    if (!raw) return '';
    if (/^[A-D]$/.test(raw)) return raw;
    const match=raw.match(/[A-D]/);
    if (match) return match[0];
    const direct={OPTION_A:'A',OPTION_B:'B',OPTION_C:'C',OPTION_D:'D',OPTIONA:'A',OPTIONB:'B',OPTIONC:'C',OPTIOND:'D'};
    if (direct[raw]) return direct[raw];
    const numeric=Number(raw);
    return Number.isInteger(numeric) && numeric>=1 && numeric<=4 ? letter(numeric-1) : '';
  }

  function normalizeQuestionRecord(record,index){
    const subject=String(record.Subject??record.subject??record.subjectName??'Unknown').trim()||'Unknown';
    const questionText=String(record.Question??record.question??record.prompt??'').trim();
    const type=String(record.test_type??record.type??record.questionType??'practice').trim().toLowerCase()||'practice';
    const optionValues=Array.isArray(record.options)
      ? record.options.slice(0,4)
      : [record.Option_a,record.Option_b,record.Option_c,record.Option_d,record.option_a,record.option_b,record.option_c,record.option_d,record.OptionA,record.OptionB,record.OptionC,record.OptionD];
    const options=optionValues.map(value=>String(value??'').trim()).slice(0,4);
    while(options.length<4) options.push('');
    return {
      id:record.id??`${subject}-${index}-${String(questionText).slice(0,24)}`,
      subject,
      type,
      question:questionText,
      options,
      answer:normalizeAnswer(record.Correct_Answer??record.correct_answer??record.answer??record.Answer??''),
      topic:String(record.Topic??record.topic??'').trim()||'General',
      explanation:String(record.Explanation??'').trim(),
      index
    };
  }

  function answerIndex(question){
    const answer=normalizeAnswer(question?.answer);
    return answer ? answer.charCodeAt(0)-65 : -1;
  }
  function hasExplanation(q){return Boolean(String(q.explanation||'').trim());}
  function topicOf(q){return String(q.topic||'').trim()||'General';}
  function questionKey(row){return `${row.subject}::${row.id||row.question}`;}
  function selectedAnswerFor(row){return answerState[questionKey(row)]||null;}

  function collectBankQuestions(){
    const rows=[];
    Object.entries(localBank).forEach(([subject,data])=>{
      const practice=Array.isArray(data?.practice)?data.practice:[];
      const past=Array.isArray(data?.past)?data.past:[];
      [...practice,...past].forEach((entry,idx)=>{
        rows.push(normalizeQuestionRecord({
          ...(entry||{}),
          Subject:entry?.Subject||subject,
          test_type:entry?.test_type||(idx<practice.length?'practice':'past')
        },rows.length+1));
      });
    });
    return rows.filter(q=>q.question&&q.options.some(option=>String(option).trim()));
  }

  function activeFilters(){
    return {
      subject:subjectFilter.value,
      type:typeFilter.value,
      topic:topicFilter.value,
      query:searchInput.value.trim(),
      explanation:explanationFilter.value
    };
  }

  function applyQueryFilters(query,filters){
    if(filters.subject!=='all') query=query.eq('Subject',filters.subject);
    if(filters.type!=='all') query=query.eq('test_type',filters.type);
    if(filters.topic!=='all') query=query.eq('Topic',filters.topic);
    if(filters.query){
      const term=filters.query.replace(/[(),]/g,' ').trim();
      if(term) query=query.or(`Question.ilike.%${term}%,Subject.ilike.%${term}%,Topic.ilike.%${term}%,Option_a.ilike.%${term}%,Option_b.ilike.%${term}%,Option_c.ilike.%${term}%,Option_d.ilike.%${term}%,Explanation.ilike.%${term}%`);
    }
    if(filters.explanation==='available') query=query.not('Explanation','is',null);
    if(filters.explanation==='missing') query=query.or('Explanation.is.null,Explanation.eq.');
    return query;
  }

  function populateSubjects(){
    const selected=subjectFilter.value;
    const subjects=[...new Set(all.map(q=>q.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    subjectFilter.innerHTML='<option value="all">All Subjects</option>'+subjects.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    if(subjects.includes(selected)) subjectFilter.value=selected;
  }

  function populateTopics(){
    const selectedSubject=subjectFilter.value;
    const selectedType=typeFilter.value;
    const previous=topicFilter.value;
    const topics=new Set();
    all.forEach(q=>{
      if(selectedSubject!=='all'&&q.subject!==selectedSubject) return;
      if(selectedType!=='all'&&q.type!==selectedType) return;
      topics.add(topicOf(q));
    });
    const sorted=[...topics].sort((a,b)=>a.localeCompare(b));
    topicFilter.innerHTML='<option value="all">All Topics</option>'+sorted.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if(sorted.includes(previous)) topicFilter.value=previous;
  }

  function filteredRows(){
    const selectedSubject=subjectFilter.value;
    const selectedType=typeFilter.value;
    const selectedTopic=topicFilter.value;
    const availability=explanationFilter.value;
    const query=searchInput.value.trim().toLowerCase();
    return all.filter(row=>{
      if(selectedSubject!=='all'&&row.subject!==selectedSubject) return false;
      if(selectedType!=='all'&&row.type!==selectedType) return false;
      if(selectedTopic!=='all'&&topicOf(row)!==selectedTopic) return false;
      const available=hasExplanation(row);
      if(availability==='available'&&!available) return false;
      if(availability==='missing'&&available) return false;
      if(query){
        const haystack=[row.question,row.subject,topicOf(row),...row.options,row.explanation].join(' ').toLowerCase();
        if(!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function render(){
    const rows=filteredRows();
    const visibleRows=rows.slice(0,renderLimit);
    const visibleKeys=new Set(rows.map(questionKey));
    Object.keys(answerState).forEach(key=>{if(!visibleKeys.has(key)) delete answerState[key];});
    totalCount.textContent=all.length;
    subjectCount.textContent=new Set(all.map(q=>q.subject)).size;
    explanationCount.textContent=all.filter(hasExplanation).length;
    visibleCount.textContent=visibleRows.length;
    resultSummary.textContent=loadError|| (rows.length
      ? `Showing ${visibleRows.length} loaded question${visibleRows.length===1?'':'s'}`
      : (loading?'Loading questions…':'No questions match your filters'));

    if(!visibleRows.length&&loadError){
      list.innerHTML='<div class="empty"><div class="empty-icon">!</div><h2>Could not load answers</h2><p>We could not connect to the JAMB question bank. Please try again.</p></div>';
      updateLoadMore(0);
      return;
    }
    if(!visibleRows.length&&loading){
      list.innerHTML='<div class="empty"><div class="empty-icon">…</div><h2>Loading answers</h2><p>Fetching questions for your filters…</p></div>';
      updateLoadMore(0);
      return;
    }
    if(!visibleRows.length){
      list.innerHTML='<div class="empty"><div class="empty-icon">⌕</div><h2>No questions found</h2><p>Try another subject, topic, question type, explanation filter or search term.</p></div>';
      updateLoadMore(rows.length);
      return;
    }

    list.innerHTML=visibleRows.map(row=>{
      const questionId=questionKey(row);
      const selectedLetter=selectedAnswerFor(row);
      const selectedIndex=selectedLetter?normalizeAnswer(selectedLetter).charCodeAt(0)-65:-1;
      const correctIndex=answerIndex(row);
      const answerText=correctIndex>=0?row.options[correctIndex]||'Answer not available':'Answer not available';
      const isAnswered=Boolean(selectedLetter);
      const isCorrect=isAnswered&&normalizeAnswer(selectedLetter)===normalizeAnswer(row.answer);
      const optionsMarkup=row.options.map((option,index)=>{
        const letterValue=letter(index);
        const classes=['option'];
        if(index===correctIndex) classes.push('correct');
        if(selectedLetter&&selectedIndex===index&&index!==correctIndex) classes.push('wrong');
        if(selectedLetter&&selectedIndex===index) classes.push('selected');
        const detail=index===correctIndex?'<span class="correct-mark">Correct</span>':(selectedLetter&&selectedIndex===index?'<span class="wrong-mark">Your answer</span>':'');
        return `<button type="button" class="${classes.join(' ')}" data-question-key="${escapeHtml(questionId)}" data-answer="${letterValue}" aria-pressed="${selectedLetter===letterValue}"><span class="option-letter">${letterValue}</span><span class="option-text">${escapeHtml(option||'Option not available')}</span>${detail}</button>`;
      }).join('');
      const explanationContent=row.explanation
        ? `<div class="explanation-body"><p><strong>Correct answer:</strong> ${correctIndex>=0?letter(correctIndex)+'. ':''}${escapeHtml(answerText)}</p><p>${escapeHtml(row.explanation)}</p></div>`
        : `<div class="explanation-body"><p><strong>Correct answer:</strong> ${correctIndex>=0?letter(correctIndex)+'. ':''}${escapeHtml(answerText)}</p><p>Explanation not available.</p></div>`;
      const explanationMarkup=isAnswered
        ? `<div class="answer-status ${isCorrect?'correct':'wrong'}">${isCorrect?'✓ Correct':'✕ Incorrect'} — your answer: ${selectedLetter}</div>${row.explanation?`<details class="explanation" ${expanded?'open':''}><summary>View explanation</summary>${explanationContent}</details>`:`<div class="explanation unavailable"><div class="unavailable-title">Explanation not available</div>${explanationContent}</div>`}`
        : `<div class="answer-status neutral">Select an answer to reveal the explanation.</div>${row.explanation?`<details class="explanation" ${expanded?'open':''}><summary>View explanation</summary>${explanationContent}</details>`:`<div class="explanation unavailable"><div class="unavailable-title">Explanation not available</div>${explanationContent}</div>`}`;
      return `<article class="question-card"><div class="question-meta"><span>${escapeHtml(row.subject)}</span><span>${row.type==='past'?'Past Question':'Practice Question'}</span><span>${escapeHtml(topicOf(row))}</span><span>Question ${row.index}</span></div><h2>${escapeHtml(row.question)}</h2><div class="options">${optionsMarkup}</div>${explanationMarkup}</article>`;
    }).join('');
    document.querySelectorAll('[data-question-key]').forEach(button=>{
      button.addEventListener('click',()=>{
        const key=button.getAttribute('data-question-key');
        const answer=button.getAttribute('data-answer');
        if(!key||!answer) return;
        answerState[key]=answer;
        render();
      });
    });
    updateLoadMore(rows.length);
  }

  function updateLoadMore(filteredCount){
    if(!loadMore) return;
    loadMore.hidden=loading||!hasMore;
    loadMore.disabled=loading;
    loadMore.textContent=loading?'Loading…':'Load more questions';
    if(filteredCount>renderLimit&&!loading) loadMore.textContent='Show more loaded questions';
  }

  async function loadQuestions({reset=false}={}){
    if(loading){
      if(reset) pendingReset=true;
      return;
    }
    if(reset){
      requestToken++;
      all=[];
      offset=0;
      hasMore=true;
      answerState={};
      list.innerHTML='<div class="empty"><div class="empty-icon">…</div><h2>Loading answers</h2><p>Fetching questions for your filters…</p></div>';
      resultSummary.textContent='Loading questions…';
      loadError='';
    }
    if(!hasMore) return;
    loading=true;
    const token=requestToken;
    render();
    try{
      if(!supabaseClient) throw new Error('Supabase client unavailable');
      const filters=activeFilters();
      let query=supabaseClient
        .from('Questions')
        .select('id, Subject, test_type, Question, Option_a, Option_b, Option_c, Option_d, Correct_Answer, Topic, Explanation')
        .order('id',{ascending:true})
        .range(offset,offset+pageSize-1);
      query=applyQueryFilters(query,filters);
      const {data,error}=await query;
      if(error) throw error;
      if(token!==requestToken) return;
      loadError='';
      const incoming=(Array.isArray(data)?data:[]).map((record,index)=>normalizeQuestionRecord(record,offset+index+1));
      const known=new Set(all.map(q=>q.id));
      all.push(...incoming.filter(q=>!known.has(q.id)));
      offset+=incoming.length;
      hasMore=incoming.length===pageSize;
      populateSubjects();
      populateTopics();
      render();
    }catch(error){
      if(token!==requestToken) return;
      console.error('Answers & Explanations load error:',error);
      loadError='Unable to load more questions. Please try again.';
      if(!all.length){
        const fallback=collectBankQuestions();
        all=fallback.slice(0,pageSize);
        offset=all.length;
        hasMore=fallback.length>all.length;
        populateSubjects();
        populateTopics();
        if(!all.length){
          list.innerHTML='<div class="empty"><div class="empty-icon">!</div><h2>Could not load answers</h2><p>We could not connect to the JAMB question bank. Please refresh and try again.</p></div>';
          resultSummary.textContent='Question bank unavailable';
        }else{
          loadError='';
          render();
        }
      }
    }finally{
      if(token===requestToken){
        loading=false;
        render();
        if(pendingReset){
          pendingReset=false;
          loadQuestions({reset:true});
        }
      }
    }
  }

  function filtersChanged(){
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>loadQuestions({reset:true}),searchInput.value?250:0);
  }
  subjectFilter.addEventListener('change',()=>{populateTopics();filtersChanged();});
  typeFilter.addEventListener('change',()=>{populateTopics();filtersChanged();});
  topicFilter.addEventListener('change',filtersChanged);
  explanationFilter.addEventListener('change',filtersChanged);
  searchInput.addEventListener('input',filtersChanged);
  clearFilters.addEventListener('click',()=>{
    subjectFilter.value='all';
    typeFilter.value='all';
    explanationFilter.value='all';
    searchInput.value='';
    topicFilter.value='all';
    filtersChanged();
  });
  expandAll.addEventListener('click',()=>{
    expanded=!expanded;
    expandAll.textContent=expanded?'Collapse all':'Expand all';
    document.querySelectorAll('.explanation:not(.unavailable)').forEach(details=>{details.open=expanded;});
  });
  if(loadMore){
    loadMore.addEventListener('click',async()=>{
      if(filteredRows().length>renderLimit){
        renderLimit+=pageSize;
        render();
        return;
      }
      await loadQuestions();
    });
  }
  await loadQuestions({reset:true});
})();
