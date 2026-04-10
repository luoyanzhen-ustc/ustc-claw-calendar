#!/usr/bin/env node

const {
  generateStageId,
  readCourses,
  getCourseById,
  saveCourse
} = require('./file-ops.js');
const { syncReminderCronsForSource, buildAdHocReminderStage } = require('./cron-manager.js');

function normalizeReminderStages(stages = []) {
  if (!Array.isArray(stages)) {
    return [];
  }

  return stages.map((stage) => ({
    id: stage.id || generateStageId(),
    offset: Math.max(0, Number(stage.offset) || 0),
    offsetUnit: ['minutes', 'hours', 'days'].includes(stage.offsetUnit) ? stage.offsetUnit : 'minutes',
    cronJobIds: Array.isArray(stage.cronJobIds) ? stage.cronJobIds : [],
    triggerTime: stage.triggerTime || null,
    createdAt: stage.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function normalizeReminders(reminders = {}) {
  const stages = normalizeReminderStages(reminders.stages || []);
  return {
    enabled: reminders.enabled === true && stages.length > 0,
    stages
  };
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
