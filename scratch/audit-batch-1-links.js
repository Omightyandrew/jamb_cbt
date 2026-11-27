"use strict";

const fs = require("node:fs");
const path = require("node:path");

const articles = [
  "jamb-profile-code-nin-guide",
  "waec-neco-nabteb-registration-guide",
  "understanding-jamb-caps-admission-guide",
  "jamb-change-of-course-and-institution",
  "jamb-direct-entry-requirements-guide"
];

console.log("=== BATCH 1 READ-ONLY CONTENT & LINK AUDIT ===\n");

// 1. Audit Internal & External Links
articles.forEach(slug => {
  const filePath = path.join(__dirname, "..", slug, "index.html");
  const content = fs.readFileSync(filePath, "utf8");

  console.log(`\n--- Auditing Links in: ${slug} ---`);

  // Find all hrefs
  const hrefMatches = [...content.matchAll(/href="([^"#\?]+)"/g)].map(m => m[1]);
  const uniqueHrefs = [...new Set(hrefMatches)];

  uniqueHrefs.forEach(href => {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      console.log(`  [EXTERNAL] ${href}`);
    } else if (href.startsWith("../")) {
      // relative root link (e.g. ../brand.css, ../public-seo.css, ../public-seo.js)
      const targetPath = path.resolve(path.dirname(filePath), href);
      const exists = fs.existsSync(targetPath);
      console.log(`  [ASSET] ${href} -> exists: ${exists}`);
    } else if (href.startsWith("/")) {
      // Absolute site link
      // Could be /student.html or /jamb/cbt/ or /jamb/
      let targetPath;
      if (href.endsWith("/")) {
        targetPath = path.join(__dirname, "..", href.slice(1), "index.html");
      } else {
        targetPath = path.join(__dirname, "..", href.slice(1));
      }
      const exists = fs.existsSync(targetPath);
      console.log(`  [INTERNAL] ${href} -> resolved: ${targetPath} -> exists: ${exists}`);
    } else {
      console.log(`  [OTHER] ${href}`);
    }
  });
});
