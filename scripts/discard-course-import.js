#!/usr/bin/env node

const { discardCourseImportDraft } = require('../tools/course-import.js');

const draftId = process.argv[2] || 'latest';
const result = discardCourseImportDraft(draftId);

if (!result.success) {
  console.error(`Failed to discard course import draft: ${result.error}`);
  process.exit(1);
}

console.log('Course import draft discarded.');
console.log(`- Draft ID: ${result.draft.id}`);
