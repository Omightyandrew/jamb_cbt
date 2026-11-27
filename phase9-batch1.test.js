const fs = require('fs');
const assert = require('assert');
const path = require('path');

function readNormalized(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

console.log('=== RUNNING EXAMPILOT PHASE 9 BATCH 1: MOBILE REGRESSION TEST ===\n');

// 1. challenge.html
console.log('Test 1: challenge.html header and leaderboard containment...');
const challengeHtml = readNormalized('challenge.html');

assert(challengeHtml.includes('#leaderboard{\n  overflow-x:auto') || challengeHtml.includes('#leaderboard{overflow-x:auto') || challengeHtml.includes('overflow-x:auto;\n  -webkit-overflow-scrolling:touch'), 'Leaderboard must have overflow-x: auto');
assert(challengeHtml.includes('.leader td:nth-child(2)'), 'Leaderboard student name column must have max-width and ellipsis');
assert(challengeHtml.includes('text-overflow:ellipsis'), 'Leaderboard student name must have text-overflow: ellipsis');
assert(challengeHtml.includes('.top .ep-logo--header{\n    width:110px') || challengeHtml.includes('.top .ep-logo--header{width:110px'), 'Header logo must scale down on mobile');
assert(challengeHtml.includes('.top .ep-logo--header{\n    width:95px') || challengeHtml.includes('.top .ep-logo--header{width:95px'), 'Header logo must scale down to 95px on 360px');
assert(challengeHtml.includes('#milestoneBadge{\n    font-size:13px !important'), 'Milestone badge must fit comfortably at 420px');
console.log('  ✓ challenge.html header and leaderboard containment verified');

// 2. dashboard.html
console.log('Test 2: dashboard.html subscription modal and touch targets...');
const dashboardHtml = readNormalized('dashboard.html');

assert(dashboardHtml.includes('overflow-y: auto'), 'Subscription modal must have overflow-y: auto');
assert(dashboardHtml.includes('max-height: calc(100vh - 40px)'), 'Subscription modal must have max-height constraint');
assert(dashboardHtml.includes('min-width: 40px;\n        min-height: 40px') || dashboardHtml.includes('width: 40px;\n        height: 40px'), 'Header buttons must have ~40px touch targets on 360px');
assert(!dashboardHtml.includes('font-size: 8px'), 'dashboard.html must not have illegible 8px brand subtitle');
assert(dashboardHtml.includes('font-size: 11px;\n        line-height: 1.3'), 'dashboard.html brand subtitle must be 11px on 360px');

// Verify duplicate 360px media query was consolidated
const media360Matches = [...dashboardHtml.matchAll(/@media\s*\(\s*max-width:\s*360px\s*\)/gi)];
assert.strictEqual(media360Matches.length, 1, 'Duplicate @media (max-width: 360px) must be consolidated into exactly 1 block');

// Verify compact Quick Links styling under 390px
assert(!dashboardHtml.includes('.quick-link-title {\n        font-size: 19px'), 'dashboard.html must not have bloated 19px quick link titles');
assert(dashboardHtml.includes('.quick-link-title {\n        font-size: 14.5px'), 'dashboard.html must have 14.5px quick link title on <=390px');
assert(dashboardHtml.includes('-webkit-line-clamp: 2'), 'dashboard.html must clamp quick link description to 2 lines on <=390px');
assert(dashboardHtml.includes('min-height: 105px'), 'dashboard.html must have compact 105px min-height for quick links on <=390px');
console.log('  ✓ dashboard.html subscription modal scroll, consolidated touch targets, and compact quick links verified');


// 3. mock-exam.css
console.log('Test 3: mock-exam.css 320px header collision protection...');
const mockExamCss = readNormalized('mock-exam.css');

assert(mockExamCss.includes('@media (max-width: 380px)'), 'mock-exam.css must have @media (max-width: 380px) query');
assert(/\.mock-premium-label\s*\{\s*display:\s*none;?\s*\}/.test(mockExamCss), 'mock-exam.css must hide premium label on narrow screens');
assert(/\.mock-timer\s*\{\s*min-width:\s*86px/.test(mockExamCss), 'mock-exam.css timer must adjust min-width on narrow screens');
console.log('  ✓ mock-exam.css narrow mobile header rules verified');

// 4. test-type.html
console.log('Test 4: test-type.html button stacking and touch targets...');
const testTypeHtml = readNormalized('test-type.html');

assert(testTypeHtml.includes('class="test-type-actions"'), 'test-type.html must have .test-type-actions container');
assert(testTypeHtml.includes('startPractice()'), 'startPractice() action must be preserved');
assert(testTypeHtml.includes('startPastQuestions()'), 'startPastQuestions() action must be preserved');
assert(testTypeHtml.includes('goBack()'), 'goBack() action must be preserved');
assert(testTypeHtml.includes('width: 100% !important'), 'Buttons must stack full-width on mobile');
console.log('  ✓ test-type.html button stacking verified');

// 5. subject.html
console.log('Test 5: subject.html choices and action button stacking...');
const subjectHtml = readNormalized('subject.html');

assert(/#subjectChoices\s+br\s*\{\s*display:\s*none;?\s*\}/.test(subjectHtml), '#subjectChoices br must be disabled in CSS');
assert(subjectHtml.includes('class="subject-actions"'), 'subject.html must have .subject-actions container');
assert(subjectHtml.includes('startTest()'), 'startTest() action must be preserved');
assert(subjectHtml.includes('goBack()'), 'goBack() action must be preserved');
console.log('  ✓ subject.html choices and action buttons verified');

// 6. student.html
console.log('Test 6: student.html input font size...');
const studentHtml = readNormalized('student.html');

assert(/\.form-group\s+input\s*\{[^}]*font-size:\s*16px/.test(studentHtml), 'student.html .form-group input must use font-size: 16px to prevent iOS auto-zoom');
assert(!/\.form-group\s+input\s*\{[^}]*font-size:\s*15px/.test(studentHtml), 'student.html .form-group input must not use 15px');
console.log('  ✓ student.html input font size verified');

// 7. Corrupted back buttons
console.log('Test 7: Verification of back button arrows...');
const pastQuestionsHtml = readNormalized('past-questions.html');
const settingsHtml = readNormalized('settings.html');
const syllabusHtml = readNormalized('syllabus.html');

assert(!pastQuestionsHtml.includes('class="back-btn" aria-label="Back to dashboard">?</a>'), 'past-questions.html must not contain ? back button');
assert(pastQuestionsHtml.includes('class="back-btn" aria-label="Back to dashboard">←</a>'), 'past-questions.html must contain ← arrow');

assert(!settingsHtml.includes('class="back" onclick="location.href=\'dashboard.html\'" aria-label="Back to Dashboard">?</button>'), 'settings.html must not contain ? back button');
assert(settingsHtml.includes('class="back" onclick="location.href=\'dashboard.html\'" aria-label="Back to Dashboard">←</button>'), 'settings.html must contain ← arrow');

assert(!syllabusHtml.includes('class="back" aria-label="Back to dashboard">?</a>'), 'syllabus.html must not contain ? back button');
assert(syllabusHtml.includes('class="back" aria-label="Back to dashboard">←</a>'), 'syllabus.html must contain ← arrow');
console.log('  ✓ Back button arrows verified across all affected pages');

console.log('\n=== ALL PHASE 9 BATCH 1 TESTS PASSED SUCCESSFULLY! ===\n');
