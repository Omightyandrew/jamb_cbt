const fs = require('fs');
const path = require('path');

const allocPath = path.join(__dirname, 'nabteb_question_allocation.json');
const batchesPath = path.join(__dirname, 'nabteb_question_generation_batches.json');
const hierarchyPath = path.join(__dirname, 'nabteb_full_hierarchy.json');

const alloc = JSON.parse(fs.readFileSync(allocPath, 'utf8'));
const batchesData = JSON.parse(fs.readFileSync(batchesPath, 'utf8'));
const hierarchy = JSON.parse(fs.readFileSync(hierarchyPath, 'utf8'));

console.log('--- STARTING VALIDATION OF NABTEB QUESTION GENERATION BATCHES ---');

// 1. Basic structure check
if (!Array.isArray(batchesData.batches)) throw new Error('batches is not an array');
console.log(`Number of batches: ${batchesData.batches.length}`);

// 2. Check 5,000 total questions and 284 topics
let totalQuestions = 0;
let totalTopics = 0;
let totalSections = 0;
const seenKeys = new Set();
const seenTopicSlugs = new Set();
const seenSubjects = new Set();

batchesData.batches.forEach(b => {
  if (typeof b.batch_number !== 'number') throw new Error(`Batch missing batch_number`);
  if (!b.batch_id) throw new Error(`Batch ${b.batch_number} missing batch_id`);
  if (!b.batch_name) throw new Error(`Batch ${b.batch_number} missing batch_name`);
  if (!Array.isArray(b.subjects_included) || b.subjects_included.length === 0) {
    throw new Error(`Batch ${b.batch_number} missing subjects_included`);
  }

  let batchQCount = 0;
  let batchTopicCount = 0;
  let batchSecCount = 0;

  b.subjects.forEach(sub => {
    if (seenSubjects.has(sub.name)) {
      throw new Error(`Subject ${sub.name} duplicated across batches!`);
    }
    seenSubjects.add(sub.name);

    let subQCount = 0;
    sub.sections.forEach(sec => {
      batchSecCount++;
      let secQCount = 0;
      sec.topics.forEach(t => {
        batchTopicCount++;
        if (seenTopicSlugs.has(t.topic_slug)) {
          throw new Error(`Duplicate topic slug: ${t.topic_slug}`);
        }
        seenTopicSlugs.add(t.topic_slug);

        if (t.allocated_questions <= 0) {
          throw new Error(`Topic has non-positive questions: ${t.topic_slug}`);
        }
        if (!Array.isArray(t.planned_import_keys) || t.planned_import_keys.length !== t.allocated_questions) {
          throw new Error(`Topic keys count mismatch for ${t.topic_slug}`);
        }
        t.planned_import_keys.forEach(k => {
          if (seenKeys.has(k)) {
            throw new Error(`Duplicate import key: ${k}`);
          }
          seenKeys.add(k);
        });

        secQCount += t.allocated_questions;
      });

      if (secQCount !== sec.allocated_questions) {
        throw new Error(`Section allocation mismatch in ${sec.title}`);
      }
      subQCount += secQCount;
    });

    if (subQCount !== sub.allocated_questions) {
      throw new Error(`Subject allocation mismatch in ${sub.name}`);
    }
    batchQCount += subQCount;
  });

  if (batchQCount !== b.allocated_questions) {
    throw new Error(`Batch ${b.batch_number} question sum mismatch`);
  }
  if (batchTopicCount !== b.topics_count) {
    throw new Error(`Batch ${b.batch_number} topic count mismatch`);
  }
  if (batchSecCount !== b.sections_count) {
    throw new Error(`Batch ${b.batch_number} section count mismatch`);
  }

  totalQuestions += batchQCount;
  totalTopics += batchTopicCount;
  totalSections += batchSecCount;
});

console.log(`Total subjects validated: ${seenSubjects.size} (Expected: 14)`);
console.log(`Total sections validated: ${totalSections} (Expected: 70)`);
console.log(`Total topics validated: ${totalTopics} (Expected: 284)`);
console.log(`Total planned questions validated: ${totalQuestions} (Expected: 5,000)`);
console.log(`Total unique import keys: ${seenKeys.size} (Expected: 5,000)`);

if (seenSubjects.size !== 14) throw new Error('Subject count mismatch');
if (totalSections !== 70) throw new Error('Section count mismatch');
if (totalTopics !== 284) throw new Error('Topic count mismatch');
if (totalQuestions !== 5000) throw new Error('Grand question count mismatch');
if (seenKeys.size !== 5000) throw new Error('Unique import key count mismatch');

// 3. Verify against allocation file
alloc.subjects.forEach(as => {
  const batch = batchesData.batches.find(b => b.subjects_included.includes(as.name));
  if (!batch) throw new Error(`Subject ${as.name} not assigned to any batch!`);
  const bs = batch.subjects.find(s => s.name === as.name);
  if (!bs) throw new Error(`Subject ${as.name} missing in batch ${batch.batch_number}`);
  if (bs.allocated_questions !== as.allocated_questions) {
    throw new Error(`Subject ${as.name} question allocation changed!`);
  }
  if (bs.topics_count !== as.topics_count) {
    throw new Error(`Subject ${as.name} topic count changed!`);
  }
});

console.log('--- ALL VALIDATION CHECKS PASSED PERFECTLY ---');
