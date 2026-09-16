(() => {
  const legacyLocalSyllabus = {
    "English": {
      icon: "📝", subtitle: "Use of English",
      overview: "Build comprehension, vocabulary, grammar and oral English skills for UTME preparation.",
      sections: [{"title": "Comprehension & Summary", "topics": ["Description and narration", "Exposition and argumentation", "Main ideas and topic sentences", "Inference and implied meaning", "Vocabulary and expressions in context", "Synthesis of ideas"]}, {"title": "Lexis & Structure", "topics": ["Synonyms and antonyms", "Sentence completion", "Idioms and figurative expressions", "Grammar and concord", "Parts of speech", "Word formation and usage"]}, {"title": "Oral Forms", "topics": ["Vowel sounds", "Consonant sounds", "Rhyming words", "Word stress", "Emphasis and intonation"]}, {"title": "Literature & Reading", "topics": ["Literary appreciation", "Prose and poetry concepts", "Drama concepts", "The prescribed reading text"]}]
    },
    "Mathematics": {
      icon: "📐", subtitle: "UTME Mathematics",
      overview: "Revise number, algebra, geometry, statistics and other core mathematical skills.",
      sections: [{"title": "Number & Numeration", "topics": ["Number bases", "Fractions, decimals and percentages", "Indices, logarithms and surds", "Ratio, proportion and variation", "Sets and operations"]}, {"title": "Algebra", "topics": ["Algebraic expressions", "Linear equations and inequalities", "Quadratic equations", "Simultaneous equations", "Sequences and series", "Functions"]}, {"title": "Geometry & Trigonometry", "topics": ["Angles and triangles", "Polygons and circles", "Mensuration", "Coordinate geometry", "Trigonometric ratios and identities"]}, {"title": "Statistics & Probability", "topics": ["Data collection and presentation", "Mean, median and mode", "Measures of dispersion", "Probability", "Frequency distributions"]}, {"title": "Calculus", "topics": ["Limits and continuity", "Differentiation", "Applications of differentiation", "Integration", "Applications of integration"]}]
    },
    "Physics": {
      icon: "⚡", subtitle: "UTME Physics",
      overview: "Study mechanics, thermal physics, waves, electricity, magnetism and modern physics.",
      sections: [{"title": "Mechanics", "topics": ["Measurement and units", "Motion", "Scalars and vectors", "Forces and equilibrium", "Work, energy and power", "Momentum and collisions", "Gravitation"]}, {"title": "Heat & Thermal Physics", "topics": ["Temperature and thermometry", "Thermal expansion", "Heat transfer", "Change of state", "Gas laws"]}, {"title": "Waves & Optics", "topics": ["Wave motion", "Sound", "Reflection", "Refraction", "Lenses", "Electromagnetic waves"]}, {"title": "Electricity & Magnetism", "topics": ["Electrostatics", "Current electricity", "Electrical circuits", "Magnetic fields", "Electromagnetic induction", "Alternating current"]}, {"title": "Modern Physics", "topics": ["Atomic structure", "Photoelectric effect", "Radioactivity", "Nuclear energy", "Semiconductors"]}]
    },
    "Chemistry": {
      icon: "🧪", subtitle: "UTME Chemistry",
      overview: "Revise atomic structure, bonding, calculations, inorganic and organic chemistry.",
      sections: [{"title": "Atomic Structure & Bonding", "topics": ["Particles of matter", "Atomic structure", "Electronic configuration", "Periodic table", "Chemical bonding"]}, {"title": "Stoichiometry & Energetics", "topics": ["Mole concept", "Chemical equations", "Empirical and molecular formulae", "Gas laws", "Energy changes in reactions"]}, {"title": "States of Matter", "topics": ["Kinetic theory", "Properties of solids", "Properties of liquids", "Properties of gases", "Solutions"]}, {"title": "Acids, Bases & Salts", "topics": ["Properties of acids and bases", "pH and indicators", "Neutralisation", "Solubility", "Salt preparation"]}, {"title": "Organic Chemistry", "topics": ["Hydrocarbons", "Functional groups", "Isomerism", "Alcohols and acids", "Polymers", "Petroleum chemistry"]}, {"title": "Environmental Chemistry", "topics": ["Air pollution", "Water pollution", "Greenhouse effect", "Ozone depletion", "Water treatment"]}]
    },
    "Biology": {
      icon: "🧬", subtitle: "UTME Biology",
      overview: "Cover cell biology, life processes, genetics, evolution, ecology and biological systems.",
      sections: [{"title": "Cell Biology", "topics": ["Cell structure and functions", "Cell organisation", "Cell division", "Tissues and organs", "Transport across membranes"]}, {"title": "Nutrition & Life Processes", "topics": ["Modes of nutrition", "Photosynthesis", "Respiration", "Digestion", "Excretion"]}, {"title": "Transport & Coordination", "topics": ["Transport in plants", "Transport in animals", "Nervous coordination", "Hormonal coordination", "Homeostasis"]}, {"title": "Reproduction & Genetics", "topics": ["Asexual reproduction", "Sexual reproduction", "Human reproduction", "Inheritance", "Variation and mutation"]}, {"title": "Evolution & Ecology", "topics": ["Evidence of evolution", "Natural selection", "Population studies", "Food chains and webs", "Ecological factors", "Conservation"]}]
    },
    "Government": {
      icon: "🏛️", subtitle: "UTME Government",
      overview: "Understand political institutions, constitutional development, citizenship, elections and international relations.",
      sections: [{"title": "Political Concepts", "topics": ["State, nation and sovereignty", "Power, authority and legitimacy", "Democracy and rule of law", "Political culture and socialization"]}, {"title": "Constitutional Development", "topics": ["Constitutions and constitutionalism", "Pre-independence constitutional development", "Post-independence constitutions", "Federalism and separation of powers"]}, {"title": "Political Parties & Elections", "topics": ["Political parties", "Party systems", "Electoral systems", "Electoral commissions", "Voting and representation"]}, {"title": "Public Administration", "topics": ["Public service", "Civil service", "Local government", "Public corporations", "Pressure groups and public opinion"]}, {"title": "Foreign Policy & International Relations", "topics": ["Nigeria foreign policy", "Diplomatic relations", "International organizations", "ECOWAS", "African Union", "United Nations"]}]
    },
    "Literature": {
      icon: "📚", subtitle: "UTME Literature in English",
      overview: "Develop skills in prose, poetry, drama, literary devices, themes and appreciation.",
      sections: [{"title": "Literary Concepts", "topics": ["Genre", "Plot", "Setting", "Characterization", "Theme", "Point of view"]}, {"title": "Poetry", "topics": ["Poetic forms", "Figures of speech", "Sound devices", "Tone and mood", "Imagery and symbolism"]}, {"title": "Prose", "topics": ["Narrative techniques", "Character and conflict", "Theme and setting", "Point of view", "Style"]}, {"title": "Drama", "topics": ["Dramatic structure", "Dialogue and stagecraft", "Characterization", "Conflict", "Tragedy and comedy"]}, {"title": "African & Non-African Literature", "topics": ["African prose", "African poetry", "African drama", "Non-African prose", "Non-African poetry", "Non-African drama"]}]
    },
    "Economics": {
      icon: "💹", subtitle: "UTME Economics",
      overview: "Study economic principles, markets, production, national income, public finance and development.",
      sections: [{"title": "Basic Economic Concepts", "topics": ["Scarcity and choice", "Opportunity cost", "Production possibility curve", "Factors of production", "Economic systems"]}, {"title": "Demand & Supply", "topics": ["Law of demand", "Law of supply", "Elasticity", "Market equilibrium", "Price determination"]}, {"title": "Production & Cost", "topics": ["Division of labour", "Scale of production", "Fixed and variable costs", "Revenue", "Productivity"]}, {"title": "Market Structures", "topics": ["Perfect competition", "Monopoly", "Monopolistic competition", "Oligopoly"]}, {"title": "National Income", "topics": ["GDP and GNP", "Income measurement", "Circular flow", "Per capita income", "National income problems"]}, {"title": "Money & Banking", "topics": ["Functions of money", "Commercial banks", "Central bank", "Credit creation", "Monetary policy"]}, {"title": "Public Finance & Development", "topics": ["Government revenue", "Taxation", "Public expenditure", "Budget", "Inflation", "Unemployment", "Economic growth and development"]}]
    },
    "Commerce": {
      icon: "🛒", subtitle: "UTME Commerce",
      overview: "Understand trade, business organization, finance, insurance, transport, banking and other aids to trade.",
      sections: [{"title": "Commerce & Occupation", "topics": ["Meaning and scope of commerce", "Occupation", "Production and specialization", "Trade and exchange"]}, {"title": "Trade", "topics": ["Home trade", "Foreign trade", "Wholesale trade", "Retail trade", "Channels of distribution"]}, {"title": "Aids to Trade", "topics": ["Banking", "Insurance", "Transportation", "Communication", "Warehousing", "Advertising"]}, {"title": "Business Organizations", "topics": ["Sole proprietorship", "Partnership", "Companies", "Co-operatives", "Public enterprises"]}, {"title": "Business Finance", "topics": ["Sources of finance", "Capital market", "Stock exchange", "Financial institutions"]}, {"title": "International Commerce", "topics": ["Balance of trade", "Balance of payments", "Exchange rates", "Trade documents", "International trade organizations"]}]
    },
    "Accounting": {
      icon: "🧾", subtitle: "UTME Financial Accounting",
      overview: "Build practical accounting skills from source documents through final accounts and analysis.",
      sections: [{"title": "Accounting Foundations", "topics": ["Meaning and objectives of accounting", "Accounting concepts", "Accounting equation", "Double-entry principles"]}, {"title": "Books & Records", "topics": ["Source documents", "Books of original entry", "Ledger accounts", "Trial balance", "Correction of errors"]}, {"title": "Cash & Banking", "topics": ["Cash book", "Petty cash book", "Bank reconciliation statement", "Banking transactions"]}, {"title": "Final Accounts", "topics": ["Trading account", "Profit and loss account", "Statement of financial position", "Adjustments"]}, {"title": "Special Accounts", "topics": ["Manufacturing accounts", "Partnership accounts", "Company accounts", "Non-profit organizations", "Public sector accounts"]}, {"title": "Analysis & Control", "topics": ["Control accounts", "Incomplete records", "Accounting ratios", "Cost accounting", "Budgeting"]}]
    },
    "Geography": {
      icon: "🌍", subtitle: "UTME Geography",
      overview: "Study map work, physical and human geography, Nigeria, Africa and world regional geography.",
      sections: [{"title": "Map Work", "topics": ["Scale", "Direction and bearings", "Grid references", "Relief representation", "Map interpretation"]}, {"title": "Physical Geography", "topics": ["Earth structure", "Rocks", "Weathering", "Erosion and deposition", "Landforms"]}, {"title": "Weather & Climate", "topics": ["Atmosphere", "Elements of weather", "Climate types", "Climatic factors", "Climate change"]}, {"title": "Soils & Vegetation", "topics": ["Soil formation", "Soil profiles", "Vegetation zones", "Natural resources", "Conservation"]}, {"title": "Human Geography", "topics": ["Population", "Migration", "Settlement", "Urbanization", "Economic activities"]}, {"title": "Nigeria & Regional Geography", "topics": ["Regions of Nigeria", "Agriculture", "Industry and mining", "Transportation", "West Africa", "Africa and world regions"]}]
    },
    "CRS": {
      icon: "✝️", subtitle: "Christian Religious Studies",
      overview: "Study biblical events, teachings, Christian leadership, salvation, the early church and Christian living.",
      sections: [{"title": "Old Testament Foundations", "topics": ["Creation and the fall", "Call of Abraham", "Covenant", "Moses and the Exodus", "The Ten Commandments"]}, {"title": "Leadership & Prophets", "topics": ["Joshua and Judges", "Samuel and Saul", "David and Solomon", "Prophets and their messages", "Justice and social responsibility"]}, {"title": "Wisdom & Prophetic Literature", "topics": ["Wisdom literature", "Psalms and Proverbs", "Major prophets", "Minor prophets", "Faith and obedience"]}, {"title": "Life and Ministry of Jesus", "topics": ["Birth and baptism", "Temptation", "Teachings and parables", "Miracles", "Discipleship"]}, {"title": "Death & Resurrection", "topics": ["Last Supper", "Arrest and trial", "Crucifixion", "Resurrection", "Ascension"]}, {"title": "Early Church & Christian Living", "topics": ["Pentecost", "Early church fellowship", "Pauline missions", "Christian virtues", "Love, service and forgiveness"]}]
    },
    "History": {
      icon: "🏺", subtitle: "UTME History",
      overview: "Study Nigerian, African and world history, historical change, nationalism and political development.",
      sections: [{"title": "Precolonial West Africa", "topics": ["Early societies", "Hausa states", "Kanem-Borno", "Yoruba states", "Benin Kingdom", "Igbo societies"]}, {"title": "European Contact & Slave Trade", "topics": ["European exploration", "Trans-Atlantic slave trade", "Missionary activities", "Legitimate commerce"]}, {"title": "Colonial Nigeria", "topics": ["Colonial administration", "Amalgamation", "Indirect rule", "Economic policies", "Resistance movements"]}, {"title": "Nationalism & Independence", "topics": ["Nationalist movements", "Constitutional development", "Political parties", "Independence"]}, {"title": "Post-Independence Nigeria", "topics": ["First Republic", "Military rule", "Civil War", "Second Republic", "Later political developments"]}, {"title": "African & World History", "topics": ["Pan-Africanism", "African independence", "Industrial Revolution", "World wars", "Cold War", "Historical sources and methods"]}]
    }
  };

  let syllabus = {};
  const stateKey = 'jambSyllabusProgress';
  const grid = document.getElementById('syllabusSubjects');
  const detail = document.getElementById('syllabusDetail');
  const search = document.getElementById('syllabusSearch');
  const count = document.getElementById('syllabusCount');
  const progress = document.getElementById('syllabusProgress');
  const modal = document.getElementById('syllabusModal');
  const modalBody = document.getElementById('syllabusModalBody');
  const modalClose = document.getElementById('syllabusModalClose');
  const supabaseClient = window.supabaseClient || null;

  function isPremiumSubscriptionRecord(row) {
    if (!row) return false;
    const status = String(row.status ?? row.subscription_status ?? row.plan_status ?? row.payment_status ?? '').trim().toLowerCase();
    const expires = row.expires_at ?? row.expiresAt ?? row.current_period_end ?? row.ends_at ?? null;
    const isStatusActive = ['active', 'paid', 'premium', 'subscribed', 'success', 'successful', 'succeeded', 'completed'].includes(status);
    let notExpired = true;
    if (expires) {
      const exp = new Date(expires);
      notExpired = !Number.isNaN(exp.getTime()) ? exp > new Date() : true;
    }
    return isStatusActive && notExpired;
  }

  async function ensurePremiumAccess() {
    if (typeof window.ensurePremiumFeatureAccess === 'function') {
      return window.ensurePremiumFeatureAccess({ featureName: 'JAMB Syllabus', featureKey: 'syllabus' });
    }
    return Boolean(supabaseClient);
  }

  let selectedSubject = null;
  let progressState = loadProgress();

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch { return {}; }
  }
  function saveProgress() { localStorage.setItem(stateKey, JSON.stringify(progressState)); }
  function topicId(subject, section, topic) { return `${subject}::${section}::${topic.title}`; }
  function isDone(id) { return !!progressState[id]; }
  function studyModal() {
    let element = document.getElementById('syllabusStudyModal');
    if (element) return element;
    element = document.createElement('div');
    element.id = 'syllabusStudyModal';
    element.className = 'syllabus-modal hidden';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-labelledby', 'studyLessonTitle');
    document.body.appendChild(element);
    return element;
  }
  function lessonValue(content, ...keys) {
    if (!content || typeof content !== 'object') return null;
    for (const key of keys) {
      if (content[key] !== undefined && content[key] !== null) return content[key];
    }
    return null;
  }
  function renderLessonValue(value, fallback) {
    if (value === null || value === undefined || value === '') return `<p class="study-placeholder">${escapeHtml(fallback)}</p>`;
    if (Array.isArray(value)) return `<ul>${value.map(item => `<li>${escapeHtml(typeof item === 'string' ? item : JSON.stringify(item))}</li>`).join('')}</ul>`;
    if (typeof value === 'object') return `<ul>${Object.entries(value).map(([key, item]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(typeof item === 'string' ? item : JSON.stringify(item))}</li>`).join('')}</ul>`;
    return `<p>${escapeHtml(String(value))}</p>`;
  }
  async function renderStudyLesson(subject, sectionTitle, topic) {
    const id = topicId(subject, sectionTitle, topic);
    const studied = isDone(id);
    const modal = studyModal();
    modal.innerHTML = `<div class="modal-card study-card"><button class="modal-close" id="studyModalClose" type="button" aria-label="Close study lesson">×</button><span class="study-label">SUPABASE STUDY LESSON</span><h2 id="studyLessonTitle">${escapeHtml(topic.title)}</h2><p class="study-context">${escapeHtml(subject)} · ${escapeHtml(sectionTitle)}</p><div class="study-loading">Loading lesson content…</div></div>`;
    modal.classList.remove('hidden');
    const { data, error } = await supabaseClient.from('syllabus_topics').select('content').eq('id', topic.id).eq('is_active', true).maybeSingle();
    if (error) {
      modal.querySelector('.study-loading').innerHTML = `<p class="study-error">We couldn't load this lesson. Please try again.</p>`;
      return;
    }
    const content = data?.content;
    const overview = lessonValue(content, 'overview', 'introduction');
    const learn = lessonValue(content, 'what_youll_learn', 'whatYoullLearn', 'what_you_will_learn');
    const keyPoints = lessonValue(content, 'key_points', 'keyPoints');
    const examples = lessonValue(content, 'examples');
    const quickCheck = lessonValue(content, 'quick_check', 'quickCheck');
    modal.querySelector('.study-card').innerHTML = `<button class="modal-close" id="studyModalClose" type="button" aria-label="Close study lesson">×</button><span class="study-label">SUPABASE STUDY LESSON</span><h2 id="studyLessonTitle">${escapeHtml(topic.title)}</h2><p class="study-context">${escapeHtml(subject)} · ${escapeHtml(sectionTitle)}</p><div class="study-section"><h3>Overview</h3>${renderLessonValue(overview, 'No overview has been added for this topic yet.')}</div><div class="study-section"><h3>What You'll Learn</h3>${renderLessonValue(learn, 'No learning objectives have been added for this topic yet.')}</div><div class="study-section"><h3>Key Points</h3>${renderLessonValue(keyPoints, 'No key points have been added for this topic yet.')}</div><div class="study-section"><h3>Examples</h3>${renderLessonValue(examples, 'No examples have been added for this topic yet.')}</div><div class="study-section"><h3>Quick Check</h3>${renderLessonValue(quickCheck, 'No quick check has been added for this topic yet.')}</div><button class="study-complete ${studied ? 'is-complete' : ''}" id="studyMarkComplete" type="button">${studied ? 'Studied' : 'Mark as Studied'}</button>`;
    document.getElementById('studyModalClose').addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('studyMarkComplete').addEventListener('click', () => {
      progressState[id] = true;
      saveProgress();
      updateProgress();
      renderSubjects(search.value);
      if (selectedSubject) showDetail(selectedSubject);
      renderStudyLesson(subject, sectionTitle, topic);
    });
    modal.onclick = event => {
      if (event.target === modal) modal.classList.add('hidden');
    };
  }
  function totals() {
    let total = 0, done = 0;
    Object.entries(syllabus).forEach(([subject, data]) => data.sections.forEach(section => section.topics.forEach(topic => { total++; if (isDone(topicId(subject, section.title, topic))) done++; })));
    return { total, done };
  }
  function updateProgress() {
    const t = totals();
    const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
    if (progress) progress.textContent = `${t.done} of ${t.total} topics completed`;
    const bar = document.getElementById('syllabusProgressBar');
    if (bar) bar.style.width = `${pct}%`;
    const pctEl = document.getElementById('syllabusProgressPct');
    if (pctEl) pctEl.textContent = `${pct}%`;
  }
  function escapeHtml(value) { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function renderSubjects(filter = '') {
    const q = filter.trim().toLowerCase();
    grid.innerHTML = '';
    let shown = 0;
    Object.entries(syllabus).forEach(([subject, data]) => {
      const allTopics = data.sections.flatMap(s => s.topics);
      const matches = !q || data.displayName.toLowerCase().includes(q) || data.subtitle.toLowerCase().includes(q) || data.sections.some(s => s.title.toLowerCase().includes(q) || s.topics.some(t => t.title.toLowerCase().includes(q)));
      if (!matches) return;
      shown++;
      const done = allTopics.filter(t => isDone(topicId(subject, data.sections.find(s => s.topics.includes(t)).title, t))).length;
      const pct = allTopics.length ? Math.round((done / allTopics.length) * 100) : 0;
      const card = document.createElement('article');
      card.className = 'syllabus-card';
      card.innerHTML = `<div class="syllabus-card-icon">${escapeHtml(data.icon)}</div><div class="syllabus-card-body"><div class="syllabus-card-title"><h3>${escapeHtml(data.displayName)}</h3><span>${done}/${allTopics.length}</span></div><p>${escapeHtml(data.subtitle)}</p><div class="mini-progress"><span style="width:${pct}%"></span></div><small>${allTopics.length} topics · ${pct}% complete</small></div><button class="syllabus-open" type="button" aria-label="Open ${escapeHtml(data.displayName)}">›</button>`;
      card.querySelector('.syllabus-open').addEventListener('click', () => showDetail(subject));
      card.addEventListener('click', e => { if (!e.target.closest('button')) showDetail(subject); });
      grid.appendChild(card);
    });
    if (count) count.textContent = `${shown} subject${shown === 1 ? '' : 's'}`;
    if (!shown) grid.innerHTML = '<div class="syllabus-empty"><strong>No matches found</strong><p>Try a subject name or topic such as algebra, genetics or waves.</p></div>';
  }

  function showDetail(subject) {
    selectedSubject = subject;
    const data = syllabus[subject];
    detail.classList.remove('hidden');
    detail.innerHTML = `<div class="detail-hero"><button class="detail-back" id="closeDetail" type="button">← All subjects</button><div class="detail-icon">${escapeHtml(data.icon)}</div><div><span>${escapeHtml(data.subtitle)}</span><h2>${escapeHtml(data.displayName)}</h2><p>${escapeHtml(data.overview)}</p></div></div><div class="detail-actions"><button class="primary" id="markAll" type="button">Mark all complete</button><button class="secondary" id="clearAll" type="button">Reset progress</button></div><div class="section-list">${data.sections.map(section => `<section class="syllabus-section"><div class="section-heading"><div><span>SYLLABUS AREA</span><h3>${escapeHtml(section.title)}</h3></div><span class="section-count">${section.topics.length} topics</span></div><div class="topic-list">${section.topics.map(topic => { const id = topicId(subject, section.title, topic); return `<label class="topic-row ${isDone(id) ? 'done' : ''}" data-study-topic-id="${escapeHtml(topic.id)}" data-study-section="${escapeHtml(section.title)}"><input type="checkbox" data-topic-id="${escapeHtml(topic.id)}" data-progress-id="${escapeHtml(id)}" ${isDone(id) ? 'checked' : ''}><span>${escapeHtml(topic.title)}</span><small>${isDone(id) ? 'Studied · Open lesson' : 'Open lesson'}</small></label>`; }).join('')}</div></section>`).join('')}</div>`;
    document.getElementById('closeDetail').addEventListener('click', () => { detail.classList.add('hidden'); selectedSubject = null; window.scrollTo({top: 0, behavior: 'smooth'}); });
    document.getElementById('markAll').addEventListener('click', () => { data.sections.forEach(s => s.topics.forEach(t => progressState[topicId(subject, s.title, t)] = true)); saveProgress(); showDetail(subject); renderSubjects(search.value); updateProgress(); });
    document.getElementById('clearAll').addEventListener('click', () => { data.sections.forEach(s => s.topics.forEach(t => delete progressState[topicId(subject, s.title, t)])); saveProgress(); showDetail(subject); renderSubjects(search.value); updateProgress(); });
    detail.querySelectorAll('input[data-topic-id]').forEach(input => input.addEventListener('change', event => { event.stopPropagation(); progressState[input.dataset.progressId] = input.checked; if (!input.checked) delete progressState[input.dataset.progressId]; saveProgress(); input.closest('.topic-row').classList.toggle('done', input.checked); input.closest('.topic-row').querySelector('small').textContent = input.checked ? 'Studied · Open lesson' : 'Open lesson'; renderSubjects(search.value); updateProgress(); }));
    detail.querySelectorAll('[data-study-topic-id]').forEach(row => row.addEventListener('click', event => { if (event.target.closest('input')) return; const topic = data.sections.flatMap(section => section.topics).find(item => item.id === row.dataset.studyTopicId); if (topic) renderStudyLesson(subject, row.dataset.studySection, topic); }));
    detail.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function openQuickGuide() {
    const data = Object.entries(syllabus).map(([, d]) => `<div class="guide-item"><strong>${escapeHtml(d.icon)} ${escapeHtml(d.displayName)}</strong><span>${d.sections.reduce((n,s)=>n+s.topics.length,0)} topics across ${d.sections.length} areas</span></div>`).join('');
    modalBody.innerHTML = `<h2>How to use the syllabus</h2><p>Choose a subject, open a syllabus area and tick topics as you study them. Your progress is stored on this device.</p><div class="guide-list">${data}</div><p class="source-note">For the official JAMB syllabus system, use the Board's IBASS platform.</p>`;
    modal.classList.remove('hidden');
  }

  search.addEventListener('input', e => renderSubjects(e.target.value));
  document.getElementById('quickGuide')?.addEventListener('click', openQuickGuide);
  modalClose?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') modal?.classList.add('hidden'); });
  document.getElementById('resetAllProgress')?.addEventListener('click', () => { progressState = {}; saveProgress(); renderSubjects(search.value); updateProgress(); if (selectedSubject) showDetail(selectedSubject); });

  function showLoadMessage(title, message, error = false) {
    grid.innerHTML = `<div class="syllabus-empty ${error ? 'syllabus-load-error' : ''}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
    if (count) count.textContent = '0 subjects';
  }

  async function loadSyllabusFromSupabase() {
    if (!supabaseClient) throw new Error('Supabase client is unavailable.');
    const [subjectsResult, sectionsResult, topicsResult] = await Promise.all([
      supabaseClient.from('syllabus_subjects').select('id,name,display_name,subtitle,icon,overview,display_order').eq('is_active', true).order('display_order', { ascending: true }),
      supabaseClient.from('syllabus_sections').select('id,subject_id,title,description,display_order').eq('is_active', true).order('display_order', { ascending: true }),
      supabaseClient.from('syllabus_topics').select('id,section_id,title,description,display_order').eq('is_active', true).order('display_order', { ascending: true })
    ]);
    const failed = [subjectsResult, sectionsResult, topicsResult].find(result => result.error);
    if (failed) throw failed.error;

    const sectionsBySubject = new Map();
    sectionsResult.data.forEach(section => {
      if (!sectionsBySubject.has(section.subject_id)) sectionsBySubject.set(section.subject_id, []);
      sectionsBySubject.get(section.subject_id).push({ ...section, topics: [] });
    });
    const sectionsById = new Map();
    sectionsBySubject.forEach(sections => sections.forEach(section => sectionsById.set(section.id, section)));
    topicsResult.data.forEach(topic => sectionsById.get(topic.section_id)?.topics.push(topic));

    syllabus = {};
    subjectsResult.data.forEach(subject => {
      const key = String(subject.name || subject.display_name || subject.id);
      syllabus[key] = {
        displayName: String(subject.display_name || subject.name || 'Subject'),
        subtitle: String(subject.subtitle || ''),
        icon: String(subject.icon || ''),
        overview: String(subject.overview || ''),
        sections: sectionsBySubject.get(subject.id) || []
      };
    });
  }

  (async () => {
    const allowed = await ensurePremiumAccess();
    if (!allowed) return;
    showLoadMessage('Loading syllabus', 'Loading active syllabus content from Supabase…');
    try {
      await loadSyllabusFromSupabase();
      renderSubjects();
      updateProgress();
    } catch (error) {
      console.error('Syllabus loading failed:', error);
      showLoadMessage('Syllabus unavailable', 'We could not load the syllabus from Supabase. Please refresh and try again.', true);
    }
  })();
})();
