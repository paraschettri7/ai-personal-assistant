import assert from "node:assert/strict";
import test from "node:test";

import {
    DateResolutionError,
    resolveDateExpression,
    resolveTaskDueDate
} from "../services/dateResolutionService.js";

const referenceTime = new Date("2026-11-23T06:30:00.000Z");

const dateCases = [
    ["today", "2026-11-23"],
    ["tomorrow", "2026-11-24"],
    ["day after tomorrow", "2026-11-25"],
    ["next Monday", "2026-11-30"],
    ["next Friday", "2026-11-27"],
    ["Friday", "2026-11-27"],
    ["December 15, 2026", "2026-12-15"]
];

for (const [expression, expectedDate] of dateCases) {
    test(`resolves "${expression}" to ${expectedDate}`, () => {
        assert.equal(resolveDateExpression(expression, referenceTime), expectedDate);
    });
}

test("rejects an invalid calendar date", () => {
    assert.throws(
        () => resolveDateExpression("February 30, 2026", referenceTime),
        DateResolutionError
    );
});

test("rejects a request containing multiple possible dates", () => {
    assert.throws(
        () => resolveTaskDueDate(
            "tomorrow",
            "Create a task for tomorrow or next Friday.",
            referenceTime
        ),
        DateResolutionError
    );
});

test("uses the request date when Gemini supplies a different valid date", () => {
    assert.equal(
        resolveTaskDueDate(
            "May 18, 2024",
            "Create a task to revise DBMS tomorrow.",
            referenceTime
        ),
        "2026-11-24"
    );
});

test("extracts a bare weekday from a task update request", () => {
    assert.equal(
        resolveTaskDueDate(
            "Friday",
            "Change my linked list task date to Friday.",
            referenceTime
        ),
        "2026-11-27"
    );
});

test("uses the Asia/Kolkata calendar date near UTC midnight", () => {
    const shortlyAfterMidnightInKolkata = new Date("2026-11-22T19:00:00.000Z");
    assert.equal(
        resolveDateExpression("today", shortlyAfterMidnightInKolkata),
        "2026-11-23"
    );
});
