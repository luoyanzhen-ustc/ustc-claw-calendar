#!/usr/bin/env node

const {
  USTC_PERIOD_TIMES,
  normalizePeriods,
  applyUSTCRules,
  createCourseImportDraftFromCourses,
  getCourseImportDraft,
  updateCourseImportDraft,
  confirmCourseImportDraft,
  discardCourseImportDraft,
  coursesToCourseEntries
} = require('./course-import.js');

function buildSchedulePrompt() {
  return [
    'You are a USTC course schedule extraction assistant.',
    'Extract course rows from the image and return JSON only.',
    'Do not add natural-language explanation.',
    'Expected fields: weekday, periods, startTime, endTime, name, code, location, weeks, teacher, isUndergraduate, needsReview.'
  ].join('\n');
}

async function parseScheduleImageWithModel(imagePath, callModel) {
  const result = await callModel('ustc/qwen-chat', {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildSchedulePrompt() },
          { type: 'image', image_url: { url: imagePath } }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  });

  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  return {
    parser: 'model-ocr',
    courses: parsed.courses || [],
    raw: parsed
  };
}

async function parseScheduleImage(imagePath, callModel, options = {}) {
  try {
    let extraction = null;
    let fallbackUsed = false;

    if (Array.isArray(options.agentVisionCourses) && options.agentVisionCourses.length > 0) {
      extraction = {
        parser: 'agent-vision',
        courses: options.agentVisionCourses,
        raw: { courses: options.agentVisionCourses }
      };
    } else if (typeof options.agentVisionParser === 'function') {
      const visionResult = await options.agentVisionParser(imagePath);
      if (Array.isArray(visionResult?.courses) && visionResult.courses.length > 0) {
        extraction = {
          parser: 'agent-vision',
          courses: visionResult.courses,
          raw: visionResult
        };
      }
    }

    if (!extraction) {
      extraction = await parseScheduleImageWithModel(imagePath, callModel);
      fallbackUsed = true;
    }

    const draft = createCourseImportDraftFromCourses(extraction.courses, {
      imagePath,
      semesterStart: options.semesterStart || null,
      primaryParser: extraction.parser,
      fallbackUsed,
      model: extraction.parser === 'model-ocr' ? 'ustc/qwen-chat' : null,
      source: extraction.parser === 'agent-vision' ? 'agent-vision' : 'schedule-image'
    });

    return {
      success: true,
      draft,
      draftId: draft.id,
      requiresConfirmation: true,
      courses: draft.courses,
      summary: draft.summary,
      periodTimes: USTC_PERIOD_TIMES,
      parser: draft.parser
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to parse the schedule image. Please upload a clearer screenshot and try again.'
    };
  }
}

function coursesToEvents(courses, semesterStart = null) {
  return coursesToCourseEntries(courses, semesterStart);
}

module.exports = {
  USTC_PERIOD_TIMES,
  normalizePeriods,
  applyUSTCRules,
  parseScheduleImageWithModel,
  parseScheduleImage,
  createCourseImportDraftFromCourses,
  getCourseImportDraft,
  updateCourseImportDraft,
  confirmCourseImportDraft,
  discardCourseImportDraft,
  coursesToCourseEntries,
  coursesToEvents
};
