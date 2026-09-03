const brochureData = [
 {course:'Medicine and Surgery',category:'Medical & Health Sciences',subjects:['Use of English','Biology','Chemistry','Physics'],olevel:'English Language, Mathematics, Biology, Chemistry and Physics are commonly relevant.',note:'Exact requirements and institution-specific conditions must be checked in IBASS.'},
 {course:'Nursing Science',category:'Medical & Health Sciences',subjects:['Use of English','Biology','Chemistry','Physics'],olevel:'Relevant credits commonly include English, Mathematics, Biology, Chemistry and Physics.',note:'Verify the institution and programme requirements in IBASS before selecting.'},
 {course:'Medical Laboratory Science',category:'Medical & Health Sciences',subjects:['Use of English','Biology','Chemistry','Physics'],olevel:'Relevant science credits are commonly required alongside English and Mathematics.',note:'Check institution-specific professional and subject requirements in IBASS.'},
 {course:'Pharmacy',category:'Medical & Health Sciences',subjects:['Use of English','Biology','Chemistry','Physics'],olevel:'English, Mathematics, Biology, Chemistry and Physics are commonly relevant.',note:'Confirm the exact combination and O’level requirements for your institution.'},
 {course:'Computer Science',category:'Computing & Technology',subjects:['Use of English','Mathematics','Physics','Chemistry'],olevel:'English and Mathematics are central; relevant science subjects are commonly required.',note:'Some institutions may specify different fourth-subject or O’level details.'},
 {course:'Software Engineering',category:'Computing & Technology',subjects:['Use of English','Mathematics','Physics','Chemistry'],olevel:'English, Mathematics and relevant science/technology subjects are commonly required.',note:'Verify the programme title and requirements in IBASS because institutions can differ.'},
 {course:'Information Technology',category:'Computing & Technology',subjects:['Use of English','Mathematics','Physics','Economics'],olevel:'English and Mathematics are commonly important, with relevant supporting subjects.',note:'Use IBASS to verify the exact institution-specific combination.'},
 {course:'Electrical/Electronics Engineering',category:'Engineering',subjects:['Use of English','Mathematics','Physics','Chemistry'],olevel:'English, Mathematics, Physics and Chemistry are commonly relevant.',note:'Engineering requirements can vary by institution; verify in IBASS.'},
 {course:'Mechanical Engineering',category:'Engineering',subjects:['Use of English','Mathematics','Physics','Chemistry'],olevel:'English, Mathematics, Physics and Chemistry are commonly relevant.',note:'Verify the exact programme requirements in IBASS.'},
 {course:'Civil Engineering',category:'Engineering',subjects:['Use of English','Mathematics','Physics','Chemistry'],olevel:'English, Mathematics, Physics and Chemistry are commonly relevant.',note:'Check the institution-specific IBASS entry.'},
 {course:'Accounting',category:'Business & Management',subjects:['Use of English','Mathematics','Economics','Government'],olevel:'English and Mathematics are commonly important with relevant commercial/social science subjects.',note:'Subject requirements can differ by institution; verify in IBASS.'},
 {course:'Business Administration',category:'Business & Management',subjects:['Use of English','Mathematics','Economics','Government'],olevel:'English, Mathematics and relevant commercial/social science subjects are commonly useful.',note:'Confirm the exact combination in IBASS.'},
 {course:'Economics',category:'Social Sciences',subjects:['Use of English','Mathematics','Economics','Government'],olevel:'English and Mathematics are commonly required with relevant social science subjects.',note:'Verify the exact institution and programme requirements.'},
 {course:'Mass Communication',category:'Arts & Social Sciences',subjects:['Use of English','Literature in English','Government','Economics'],olevel:'English and relevant arts/social science credits are commonly important.',note:'Check institution-specific requirements and any special conditions in IBASS.'},
 {course:'Law',category:'Law & Humanities',subjects:['Use of English','Literature in English','Government','CRK/IRK'],olevel:'English, Literature and relevant arts/social science credits are commonly important.',note:'Law requirements can be institution-specific. Verify in IBASS.'},
 {course:'Political Science',category:'Social Sciences',subjects:['Use of English','Government','Economics','Literature in English'],olevel:'English and relevant social science/arts subjects are commonly required.',note:'Verify the institution-specific combination in IBASS.'},
 {course:'Psychology',category:'Social Sciences',subjects:['Use of English','Biology','Economics','Government'],olevel:'English and relevant science/social science subjects are commonly considered.',note:'Check exact institutional requirements in IBASS.'},
 {course:'Biochemistry',category:'Pure & Applied Sciences',subjects:['Use of English','Biology','Chemistry','Physics'],olevel:'English, Mathematics, Biology, Chemistry and Physics are commonly relevant.',note:'Verify the exact programme requirements in IBASS.'},
 {course:'Microbiology',category:'Pure & Applied Sciences',subjects:['Use of English','Biology','Chemistry','Physics'],olevel:'Relevant science credits commonly include Biology, Chemistry and Physics with English and Mathematics.',note:'Confirm exact requirements in IBASS.'},
 {course:'Mathematics',category:'Pure & Applied Sciences',subjects:['Use of English','Mathematics','Physics','Chemistry'],olevel:'English, Mathematics and relevant science subjects are commonly important.',note:'Check your chosen institution in IBASS for the exact combination.'}
];

const grid=document.getElementById('brochureGrid');
const search=document.getElementById('searchInput');
const categoryFilter=document.getElementById('categoryFilter');
const subjectFilter=document.getElementById('subjectFilter');
const activeFilters=document.getElementById('activeFilters');
const modal=document.getElementById('courseModal');
const modalClose=document.getElementById('modalClose');
const supabaseClient = window.supabase ? window.supabase.createClient('https://afdnfqmsjmpwlvhloopy.supabase.co', 'sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V') : null;

function isPremiumSubscriptionRecord(row){
  if(!row) return false;
  const status = String(row.status ?? row.subscription_status ?? row.plan_status ?? row.payment_status ?? '').trim().toLowerCase();
  const expires = row.expires_at ?? row.expiresAt ?? row.current_period_end ?? row.ends_at ?? null;
  const isStatusActive = ['active','paid','premium','subscribed','success','successful','succeeded','completed'].includes(status);
  let notExpired = true;
  if (expires) {
    const exp = new Date(expires);
    notExpired = !Number.isNaN(exp.getTime()) ? exp > new Date() : true;
  }
  return isStatusActive && notExpired;
}

async function ensurePremiumAccess(){
  if (typeof window.ensurePremiumFeatureAccess === 'function') {
    return window.ensurePremiumFeatureAccess({ featureName: 'JAMB Brochure', featureKey: 'brochure' });
  }
  if (!supabaseClient) return true;
  return true;
}

const categories=[...new Set(brochureData.map(x=>x.category))].sort();
const subjects=[...new Set(brochureData.flatMap(x=>x.subjects))].sort();
categories.forEach(x=>categoryFilter.insertAdjacentHTML('beforeend',`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`));
subjects.forEach(x=>subjectFilter.insertAdjacentHTML('beforeend',`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`));

document.getElementById('courseCount').textContent=brochureData.length;
document.getElementById('subjectCount').textContent=subjects.length;
document.getElementById('categoryCount').textContent=categories.length;

function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function getFiltered(){const q=search.value.trim().toLowerCase(), c=categoryFilter.value, s=subjectFilter.value;return brochureData.filter(x=>{const hay=[x.course,x.category,x.olevel,x.note,...x.subjects].join(' ').toLowerCase();return (!q||hay.includes(q))&&(c==='all'||x.category===c)&&(s==='all'||x.subjects.includes(s));});}
function render(){const data=getFiltered();activeFilters.innerHTML='';if(search.value.trim())addFilter(`Search: ${search.value.trim()}`);if(categoryFilter.value!=='all')addFilter(categoryFilter.value);if(subjectFilter.value!=='all')addFilter(subjectFilter.value);grid.innerHTML=data.length?data.map((x,i)=>`<article class="brochure-card"><div class="card-top"><span class="category-tag">${escapeHtml(x.category)}</span><span class="course-index">${String(i+1).padStart(2,'0')}</span></div><h3>${escapeHtml(x.course)}</h3><p>${escapeHtml(x.note)}</p><div class="subjects">${x.subjects.map(s=>`<span>${escapeHtml(s)}</span>`).join('')}</div><button class="details-button" data-course="${escapeHtml(x.course)}">View course details <span>→</span></button></article>`).join(''):`<div class="empty-state"><div>⌕</div><h3>No matching course</h3><p>Try another course, category or subject.</p><button id="clearFilters">Clear filters</button></div>`;grid.querySelectorAll('[data-course]').forEach(btn=>btn.addEventListener('click',()=>openCourse(btn.dataset.course)));const clear=document.getElementById('clearFilters');if(clear)clear.addEventListener('click',clearAll);}
function addFilter(text){const b=document.createElement('button');b.className='filter-chip';b.textContent=text+' ×';b.onclick=clearAll;activeFilters.appendChild(b);}
function clearAll(){search.value='';categoryFilter.value='all';subjectFilter.value='all';render();}
function openCourse(course){const x=brochureData.find(v=>v.course===course);if(!x)return;document.getElementById('modalCategory').textContent=x.category;document.getElementById('modalTitle').textContent=x.course;document.getElementById('modalDescription').textContent='Planning guide for '+x.course+'. Use the official IBASS checker for the final programme-specific result.';document.getElementById('modalSubjects').innerHTML=x.subjects.map(s=>`<span>${escapeHtml(s)}</span>`).join('');document.getElementById('modalOlevel').textContent=x.olevel;document.getElementById('modalNote').textContent=x.note;modal.classList.add('show');modal.setAttribute('aria-hidden','false');document.body.classList.add('modal-open');modalClose.focus();}
function closeModal(){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');document.body.classList.remove('modal-open');}
search.addEventListener('input',render);categoryFilter.addEventListener('change',render);subjectFilter.addEventListener('change',render);modalClose.addEventListener('click',closeModal);modal.addEventListener('click',e=>{if(e.target.dataset.close==='true')closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
(async () => {
  const allowed = await ensurePremiumAccess();
  if (!allowed) return;
  render();
})();
