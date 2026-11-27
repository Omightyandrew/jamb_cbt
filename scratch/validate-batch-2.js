"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

console.log("=== EXAMPILOT SEO EXPANSION BATCH 2 VALIDATION SUITE ===\n");

const batch2Articles = [
  {
    dir: "how-to-check-waec-neco-jamb-results",
    title: "How to Check WAEC, NECO and JAMB Results Online and via SMS | ExamPilot",
    canonical: "https://exampilot.com.ng/how-to-check-waec-neco-jamb-results/",
    mustInclude: [
      "https://www.waecdirect.org",
      "WAEC*ExamNo*PIN*ExamYear",
      "32327",
      "MTN, Celtel, and Glo",
      "https://results.neco.gov.ng",
      "UTMERESULT",
      "55019",
      "66019",
      "minimum airtime balance"
    ],
    mustNotInclude: [
      "mynecoexams.com",
      /Airtel/i
    ]
  },
  {
    dir: "how-to-print-jamb-admission-letter",
    title: "How to Print Official JAMB Admission Letters on e-Facility | ExamPilot",
    canonical: "https://exampilot.com.ng/how-to-print-jamb-admission-letter/",
    mustInclude: [
      "https://efacility.jamb.gov.ng",
      "₦1,000",
      "₦200",
      "₦300",
      "2026 Training Manual",
      "Institutional Admission Letter"
    ],
    mustNotInclude: [
      /legally invalid/i
    ]
  },
  {
    dir: "how-to-score-300-and-above-in-jamb",
    title: "How to Score 300 or Above in JAMB UTME: An Advanced Mastery Guide | ExamPilot",
    canonical: "https://exampilot.com.ng/how-to-score-300-and-above-in-jamb/",
    mustInclude: [
      "180 total questions",
      "120-minute",
      "8 downloaded question sets",
      "120 questions per set",
      "daily request quotas",
      "does not guarantee admission"
    ],
    mustNotInclude: [
      /top 1%/i
    ]
  },
  {
    dir: "jamb-cut-off-marks-explained",
    title: "Understanding JAMB Cut-Off Marks: National Minimum Benchmarks vs Institutional Cut-Offs | ExamPilot",
    canonical: "https://exampilot.com.ng/jamb-cut-off-marks-explained/",
    mustInclude: [
      "2026/2027",
      "Universities: 150",
      "Colleges of Nursing Sciences: 150",
      "Polytechnics",
      "100",
      "May 11, 2026",
      "does not guarantee admission"
    ],
    mustNotInclude: [
      "45:35:20",
      "45%"
    ]
  },
  {
    dir: "how-to-calculate-post-utme-aggregate-score",
    title: "How Nigerian Universities Calculate Post-UTME Aggregate Scores | ExamPilot",
    canonical: "https://exampilot.com.ng/how-to-calculate-post-utme-aggregate-score/",
    mustInclude: [
      "no single universal aggregate formula",
      "2025/2026",
      "50%",
      "30%",
      "20%",
      "https://admissions.unilag.edu.ng",
      "https://admissions.ui.edu.ng"
    ],
    mustNotInclude: [
      "4.0",
      "3.6",
      "50:50"
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

// 1. Structure & Metadata
console.log("Test Group 1: Structure, Metadata & Canonical Verification");
batch2Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  runTest(`File exists: ${art.dir}/index.html`, () => {
    assert.ok(fs.existsSync(filePath), `File ${filePath} missing`);
  });

  const content = fs.readFileSync(filePath, "utf8");

  runTest(`Meta tags & canonical in ${art.dir}`, () => {
    assert.ok(content.includes(`<title>${art.title}</title>`), `Title mismatch`);
    assert.ok(content.includes(`<link rel="canonical" href="${art.canonical}">`), `Canonical mismatch`);
    assert.ok(content.includes(`<meta property="og:url" content="${art.canonical}">`), `OG URL mismatch`);
    assert.ok(content.includes('<meta property="og:type" content="article">'), `og:type missing`);
    assert.ok(content.includes('<meta name="twitter:card" content="summary_large_image">'), `twitter:card missing`);
  });

  runTest(`Heading hierarchy in ${art.dir}`, () => {
    const h1s = [...content.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
    assert.strictEqual(h1s.length, 1, "Must have exactly 1 H1");
    const h2s = [...content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
    assert.ok(h2s.length >= 4, `Expected >=4 H2s, got ${h2s.length}`);
    const h3s = [...content.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
    assert.ok(h3s.length >= 5, `Expected >=5 H3s, got ${h3s.length}`);
  });
});

// 2. Editorial Safeguards & Content Rules
console.log("\nTest Group 2: Editorial Safeguards & Content Verification");
batch2Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  const content = fs.readFileSync(filePath, "utf8");

  art.mustInclude.forEach((reqStr) => {
    runTest(`Includes "${reqStr}" in ${art.dir}`, () => {
      assert.ok(content.includes(reqStr), `Missing required string: ${reqStr}`);
    });
  });

  art.mustNotInclude.forEach((banned) => {
    runTest(`Excludes "${banned}" in ${art.dir}`, () => {
      if (banned instanceof RegExp) {
        assert.ok(!banned.test(content), `Found prohibited pattern: ${banned}`);
      } else {
        assert.ok(!content.includes(banned), `Found prohibited string: ${banned}`);
      }
    });
  });
});

// 3. Links Integrity
console.log("\nTest Group 3: Internal & External Link Integrity");
batch2Articles.forEach((art) => {
  const filePath = path.join(__dirname, "..", art.dir, "index.html");
  const content = fs.readFileSync(filePath, "utf8");

  runTest(`Internal & Asset links resolve in ${art.dir}`, () => {
    const hrefMatches = [...content.matchAll(/href="([^"#\?]+)"/g)].map(m => m[1]);
    for (const href of hrefMatches) {
      if (href.startsWith("../")) {
        const target = path.resolve(path.dirname(filePath), href);
        assert.ok(fs.existsSync(target), `Missing asset: ${href}`);
      } else if (href.startsWith("/")) {
        const target = href.endsWith("/")
          ? path.join(__dirname, "..", href.slice(1), "index.html")
          : path.join(__dirname, "..", href.slice(1));
        assert.ok(fs.existsSync(target), `Missing internal link target: ${href} -> ${target}`);
      }
    }
  });

  runTest(`Structured data & public-seo.js in ${art.dir}`, () => {
    assert.ok(content.includes('<script src="../public-seo.js"></script>'), "public-seo.js missing");
    assert.ok(content.includes('"@type": "Article"'), "Article schema missing");
    assert.ok(content.includes('"@type": "FAQPage"'), "FAQPage schema missing");
  });
});

// 4. Sitemap Verification
console.log("\nTest Group 4: Sitemap.xml Verification");
const sitemapPath = path.join(__dirname, "..", "sitemap.xml");
const sitemapContent = fs.readFileSync(sitemapPath, "utf8");

batch2Articles.forEach((art) => {
  runTest(`Sitemap entry for ${art.canonical}`, () => {
    const blockRegex = new RegExp(
      `<loc>${art.canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/loc>\\s*<lastmod>2026-11-27<\\/lastmod>\\s*<changefreq>monthly<\\/changefreq>\\s*<priority>0\\.80<\\/priority>`,
      "m"
    );
    assert.ok(blockRegex.test(sitemapContent), `Sitemap entry invalid or missing for ${art.canonical}`);
  });
});

runTest("All sitemap URLs are unique", () => {
  const locs = [...sitemapContent.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(m => m[1]);
  const set = new Set(locs);
  assert.strictEqual(locs.length, set.size, "Duplicate URLs detected in sitemap.xml");
});

console.log(`\n======================================`);
console.log(`Batch 2 Validation Completed: ${passedTests}/${totalTests} Tests Passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}
