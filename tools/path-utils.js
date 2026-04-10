#!/usr/bin/env node

const os = require('os');
const path = require('path');

function getOpenClawHome() {
  return process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
}

function getWorkspace() {
  return process.env.OPENCLAW_WORKSPACE || path.join(getOpenClawHome(), 'workspace');
}

function getCalendarDir() {
  return path.join(getWorkspace(), 'ustc-claw-calendar');
}

function getDataDir() {
  return path.join(getCalendarDir(), 'data');
}

function getActiveDir() {
  return path.join(getDataDir(), 'active');
}

function getArchiveDir(semester = null) {
  const archiveDir = path.join(getDataDir(), 'archive');
  return semester ? path.join(archiveDir, semester) : archiveDir;
}

function getIndexDir() {
  return path.join(getDataDir(), 'index');
}

function getImportDraftsDir() {
  return path.join(getDataDir(), 'import-drafts');
}

function getSettingsFile() {
  return path.join(getDataDir(), 'settings.json');
}

function getEventsFile() {
  return path.join(getActiveDir(), 'events.json');
}

function getCoursesFile() {
  return path.join(getActiveDir(), 'courses.json');
}

function getRecurringFile() {
  return path.join(getActiveDir(), 'recurring.json');
}

function getKnownUsersPath() {
  return path.join(getDataDir(), 'known-users.json');
}

function getOpenClawConfigFile() {
  return path.join(getOpenClawHome(), 'openclaw.json');
}

function getOpenClawQQKnownUsersFile() {
  return path.join(getOpenClawHome(), 'qqbot', 'data', 'known-users.json');
}

function getOpenClawWeixinAccountsDir() {
  return path.join(getOpenClawHome(), 'openclaw-weixin', 'accounts');
}

function getMetadataFile() {
  return path.join(getDataDir(), 'metadata.json');
}

function getTodayIndexFile() {
  return path.join(getIndexDir(), 'today.json');
}

function getThisWeekIndexFile() {
  return path.join(getIndexDir(), 'this-week.json');
}

function getUpcomingIndexFile() {
  return path.join(getIndexDir(), 'upcoming.json');
}

function getLatestCourseImportDraftFile() {
  return path.join(getImportDraftsDir(), 'latest-course-import.json');
}

function getCourseImportDraftFile(draftId) {
  return path.join(getImportDraftsDir(), `${draftId}.json`);
}

module.exports = {
  getOpenClawHome,
  getWorkspace,
  getCalendarDir,
  getDataDir,
  getActiveDir,
  getArchiveDir,
  getIndexDir,
  getImportDraftsDir,
  getSettingsFile,
  getEventsFile,
  getCoursesFile,
  getRecurringFile,
  getKnownUsersPath,
  getOpenClawConfigFile,
  getOpenClawQQKnownUsersFile,
  getOpenClawWeixinAccountsDir,
  getMetadataFile,
  getTodayIndexFile,
  getThisWeekIndexFile,
  getUpcomingIndexFile,
  getLatestCourseImportDraftFile,
  getCourseImportDraftFile
};
