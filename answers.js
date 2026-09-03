(async function(){
  if (typeof window.ensurePremiumFeatureAccess === 'function') {
    const allowed = await window.ensurePremiumFeatureAccess({ featureName: 'Answers & Explanations', featureKey: 'answers' });
    if (!allowed) return;
  }
  const SUPABASE_URL = 'https://afdnfqmsjmpwlvhloopy.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V';
  const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  const localBank = (typeof window !== 'undefined' && (window.questionBanks || globalThis.questionBanks)) || (typeof questionBanks !== 'undefined' ? questionBanks : {});

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
  let all=[];
  let expanded=false;
  let answerState={};

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function letter(i){return String.fromCharCode(65+i);}
  function clampIndex(index){return Number.isInteger(index) && index >= 0 && index < 4 ? index : -1;}

  function normalizeAnswer(value){
    if (value === null || value === undefined) return '';
    const raw = String(value).trim().toUpperCase();
    if (!raw) return '';
    if (/^[A-D]$/.test(raw)) return raw;
    const match = raw.match(/[A-D]/);
    if (match) return match[0].toUpperCase();
    const direct = { OPTION_A:'A', OPTION_B:'B', OPTION_C:'C', OPTION_D:'D', OPTIONA:'A', OPTIONB:'B', OPTIONC:'C', OPTIOND:'D' };
    if (direct[raw]) return direct[raw];
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 4) return letter(numeric - 1);
    return '';
  }

  function normalizeQuestionRecord(record, index){
    const subject = String(record.Subject ?? record.subject ?? record.subjectName ?? 'Unknown').trim() || 'Unknown';
    const questionText = String(record.Question ?? record.question ?? record.prompt ?? '').trim();
    const type = String(record.test_type ?? record.type ?? record.questionType ?? 'practice').trim().toLowerCase() || 'practice';
    const optionValues = Array.isArray(record.options)
      ? record.options.slice(0,4)
      : [record.Option_a, record.Option_b, record.Option_c, record.Option_d, record.option_a, record.option_b, record.option_c, record.option_d, record.OptionA, record.OptionB, record.OptionC, record.OptionD];
    const options = optionValues.map(value => String(value ?? '').trim()).slice(0, 4);
    while (options.length < 4) options.push('');
    const answer = normalizeAnswer(record.Correct_Answer ?? record.correct_answer ?? record.answer ?? record.Answer ?? '');
    const explanation = String(record.Explanation ?? record.explanation ?? '').trim();
    const topic = String(record.Topic ?? record.topic ?? '').trim() || 'General';
    return {
      id: record.id ?? `${subject}-${index}-${String(questionText).slice(0, 24)}`,
      subject,
      type,
      question: questionText,
      options,
      answer,
      topic,
      explanation,
      index
    };
  }

  function answerIndex(question){
    if (!question || !question.answer) return -1;
    const letter = normalizeAnswer(question.answer);
    if (!letter) return -1;
    return letter.charCodeAt(0) - 65;
  }

  function hasExplanation(q){return Boolean(String(q.explanation||'').trim());}
  function topicOf(q){return String(q.topic||'').trim() || 'General';}
  function questionKey(row){return `${row.subject}::${row.id || row.question}`;}
  function selectedAnswerFor(row){return answerState[questionKey(row)] || null;}

  function collectBankQuestions(){
    const rows=[];
    Object.entries(localBank).forEach(([subject, data]) => {
      const practice = Array.isArray(data?.practice) ? data.practice : [];
      const past = Array.isArray(data?.past) ? data.past : [];
      [...practice, ...past].forEach((entry, idx) => {
        rows.push(normalizeQuestionRecord({ ...(entry || {}), Subject: entry?.Subject || subject, test_type: entry?.test_type || (idx < practice.length ? 'practice' : 'past') }, rows.length + 1));
      });
    });
    return rows;
  }

  async function loadQuestions(){
    list.innerHTML='<div class="empty"><div class="empty-icon">…</div><h2>Loading answers</h2><p>Connecting to the JAMB question bank…</p></div>';
    let rows=[];
    const pageSize=1000;
    try{
      if (supabaseClient) {
        for (let from=0;;from+=pageSize) {
          const { data, error } = await supabaseClient
            .from('Questions')
            .select('id, Subject, test_type, Question, Option_a, Option_b, Option_c, Option_d, Correct_Answer, Topic, explanation, Explanation')
            .range(from, from + pageSize - 1);
          if (error) throw error;
          const page = Array.isArray(data) ? data : [];
          rows.push(...page.map((record, idx) => normalizeQuestionRecord(record, from + idx + 1)));
          if (page.length < pageSize) break;
        }
      }
      if (!rows.length && Object.keys(localBank).length) {
        rows = collectBankQuestions();
      }
      all = rows.filter(q => q.question && q.options.some(option => String(option).trim()));
      populateSubjects();
      populateTopics();
      render();
    }catch(error){
      console.error('Answers & Explanations load error:', error);
      all = collectBankQuestions();
      if (!all.length) {
        list.innerHTML='<div class="empty"><div class="empty-icon">!</div><h2>Could not load answers</h2><p>We could not connect to the JAMB question bank. Please refresh and try again.</p></div>';
        resultSummary.textContent='Question bank unavailable';
        return;
      }
      populateSubjects();
      populateTopics();
      render();
    }
  }

  function populateSubjects(){
    const subjects=[...new Set(all.map(q=>q.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    subjectFilter.innerHTML='<option value="all">All Subjects</option>'+subjects.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }

  function populateTopics(){
    const selectedSubject=subjectFilter.value, selectedType=typeFilter.value, previous=topicFilter.value;
    const topics=new Set();
    all.forEach(q=>{
      if(selectedSubject!=='all'&&q.subject!==selectedSubject)return;
      if(selectedType!=='all'&&q.type!==selectedType)return;
      topics.add(topicOf(q));
    });
    const sorted=[...topics].sort((a,b)=>a.localeCompare(b));
    topicFilter.innerHTML='<option value="all">All Topics</option>'+sorted.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if(sorted.includes(previous))topicFilter.value=previous;
  }

  function filteredRows(){
    const selectedSubject=subjectFilter.value;
    const selectedType=typeFilter.value;
    const selectedTopic=topicFilter.value;
    const availability=explanationFilter.value;
    const query=searchInput.value.trim().toLowerCase();

    return all.filter(row=>{
      if(selectedSubject!=='all'&&row.subject!==selectedSubject)return false;
      if(selectedType!=='all'&&row.type!==selectedType)return false;
      if(selectedTopic!=='all'&&topicOf(row)!==selectedTopic)return false;
      const hasText = hasExplanation(row);
      if(availability==='available'&&!hasText)return false;
      if(availability==='missing'&&hasText)return false;
      if(query){
        const haystack=[row.question,row.subject,topicOf(row),...row.options,row.explanation].join(' ').toLowerCase();
        if(!haystack.includes(query))return false;
      }
      return true;
    });
  }

  function render(){
    const rows=filteredRows();
    const visibleKeys = new Set(rows.map(questionKey));
    Object.keys(answerState).forEach(key => { if (!visibleKeys.has(key)) delete answerState[key]; });
    const withExplanations=all.filter(hasExplanation).length;
    totalCount.textContent=all.length;
    subjectCount.textContent=new Set(all.map(q=>q.subject)).size;
    explanationCount.textContent=withExplanations;
    visibleCount.textContent=rows.length;
    resultSummary.textContent=rows.length?`Showing ${rows.length} question${rows.length===1?'':'s'} of ${all.length}`:'No questions match your filters';

    if(!rows.length){
      list.innerHTML='<div class="empty"><div class="empty-icon">⌕</div><h2>No questions found</h2><p>Try another subject, topic, question type, explanation filter or search term.</p></div>';
      return;
    }

    list.innerHTML=rows.map(row => {
      const questionId = questionKey(row);
      const selectedLetter = selectedAnswerFor(row);
      const selectedIndex = selectedLetter ? normalizeAnswer(selectedLetter).charCodeAt(0) - 65 : -1;
      const correctIndex = answerIndex(row);
      const answerText = correctIndex >=0 ? row.options[correctIndex] || 'Answer not available' : 'Answer not available';
      const isAnswered = Boolean(selectedLetter);
      const isCorrect = selectedLetter && normalizeAnswer(selectedLetter) === normalizeAnswer(row.answer);

      const optionsMarkup = row.options.map((option, index) => {
        const letterValue = letter(index);
        const isCorrectOption = index === correctIndex;
        const isSelected = selectedLetter === letterValue;
        const classes = ['option'];
        if (isCorrectOption) classes.push('correct');
        if (isSelected && !isCorrectOption) classes.push('wrong');
        if (isSelected) classes.push('selected');
        const detail = isCorrectOption ? '<span class="correct-mark">Correct</span>' : (isSelected && !isCorrectOption ? '<span class="wrong-mark">Your answer</span>' : '');
        return `<button type="button" class="${classes.join(' ')}" data-question-key="${escapeHtml(questionId)}" data-answer="${letterValue}" aria-pressed="${isSelected}"><span class="option-letter">${letterValue}</span><span class="option-text">${escapeHtml(option || 'Option not available')}</span>${detail}</button>`;
      }).join('');

      const explanationContent = row.explanation
        ? `<div class="explanation-body"><p><strong>Correct answer:</strong> ${correctIndex >=0 ? letter(correctIndex) + '. ' : ''}${escapeHtml(answerText)}</p><p>${escapeHtml(row.explanation)}</p></div>`
        : `<div class="explanation-body"><p><strong>Correct answer:</strong> ${correctIndex >=0 ? letter(correctIndex) + '. ' : ''}${escapeHtml(answerText)}</p><p>Explanation not available.</p></div>`;

      const explanationMarkup = isAnswered
        ? `<div class="answer-status ${isCorrect ? 'correct' : 'wrong'}">${isCorrect ? '✓ Correct' : '✕ Incorrect'} — your answer: ${selectedLetter || 'Not selected'}</div>${row.explanation ? `<details class="explanation" ${expanded ? 'open' : ''}><summary>View explanation</summary>${explanationContent}</details>` : `<div class="explanation unavailable"><div class="unavailable-title">Explanation not available</div>${explanationContent}</div>`}`
        : `<div class="answer-status neutral">Select an answer to reveal the explanation.</div>${row.explanation ? `<details class="explanation" ${expanded ? 'open' : ''}><summary>View explanation</summary>${explanationContent}</details>` : `<div class="explanation unavailable"><div class="unavailable-title">Explanation not available</div>${explanationContent}</div>`}`;

      return `<article class="question-card"><div class="question-meta"><span>${escapeHtml(row.subject)}</span><span>${row.type==='past'?'Past Question':'Practice Question'}</span><span>${escapeHtml(topicOf(row))}</span><span>Question ${row.index}</span></div><h2>${escapeHtml(row.question)}</h2><div class="options">${optionsMarkup}</div>${explanationMarkup}</article>`;
    }).join('');

    document.querySelectorAll('[data-question-key]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-question-key');
        const answer = button.getAttribute('data-answer');
        if (!key || !answer) return;
        answerState[key] = answer;
        render();
      });
    });
  }

  subjectFilter.addEventListener('change',()=>{populateTopics();render();});
  typeFilter.addEventListener('change',()=>{populateTopics();render();});
  topicFilter.addEventListener('change',render);
  explanationFilter.addEventListener('change',render);
  searchInput.addEventListener('input',render);
  clearFilters.addEventListener('click',()=>{subjectFilter.value='all';typeFilter.value='all';explanationFilter.value='all';searchInput.value='';populateTopics();topicFilter.value='all';answerState={};render();});
  expandAll.addEventListener('click',()=>{expanded=!expanded;expandAll.textContent=expanded?'Collapse all':'Expand all';document.querySelectorAll('.explanation:not(.unavailable)').forEach(d => { d.open = expanded; });});
  loadQuestions();
})();
