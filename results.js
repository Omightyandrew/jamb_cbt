const SUPABASE_URL = "https://afdnfqmsjmpwlvhloopy.supabase.co";
const SUPABASE_KEY = "sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V";
const resultsSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function formatDuration(seconds){
    const total=Math.max(0,Number(seconds)||0);
    return Math.floor(total/60)+":"+String(total%60).padStart(2,"0");
}
function escapeHtml(value){
    return String(value ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function getStoredResults(){
    try { return JSON.parse(localStorage.getItem('jambResults')||'[]'); }
    catch { return []; }
}

async function loadResults(){
    const list=document.getElementById('resultsList');
    try {
        const {data,error}=await resultsSupabase.auth.getSession();
        if(error || !data.session){
            list.innerHTML='<div class="empty"><h2>Please log in</h2><p>Log in as a student to view your CBT results.</p><button class="back" onclick="location.href=\'student.html\'">Login</button></div>';
            return;
        }
        const userId=data.session.user.id;
        const allResults=getStoredResults();
        // New results are tagged with the authenticated student ID. Legacy results without
        // a userId are retained for backward compatibility on this browser.
        const results=allResults.filter(r=>!r.userId || r.userId===userId);
        document.getElementById('testsTaken').textContent=results.length;
        const average=results.length?Math.round(results.reduce((sum,r)=>sum+(Number(r.percentage)||0),0)/results.length):0;
        const best=results.length?Math.max(...results.map(r=>Number(r.percentage)||0)):0;
        document.getElementById('averageScore').textContent=average+'%';
        document.getElementById('bestScore').textContent=best+'%';
        if(!results.length){
            list.innerHTML='<div class="empty"><h2>No results yet</h2><p>Complete a CBT practice test and your result will appear here.</p><button class="back" onclick="location.href=\'subject.html\'">Start CBT</button></div>';
            return;
        }
        list.innerHTML=results.map(r=>{
            const date=new Date(r.date);
            const type=r.testType==='past'?'Past Questions':'Practice Test';
            return `<article class="result-card">
                <div class="result-head"><div><h3>${escapeHtml(type)}</h3><div class="muted">${escapeHtml(date.toLocaleString())}</div></div><span class="badge">${Number(r.percentage)||0}%</span></div>
                <div class="details"><span class="pill">Subjects: ${escapeHtml((r.subjects||[]).join(', '))}</span><span class="pill">Score: ${Number(r.score)||0}/${Number(r.total)||0}</span><span class="pill">Correct: ${Number(r.correct)||0}</span><span class="pill">Wrong: ${Number(r.wrong)||0}</span><span class="pill">Unanswered: ${Number(r.unanswered)||0}</span><span class="pill">Time: ${formatDuration(r.timeUsed)}</span></div>
                <div class="result-card-actions"><button class="back" onclick="location.href='result-details.html?id=${encodeURIComponent(r.id)}'">View Full Analysis</button></div>
            </article>`;
        }).join('');
    } catch(err) {
        console.error('Results loading error:',err);
        list.innerHTML='<div class="empty"><h2>Unable to load results</h2><p>Please refresh the page and try again.</p><button class="back" onclick="location.reload()">Refresh</button></div>';
    }
}
loadResults();
