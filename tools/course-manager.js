#!/usr/bin/env node

const {
  generateStageId,
  readCourses,
  getCourseById,
  saveCourse
} = require('./file-ops.js');
const { normalizeReminders: normalizeSharedReminders } = require('./reminder-utils.js');
const { syncReminderCronsForSource, buildAdHocReminderStage } = require('./cron-manager.js');

function normalizeReminders(reminders = {}) {
  return normalizeSharedReminders(reminders, generateStageId);
}

function getCourse(courseId) {
  return getCourseById(courseId);
}

function listCourses() {
  return readCourses().courses;
}

function setCourseReminders(courseId, reminders = {}) {
  const currentCourse = getCourseById(courseId);
  if (!currentCourse) {
    return { success: false, error: 'Course not found.' };
  }

  const nextCourse = {
    ...currentCourse,
    reminders: normalizeReminders(reminders),
    metadata: {
      ...(currentCourse.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  saveCourse(nextCourse);
  return {
    success: true,
    course: nextCourse
  };
}

function applyCourseReminders(courseId, reminders = {}, options = {}) {
  const currentCourse = getCourseById(courseId);
  if (!currentCourse) {
    return { success: false, error: 'Course not found.' };
  }

  const nextCourse = {
    ...currentCourse,
    reminders: normalizeReminders(reminders),
    metadata: {
      ...(currentCourse.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  const syncResult = syncReminderCronsForSource({
    sourceType: 'course',
    sourceId: courseId,
    sourceObject: nextCourse,
    reminders: nextCourse.reminders,
    options,
    dependencies: options.dependencies || {}
  });

  nextCourse.reminders = syncResult.reminders;
  saveCourse(nextCourse);

  return {
    ...syncResult,
    course: nextCourse
  };
}

function addCourseReminderStage(courseId, stage = {}, options = {}) {
  const currentCourse = getCourseById(courseId);
  if (!currentCourse) {
    return { success: false, error: 'Course not found.' };
  }

  return applyCourseReminders(
    courseId,
    buildAdHocReminderStage(currentCourse.reminders || {}, stage),
    options
  );
}

module.exports = {
  normalizeReminders,
  getCourse,
  listCourses,
  setCourseReminders,
  applyCourseReminders,
  addCourseReminderStage
};
