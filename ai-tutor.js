(function () {
  "use strict";

  var SUPABASE_URL = window.SUPABASE_URL || "https://afdnfqmsjmpwlvhloopy.supabase.co";
  var SUPABASE_KEY = window.SUPABASE_PUBLISHABLE_KEY || "";
  var client = window.supabaseClient || null;
  var conversationId = null;
  var currentContext = {};
  var modal;
  var answer;
  var composer;
  var sendButton;
  var status;

  function getClient() {
    if (client) return client;
    if (window.supabase && typeof window.supabase.createClient === "function" && SUPABASE_KEY) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window.supabaseClient = client;
    }
    return client;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      }[character];
    });
  }

  function pageContext() {
    var pathname = window.location.pathname.toLowerCase();
    if (pathname.endsWith("answers.html")) return "answers";
    if (pathname.endsWith("result-details.html")) return "result";
    if (pathname.endsWith("topics.html")) return "topics";
    if (pathname.endsWith("syllabus.html")) return "syllabus";
    return "general";
  }

  function collectResultContext() {
    if (window.examPilotAiResultContext && typeof window.examPilotAiResultContext === "object") {
      return window.examPilotAiResultContext;
    }
    var text = document.getElementById("overview")?.textContent ||
      document.getElementById("pageMeta")?.textContent || "";
    return { summary: text.trim().slice(0, 1200) };
  }

  function createModal() {
    if (modal) return;
    var style = document.createElement("style");
    style.textContent = `
      .ep-ai-launcher{position:fixed;right:16px;bottom:18px;z-index:2500;border:0;border-radius:999px;background:#087f45;color:#fff;padding:12px 16px;box-shadow:0 10px 24px rgba(15,48,38,.2);font:700 14px Arial,sans-serif;cursor:pointer}
      .ep-ai-backdrop{position:fixed;inset:0;z-index:4000;display:none;align-items:flex-end;justify-content:center;padding:14px;background:rgba(8,30,22,.42)}
      .ep-ai-backdrop.is-open{display:flex}
      .ep-ai-dialog{width:min(100%,560px);max-height:min(720px,calc(100vh - 28px));display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.24);font-family:Arial,Helvetica,sans-serif;color:#173229}
      .ep-ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #dce8e0}.ep-ai-head h2{margin:0;font-size:19px}.ep-ai-head p{margin:4px 0 0;color:#5f7169;font-size:12px}.ep-ai-close{width:40px;height:40px;border:0;border-radius:50%;background:#eef8f1;color:#173229;font-size:23px;cursor:pointer}
      .ep-ai-answer{min-height:150px;max-height:390px;overflow:auto;padding:18px;white-space:pre-wrap;color:#314840;line-height:1.6;font-size:14px}.ep-ai-answer.is-empty{color:#6c7b74}.ep-ai-status{padding:0 18px;color:#087f45;font-size:12px;min-height:18px}.ep-ai-composer{display:flex;gap:8px;padding:12px 18px 18px;border-top:1px solid #dce8e0}.ep-ai-composer textarea{min-height:48px;max-height:120px;flex:1;resize:vertical;padding:11px;border:1px solid #cbdcd2;border-radius:10px;font:14px Arial,sans-serif;color:#173229}.ep-ai-send{min-width:82px;border:0;border-radius:10px;background:#087f45;color:#fff;font-weight:700;cursor:pointer}.ep-ai-send:disabled{opacity:.55;cursor:wait}.ep-ai-suggestions{display:flex;flex-wrap:wrap;gap:7px;padding:0 18px 12px}.ep-ai-suggestion{border:1px solid #b8d6c2;border-radius:999px;background:#fff;color:#087f45;padding:7px 10px;font-size:12px;cursor:pointer}.ai-question-button{margin:0 0 12px;padding:8px 11px;border:1px solid #b8d6c2;border-radius:9px;background:#fff;color:#087f45;font-weight:700;cursor:pointer}
      @media(max-width:520px){.ep-ai-launcher{right:12px;bottom:14px}.ep-ai-backdrop{padding:0}.ep-ai-dialog{max-height:100vh;border-radius:16px 16px 0 0}.ep-ai-answer{max-height:none;flex:1}.ep-ai-composer{padding-bottom:max(14px,env(safe-area-inset-bottom))}}
    `;
    document.head.appendChild(style);

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "ep-ai-launcher";
    launcher.textContent = "AI Tutor";
    launcher.addEventListener("click", function () { openTutor({}); });
    document.body.appendChild(launcher);

    modal = document.createElement("div");
    modal.className = "ep-ai-backdrop";
    modal.innerHTML = `
      <section class="ep-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="epAiTitle">
        <header class="ep-ai-head"><div><h2 id="epAiTitle">AI Tutor</h2><p id="epAiSubtitle">Ask a focused study question.</p></div><button class="ep-ai-close" type="button" aria-label="Close AI Tutor">×</button></header>
        <div class="ep-ai-answer is-empty" id="epAiAnswer">AI Tutor responses are for study support. Check important answers against your course materials.</div>
        <div class="ep-ai-status" id="epAiStatus" role="status" aria-live="polite"></div>
        <div class="ep-ai-suggestions"><button type="button" class="ep-ai-suggestion" data-ai-suggestion="Explain this simply.">Explain simply</button><button type="button" class="ep-ai-suggestion" data-ai-suggestion="Give me a short example.">Give an example</button><button type="button" class="ep-ai-suggestion" data-ai-suggestion="Give me one follow-up practice question.">Follow-up practice</button></div>
        <form class="ep-ai-composer"><textarea maxlength="2000" aria-label="Ask AI Tutor" placeholder="Ask AI Tutor..."></textarea><button class="ep-ai-send" type="submit">Ask</button></form>
      </section>`;
    document.body.appendChild(modal);
    answer = modal.querySelector("#epAiAnswer");
    composer = modal.querySelector("textarea");
    sendButton = modal.querySelector(".ep-ai-send");
    status = modal.querySelector("#epAiStatus");
    modal.querySelector(".ep-ai-close").addEventListener("click", closeTutor);
    modal.addEventListener("click", function (event) { if (event.target === modal) closeTutor(); });
    modal.querySelectorAll("[data-ai-suggestion]").forEach(function (button) {
      button.addEventListener("click", function () { composer.value = button.dataset.aiSuggestion; composer.focus(); });
    });
    composer.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.form.requestSubmit(); }
    });
    composer.form.addEventListener("submit", function (event) { event.preventDefault(); askTutor(); });
  }

  function openTutor(context) {
    createModal();
    currentContext = context || {};
    var subtitle = modal.querySelector("#epAiSubtitle");
    if (currentContext.questionId) subtitle.textContent = "Question explanation and answer review.";
    else if (currentContext.topicTitle) subtitle.textContent = "Topic support for " + currentContext.topicTitle + ".";
    else if (currentContext.result) subtitle.textContent = "Study support for this result.";
    else subtitle.textContent = "Ask a focused study question.";
    modal.classList.add("is-open");
    composer.focus();
  }

  function closeTutor() { if (modal) modal.classList.remove("is-open"); }

  async function askTutor() {
    var message = composer.value.trim();
    if (!message || sendButton.disabled) return;
    var supabaseClient = getClient();
    if (!supabaseClient) { status.textContent = "Login is required to use AI Tutor."; return; }
    sendButton.disabled = true;
    status.textContent = "Thinking...";
    answer.classList.remove("is-empty");
    answer.textContent = "";
    try {
      var result = await supabaseClient.functions.invoke("ai-tutor", {
        body: {
          action: currentContext.action || (currentContext.questionId ? "explain" : currentContext.topicTitle ? "tutor" : currentContext.result ? "result" : "tutor"),
          message,
          examCode: typeof window.getSelectedExamCode === "function" ? window.getSelectedExamCode() : "JAMB",
          questionId: currentContext.questionId || undefined,
          topicId: currentContext.topicId || undefined,
          topicTitle: currentContext.topicTitle || undefined,
          resultContext: currentContext.result ? collectResultContext() : undefined,
          conversationId: conversationId || undefined
        }
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("AI Tutor request failed");
      answer.textContent = result.data.answer || "No answer was returned.";
      conversationId = result.data.conversationId || conversationId;
      status.textContent = result.data.quota ? `${result.data.quota.remaining} AI request${result.data.quota.remaining === 1 ? "" : "s"} remaining today.` : "";
      composer.value = "";
    } catch (error) {
      var responseStatus = 0;
      var responseBody = null;
      var responseContext = error && error.context;
      if (responseContext && typeof responseContext.status === "number") {
        responseStatus = responseContext.status;
        if (typeof responseContext.clone === "function") {
          try {
            responseBody = await responseContext.clone().json();
          } catch (_) {
            responseBody = null;
          }
        }
      }

      var backendMessage = responseBody && typeof responseBody.error === "string"
        ? responseBody.error
        : "";
      answer.classList.add("is-empty");
      if (responseStatus === 401) {
        answer.textContent = "Your session has expired. Please sign in again.";
        status.textContent = "";
      } else if (responseStatus === 429 && backendMessage.indexOf("Daily AI limit reached.") === 0) {
        answer.textContent = "Your AI Tutor requests for today are finished.\n\nYour requests will reset tomorrow. Come back then to continue learning.";
        status.textContent = "No AI usage was deducted.";
      } else if (responseStatus === 429 && backendMessage.indexOf("Too many AI requests.") === 0) {
        answer.textContent = "You're sending requests too quickly. Please wait a moment and try again.";
        status.textContent = "";
      } else if (responseStatus === 502 || responseStatus >= 500) {
        answer.textContent = "AI Tutor is temporarily unavailable. Please try again later.";
        status.textContent = "No AI usage was deducted for this failed request.";
      } else if (!responseStatus) {
        answer.textContent = "We couldn't connect to AI Tutor. Please check your internet connection and try again.";
        status.textContent = "";
      } else {
        answer.textContent = "AI Tutor is temporarily unavailable. Please try again later.";
        status.textContent = "No AI usage was deducted for this failed request.";
      }
    } finally {
      sendButton.disabled = false;
    }
  }

  function addTopicLessonAction() {
    var lessonTitle = document.getElementById("studyLessonTitle");
    var card = lessonTitle && lessonTitle.closest(".study-card");
    if (!card || card.querySelector("[data-ai-topic-title]")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "ai-lesson-action";
    button.textContent = "Ask AI about this topic";
    button.dataset.aiTopicTitle = lessonTitle.textContent.trim();
    button.style.cssText = "margin:12px 0;padding:9px 12px;border:1px solid #b8d6c2;border-radius:10px;background:#fff;color:#087f45;font-weight:700;cursor:pointer";
    button.addEventListener("click", function () { openTutor({ topicTitle: button.dataset.aiTopicTitle }); });
    card.appendChild(button);
  }

  function init() {
    if (["answers", "result", "topics", "syllabus", "general"].indexOf(pageContext()) === -1) return;
    createModal();
    document.addEventListener("click", function (event) {
      var questionButton = event.target.closest("[data-ai-question-id]");
      if (questionButton) openTutor({ questionId: questionButton.dataset.aiQuestionId, action: "explain" });
      var resultButton = event.target.closest("[data-ai-result]");
      if (resultButton) openTutor({ result: true, action: "result" });
    });
    var observer = new MutationObserver(addTopicLessonAction);
    observer.observe(document.body, { childList: true, subtree: true });
    addTopicLessonAction();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
