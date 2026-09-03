const SUPABASE_URL = "https://afdnfqmsjmpwlvhloopy.supabase.co";
const SUPABASE_KEY = "sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V";
const detailsSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const escapeHTML = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const formatDuration = seconds => { const s=Math.max(0,Number(seconds)||0); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };

async function loadResultDetails(){
    const params=new URLSearchParams(location.search); const id=Number(params.get("id"));
    let result=null;
    try {
        const {data,error}=await detailsSupabase.auth.getSession();
        if(!error && data.session){
            const userId=data.session.user.id;
            const results=JSON.parse(localStorage.getItem("jambResults")||"[]");
            result=results.find(r=>Number(r.id)===id && (!r.userId || r.userId===userId));
        }
    } catch(err){ console.error('Result detail loading error:',err); }
    if(!result){ document.body.innerHTML='<main class="details-page"><div class="empty"><h2>Result not found</h2><p>This result may have been cleared from your browser or belongs to another student.</p><button class="primary-action" onclick="location.href=\'results.html\'">Back to Results</button></div></main>'; return; }
    document.getElementById("pageTitle").textContent=(result.testType==='past'?'Past Questions':'Practice Test')+' Analysis';
    document.getElementById("pageMeta").textContent=new Date(result.date).toLocaleString()+" • "+(result.subjects||[]).join(", ");
    const overview=document.getElementById("overview"); overview.innerHTML=`<section class="analysis-hero"><div class="analysis-score"><span>Overall Score</span><strong>${Number(result.percentage)||0}%</strong><small>${Number(result.score)||0}/${Number(result.total)||0} correct</small></div><div class="analysis-stat"><span>Time Used</span><strong>${formatDuration(result.timeUsed)}</strong><small>of ${formatDuration(result.timeAllowed)}</small></div><div class="analysis-stat"><span>Correct</span><strong>${Number(result.correct)||0}</strong></div><div class="analysis-stat"><span>Wrong</span><strong>${Number(result.wrong)||0}</strong></div><div class="analysis-stat"><span>Unanswered</span><strong>${Number(result.unanswered)||0}</strong></div></section>`;
    const stats=result.subjectStats||[]; document.getElementById("subjectBreakdown").innerHTML=stats.map(s=>`<article class="subject-result-card"><div class="subject-result-head"><strong>${escapeHTML(s.subject)}</strong><span>${Number(s.percentage)||0}%</span></div><div class="subject-bar"><span style="width:${Number(s.percentage)||0}%"></span></div><div class="subject-result-meta"><span>${s.correct||0} correct</span><span>${s.wrong||0} wrong</span><span>${s.unanswered||0} unanswered</span><span>${s.total||0} total</span></div></article>`).join("");
    const container=document.getElementById("questionReview"); const render=filter=>{ const items=result.questionDetails||[]; const filtered=items.filter(q=>filter==='all'||(filter==='correct'&&q.isCorrect)||(filter==='wrong'&&!q.isCorrect&&!q.unanswered)||(filter==='unanswered'&&q.unanswered)); container.innerHTML=filtered.map(q=>`<article class="question-analysis ${q.isCorrect?'is-correct':q.unanswered?'is-unanswered':'is-wrong'}"><div class="qa-head"><div><span class="qa-number">Question ${q.number}</span><span class="qa-subject">${escapeHTML(q.subject)}</span></div><strong>${q.isCorrect?'✓ Correct':q.unanswered?'— Unanswered':'✕ Wrong'}</strong></div><p class="qa-question">${escapeHTML(q.question)}</p><div class="qa-options">${(q.options||[]).map((opt,i)=>{const letter=String.fromCharCode(65+i); const chosen=q.userAnswer===letter; const correct=q.correctAnswer===letter; return `<div class="qa-option ${correct?'correct-option':''} ${chosen&&!correct?'wrong-option':''}"><span>${letter}</span><div>${escapeHTML(opt)}</div>${correct?'<b>Correct</b>':chosen&&!correct?'<b>Your answer</b>':''}</div>`}).join("")}</div><div class="qa-meta"><span>Your answer: <strong>${escapeHTML(q.userAnswer||'Not answered')}</strong></span><span>Correct: <strong>${escapeHTML(q.correctAnswer)}</strong></span><span>Time: <strong>${formatDuration(q.timeSpent)}</strong></span></div>${q.explanation?`<div class="qa-explanation"><strong>Explanation</strong><p>${escapeHTML(q.explanation)}</p></div>`:''}</article>`).join("")||'<div class="empty"><p>No questions match this filter.</p></div>'; };
    document.querySelectorAll('.filter-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');render(btn.dataset.filter);})); render('all');
}
loadResultDetails();
