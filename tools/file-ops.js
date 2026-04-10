#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  getDataDir,
  getActiveDir,
  getArchiveDir,
  getIndexDir,
  getSettingsFile,
  getEventsFile,
  getCoursesFile,
  getRecurringFile,
  getKnownUsersPath,
  getMetadataFile,
  getTodayIndexFile,
  getThisWeekIndexFile,
  getUpcomingIndexFile,
  getImportDraftsDir,
  getLatestCourseImportDraftFile,
  getCourseImportDraftFile
} = require('./path-utils.js');

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_REMINDER_DEFAULTS = {
  high: [0],
  medium: [0],
  low: [0]
};
const LEGACY_REMINDER_DEFAULTS = {
  high: [1440, 60],
  medium: [30],
  low: [10]
};

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureParentDir(filePath) {
  ensureDirExists(path.dirname(filePath));
}

function ensureDataLayout() {
  ensureDirExists(getDataDir());
  ensureDirExists(getActiveDir());
  ensureDirExists(getArchiveDir());
  ensureDirExists(getIndexDir());
  ensureDirExists(getImportDraftsDir());
}

function readJsonFile(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data, options = {}) {
  const { atomic = true, backup = false } = options;

  try {
    ensureParentDir(filePath);

    if (backup && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak.${Date.now()}`);
    }

    if (!atomic) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    }

    const tempFile = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, filePath);
    return true;
  } catch (error) {
    console.error(`Failed to write ${filePath}:`, error.message);
    return false;
  }
}

function buildMetadataDefaults() {
  return {
    version: 1,
    semester: null,
    name: null,
    school: 'USTC',
    startDate: null,
    endDate: null,
    totalWeeks: 20,
    currentWeek: 1,
    weekMapping: {},
    keyDates: {
      midtermWeek: [8, 9],
      finalWeek: [19, 20],
      holidays: []
    },
    stats: {
      totalCourses: 0,
      totalEvents: 0,
      totalRecurring: 0,
      byStatus: {}
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null
  };
}

function buildCoursesDefaults() {
  return {
    version: 1,
    semester: null,
    courses: [],
    metadata: {
      totalCourses: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function buildEventsDefaults() {
  return {
    version: 1,
    events: [],
    metadata: {
      totalEvents: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function buildRecurringDefaults() {
  return {
    version: 1,
    recurring: [],
    metadata: {
      totalRecurring: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function buildSettingsDefaults(overrides = {}) {
  return {
    version: 2,
    timezone: DEFAULT_TIMEZONE,
    displayTimezone: DEFAULT_TIMEZONE,
    semesterStart: null,
    semesterName: null,
    notify: {
      enabled: true,
      channels: ['qq', 'wechat'],
      qq: { enabled: false },
      wechat: { enabled: false }
    },
    reminderDefaults: {
      ...DEFAULT_REMINDER_DEFAULTS
    },
    quietHours: {
      enabled: true,
      start: '23:00',
      end: '08:00'
    },
    ...overrides
  };
}

function sameNumberArray(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => Number(value) === Number(b[index]));
}

function isLegacyReminderDefaults(reminderDefaults) {
  if (!reminderDefaults || typeof reminderDefaults !== 'object') {
    return false;
  }

  return (
    sameNumberArray(reminderDefaults.high, LEGACY_REMINDER_DEFAULTS.high) &&
    sameNumberArray(reminderDefaults.medium, LEGACY_REMINDER_DEFAULTS.medium) &&
    sameNumberArray(reminderDefaults.low, LEGACY_REMINDER_DEFAULTS.low)
  );
}

function buildKnownUsersDefaults() {
  return {
    version: 1,
    users: [
      {
        name: 'default',
        qq: {
          openid: null,
          enabled: false
        },
        weixin: {
          userId: null,
          accountId: null,
          enabled: false
        }
      }
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'default'
    }
  };
}

function normalizeWeixinAccountId(value) {
  if (!value) {
    return null;
  }

  return String(value).replace(/-im-bot(?:\.json)?$/, '');
}

function mergeSettings(rawSettings) {
  const defaults = buildSettingsDefaults();
  const settings = rawSettings || {};
  const reminderDefaults = isLegacyReminderDefaults(settings.reminderDefaults)
    ? defaults.reminderDefaults
    : {
        ...defaults.reminderDefaults,
        ...(settings.reminderDefaults || {})
      };

  return {
    ...defaults,
    ...settings,
    notify: {
      ...defaults.notify,
      ...(settings.notify || {}),
      qq: {
        ...defaults.notify.qq,
        ...((settings.notify || {}).qq || {})
      },
      wechat: {
        ...defaults.notify.wechat,
        ...((settings.notify || {}).wechat || {})
      }
    },
    reminderDefaults,
    quietHours: {
      ...defaults.quietHours,
      ...(settings.quietHours || {})
    }
  };
}

function normalizeSingleUser(rawUser = {}) {
  const qq = rawUser.qq || {};
  const weixin = rawUser.weixin || rawUser.wechat || {};
  const accountId = normalizeWeixinAccountId(weixin.accountId || weixin.account || null);

  return {
    name: rawUser.name || 'default',
    qq: {
      openid: qq.openid || qq.userId || null,
      enabled: Boolean(qq.enabled && (qq.openid || qq.userId))
    },
    weixin: {
      userId: weixin.userId || weixin.openid || null,
      accountId,
      enabled: Boolean(weixin.enabled && (weixin.userId || weixin.openid))
    }
  };
}

function normalizeKnownUsers(rawData) {
  if (!rawData) {
    return [];
  }

  if (Array.isArray(rawData)) {
    return rawData.map(normalizeSingleUser);
  }

  if (Array.isArray(rawData.users)) {
    return rawData.users.map(normalizeSingleUser);
  }

  if (Array.isArray(rawData.qqUsers) || Array.isArray(rawData.wechatUsers)) {
    const merged = new Map();
    const qqUsers = rawData.qqUsers || [];
    const wechatUsers = rawData.wechatUsers || [];

    for (const qqUser of qqUsers) {
      const key = qqUser.name || qqUser.userId || 'default';
      merged.set(key, {
        name: qqUser.name || 'default',
        qq: {
          openid: qqUser.openid || qqUser.userId || null,
          enabled: true
        },
        weixin: {
          userId: null,
          accountId: null,
          enabled: false
        }
      });
    }

    for (const wechatUser of wechatUsers) {
      const key = wechatUser.name || wechatUser.userId || 'default';
      const current = merged.get(key) || normalizeSingleUser({ name: wechatUser.name || 'default' });
      current.weixin = {
        userId: wechatUser.userId || null,
        accountId: wechatUser.accountId || null,
        enabled: true
      };
      merged.set(key, current);
    }

    return [...merged.values()].map(normalizeSingleUser);
  }

  return [normalizeSingleUser(rawData)];
}

function readSettings() {
  ensureDataLayout();
  return mergeSettings(readJsonFile(getSettingsFile(), buildSettingsDefaults()));
}

function writeSettings(settings) {
  const nextSettings = mergeSettings(settings);
  nextSettings.version = 2;
  return writeJsonFile(getSettingsFile(), nextSettings);
}

function readMetadata() {
  ensureDataLayout();
  return readJsonFile(getMetadataFile(), buildMetadataDefaults());
}

function writeMetadata(metadata) {
  const nextMetadata = {
    ...buildMetadataDefaults(),
    ...metadata,
    updatedAt: new Date().toISOString()
  };

  return writeJsonFile(getMetadataFile(), nextMetadata);
}

function readCourses() {
  ensureDataLayout();
  return readJsonFile(getCoursesFile(), buildCoursesDefaults());
}

function readEvents() {
  ensureDataLayout();
  return readJsonFile(getEventsFile(), buildEventsDefaults());
}

function writeCourses(data) {
  const nextData = {
    ...buildCoursesDefaults(),
    ...data,
    courses: Array.isArray(data.courses) ? data.courses : [],
    metadata: {
      ...buildCoursesDefaults().metadata,
      ...((data && data.metadata) || {}),
      totalCourses: Array.isArray(data.courses) ? data.courses.length : 0,
      updatedAt: new Date().toISOString()
    }
  };

  return writeJsonFile(getCoursesFile(), nextData);
}

function writeEvents(data) {
  const nextData = {
    ...buildEventsDefaults(),
    ...data,
    events: Array.isArray(data.events) ? data.events : [],
    metadata: {
      ...buildEventsDefaults().metadata,
      ...((data && data.metadata) || {}),
      totalEvents: Array.isArray(data.events) ? data.events.length : 0,
      updatedAt: new Date().toISOString()
    }
  };

  return writeJsonFile(getEventsFile(), nextData);
}

function replaceCourses(courses, extra = {}) {
  const current = readCourses();
  return writeCourses({
    ...current,
    ...extra,
    courses
  });
}

function replaceEvents(events, extra = {}) {
  const current = readEvents();
  return writeEvents({
    ...current,
    ...extra,
    events
  });
}

function readRecurring() {
  ensureDataLayout();
  return readJsonFile(getRecurringFile(), buildRecurringDefaults());
}

function writeRecurring(data) {
  const nextData = {
    ...buildRecurringDefaults(),
    ...data,
    recurring: Array.isArray(data.recurring) ? data.recurring : [],
    metadata: {
      ...buildRecurringDefaults().metadata,
      ...((data && data.metadata) || {}),
      totalRecurring: Array.isArray(data.recurring) ? data.recurring.length : 0,
      updatedAt: new Date().toISOString()
    }
  };

  return writeJsonFile(getRecurringFile(), nextData);
}

function getCourseById(courseId) {
  return readCourses().courses.find((course) => course.id === courseId) || null;
}

function getEventById(eventId) {
  return readEvents().events.find((event) => event.id === eventId) || null;
}

function getRecurringById(recurringId) {
  return readRecurring().recurring.find((item) => item.id === recurringId) || null;
}

function saveCourse(course) {
  const coursesData = readCourses();
  const courseIndex = coursesData.courses.findIndex((item) => item.id === course.id);

  if (courseIndex === -1) {
    coursesData.courses.push(course);
  } else {
    coursesData.courses[courseIndex] = {
      ...coursesData.courses[courseIndex],
      ...course
    };
  }

  return writeCourses(coursesData);
}

function saveEvent(event) {
  const eventsData = readEvents();
  const eventIndex = eventsData.events.findIndex((item) => item.id === event.id);

  if (eventIndex === -1) {
    eventsData.events.push(event);
  } else {
    eventsData.events[eventIndex] = {
      ...eventsData.events[eventIndex],
      ...event
    };
  }

  return writeEvents(eventsData);
}

function saveRecurringItem(recurringItem) {
  const recurringData = readRecurring();
  const recurringIndex = recurringData.recurring.findIndex((item) => item.id === recurringItem.id);

  if (recurringIndex === -1) {
    recurringData.recurring.push(recurringItem);
  } else {
    recurringData.recurring[recurringIndex] = {
      ...recurringData.recurring[recurringIndex],
      ...recurringItem
    };
  }

  return writeRecurring(recurringData);
}

function deleteEventById(eventId) {
  const eventsData = readEvents();
  const nextEvents = eventsData.events.filter((event) => event.id !== eventId);

  if (nextEvents.length === eventsData.events.length) {
    return false;
  }

  eventsData.events = nextEvents;
  return writeEvents(eventsData);
}

function deleteRecurringById(recurringId) {
  const recurringData = readRecurring();
  const nextRecurring = recurringData.recurring.filter((item) => item.id !== recurringId);

  if (nextRecurring.length === recurringData.recurring.length) {
    return false;
  }

  recurringData.recurring = nextRecurring;
  return writeRecurring(recurringData);
}

function readKnownUsers() {
  ensureDataLayout();
  return readJsonFile(getKnownUsersPath(), buildKnownUsersDefaults());
}

function writeKnownUsers(data) {
  const normalizedUsers = normalizeKnownUsers(data);
  const inputMetadata = (data && data.metadata) || {};
  const currentMetadata = (readKnownUsers().metadata || {});
  const payload = {
    version: 1,
    users: normalizedUsers.length > 0 ? normalizedUsers : buildKnownUsersDefaults().users,
    metadata: {
      ...buildKnownUsersDefaults().metadata,
      ...currentMetadata,
      ...inputMetadata,
      createdAt: currentMetadata.createdAt || inputMetadata.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  return writeJsonFile(getKnownUsersPath(), payload);
}

function readTodayIndex() {
  return readJsonFile(getTodayIndexFile(), {
    generatedAt: null,
    date: null,
    events: [],
    summary: {}
  });
}

function writeTodayIndex(data) {
  return writeJsonFile(getTodayIndexFile(), data);
}

function readThisWeekIndex() {
  return readJsonFile(getThisWeekIndexFile(), {
    generatedAt: null,
    range: null,
    days: [],
    summary: {}
  });
}

function writeThisWeekIndex(data) {
  return writeJsonFile(getThisWeekIndexFile(), data);
}

function readUpcomingIndex() {
  return readJsonFile(getUpcomingIndexFile(), {
    generatedAt: null,
    range: null,
    events: [],
    reminders: []
  });
}

function writeUpcomingIndex(data) {
  return writeJsonFile(getUpcomingIndexFile(), data);
}

function readCourseImportDraft(draftId = 'latest') {
  ensureDataLayout();
  const filePath = draftId === 'latest' ? getLatestCourseImportDraftFile() : getCourseImportDraftFile(draftId);
  return readJsonFile(filePath, null);
}

function writeCourseImportDraft(draft, options = {}) {
  ensureDataLayout();
  if (!draft || !draft.id) {
    return false;
  }

  const draftFile = getCourseImportDraftFile(draft.id);
  const latestFile = getLatestCourseImportDraftFile();
  const draftSaved = writeJsonFile(draftFile, draft, options);
  const latestSaved = writeJsonFile(latestFile, draft, options);
  return draftSaved && latestSaved;
}

function getTimezoneOffset(timezone = DEFAULT_TIMEZONE) {
  if (timezone === 'UTC') {
    return 'Z';
  }

  return '+08:00';
}

function toUTC(date, time = '00:00', timezone = DEFAULT_TIMEZONE) {
  if (!date) {
    return null;
  }

  const offset = getTimezoneOffset(timezone);
  const suffix = offset === 'Z' ? 'Z' : offset;
  const isoLike = `${date}T${time}:00${suffix}`;
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toLocal(utcString, targetTimezone = DEFAULT_TIMEZONE) {
  if (!utcString) {
    return null;
  }

  const date = new Date(utcString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday,
    timezone: targetTimezone
  };
}

function generateEventId() {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateRecurringId() {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateStageId() {
  return `stage-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = {
  DEFAULT_TIMEZONE,
  ensureDataLayout,
  readJsonFile,
  writeJsonFile,
  readSettings,
  writeSettings,
  readMetadata,
  writeMetadata,
  readCourses,
  readEvents,
  writeCourses,
  writeEvents,
  replaceCourses,
  replaceEvents,
  readRecurring,
  writeRecurring,
  getCourseById,
  getEventById,
  getRecurringById,
  saveCourse,
  saveEvent,
  saveRecurringItem,
  deleteEventById,
  deleteRecurringById,
  readKnownUsers,
  writeKnownUsers,
  normalizeKnownUsers,
  readTodayIndex,
  writeTodayIndex,
  readThisWeekIndex,
  writeThisWeekIndex,
  readUpcomingIndex,
  writeUpcomingIndex,
  readCourseImportDraft,
  writeCourseImportDraft,
  toUTC,
  toLocal,
  generateEventId,
  generateRecurringId,
  generateStageId,
  getDataDir,
  getActiveDir,
  getArchiveDir,
  getIndexDir,
  getSettingsFile,
  getEventsFile,
  getCoursesFile,
  getRecurringFile,
  getKnownUsersPath,
  getMetadataFile,
  getImportDraftsDir,
  getThisWeekIndexFile,
  getLatestCourseImportDraftFile,
  getCourseImportDraftFile
};
