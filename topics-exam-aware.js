(function () {
  "use strict";

  async function loadExamCatalogue(client, examCode) {
    if (!client || typeof client.from !== "function") {
      throw new Error("Supabase client is unavailable.");
    }

    const code = String(examCode || "").trim().toUpperCase();
    const examId = await window.resolveExamId(client, code);
    const subjectResult = await client
      .from("syllabus_subjects")
      .select("id,exam_id,name,display_name,subtitle,icon,overview,display_order")
      .eq("exam_id", examId)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (subjectResult.error) throw subjectResult.error;
    const subjects = Array.isArray(subjectResult.data) ? subjectResult.data : [];
    if (!subjects.length) {
      throw new Error("No active syllabus subjects are available for " + code + ".");
    }
    if (subjects.some((subject) => subject.exam_id !== examId || !subject.name)) {
      throw new Error("The syllabus subject catalogue does not match exam " + code + ".");
    }

    const subjectIds = subjects.map((subject) => subject.id);
    const sectionResult = await client
      .from("syllabus_sections")
      .select("id,subject_id,title,description,display_order")
      .in("subject_id", subjectIds)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (sectionResult.error) throw sectionResult.error;
    const sections = Array.isArray(sectionResult.data) ? sectionResult.data : [];
    const subjectIdSet = new Set(subjectIds);
    if (sections.some((section) => !subjectIdSet.has(section.subject_id))) {
      throw new Error("A syllabus section is outside the selected exam catalogue.");
    }

    const sectionIds = sections.map((section) => section.id);
    let topics = [];
    if (sectionIds.length) {
      const topicResult = await client
        .from("syllabus_topics")
        .select("id,section_id,title,description,display_order")
        .in("section_id", sectionIds)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (topicResult.error) throw topicResult.error;
      topics = Array.isArray(topicResult.data) ? topicResult.data : [];
    }

    const sectionIdSet = new Set(sectionIds);
    if (topics.some((topic) => !sectionIdSet.has(topic.section_id))) {
      throw new Error("A syllabus topic is outside the selected exam catalogue.");
    }

    const sectionsBySubject = new Map();
    sections.forEach((section) => {
      if (!sectionsBySubject.has(section.subject_id)) {
        sectionsBySubject.set(section.subject_id, []);
      }
      sectionsBySubject.get(section.subject_id).push({ ...section, topics: [] });
    });

    const sectionsById = new Map();
    sectionsBySubject.forEach((subjectSections) => {
      subjectSections.forEach((section) => sectionsById.set(section.id, section));
    });
    topics.forEach((topic) => sectionsById.get(topic.section_id)?.topics.push(topic));

    return {
      exam: { id: examId, code },
      subjects: subjects.map((subject) => ({
        ...subject,
        sections: sectionsBySubject.get(subject.id) || []
      }))
    };
  }

  async function loadQuestionCounts(client, examId, subjects) {
    const results = await Promise.all(
      subjects.flatMap((subject) => ["practice", "past"].map(async (testType) => {
        const result = await client
          .from("Questions")
          .select("id", { count: "exact", head: true })
          .eq("exam_id", examId)
          .eq("Subject", subject.name)
          .eq("test_type", testType)
          .eq("is_active", true);
        if (result.error) throw result.error;
        return { subject: subject.name, testType, count: result.count || 0 };
      }))
    );

    const counts = new Map();
    results.forEach(({ subject, testType, count }) => {
      if (!counts.has(subject)) counts.set(subject, { practice: 0, past: 0 });
      counts.get(subject)[testType] = count;
    });
    return counts;
  }

  window.ExamPilotTopicsRuntime = Object.freeze({
    loadExamCatalogue,
    loadQuestionCounts
  });

  async function initialize() {
    const grid = document.getElementById("subjectGrid");
    const search = document.getElementById("subjectSearch");
    const clear = document.getElementById("clearSearch");
    const summary = document.getElementById("summary");
    const panel = document.getElementById("topicPanel");
    const title = document.getElementById("selectedSubject");
    const meta = document.getElementById("selectedMeta");
    const list = document.getElementById("topicList");
    const close = document.getElementById("closeTopics");
    const practice = document.getElementById("practiceLink");
    const past = document.getElementById("pastLink");
    const empty = document.getElementById("emptyState");
    const examCode = window.getSelectedExamCode();

    if (typeof window.ensurePremiumFeatureAccess === "function") {
      const allowed = await window.ensurePremiumFeatureAccess({
        featureName: "Subjects & Topics",
        featureKey: "topics"
      });
      if (!allowed) return;
    }

    const client = window.supabaseClient;
    if (!client) {
      summary.textContent = "Syllabus unavailable for " + examCode + ".";
      grid.replaceChildren();
      return;
    }

    summary.textContent = "Loading " + examCode + " subjects…";
    try {
      const catalogue = await loadExamCatalogue(client, examCode);
      let counts = null;
      let countsUnavailable = false;
      try {
        counts = await loadQuestionCounts(
          client,
          catalogue.exam.id,
          catalogue.subjects
        );
      } catch (error) {
        console.warn("Could not load exam-scoped question counts:", error);
        countsUnavailable = true;
      }

      function renderSubjects() {
        const query = search.value.trim().toLowerCase();
        grid.replaceChildren();
        let shown = 0;
        catalogue.subjects.forEach((subject) => {
          const subjectName = String(subject.name);
          const displayName = String(subject.display_name || subject.name);
          const sections = subject.sections;
          const topicNames = sections.flatMap((section) =>
            section.topics.map((topic) => topic.title)
          );
          const matches = !query ||
            subjectName.toLowerCase().includes(query) ||
            displayName.toLowerCase().includes(query) ||
            sections.some((section) =>
              section.title.toLowerCase().includes(query) ||
              section.topics.some((topic) => topic.title.toLowerCase().includes(query))
            );
          if (!matches) return;

          const subjectCounts = counts?.get(subjectName);
          const card = document.createElement("button");
          card.type = "button";
          card.className = "subject-card";
          const icon = document.createElement("span");
          icon.className = "subject-icon";
          icon.textContent = String(subject.icon || displayName.charAt(0));
          const name = document.createElement("span");
          name.className = "subject-name";
          name.textContent = displayName;
          const count = document.createElement("span");
          count.className = "subject-count";
          const total = subjectCounts
            ? subjectCounts.practice + subjectCounts.past
            : null;
          count.textContent = (total === null ? "Question counts unavailable" : total + " questions") +
            " • " + topicNames.length + " topic areas";
          const typeCounts = document.createElement("span");
          typeCounts.className = "counts";
          typeCounts.textContent = subjectCounts
            ? "Practice " + subjectCounts.practice + " · Past " + subjectCounts.past
            : "Practice — · Past —";
          const action = document.createElement("span");
          action.className = "view";
          action.textContent = "Explore subject →";
          card.append(icon, name, count, typeCounts, action);
          card.addEventListener("click", () => openSubject(subject));
          grid.appendChild(card);
          shown += 1;
        });

        summary.textContent = shown + " of " + catalogue.subjects.length +
          " subjects available for " + examCode;
        empty.hidden = shown !== 0;
        if (!shown && query) empty.querySelector("h2").textContent = "No match found";
      }

      function openSubject(subject) {
        const displayName = String(subject.display_name || subject.name);
        const subjectCounts = counts?.get(subject.name);
        const total = subjectCounts
          ? subjectCounts.practice + subjectCounts.past
          : "—";
        const topicTotal = subject.sections.reduce(
          (sum, section) => sum + section.topics.length,
          0
        );
        title.textContent = displayName;
        meta.textContent = total + " questions available • " + topicTotal + " topic areas";

        const practiceUrl = new URL("subject.html", window.location.href);
        practiceUrl.searchParams.set("subject", subject.name);
        practice.href = practiceUrl.href;
        const pastUrl = new URL("past-questions.html", window.location.href);
        pastUrl.searchParams.set("subject", subject.name);
        past.href = pastUrl.href;

        list.replaceChildren();
        subject.sections.forEach((section) => {
          section.topics.forEach((topic) => {
            const item = document.createElement("article");
            item.className = "topic-item";
            const number = document.createElement("span");
            number.className = "topic-number";
            number.textContent = String(list.children.length + 1).padStart(2, "0");
            const details = document.createElement("div");
            const topicTitle = document.createElement("strong");
            topicTitle.textContent = topic.title;
            const sectionTitle = document.createElement("p");
            sectionTitle.textContent = section.title;
            details.append(topicTitle, sectionTitle);
            item.append(number, details);
            list.appendChild(item);
          });
        });
        if (!topicTotal) {
          const notice = document.createElement("p");
          notice.className = "muted";
          notice.textContent = "Topic areas are not populated for this subject yet.";
          list.appendChild(notice);
        }
        panel.hidden = false;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      search.addEventListener("input", renderSubjects);
      clear.addEventListener("click", () => {
        search.value = "";
        renderSubjects();
        search.focus();
      });
      close.addEventListener("click", () => { panel.hidden = true; });
      renderSubjects();
    } catch (error) {
      console.error("Exam-scoped syllabus unavailable:", error);
      summary.textContent = "Syllabus unavailable for " + examCode + ".";
      grid.replaceChildren();
      panel.hidden = true;
      empty.hidden = false;
      empty.querySelector("h2").textContent = "Syllabus unavailable";
      empty.querySelector("p").textContent =
        error?.message || "No active syllabus catalogue is available for this exam.";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}());