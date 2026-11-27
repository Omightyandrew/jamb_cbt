"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

console.log("=== EXAMPILOT SEO EXPANSION BATCH 1 VALIDATION SUITE ===\n");

const batch1Articles = [
  {
    dir: "jamb-profile-code-nin-guide",
    title: "How to Get Your NIN and Generate Your JAMB Profile Code | ExamPilot",
    canonical: "https://exampilot.com.ng/jamb-profile-code-nin-guide/",
    category: "Registration & Identity Guide",
    expectedKeywords: [
      "National Identification Number",
      "NIMC",
      "JAMB Profile Code",
      "10-digit",
      "55019",
      "66019",
      "RESEND"
    ],
    officialLinks: [
      "https://nimc.gov.ng",
      "https://www.jamb.gov.ng"
    ]
  },
  {
    dir: "waec-neco-nabteb-registration-guide",
    title: "WAEC, NECO and NABTEB Registration Procedures: School vs Private Candidates Guide | ExamPilot",
    canonical: "https://exampilot.com.ng/waec-neco-nabteb-registration-guide/",
    category: "National O'Level Examination Guide",
    expectedKeywords: [
      "School Candidates",
      "Private Candidates",
      "WAEC",
      "NECO",
      "NABTEB",
      "CASS",
      "Continuous Assessment"
    ],
    officialLinks: [
      "https://www.waeconline.org.ng",
      "https://www.neco.gov.ng",
      "https://mynecoexams.com",
      "https://nabteb.gov.ng"
    ]
  },
  {
    dir: "understanding-jamb-caps-admission-guide",
    title: "Complete Guide to JAMB CAPS: Admission Status, Acceptance and Programme Transfer | ExamPilot",
    canonical: "https://exampilot.com.ng/understanding-jamb-caps-admission-guide/",
    category: "Tertiary Admissions Architecture",
    expectedKeywords: [
      "Central Admissions Processing System",
      "CAPS",
      "Institutional Recommendations",
      "Admission in Progress",
      "Accept Admission",
      "Reject Admission",
      "Marketplace",
      "Programme Transfer"
    ],
    officialLinks: [
      "https://efacility.jamb.gov.ng"
    ]
  },
  {
    dir: "jamb-change-of-course-and-institution",
    title: "JAMB Change of Course and Institution: Guidelines, Eligibility and Timelines | ExamPilot",
    canonical: "https://exampilot.com.ng/jamb-change-of-course-and-institution/",
    category: "Admissions Realignment Guide",
    expectedKeywords: [
      "Change of Course",
      "IBASS",
      "Remita",
      "CBT centre",
      "biometric",
      "Synchronization"
    ],
    officialLinks: [
      "https://ibass.jamb.gov.ng",
      "https://efacility.jamb.gov.ng"
    ]
  },
  {
    dir: "jamb-direct-entry-requirements-guide",
    title: "Direct Entry (DE) Admission in Nigeria: Requirements, Verification and Application Guide | ExamPilot",
    canonical: "https://exampilot.com.ng/jamb-direct-entry-requirements-guide/",
    category: "Advanced Tertiary Admission Guide",
    expectedKeywords: [
      "Direct Entry",
      "National Diploma",
      "NCE",
      "IJMB",
      "JUPEB",
      "transcript",
      "200-level",
      "Senate"
    ],
    officialLinks: [
      "https://ibass.jamb.gov.ng"
    ]
  }
];

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

// 1. File existence & basic structure
console.log("Test Group 1: File Existence & HTML Structure");
batch1Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  runTest(`File exists: ${art.dir}/index.html`, () => {
    assert.ok(fs.existsSync(filePath), `File ${filePath} must exist`);
  });

  const content = fs.readFileSync(filePath, "utf8");

  runTest(`HTML doctype and lang in ${art.dir}`, () => {
    assert.ok(content.startsWith("<!DOCTYPE html>"), "Must start with DOCTYPE");
    assert.ok(content.includes('<html lang="en">'), "Must specify lang='en'");
    assert.ok(content.includes('<meta charset="UTF-8">'), "Must specify charset UTF-8");
    assert.ok(content.includes('<body class="seo-page">'), "Body must have seo-page class");
  });

  runTest(`Heading hierarchy in ${art.dir}`, () => {
    const h1s = [...content.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
    assert.strictEqual(h1s.length, 1, "Exactly one H1 element");
    const h2s = [...content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
    assert.ok(h2s.length >= 4, `At least 4 H2 headings, found ${h2s.length}`);
    const h3s = [...content.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
    assert.ok(h3s.length >= 6, `At least 6 H3 headings, found ${h3s.length}`);
  });
});

// 2. SEO Meta, Canonical & Social Sharing
console.log("\nTest Group 2: SEO Metadata, Canonical & Social Sharing Tags");
batch1Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  const content = fs.readFileSync(filePath, "utf8");

  runTest(`Title tag for ${art.dir}`, () => {
    assert.ok(content.includes(`<title>${art.title}</title>`), `Title must match ${art.title}`);
  });

  runTest(`Canonical URL for ${art.dir}`, () => {
    assert.ok(
      content.includes(`<link rel="canonical" href="${art.canonical}">`),
      `Canonical must be ${art.canonical}`
    );
  });

  runTest(`Open Graph tags for ${art.dir}`, () => {
    assert.ok(content.includes('<meta property="og:type" content="article">'), "og:type is article");
    assert.ok(content.includes(`<meta property="og:url" content="${art.canonical}">`), "og:url matches canonical");
    assert.ok(content.includes('<meta property="og:site_name" content="ExamPilot">'), "og:site_name is ExamPilot");
    assert.ok(content.includes('<meta property="og:image" content="https://exampilot.com.ng/assets/logo/og-image.png">'), "og:image present");
  });

  runTest(`Twitter Card tags for ${art.dir}`, () => {
    assert.ok(content.includes('<meta name="twitter:card" content="summary_large_image">'), "twitter:card is summary_large_image");
    assert.ok(content.includes('<meta name="twitter:image" content="https://exampilot.com.ng/assets/logo/og-image.png">'), "twitter:image present");
  });
});

// 3. Keywords & Policy Boundaries
console.log("\nTest Group 3: Content Guardrails & Key Concepts");
batch1Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  const content = fs.readFileSync(filePath, "utf8");

  art.expectedKeywords.forEach((kw) => {
    runTest(`Keyword "${kw}" present in ${art.dir}`, () => {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      assert.ok(regex.test(content), `Missing keyword '${kw}'`);
    });
  });

  art.officialLinks.forEach((link) => {
    runTest(`Official authority link "${link}" in ${art.dir}`, () => {
      assert.ok(content.includes(link), `Missing official link '${link}'`);
      assert.ok(content.includes('rel="noopener noreferrer"'), "Must have rel='noopener noreferrer'");
    });
  });
});

// 4. Structured Data (JSON-LD)
console.log("\nTest Group 4: Structured Data (JSON-LD) Schemas");
batch1Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  const content = fs.readFileSync(filePath, "utf8");

  runTest(`Public SEO script and init in ${art.dir}`, () => {
    assert.ok(content.includes('<script src="../public-seo.js"></script>'), "public-seo.js included");
    assert.ok(content.includes("ExamPilotPublicSEO"), "ExamPilotPublicSEO referenced");
    assert.ok(content.includes('seo.renderHeader("#publicHeader"'), "Header rendered");
    assert.ok(content.includes('seo.renderBreadcrumbs("#breadcrumbMount"'), "Breadcrumbs rendered");
    assert.ok(content.includes('seo.renderFooter("#publicFooter")'), "Footer rendered");
  });

  runTest(`Article & FAQPage schemas in ${art.dir}`, () => {
    assert.ok(content.includes('"@type": "Article"'), "Article schema present");
    assert.ok(content.includes(`"url": "${art.canonical}"`), "Article URL matches");
    assert.ok(content.includes('"@type": "FAQPage"'), "FAQPage schema present");
    assert.ok(content.includes('"@type": "Question"'), "FAQ questions present");
    assert.ok(content.includes('"@type": "Answer"'), "FAQ answers present");
  });
});

// 5. Sitemap Validation
console.log("\nTest Group 5: Sitemap.xml Verification");
const sitemapPath = path.join(__dirname, "..", "sitemap.xml");
const sitemapContent = fs.readFileSync(sitemapPath, "utf8");

batch1Articles.forEach((art) => {
  runTest(`Sitemap entry for ${art.canonical}`, () => {
    assert.ok(sitemapContent.includes(`<loc>${art.canonical}</loc>`), "Canonical in sitemap");
    // Verify structure
    const blockRegex = new RegExp(
      `<loc>${art.canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/loc>\\s*<lastmod>(\\d{4}-\\d{2}-\\d{2})<\\/lastmod>\\s*<changefreq>monthly<\\/changefreq>\\s*<priority>0\\.80<\\/priority>`,
      "m"
    );
    assert.ok(blockRegex.test(sitemapContent), `Sitemap entry format correct for ${art.canonical}`);
  });
});

// Ensure uniqueness of locs in sitemap
runTest("All sitemap loc entries are unique", () => {
  const locs = [...sitemapContent.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(m => m[1]);
  const set = new Set(locs);
  assert.strictEqual(locs.length, set.size, "No duplicate loc entries in sitemap");
});

console.log(`\n======================================`);
console.log(`Validation Completed: ${passedTests}/${totalTests} Tests Passed.`);
if (passedTests === totalTests) {
  console.log("STATUS: ALL TESTS PASSED SUCCESSFULLY! ✓");
} else {
  console.error("STATUS: FAILURES DETECTED.");
  process.exit(1);
}
