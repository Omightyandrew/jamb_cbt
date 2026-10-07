/**
 * ExamPilot Referral V1 — Client Referral Tracker
 * File: referral-tracker.js
 *
 * Responsibilities:
 * 1. Captures `?ref=CODE` query parameter from landing / entry URLs.
 * 2. Persists the code in browser storage across page navigation and reloads.
 * 3. Prevents existing logged-in users from overriding referral attribution.
 * 4. Provides sharing helpers (WhatsApp, copy link) for settings / dashboard.
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'exampilot_pending_ref';
  var CODE_REGEX = /^[A-Za-z0-9_-]{3,32}$/;

  function sanitizeCode(code) {
    if (!code || typeof code !== 'string') return '';
    var clean = code.trim().toUpperCase();
    return CODE_REGEX.test(clean) ? clean : '';
  }

  function hasActiveStudentSession() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // If student is actively logged in on this browser, do not treat as a new referred visitor
        var hasName = !!window.localStorage.getItem('studentName');
        var hasUser = !!window.localStorage.getItem('studentUsername');
        return hasName && hasUser;
      }
    } catch (_) {}
    return false;
  }

  function captureReferralFromUrl() {
    try {
      if (typeof window === 'undefined' || !window.location) return;
      var params = new URLSearchParams(window.location.search);
      var rawRef = params.get('ref');
      if (!rawRef) return;

      var cleanCode = sanitizeCode(rawRef);
      if (!cleanCode) return;

      // Existing logged-in students cannot be newly attributed
      if (hasActiveStudentSession()) {
        return;
      }

      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, cleanCode);
      }
      if (window.sessionStorage) {
        window.sessionStorage.setItem(STORAGE_KEY, cleanCode);
      }
    } catch (err) {
      console.warn('Referral capture notice:', err);
    }
  }

  function getPendingReferralCode() {
    try {
      if (window.localStorage) {
        var code = window.localStorage.getItem(STORAGE_KEY);
        if (code) return sanitizeCode(code);
      }
      if (window.sessionStorage) {
        var sessCode = window.sessionStorage.getItem(STORAGE_KEY);
        if (sessCode) return sanitizeCode(sessCode);
      }
    } catch (_) {}
    return '';
  }

  function clearPendingReferralCode() {
    try {
      if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY);
      if (window.sessionStorage) window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function buildReferralUrl(referralCode) {
    var code = sanitizeCode(referralCode);
    if (!code) return '';
    var origin = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : 'https://exampilot.com.ng';
    return origin + '/student.html?ref=' + encodeURIComponent(code);
  }

  function shareOnWhatsApp(referralCode, customText) {
    var url = buildReferralUrl(referralCode);
    var defaultMsg = 'Join me on ExamPilot to prepare for JAMB, WAEC, NECO & NABTEB exams! Sign up here: ' + url;
    var message = customText ? customText + ' ' + url : defaultMsg;
    var shareUrl = 'https://wa.me/?text=' + encodeURIComponent(message);
    if (typeof window !== 'undefined') {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
    return shareUrl;
  }

  // Auto-capture on page load
  captureReferralFromUrl();

  // Expose global interface
  window.ExamPilotReferral = {
    sanitizeCode: sanitizeCode,
    captureReferralFromUrl: captureReferralFromUrl,
    getPendingReferralCode: getPendingReferralCode,
    clearPendingReferralCode: clearPendingReferralCode,
    buildReferralUrl: buildReferralUrl,
    shareOnWhatsApp: shareOnWhatsApp,
    hasActiveStudentSession: hasActiveStudentSession,
  };
})();
