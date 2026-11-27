// topics-catalog.js
// Lightweight subject catalog for ExamPilot JAMB Topics view.
// Provides truthful fallback question counts matching the bundled questions.js question bank.

(function () {
  "use strict";

  window.questionBanks = window.questionBanks || {
    "English": { practice: new Array(500), past: new Array(20) },
    "Mathematics": { practice: new Array(500), past: [] },
    "Physics": { practice: new Array(500), past: new Array(480) },
    "Chemistry": { practice: new Array(100), past: new Array(10) },
    "Biology": { practice: new Array(100), past: new Array(10) },
    "Government": { practice: new Array(100), past: new Array(10) },
    "Commerce": { practice: new Array(500), past: [] },
    "Economics": { practice: new Array(500), past: [] },
    "Accounting": { practice: new Array(500), past: [] },
    "Geography": { practice: new Array(500), past: [] },
    "CRS": { practice: new Array(500), past: [] },
    "History": { practice: new Array(500), past: [] },
    "Literature": { practice: new Array(100), past: [] }
  };
})();
