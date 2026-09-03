(async () => {
  if (typeof window.ensurePremiumFeatureAccess === 'function') {
    const allowed = await window.ensurePremiumFeatureAccess({ featureName: 'Past Questions', featureKey: 'past-questions' });
    if (!allowed) return;
  }
  const grid = document.getElementById('subjectGrid');
  const countEl = document.getElementById('selectedCount');
  const startBtn = document.getElementById('startPastBtn');
  const message = document.getElementById('selectionMessage');
  const searchInput = document.getElementById('subjectSearch');
  const clearBtn = document.getElementById('clearBtn');
  const selectedList = document.getElementById('selectedList');
  const summary = document.getElementById('bankSummary');
  const emptyState = document.getElementById('emptyState');
  const yearFilter = document.getElementById('yearFilter');
  const sessionFilter = document.getElementById('sessionFilter');
  const yearSessionNotice = document.getElementById('yearSessionNotice');

  const icons = {
    English: '📝', Mathematics: '📐', Physics: '⚡', Chemistry: '🧪',
    Biology: '🧬', Government: '🏛️', Literature: '📚',
    Economics: '💹', Commerce: '🛍️', Accounting: '🧾',
    Geography: '🌍', CRS: '✝️', History: '🏺'
  };

  const bank = (typeof window !== 'undefined' && (window.questionBanks || globalThis.questionBanks)) || (typeof questionBanks !== 'undefined' ? questionBanks : {});
  const subjects = Object.keys(bank).filter(subject => {
    const data = bank[subject];
    return data && (Array.isArray(data.past) || Array.isArray(data.practice));
  });

  let selected = JSON.parse(localStorage.getItem('pastSelectedSubjects') || '[]')
    .filter(subject => subjects.includes(subject));
  let query = '';
  let selectedYear = 'all';
  let selectedSession = 'all';

  function getMetadata(question) {
    return {
      year: String(question.year ?? question.examYear ?? question.jambYear ?? '').trim(),
      session: String(question.session ?? question.examSession ?? '').trim()
    };
  }

  function matchesMetadata(question) {
    const meta = getMetadata(question);
    return (selectedYear === 'all' || meta.year === selectedYear) &&
           (selectedSession === 'all' || meta.session === selectedSession);
  }

  function getFilteredPastQuestions(subject) {
    return getPastQuestions(subject).filter(matchesMetadata);
  }

  function populateYearSessionFilters() {
    const years = new Set();
    const sessions = new Set();
    subjects.forEach(subject => getPastQuestions(subject).forEach(q => {
      const meta = getMetadata(q);
      if (meta.year) years.add(meta.year);
      if (meta.session) sessions.add(meta.session);
    }));
    yearFilter.innerHTML = '<option value="all">All years</option>' + [...years].sort().map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    sessionFilter.innerHTML = '<option value="all">All sessions</option>' + [...sessions].sort().map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
    yearSessionNotice.textContent = (years.size || sessions.size)
      ? 'Year/session filters use only metadata present in the verified past-question source.'
      : 'No year/session metadata is present in the current verified past-question source. No year or session has been invented.';
  }


  function getPastQuestions(subject) {
    const data = bank[subject];
    return data && Array.isArray(data.past) ? data.past : [];
  }

  function totalQuestions() {
    return subjects.reduce((total, subject) => total + getFilteredPastQuestions(subject).length, 0);
  }

  function usableSubjects() {
    return subjects.filter(subject => getPastQuestions(subject).length > 0);
  }

  function expectedQuestions(subject) {
    return Math.min(20, getFilteredPastQuestions(subject).length);
  }

  function renderSubjects() {
    const filtered = subjects.filter(subject => subject.toLowerCase().includes(query.toLowerCase()));
    emptyState.hidden = filtered.length !== 0;

    grid.innerHTML = filtered.map(subject => {
      const count = getFilteredPastQuestions(subject).length;
      const isSelected = selected.includes(subject);
      const disabled = count === 0 || (!isSelected && selected.length >= 4);
      const availability = count > 0
        ? `${count} verified past question${count === 1 ? '' : 's'} • ${expectedQuestions(subject)} used per CBT`
        : 'No verified past questions added yet';

      return `
        <button type="button" class="subject-option ${isSelected ? 'selected' : ''} ${disabled ? 'limit-reached' : ''} ${count === 0 ? 'unavailable' : ''}"
          data-subject="${escapeHtml(subject)}" aria-pressed="${isSelected}" ${disabled ? 'disabled' : ''}>
          <span class="subject-icon">${icons[subject] || '📚'}</span>
          <span class="subject-info">
            <span class="subject-name">${escapeHtml(subject)}</span>
            <span class="subject-meta">${escapeHtml(availability)}</span>
          </span>
          <span class="check">${count === 0 ? '—' : (isSelected ? '✓' : '+')}</span>
        </button>`;
    }).join('');

    grid.querySelectorAll('.subject-option:not([disabled])').forEach(button => {
      button.addEventListener('click', () => toggle(button.dataset.subject));
    });
  }

  function renderSelected() {
    countEl.textContent = selected.length;
    selectedList.innerHTML = selected.length
      ? selected.map((subject, index) => `
          <div class="selected-chip">
            <span class="chip-number">${index + 1}</span>
            <span>${escapeHtml(subject)} <small>(${expectedQuestions(subject)} questions)</small></span>
            <button type="button" data-remove="${escapeHtml(subject)}" aria-label="Remove ${escapeHtml(subject)}">×</button>
          </div>`).join('')
      : '<div class="selected-empty">No subjects selected yet.</div>';

    selectedList.querySelectorAll('[data-remove]').forEach(button => {
      button.addEventListener('click', () => toggle(button.dataset.remove));
    });

    const unavailableSelected = selected.filter(subject => getFilteredPastQuestions(subject).length === 0);
    const selectedQuestionTotal = selected.reduce((total, subject) => total + expectedQuestions(subject), 0);
    const selectedAvailableTotal = selected.reduce((total, subject) => total + getFilteredPastQuestions(subject).length, 0);

    if (selected.length === 4 && unavailableSelected.length === 0) {
      message.textContent = `✓ Ready. This CBT will load up to ${selectedQuestionTotal} questions from ${selectedAvailableTotal} verified past questions.`;
      message.className = 'selection-message ready';
    } else if (selected.length < 4) {
      const remaining = 4 - selected.length;
      message.textContent = `Select ${remaining} more subject${remaining === 1 ? '' : 's'} with available past questions to continue.`;
      message.className = 'selection-message';
    } else {
      message.textContent = 'Some selected subjects do not have verified past questions yet. Remove them before starting.';
      message.className = 'selection-message warning';
    }

    startBtn.disabled = selected.length !== 4 || unavailableSelected.length > 0;
  }

  function toggle(subject) {
    if (!subjects.includes(subject) || getFilteredPastQuestions(subject).length === 0) return;
    if (selected.includes(subject)) {
      selected = selected.filter(item => item !== subject);
    } else if (selected.length < 4) {
      selected.push(subject);
    } else {
      message.textContent = 'You can select a maximum of 4 subjects.';
      message.className = 'selection-message warning';
      return;
    }
    localStorage.setItem('pastSelectedSubjects', JSON.stringify(selected));
    renderSubjects();
    renderSelected();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  yearFilter.addEventListener('change', event => {
    selectedYear = event.target.value;
    selected = selected.filter(subject => getFilteredPastQuestions(subject).length > 0);
    renderSubjects(); renderSelected();
  });

  sessionFilter.addEventListener('change', event => {
    selectedSession = event.target.value;
    selected = selected.filter(subject => getFilteredPastQuestions(subject).length > 0);
    renderSubjects(); renderSelected();
  });

  searchInput.addEventListener('input', event => {
    query = event.target.value.trim();
    renderSubjects();
  });

  clearBtn.addEventListener('click', () => {
    selected = [];
    localStorage.removeItem('pastSelectedSubjects');
    renderSubjects();
    renderSelected();
  });

  startBtn.addEventListener('click', () => {
    if (selected.length !== 4) return;
    if (selected.some(subject => getFilteredPastQuestions(subject).length === 0)) return;

    localStorage.setItem('selectedSubjects', JSON.stringify(selected));
    localStorage.setItem('testType', 'past');
    localStorage.setItem('testTypeTitle', 'Past Questions');
    localStorage.setItem('subjectTitle', selected.join(', '));
    localStorage.setItem('pastQuestionSetStartedAt', new Date().toISOString());
    localStorage.removeItem('pastSelectedQuestions');
    window.location.href = 'index.html';
  });

  populateYearSessionFilters();
  const availableSubjectCount = usableSubjects().length;
  summary.textContent = `${availableSubjectCount} of ${subjects.length} subjects • ${totalQuestions()} verified past questions currently available`;
  renderSubjects();
  renderSelected();
})();
