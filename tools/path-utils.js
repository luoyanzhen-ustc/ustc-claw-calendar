#!/usr/bin/env node

const os = require('os');
const path = require('path');

function getWorkspace() {
  return process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
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

function getSettingsFile() {
  return path.join(getDataDir(), 'settings.json');
}

function getPlansFile() {
  return path.join(getActiveDir(), 'plans.json');
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

function getMetadataFile() {
  return path.join(getDataDir(), 'metadata.json');
}

function getTodayIndexFile() {
  return path.join(getIndexDir(), 'today.json');
}

function getUpcomingIndexFile() {
  return path.join(getIndexDir(), 'upcoming.json');
}

module.exports = {
  getWorkspace,
  getCalendarDir,
  getDataDir,
  getActiveDir,
  getArchiveDir,
  getIndexDir,
  getSettingsFile,
  getPlansFile,
  getCoursesFile,
  getRecurringFile,
  getKnownUsersPath,
  getMetadataFile,
  getTodayIndexFile,
  getUpcomingIndexFile
};
