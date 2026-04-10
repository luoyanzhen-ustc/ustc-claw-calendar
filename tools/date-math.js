#!/usr/bin/env node

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const BEIJING_OFFSET = '+08:00';

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

const WEEKDAY_NAMES = {
  1: '\u5468\u4e00',
  2: '\u5468\u4e8c',
  3: '\u5468\u4e09',
  4: '\u5468\u56db',
  5: '\u5468\u4e94',
  6: '\u5468\u516d',
  7: '\u5468\u65e5'
};

function normalizeAsciiDigits(value) {
  return String(value)
    .replace(/[\uFF10-\uFF19]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[\u2013\u2014\u2212\uFF0D\u301C\u223C]/g, '-')
    .replace(/[\uFF0C\u3001\uFF1B\uFF5E]/g, ',')
    .replace(/\uFF1A/g, ':');
}

function getTimezoneOffsetSuffix(timezone = DEFAULT_TIMEZONE) {
  return timezone === 'UTC' ? 'Z' : BEIJING_OFFSET;
}

function getLocalDateParts(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function formatDate(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return getLocalDateParts(date, timezone).date;
}

function getDateString(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return formatDate(date, timezone);
}

function formatTime(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return getLocalDateParts(date, timezone).time;
}

function normalizeWeekdayNumber(value, options = {}) {
  const { allowSundayZero = true } = options;

  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (Number.isInteger(value)) {
    if (value === 0 && allowSundayZero) {
      return 7;
    }

    return value >= 1 && value <= 7 ? value : null;
  }

  const cleaned = normalizeAsciiDigits(String(value)).trim().toLowerCase();
  if (!cleaned) {
    return null;
  }

  if (ENGLISH_WEEKDAY_MAP[cleaned]) {
    return ENGLISH_WEEKDAY_MAP[cleaned];
  }

  if (cleaned === '0' && allowSundayZero) {
    return 7;
  }

  if (/^[1-7]$/.test(cleaned)) {
    return Number(cleaned);
  }

  const chinese = cleaned.replace(/^(?:\u5468|\u661f\u671f|\u793c\u62dc)/, '').trim();
  if (CHINESE_WEEKDAY_MAP[chinese]) {
    return CHINESE_WEEKDAY_MAP[chinese];
  }

  if (chinese === '0' && allowSundayZero) {
    return 7;
  }

  if (/^[1-7]$/.test(chinese)) {
    return Number(chinese);
  }

  return null;
}

function normalizeWeekdayList(values, options = {}) {
  const list = Array.isArray(values) ? values : [values];
  const normalized = list
    .map((value) => normalizeWeekdayNumber(value, options))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);

  return [...new Set(normalized)].sort((left, right) => left - right);
}

function getWeekdayName(input) {
  if (input instanceof Date) {
    const rawWeekday = input.getDay();
    return WEEKDAY_NAMES[rawWeekday === 0 ? 7 : rawWeekday] || null;
  }

  const normalized = normalizeWeekdayNumber(input);
  return normalized ? WEEKDAY_NAMES[normalized] : null;
}

function getWeekdayFromDateString(dateString, timezone = DEFAULT_TIMEZONE) {
  const suffix = getTimezoneOffsetSuffix(timezone);
  const parsed = new Date(`${dateString}T12:00:00${suffix}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return normalizeWeekdayNumber(parsed.getUTCDay());
}

function addDaysToDateString(dateString, days, timezone = DEFAULT_TIMEZONE) {
  const suffix = getTimezoneOffsetSuffix(timezone);
  const parsed = new Date(`${dateString}T12:00:00${suffix}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return getLocalDateParts(parsed, timezone).date;
}

function diffDateStrings(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function getWeekStartDate(dateString, timezone = DEFAULT_TIMEZONE) {
  const weekday = getWeekdayFromDateString(dateString, timezone);
  if (!weekday) {
    return null;
  }

  return addDaysToDateString(dateString, -(weekday - 1), timezone);
}

function getWeekEndDate(dateString, timezone = DEFAULT_TIMEZONE) {
  const weekStart = getWeekStartDate(dateString, timezone);
  return weekStart ? addDaysToDateString(weekStart, 6, timezone) : null;
}

function computeWeekNumberFromStart(semesterStart, dateString) {
  if (!semesterStart || !dateString) {
    return null;
  }

  const days = diffDateStrings(semesterStart, dateString);
  if (days === null || days < 0) {
    return null;
  }

  return Math.floor(days / 7) + 1;
}

function getCurrentWeek(semesterStart, options = {}) {
  if (!semesterStart) {
    return null;
  }

  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const today = options.today instanceof Date ? options.today : new Date();
  const todayDate = getDateString(today, timezone);
  const days = diffDateStrings(semesterStart, todayDate);

  if (days === null) {
    return null;
  }

  if (days < 0) {
    return 0;
  }

  return Math.floor(days / 7) + 1;
}

function parseWeekRanges(weeksStr) {
  if (!weeksStr) {
    return [];
  }

  return normalizeAsciiDigits(weeksStr)
    .replace(/\u5468/g, '')
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const rangeMatch = part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (rangeMatch) {
        return [[Number(rangeMatch[1]), Number(rangeMatch[2])]];
      }

      const single = Number(part);
      return Number.isFinite(single) ? [[single, single]] : [];
    });
}

function isWeekNumberWithinRanges(weekNumber, weekRanges = []) {
  if (!Array.isArray(weekRanges) || weekRanges.length === 0) {
    return true;
  }

  if (!weekNumber) {
    return false;
  }

  return weekRanges.some((range) => Array.isArray(range) && weekNumber >= Number(range[0]) && weekNumber <= Number(range[1]));
}

function isWithinWeekRanges(dateOrWeekNumber, semesterStart, weekRanges) {
  const weekNumber =
    typeof dateOrWeekNumber === 'number'
      ? dateOrWeekNumber
      : computeWeekNumberFromStart(semesterStart, dateOrWeekNumber);

  return isWeekNumberWithinRanges(weekNumber, weekRanges);
}

function daysBetween(date1, date2) {
  return diffDateStrings(date1, date2);
}

function parseRelativeTime(text, baseDate = new Date()) {
  const sourceText = String(text || '');
  const base = new Date(baseDate);
  base.setSeconds(0, 0);

  const result = new Date(base);
  result.setHours(0, 0, 0, 0);

  if (/\u5927\u540e\u5929/.test(sourceText)) {
    result.setDate(result.getDate() + 3);
  } else if (/\u540e\u5929/.test(sourceText)) {
    result.setDate(result.getDate() + 2);
  } else if (/\u660e\u5929|\u660e\u665a/.test(sourceText)) {
    result.setDate(result.getDate() + 1);
  } else if (/\u524d\u5929/.test(sourceText)) {
    result.setDate(result.getDate() - 2);
  }

  const weekdayMatch = sourceText.match(/(?:\u5468|\u661f\u671f)([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u59290-7])/);
  if (weekdayMatch) {
    const target = normalizeWeekdayNumber(weekdayMatch[1]);
    const current = normalizeWeekdayNumber(base.getDay());
    if (target && current) {
      let diff = target - current;

      if (/\u4e0b\u5468/.test(sourceText)) {
        diff += diff > 0 ? 7 : 14;
      } else if (!/\u8fd9\u5468|\u672c\u5468/.test(sourceText) && diff <= 0) {
        diff += 7;
      }

      result.setDate(result.getDate() + diff);
    }
  }

  let hour = null;
  let minute = 0;
  const normalizedText = normalizeAsciiDigits(sourceText);
  const colonMatch = normalizedText.match(/(\d{1,2})[:：](\d{1,2})/);
  const hourOnlyMatch = normalizedText.match(/(\d{1,2})\s*(?:\u70b9|\u65f6)(?:\u534a)?/);

  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2]);
  } else if (hourOnlyMatch) {
    hour = Number(hourOnlyMatch[1]);
    minute = /\u534a/.test(hourOnlyMatch[0]) ? 30 : 0;
  }

  if (hour === null) {
    if (/\u65e9\u4e0a/.test(sourceText)) {
      hour = 8;
    } else if (/\u4e0a\u5348/.test(sourceText)) {
      hour = 9;
    } else if (/\u4e2d\u5348/.test(sourceText)) {
      hour = 12;
    } else if (/\u4e0b\u5348/.test(sourceText)) {
      hour = 15;
    } else if (/\u665a\u4e0a|\u4eca\u665a|\u660e\u665a/.test(sourceText)) {
      hour = 19;
    } else {
      hour = 9;
    }
  }

  if ((/\u4e0b\u5348|\u665a\u4e0a|\u4eca\u665a|\u660e\u665a/.test(sourceText)) && hour < 12) {
    hour += 12;
  }

  result.setHours(hour, minute, 0, 0);
  return result;
}

module.exports = {
  DEFAULT_TIMEZONE,
  BEIJING_OFFSET,
  normalizeAsciiDigits,
  normalizeWeekdayNumber,
  normalizeWeekdayList,
  getCurrentWeek,
  getLocalDateParts,
  getDateString,
  parseRelativeTime,
  formatDate,
  formatTime,
  getWeekdayName,
  getWeekdayFromDateString,
  addDaysToDateString,
  getWeekStartDate,
  getWeekEndDate,
  computeWeekNumberFromStart,
  parseWeekRanges,
  isWeekNumberWithinRanges,
  isWithinWeekRanges,
  diffDateStrings,
  daysBetween
};
