const APP_TIME_ZONE = "Asia/Kolkata";

class DateResolutionError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "DateResolutionError";
        this.code = code;
    }
}

const relativeExpressionPattern = /\bday after tomorrow\b|\btomorrow\b|\btoday\b|\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const isoDatePattern = /\b\d{4}-\d{2}-\d{2}\b/g;
const monthDatePattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})\b/gi;

const monthNumbers = new Map([
    ["jan", 1], ["january", 1],
    ["feb", 2], ["february", 2],
    ["mar", 3], ["march", 3],
    ["apr", 4], ["april", 4],
    ["may", 5],
    ["jun", 6], ["june", 6],
    ["jul", 7], ["july", 7],
    ["aug", 8], ["august", 8],
    ["sep", 9], ["sept", 9], ["september", 9],
    ["oct", 10], ["october", 10],
    ["nov", 11], ["november", 11],
    ["dec", 12], ["december", 12]
]);

const weekdayNumbers = new Map([
    ["sunday", 0],
    ["monday", 1],
    ["tuesday", 2],
    ["wednesday", 3],
    ["thursday", 4],
    ["friday", 5],
    ["saturday", 6]
]);

const getDateInApplicationTimeZone = (referenceTime) => {
    if (!(referenceTime instanceof Date) || Number.isNaN(referenceTime.getTime())) {
        throw new TypeError("Reference time must be a valid Date.");
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: APP_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(referenceTime);
    const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

    return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

const toCanonicalDate = (year, month, day) => {
    const yearText = String(year).padStart(4, "0");
    const monthText = String(month).padStart(2, "0");
    const dayText = String(day).padStart(2, "0");
    const dateText = `${yearText}-${monthText}-${dayText}`;
    const parsedDate = new Date(`${dateText}T00:00:00.000Z`);

    if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== dateText
    ) {
        throw new DateResolutionError("That date is not a valid calendar date.");
    }

    return dateText;
};

const shiftDate = (dateText, numberOfDays) => {
    const date = new Date(`${dateText}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + numberOfDays);
    return date.toISOString().slice(0, 10);
};

const extractDateExpression = (text) => {
    if (typeof text !== "string" || text.trim() === "") {
        throw new DateResolutionError("Please provide a date for the task.", "MISSING_DATE");
    }

    const matches = [
        ...text.matchAll(relativeExpressionPattern),
        ...text.matchAll(isoDatePattern),
        ...text.matchAll(monthDatePattern)
    ];
    const expressions = [...new Set(matches.map((match) => match[0].trim().toLowerCase()))];

    if (expressions.length === 0) {
        throw new DateResolutionError("I couldn't identify one clear date in the request.", "NO_DATE_EXPRESSION");
    }

    if (expressions.length > 1) {
        throw new DateResolutionError("The request contains more than one possible date.", "AMBIGUOUS_DATE");
    }

    return expressions[0];
};

const resolveDateExpression = (expression, referenceTime = new Date()) => {
    if (typeof expression !== "string" || expression.trim() === "") {
        throw new DateResolutionError("A date expression is required.");
    }

    const dateToday = getDateInApplicationTimeZone(referenceTime);
    const normalizedExpression = expression.trim().toLowerCase().replace(/[.!?,;]+$/, "");

    if (/\bday after tomorrow\b/.test(normalizedExpression)) {
        return shiftDate(dateToday, 2);
    }
    if (/\btomorrow\b/.test(normalizedExpression)) {
        return shiftDate(dateToday, 1);
    }
    if (/\btoday\b/.test(normalizedExpression)) {
        return dateToday;
    }

    const weekdayMatch = normalizedExpression.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (weekdayMatch) {
        const currentDate = new Date(`${dateToday}T00:00:00.000Z`);
        const currentWeekday = currentDate.getUTCDay();
        const targetWeekday = weekdayNumbers.get(weekdayMatch[2]);
        let daysUntil = (targetWeekday - currentWeekday + 7) % 7;
        if (weekdayMatch[1] && daysUntil === 0) {
            daysUntil = 7;
        }
        return shiftDate(dateToday, daysUntil);
    }

    const isoMatch = normalizedExpression.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
        return toCanonicalDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    }

    const monthMatch = normalizedExpression.match(/\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (monthMatch && monthNumbers.has(monthMatch[1])) {
        return toCanonicalDate(
            Number(monthMatch[3]),
            monthNumbers.get(monthMatch[1]),
            Number(monthMatch[2])
        );
    }

    throw new DateResolutionError("I couldn't reliably interpret that date. Please clarify it.");
};

const resolveTaskDueDate = (geminiExpression, userMessage, referenceTime = new Date()) => {
    const expressionFromRequest = extractDateExpression(userMessage);
    const requestedDate = resolveDateExpression(expressionFromRequest, referenceTime);

    try {
        const geminiDate = resolveDateExpression(geminiExpression, referenceTime);
        if (geminiDate !== requestedDate) {
            console.warn("Gemini date differed from the date in the user's request; using the server-resolved date.");
        }
    } catch (error) {
        if (!(error instanceof DateResolutionError)) {
            throw error;
        }

        console.warn("Gemini date could not be interpreted; using the date resolved from the user's request.");
    }

    return requestedDate;
};

export {
    APP_TIME_ZONE,
    DateResolutionError,
    extractDateExpression,
    resolveDateExpression,
    resolveTaskDueDate
};
