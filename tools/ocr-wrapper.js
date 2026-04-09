#!/usr/bin/env node

const { parseWeekRanges } = require('./date-math.js');

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

function normalizePeriods(periods) {
  if (!periods) {
    return null;
  }

  const cleaned = String(periods).replace(/\s+/g, '');
  if (/^\d+-\d+$/.test(cleaned)) {
    return cleaned;
  }

  const numbers = cleaned.split(/[，,、]/).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) {
    return cleaned;
  }

  return `${Math.min(...numbers)}-${Math.max(...numbers)}`;
}

function applyUSTCRules(courses) {
  return (courses || []).map((course) => {
    const normalizedPeriods = normalizePeriods(course.periods);
    const nextCourse = {
      ...course,
      periods: normalizedPeriods,
      weekday: Number(course.weekday),
      isUndergraduate: Boolean(course.teacher)
    };

    if (normalizedPeriods) {
      const [startPeriod, endPeriod] = normalizedPeriods.split('-').map(Number);
      if (USTC_PERIOD_TIMES[startPeriod] && USTC_PERIOD_TIMES[endPeriod]) {
        nextCourse.startTime = nextCourse.startTime || USTC_PERIOD_TIMES[startPeriod][0];
        nextCourse.endTime = nextCourse.endTime || USTC_PERIOD_TIMES[endPeriod][1];
      }
    }

    return nextCourse;
  });
}

async function parseScheduleImage(imagePath, callModel) {
  const prompt = [
    '你是 USTC 课表识别助手。',
    '请从图片中提取课程信息，并返回 JSON。',
    '只输出课程数据，不要输出自然语言解释。',
    '字段要求：weekday, periods, startTime, endTime, name, code, location, weeks, teacher, isUndergraduate, needsReview。'
  ].join('\n');

  try {
    const result = await callModel('ustc/qwen-chat', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image_url: { url: imagePath } }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });

    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const courses = applyUSTCRules(parsed.courses || []);

    return {
      success: true,
      courses,
      periodTimes: USTC_PERIOD_TIMES
    };
  } catch (error) {
    return {
      success: false,
      error: '课表图片识别失败，请重新上传更清晰的课表截图。'
    };
  }
}

function generateId() {
  return `course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function coursesToCourseEntries(courses, semesterStart = null) {
  return applyUSTCRules(courses).map((course) => ({
    id: generateId(),
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
      needsReview: Boolean(course.needsReview)
    }
  }));
}

function coursesToEvents(courses, semesterStart = null) {
  return coursesToCourseEntries(courses, semesterStart);
}

module.exports = {
  USTC_PERIOD_TIMES,
  normalizePeriods,
  applyUSTCRules,
  parseScheduleImage,
  coursesToCourseEntries,
  coursesToEvents,
  generateId
};
