const fs = require('fs');
const path = require('path');

const allocPath = path.join(__dirname, 'nabteb_question_allocation.json');
const alloc = JSON.parse(fs.readFileSync(allocPath, 'utf8'));

// Batch definitions by subject
const batchConfigs = [
  {
    batch_number: 1,
    batch_id: 'nabteb_batch_1',
    name: 'General Core Studies (English Language & Civic Education)',
    subject_names: ['English Language', 'Civic Education']
  },
  {
    batch_number: 2,
    batch_id: 'nabteb_batch_2',
    name: 'Mathematical & Social Sciences (Mathematics & Economics)',
    subject_names: ['Mathematics', 'Economics']
  },
  {
    batch_number: 3,
    batch_id: 'nabteb_batch_3',
    name: 'Physical Sciences (Physics & Chemistry)',
    subject_names: ['Physics', 'Chemistry']
  },
  {
    batch_number: 4,
    batch_id: 'nabteb_batch_4',
    name: 'Biological & Agricultural Sciences (Biology & Agricultural Science)',
    subject_names: ['Biology', 'Agricultural Science']
  },
  {
    batch_number: 5,
    batch_id: 'nabteb_batch_5',
    name: 'Business & Commercial Trades (Financial Accounting, Commerce, Office Practice)',
    subject_names: ['Financial Accounting', 'Commerce', 'Office Practice']
  },
  {
    batch_number: 6,
    batch_id: 'nabteb_batch_6',
    name: 'Technical & Engineering Trades (Technical Drawing, Basic Electricity, ICT)',
    subject_names: ['Technical Drawing', 'Basic Electricity', 'Information & Communication Technology (ICT)']
  }
];

const subjectMap = new Map();
alloc.subjects.forEach(s => subjectMap.set(s.name, s));

const batches = [];
const allImportKeys = new Set();
let totalQuestionsAcrossBatches = 0;
let totalTopicsAcrossBatches = 0;
let totalSectionsAcrossBatches = 0;

batchConfigs.forEach(cfg => {
  let batchQuestions = 0;
  let batchTopics = 0;
  let batchSections = 0;
  const batchSubjects = [];

  cfg.subject_names.forEach(subName => {
    const s = subjectMap.get(subName);
    if (!s) throw new Error('Subject not found: ' + subName);
    
    let subQuestions = 0;
    const subSections = [];

    s.sections.forEach(sec => {
      let secQuestions = 0;
      const secTopics = [];

      sec.topics.forEach(t => {
        batchTopics++;
        secQuestions += t.allocated_questions;
        
        // Generate deterministic planned import keys for this topic
        const topicKeys = [];
        for (let q = 1; q <= t.allocated_questions; q++) {
          const keyNum = String(q).padStart(2, '0');
          const key = t.import_key + '-q' + keyNum;
          if (allImportKeys.has(key)) throw new Error('Duplicate key across batches: ' + key);
          allImportKeys.add(key);
          topicKeys.push(key);
        }

        secTopics.push({
          title: t.title,
          topic_slug: t.import_key,
          allocated_questions: t.allocated_questions,
          import_key_start: topicKeys[0],
          import_key_end: topicKeys[topicKeys.length - 1],
          planned_import_keys: topicKeys
        });
      });

      subQuestions += secQuestions;
      batchSections++;
      subSections.push({
        title: sec.title,
        allocated_questions: secQuestions,
        topics_count: secTopics.length,
        topics: secTopics
      });
    });

    batchQuestions += subQuestions;
    batchSubjects.push({
      name: s.name,
      allocated_questions: subQuestions,
      sections_count: subSections.length,
      topics_count: s.topics_count,
      sections: subSections
    });
  });

  totalQuestionsAcrossBatches += batchQuestions;
  totalTopicsAcrossBatches += batchTopics;
  totalSectionsAcrossBatches += batchSections;

  batches.push({
    batch_number: cfg.batch_number,
    batch_id: cfg.batch_id,
    batch_name: cfg.name,
    allocated_questions: batchQuestions,
    subjects_count: batchSubjects.length,
    sections_count: batchSections,
    topics_count: batchTopics,
    subjects_included: cfg.subject_names,
    subjects: batchSubjects
  });
});

const output = {
  metadata: {
    title: 'NABTEB Question Generation Batch Plan',
    created_at: new Date().toISOString(),
    total_planned_questions: totalQuestionsAcrossBatches,
    total_batches: batches.length,
    total_subjects: alloc.subjects.length,
    total_sections: totalSectionsAcrossBatches,
    total_topics: totalTopicsAcrossBatches,
    total_unique_import_keys: allImportKeys.size
  },
  batches: batches
};

const outputPath = path.join(__dirname, 'nabteb_question_generation_batches.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log('SUCCESS: Generated nabteb_question_generation_batches.json');
console.log('Total Batches:', batches.length);
batches.forEach(b => {
  console.log(`Batch ${b.batch_number} (${b.batch_id}): ${b.batch_name}`);
  console.log(`  Questions: ${b.allocated_questions} | Subjects: ${b.subjects_count} | Sections: ${b.sections_count} | Topics: ${b.topics_count}`);
});
console.log('Grand Total Questions:', totalQuestionsAcrossBatches);
console.log('Grand Total Topics:', totalTopicsAcrossBatches);
console.log('Grand Total Unique Import Keys:', allImportKeys.size);
