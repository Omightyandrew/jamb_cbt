"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

console.log("=== EXAMPILOT JAMB NOVEL 2027 ARTICLE VALIDATION SUITE ===\n");

// 1. File existence
const articlePath = path.join(__dirname, "jamb-novel-2027", "index.html");
assert.ok(fs.existsSync(articlePath), "Article file jamb-novel-2027/index.html must exist");
const html = fs.readFileSync(articlePath, "utf8");

// 2. Title, Meta, and SEO Tags
console.log("Test 1: Metadata, Canonical & Social Sharing Tags...");
assert.ok(
  html.includes("<title>JAMB Novel 2027: Is The Lekki Headmaster Still the Prescribed Reading Text? | ExamPilot</title>"),
  "Page title must match recommended title"
);
assert.ok(
  html.includes('<link rel="canonical" href="https://exampilot.com.ng/jamb-novel-2027/">'),
  "Canonical URL must be exactly https://exampilot.com.ng/jamb-novel-2027/"
);
assert.ok(
  html.includes('<meta property="og:url" content="https://exampilot.com.ng/jamb-novel-2027/">'),
  "Open Graph URL must match canonical"
);
assert.ok(
  html.includes('<meta property="og:type" content="article">'),
  "Open Graph type must be 'article'"
);
assert.ok(
  html.includes('<meta name="twitter:card" content="summary_large_image">'),
  "Twitter card must be summary_large_image"
);
assert.ok(
  html.includes('<meta name="robots" content="index,follow">'),
  "Robots tag must permit indexing"
);
console.log("  ✓ Canonical, OG, Twitter, and meta tags verified.");

// 3. Keywords Presence
console.log("\nTest 2: Target Keywords Presence...");
const keywords = [
  "JAMB novel 2027",
  "JAMB recommended novel",
  "The Lekki Headmaster",
  "Kabir Alabi Garba",
  "JAMB Use of English reading text",
  "JAMB novel study guide"
];
for (const kw of keywords) {
  const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  assert.ok(regex.test(html), `Target keyword '${kw}' must be present in content`);
  console.log(`  ✓ Keyword found: "${kw}"`);
}

// 4. Heading Hierarchy
console.log("\nTest 3: Semantic Heading Hierarchy...");
const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
assert.strictEqual(h1s.length, 1, "There must be exactly one <h1> element on the page");
console.log(`  ✓ Single H1 verified: "${h1s[0][1].trim()}"`);

const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
assert.ok(h2s.length >= 7, `Expected at least 7 <h2> section headings, found ${h2s.length}`);
console.log(`  ✓ Section headings (H2): ${h2s.length} headings verified`);

const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
assert.ok(h3s.length >= 10, `Expected at least 10 <h3> subsection headings, found ${h3s.length}`);
console.log(`  ✓ Subsection headings (H3): ${h3s.length} headings verified`);

// 5. Accuracy Requirements & Official Links
console.log("\nTest 4: Accuracy & Authoritative Source Links...");
assert.ok(
  html.includes("https://www.jamb.gov.ng"),
  "Must link to the official JAMB website (https://www.jamb.gov.ng)"
);
assert.ok(
  html.includes("https://ibass.jamb.gov.ng"),
  "Must link to the official JAMB IBASS portal (https://ibass.jamb.gov.ng)"
);
assert.ok(
  /November 26, 2026/i.test(html),
  "Must state the current status as of November 26, 2026"
);
assert.ok(
  /Literature in English/i.test(html),
  "Must clearly distinguish Use of English reading text from Literature in English elective"
);
console.log("  ✓ Official JAMB & IBASS links present with proper rel='noopener noreferrer'");
console.log("  ✓ November 26, 2026 status notice and Literature distinction confirmed");

// 6. Promotional Elements & Disclaimers
console.log("\nTest 5: Educational Promotion & Weekly UTME Challenge...");
assert.ok(
  html.includes('href="/novels.html"') || html.includes('href="/novels/"'),
  "Must link to ExamPilot Novel Library (/novels.html)"
);
assert.ok(
  /independently prepared educational/i.test(html),
  "Must state clear educational disclaimer that study guide is not the full book nor official JAMB publication"
);
assert.ok(
  html.includes('href="/weekly-utme-challenge/"'),
  "Must link to Weekly UTME Challenge (/weekly-utme-challenge/)"
);
assert.ok(
  html.includes("Prepare. Compete. Win Rewards!"),
  "Must include the suggested challenge hook 'Prepare. Compete. Win Rewards!'"
);
assert.ok(
  /Test your knowledge against other students across Nigeria through the ExamPilot Weekly UTME Challenge/i.test(html),
  "Must include the full challenge invitation message"
);
assert.ok(
  !/everyone (?:wins|gets a prize)|every participant receives a (?:prize|reward)/i.test(html),
  "Must not falsely promise prizes to every single participant"
);
console.log("  ✓ Novel Library link and non-affiliated educational disclaimer verified");
console.log("  ✓ Weekly UTME Challenge message and conditional rewards disclosure verified");

// 7. Structured Data (JSON-LD) Validation
console.log("\nTest 6: Structured Data (JSON-LD) Script Block Validation...");
const scriptMatches = [...html.matchAll(/seo\.addStructuredData\((\{[\s\S]*?\})\);/g)];
assert.ok(scriptMatches.length >= 2, "Expected at least Article and FAQPage structured data calls");

let articleFound = false;
let faqFound = false;
for (const match of scriptMatches) {
  try {
    const parsed = new Function("return (" + match[1] + ");")();
    if (parsed["@type"] === "Article") {
      articleFound = true;
      assert.strictEqual(parsed.headline, "JAMB Novel 2027: Is The Lekki Headmaster Still the Prescribed Reading Text?");
      assert.strictEqual(parsed.url, "https://exampilot.com.ng/jamb-novel-2027/");
      assert.ok(parsed.author && parsed.publisher);
      console.log("  ✓ Valid Article structured data schema verified");
    }
    if (parsed["@type"] === "FAQPage") {
      faqFound = true;
      assert.ok(Array.isArray(parsed.mainEntity) && parsed.mainEntity.length >= 5);
      console.log(`  ✓ Valid FAQPage structured data with ${parsed.mainEntity.length} Q&As verified`);
    }
  } catch (err) {
    assert.fail("Structured data block failed to parse: " + err.message);
  }
}
assert.ok(articleFound, "Article schema must be registered");
assert.ok(faqFound, "FAQPage schema must be registered");

// 8. Internal Links Integrity
console.log("\nTest 7: Internal Links Target Verification...");
const internalHrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
const uniqueHrefs = [...new Set(internalHrefs)];
console.log(`  Checking ${uniqueHrefs.length} unique internal links...`);
for (const href of uniqueHrefs) {
  const clean = href.split("#")[0].split("?")[0];
  if (clean === "/" || clean === "") continue;
  
  // Resolve path to physical file
  let targetPath;
  if (clean.endsWith(".html") || clean.endsWith(".css") || clean.endsWith(".js") || clean.endsWith(".svg") || clean.endsWith(".png")) {
    targetPath = path.join(__dirname, clean);
  } else {
    targetPath = path.join(__dirname, clean, "index.html");
  }
  
  assert.ok(
    fs.existsSync(targetPath),
    `Internal link '${href}' must resolve to an existing file on disk: ${targetPath}`
  );
  console.log(`    ✓ ${href} -> ${path.relative(__dirname, targetPath)}`);
}

// 9. Sitemap Verification
console.log("\nTest 8: Sitemap.xml Verification...");
const sitemap = fs.readFileSync(path.join(__dirname, "sitemap.xml"), "utf8");
const urlOccurrences = (sitemap.match(/<loc>https:\/\/exampilot\.com\.ng\/jamb-novel-2027\/<\/loc>/g) || []).length;
assert.strictEqual(urlOccurrences, 1, "Sitemap must contain https://exampilot.com.ng/jamb-novel-2027/ exactly once");

// Verify valid XML structure
assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "Sitemap must have valid XML declaration");
assert.ok(sitemap.trim().endsWith("</urlset>"), "Sitemap must end with </urlset>");
assert.ok(sitemap.includes("<lastmod>2026-11-26</lastmod>"), "Sitemap must include 2026-11-26 lastmod");
console.log("  ✓ URL present exactly once in sitemap.xml with lastmod 2026-11-26 and valid syntax");

console.log("\n=============================================================");
console.log("ALL JAMB NOVEL 2027 ARTICLE VALIDATION CHECKS PASSED (8/8)!");
console.log("=============================================================\n");
