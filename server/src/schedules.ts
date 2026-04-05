const MAX_SEARCH_MINUTES = 366 * 24 * 60;

interface ParsedCronExpression {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

function parseNumber(rawValue: string, minimum: number, maximum: number, normalizer?: (value: number) => number): number {
  const numeric = Number(rawValue);
  if (!Number.isInteger(numeric)) {
    throw new Error(`Invalid cron value "${rawValue}".`);
  }

  const normalized = normalizer ? normalizer(numeric) : numeric;
  if (normalized < minimum || normalized > maximum) {
    throw new Error(`Cron value "${rawValue}" is out of range.`);
  }

  return normalized;
}

function expandRange(
  bucket: Set<number>,
  start: number,
  end: number,
  step: number,
): void {
  if (step <= 0) {
    throw new Error("Cron step must be greater than 0.");
  }
  if (start > end) {
    throw new Error("Cron range start cannot be greater than end.");
  }

  for (let value = start; value <= end; value += step) {
    bucket.add(value);
  }
}

function parseCronField(
  rawField: string,
  minimum: number,
  maximum: number,
  normalizer?: (value: number) => number,
): { values: Set<number>; any: boolean } {
  const field = rawField.trim();
  if (!field) {
    throw new Error("Cron field cannot be empty.");
  }

  const values = new Set<number>();
  const segments = field.split(",");

  for (const segment of segments) {
    const token = segment.trim();
    if (!token) {
      throw new Error("Cron field contains an empty segment.");
    }

    if (token === "*") {
      expandRange(values, minimum, maximum, 1);
      continue;
    }

    const [baseRaw, stepRaw] = token.split("/");
    const base = baseRaw ?? "";
    const step = stepRaw === undefined ? 1 : parseNumber(stepRaw, 1, Math.max(maximum, 1));

    if (base === "*") {
      expandRange(values, minimum, maximum, step);
      continue;
    }

    if (base.includes("-")) {
      const [startRaw, endRaw] = base.split("-");
      if (!startRaw || !endRaw) {
        throw new Error(`Invalid cron range "${token}".`);
      }
      const start = parseNumber(startRaw, minimum, maximum, normalizer);
      const end = parseNumber(endRaw, minimum, maximum, normalizer);
      expandRange(values, start, end, step);
      continue;
    }

    const value = parseNumber(base, minimum, maximum, normalizer);
    values.add(value);
  }

  return { values, any: field === "*" };
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/u);
  if (parts.length !== 5) {
    throw new Error("Cron expressions must use 5 fields: minute hour day-of-month month day-of-week.");
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const minuteField = parseCronField(minute ?? "", 0, 59);
  const hourField = parseCronField(hour ?? "", 0, 23);
  const dayOfMonthField = parseCronField(dayOfMonth ?? "", 1, 31);
  const monthField = parseCronField(month ?? "", 1, 12);
  const dayOfWeekField = parseCronField(dayOfWeek ?? "", 0, 6, (value) => (value === 7 ? 0 : value));

  return {
    minute: minuteField.values,
    hour: hourField.values,
    dayOfMonth: dayOfMonthField.values,
    month: monthField.values,
    dayOfWeek: dayOfWeekField.values,
    dayOfMonthAny: dayOfMonthField.any,
    dayOfWeekAny: dayOfWeekField.any,
  };
}

function matchesDay(parsed: ParsedCronExpression, date: Date): boolean {
  const dayOfMonthMatch = parsed.dayOfMonth.has(date.getDate());
  const dayOfWeekMatch = parsed.dayOfWeek.has(date.getDay());

  if (parsed.dayOfMonthAny && parsed.dayOfWeekAny) {
    return true;
  }
  if (parsed.dayOfMonthAny) {
    return dayOfWeekMatch;
  }
  if (parsed.dayOfWeekAny) {
    return dayOfMonthMatch;
  }
  return dayOfMonthMatch || dayOfWeekMatch;
}

function matchesCron(parsed: ParsedCronExpression, date: Date): boolean {
  return parsed.minute.has(date.getMinutes())
    && parsed.hour.has(date.getHours())
    && parsed.month.has(date.getMonth() + 1)
    && matchesDay(parsed, date);
}

export function validateCronExpression(expression: string): string | null {
  try {
    parseCronExpression(expression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid cron expression.";
  }
}

export function getNextRunAt(expression: string, from: Date): Date | null {
  const parsed = parseCronExpression(expression);
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let index = 0; index < MAX_SEARCH_MINUTES; index += 1) {
    if (matchesCron(parsed, cursor)) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}
