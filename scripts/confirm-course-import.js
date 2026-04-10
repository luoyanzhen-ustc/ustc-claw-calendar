#!/usr/bin/env node

const { confirmCourseImportDraft } = require('../tools/course-import.js');

const args = process.argv.slice(2);
const draftId = args.find((arg) => !arg.startsWith('--')) || 'latest';
const force = args.includes('--force');
const mode = args.includes('--append') ? 'append' : 'replace';

const result = confirmCourseImportDraft(draftId, { force, mode });
if (!result.success) {
  console.error(`Course import confirmation failed: ${result.error}`);
  if (!force) {
    console.error(
      'If you have already reviewed every flagged item with the user, rerun this command with --force.'
    );
  }
  process.exit(1);
}

console.log('Course import completed.');
console.log(`- Mode: ${result.mode}`);
console.log(`- Imported courses: ${result.importedCount}`);
console.log(`- Draft ID: ${result.draft.id}`);
