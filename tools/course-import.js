#!/usr/bin/env node

const { parseWeekRanges } = require('./date-math.js');
const {
  readMetadata,
  readCourses,
  replaceCourses,
  readCourseImportDraft,
  writeCourseImportDraft
} = require('./file-ops.js');

const USTC_PERIOD_TIMES = {
  1: ['07:50', '08:35'],
  2: ['08:45', '09:30'],
  3: ['09:45', '10:30'],
  4: ['10:45', '11:30'],
  5: ['11:40', '12:25'],
  6: ['14:00', '14:45'],
  7: ['14:55', '15:40'],
  8: ['15:55', '16:40'],
  9: ['16:50', '17:35'],
  10: ['17:45', '18:30'],
  11: ['18:40', '19:25'],
  12: ['19:35', '20:20'],
  13: ['20:30', '21:15']
};

const ENGLISH_WEEKDAY_MAP = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7
};

const CHINESE_WEEKDAY_MAP = {
  '\u4e00': 1,
  '\u4e8c': 2,
  '\u4e09': 3,
  '\u56db': 4,
  '\u4e94': 5,
  '\u516d': 6,
  '\u65e5': 7,
  '\u5929': 7
};

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function normalizeAsciiDigits(value) {
  return String(value)
    .replace(/[\uFF10-\uFF19]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[\u2013\u2014\u2212\uFF0D\u301C\u223C]/g, '-')
    .replace(/[\uFF0C\u3001\uFF1B\uFF5E]/g, ',')
    .replace(/\uFF1A/g, ':');
}

function normalizePeriods(periods) {
  if (periods === null || periods === undefined || periods === '') {
    return null;
  }

  const cleaned = normalizeAsciiDigits(periods).replace(/\s+/g, '');
  const directRange = cleaned.match(/^(\d{1,2})-(\d{1,2})$/);
  if (directRange) {
    const start = Number(directRange[1]);
    const end = Number(directRange[2]);
    return `${Math.min(start, end)}-${Math.max(start, end)}`;
  }

  const numbers = (cleaned.match(/\d{1,2}/g) || []).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) {
    return cleaned || null;
  }

  return `${Math.min(...numbers)}-${Math.max(...numbers)}`;
}

function normalizeWeekday(weekday) {
  if (weekday === null || weekday === undefined || weekday === '') {
    return null;
  }

  if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) {
    return weekday;
  }

  const cleaned = cleanText(weekday);
  if (!cleaned) {
    return null;
  }

  const ascii = normalizeAsciiDigits(cleaned).toLowerCase();
  if (ENGLISH_WEEKDAY_MAP[ascii]) {
    return ENGLISH_WEEKDAY_MAP[ascii];
  }

  if (/^[1-7]$/.test(ascii)) {
    return Number(ascii);
  }

  const simplified = ascii
    .replace(/^weekday/i, '')
    .replace(/^(?:\u5468|\u661f\u671f|\u793c\u62dc)/, '')
    .trim();

  if (CHINESE_WEEKDAY_MAP[simplified]) {
    return CHINESE_WEEKDAY_MAP[simplified];
  }

  if (/^[1-7]$/.test(simplified)) {
    return Number(simplified);
  }

  return null;
}

function normalizeWeeks(weeks) {
  const cleaned = cleanText(weeks);
  if (!cleaned) {
    return '';
  }

  return normalizeAsciiDigits(cleaned)
    .replace(/\s+/g, '')
    .replace(/^\u7b2c/, '')
    .replace(/\u5468/g, '');
}

function deriveTimesFromPeriods(periods) {
  if (!periods || !/^\d+-\d+$/.test(periods)) {
    return { startTime: null, endTime: null };
  }

  const [startPeriod, endPeriod] = periods.split('-').map(Number);
  if (!USTC_PERIOD_TIMES[startPeriod] || !USTC_PERIOD_TIMES[endPeriod]) {
    return { startTime: null, endTime: null };
  }

  return {
    startTime: USTC_PERIOD_TIMES[startPeriod][0],
    endTime: USTC_PERIOD_TIMES[endPeriod][1]
  };
}

function buildReviewReasons(course) {
  const reasons = [];

  if (!course.name) {
    reasons.push('missing-name');
  }

  if (!Number.isInteger(course.weekday) || course.weekday < 1 || course.weekday > 7) {
    reasons.push('invalid-weekday');
  }

  if (!course.periods || !/^\d+-\d+$/.test(course.periods)) {
    reasons.push('invalid-periods');
  }

  if (!course.startTime || !course.endTime) {
    reasons.push('missing-time-range');
  }

  if (course.weeks && parseWeekRanges(course.weeks).length === 0) {
    reasons.push('invalid-weeks');
  }

  return reasons;
}

function normalizeCourse(course = {}) {
  const periods = normalizePeriods(course.periods);
  const weekday = normalizeWeekday(course.weekday);
  const derivedTimes = deriveTimesFromPeriods(periods);
  const normalized = {
    name: cleanText(course.name || course.title),
    code: cleanText(course.code),
    location: cleanText(course.location),
    teacher: cleanText(course.teacher),
    weekday,
    rawWeekday: course.weekday ?? null,
    periods,
    rawPeriods: course.periods ?? null,
    startTime: cleanText(course.startTime) || derivedTimes.startTime,
    endTime: cleanText(course.endTime) || derivedTimes.endTime,
    weeks: normalizeWeeks(course.weeks),
    isUndergraduate:
      typeof course.isUndergraduate === 'boolean' ? course.isUndergraduate : Boolean(course.teacher)
  };

  const reviewReasons = buildReviewReasons(normalized);
  return {
    ...normalized,
    needsReview: reviewReasons.length > 0 || Boolean(course.needsReview),
    reviewReasons
  };
}

function applyUSTCRules(courses) {
  return (courses || []).map((course) => normalizeCourse(course));
}

function generateDraftId() {
  return `course-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateCourseId() {
  return `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeDraftCourses(courses) {
  const list = Array.isArray(courses) ? courses : [];
  const needsReview = list.filter((course) => course.needsReview);

  return {
    totalCourses: list.length,
    needsReviewCount: needsReview.length,
    readyCount: list.length - needsReview.length,
    reviewItems: needsReview.map((course) => ({
      name: course.name || 'Unnamed course',
      weekday: course.weekday,
      rawWeekday: course.rawWeekday,
      periods: course.periods,
      rawPeriods: course.rawPeriods,
      reviewReasons: course.reviewReasons
    }))
  };
}

function buildCourseImportDraft(courses, options = {}) {
  const normalizedCourses = applyUSTCRules(courses);
  const summary = summarizeDraftCourses(normalizedCourses);
  const now = new Date().toISOString();

  return {
    version: 1,
    id: options.draftId || generateDraftId(),
    status: options.status || 'pending',
    imagePath: options.imagePath || null,
    semesterStart: options.semesterStart || null,
    parser: {
      primary: options.primaryParser || 'unknown',
      fallbackUsed: Boolean(options.fallbackUsed),
      model: options.model || null,
      source: options.source || 'schedule-image'
    },
    courses: normalizedCourses,
    summary,
    metadata: {
      createdAt: options.createdAt || now,
      updatedAt: now,
      confirmedAt: options.confirmedAt || null
    }
  };
}

function createCourseImportDraftFromCourses(courses, options = {}) {
  const draft = buildCourseImportDraft(courses, options);
  if (options.saveDraft !== false) {
    writeCourseImportDraft(draft);
  }

  return draft;
}

function getCourseImportDraft(draftId = 'latest') {
  return readCourseImportDraft(draftId);
}

function updateCourseImportDraft(draftId, courses, options = {}) {
  const currentDraft = getCourseImportDraft(draftId);
  if (!currentDraft) {
    return { success: false, error: 'Course import draft not found.' };
  }

  const nextDraft = buildCourseImportDraft(courses, {
    draftId: currentDraft.id,
    imagePath: options.imagePath || currentDraft.imagePath,
    semesterStart: options.semesterStart || currentDraft.semesterStart,
    primaryParser: options.primaryParser || currentDraft.parser?.primary || 'agent-vision',
    fallbackUsed: options.fallbackUsed || currentDraft.parser?.fallbackUsed || false,
    model: options.model || currentDraft.parser?.model || null,
    source: options.source || currentDraft.parser?.source || 'schedule-image',
    createdAt: currentDraft.metadata?.createdAt
  });

  writeCourseImportDraft(nextDraft);
  return {
    success: true,
    draft: nextDraft
  };
}

function coursesToCourseEntries(courses, semesterStart = null) {
  return applyUSTCRules(courses).map((course) => ({
    id: generateCourseId(),
    type: 'course',
    title: course.name,
    name: course.name,
    code: course.code || null,
    teacher: course.teacher || null,
    location: course.location || null,
    schedule: {
      kind: 'weekly',
      weekday: Number(course.weekday),
      startTime: course.startTime,
      endTime: course.endTime,
      periods: normalizePeriods(course.periods),
      weeks: course.weeks || '',
      weekRanges: parseWeekRanges(course.weeks || ''),
      semesterStart
    },
    lifecycle: {
      status: 'active'
    },
    metadata: {
      source: 'schedule-image',
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      needsReview: Boolean(course.needsReview),
      reviewReasons: course.reviewReasons || []
    }
  }));
}

function confirmCourseImportDraft(draftId = 'latest', options = {}) {
  const draft = getCourseImportDraft(draftId);
  if (!draft) {
    return { success: false, error: 'Course import draft not found.' };
  }

  if (draft.status === 'discarded') {
    return { success: false, error: 'This course import draft has already been discarded.' };
  }

  if (draft.summary?.needsReviewCount > 0 && options.force !== true) {
    return {
      success: false,
      error:
        'This draft still has items that need manual review. Confirm them with the user first, then rerun with --force or update the draft.'
    };
  }

  const metadata = readMetadata();
  const currentCoursesData = readCourses();
  const semesterStart = options.semesterStart || draft.semesterStart || metadata.startDate || null;
  const semester = options.semester || metadata.semester || currentCoursesData.semester || null;
  const nextCourses = coursesToCourseEntries(draft.courses, semesterStart);
  const mode = options.mode === 'append' ? 'append' : 'replace';

  if (mode === 'append') {
    const currentCourses = currentCoursesData.courses || [];
    replaceCourses([...currentCourses, ...nextCourses], { semester });
  } else {
    replaceCourses(nextCourses, { semester });
  }

  const confirmedDraft = {
    ...draft,
    status: 'confirmed',
    semesterStart,
    metadata: {
      ...(draft.metadata || {}),
      updatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString()
    }
  };
  writeCourseImportDraft(confirmedDraft);

  return {
    success: true,
    mode,
    importedCount: nextCourses.length,
    draft: confirmedDraft,
    courses: nextCourses
  };
}

function discardCourseImportDraft(draftId = 'latest') {
  const draft = getCourseImportDraft(draftId);
  if (!draft) {
    return { success: false, error: 'Course import draft not found.' };
  }

  const nextDraft = {
    ...draft,
    status: 'discarded',
    metadata: {
      ...(draft.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };
  writeCourseImportDraft(nextDraft);

  return {
    success: true,
    draft: nextDraft
  };
}

module.exports = {
  USTC_PERIOD_TIMES,
  normalizePeriods,
  normalizeWeekday,
  normalizeWeeks,
  applyUSTCRules,
  buildCourseImportDraft,
  createCourseImportDraftFromCourses,
  getCourseImportDraft,
  updateCourseImportDraft,
  confirmCourseImportDraft,
  discardCourseImportDraft,
  coursesToCourseEntries
};
