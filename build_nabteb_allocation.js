const fs = require('fs');

const hierarchy = JSON.parse(fs.readFileSync('nabteb_full_hierarchy.json', 'utf8'));

const subjectTargets = {
  "English Language": 500,
  "Mathematics": 550,
  "Civic Education": 300,
  "Economics": 350,
  "Physics": 350,
  "Chemistry": 350,
  "Biology": 350,
  "Agricultural Science": 350,
  "Financial Accounting": 350,
  "Commerce": 300,
  "Office Practice": 300,
  "Technical Drawing": 350,
  "Basic Electricity": 300,
  "Information & Communication Technology (ICT)": 300
};

// Function to allocate questions within a subject cleanly
function allocateSubject(subject, targetTotal) {
  const totalTopics = subject.sections.reduce((acc, s) => acc + s.topics.length, 0);
  
  // Base allocation per topic (integer division)
  const base = Math.floor(targetTotal / totalTopics);
  let remainder = targetTotal - (base * totalTopics);

  // We assign base to each topic, and distribute remainder starting from core sections
  const allocatedSections = subject.sections.map(section => {
    let sectionAllocated = 0;
    const allocatedTopics = section.topics.map(topic => {
      let count = base;
      if (remainder > 0) {
        count += 1;
        remainder -= 1;
      }
      sectionAllocated += count;
      return {
        title: topic.title,
        import_key: topic.import_key,
        display_order: topic.display_order,
        allocated_questions: count
      };
    });

    return {
      title: section.title,
      display_order: section.display_order,
      allocated_questions: sectionAllocated,
      topics_count: section.topics.length,
      topics: allocatedTopics
    };
  });

  const actualSubjectTotal = allocatedSections.reduce((acc, s) => acc + s.allocated_questions, 0);
  if (actualSubjectTotal !== targetTotal) {
    throw new Error(`Subject ${subject.name} total mismatch: expected ${targetTotal}, got ${actualSubjectTotal}`);
  }

  return {
    name: subject.name,
    display_name: subject.display_name,
    display_order: subject.display_order,
    allocated_questions: actualSubjectTotal,
    sections_count: subject.sections.length,
    topics_count: totalTopics,
    sections: allocatedSections
  };
}

const allocatedSubjects = hierarchy.map(subj => {
  const target = subjectTargets[subj.name];
  if (!target) {
    throw new Error(`Missing target for subject: ${subj.name}`);
  }
  return allocateSubject(subj, target);
});

const grandTotal = allocatedSubjects.reduce((acc, s) => acc + s.allocated_questions, 0);
const totalSections = allocatedSubjects.reduce((acc, s) => acc + s.sections_count, 0);
const totalTopics = allocatedSubjects.reduce((acc, s) => acc + s.topics_count, 0);

const allocationDoc = {
  metadata: {
    title: "NABTEB Question Bank Target Allocation",
    generated_at: new Date().toISOString(),
    target_grand_total: 5000,
    actual_grand_total: grandTotal,
    total_subjects: allocatedSubjects.length,
    total_sections: totalSections,
    total_topics: totalTopics,
    total_topics_covered: totalTopics,
    total_topics_zero: 0
  },
  subjects: allocatedSubjects
};

fs.writeFileSync('nabteb_question_allocation.json', JSON.stringify(allocationDoc, null, 2), 'utf8');
console.log(`Created nabteb_question_allocation.json successfully with grand total: ${grandTotal}`);
