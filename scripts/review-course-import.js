#!/usr/bin/env node

const { getCourseImportDraft } = require('../tools/course-import.js');

const draftId = process.argv[2] || 'latest';
const draft = getCourseImportDraft(draftId);

if (!draft) {
  console.error('Course import draft not found.');
  process.exit(1);
}

console.log(`Draft ID: ${draft.id}`);
console.log(`Status: ${draft.status}`);
console.log(`Parser: ${draft.parser?.primary || 'unknown'}`);
console.log(`Total courses: ${draft.summary?.totalCourses || 0}`);
console.log(`Needs review: ${draft.summary?.needsReviewCount || 0}`);

for (const course of draft.courses || []) {
  const reviewSuffix = course.needsReview
    ? ` [needsReview: ${(course.reviewReasons || []).join(', ')}]`
    : '';

  console.log(
    `- ${course.name || 'Unnamed course'} | weekday ${course.weekday || '?'} | periods ${course.periods || '?'} | weeks ${course.weeks || '?'}${reviewSuffix}`
  );
}
