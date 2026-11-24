import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Task from "../models/Task.js";
import User from "../models/User.js";
import { createTaskDeclaration, executeFunctionCall } from "../services/toolService.js";
import { getTasks } from "../services/taskService.js";

test("creates a task without a due date", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    let insertedDocument;

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "create", async (document) => {
        insertedDocument = document;
        return { ...document, _id: new mongoose.Types.ObjectId(), isNew: false };
    });

    const task = await executeFunctionCall(
        "createTask",
        { title: "Practice linked list" },
        userId,
        "Create a task to practice linked list",
        new Date("2026-11-23T06:30:00.000Z")
    );

    assert.deepEqual(createTaskDeclaration.parametersJsonSchema.required, ["title"]);
    assert.equal(insertedDocument.dueDate, null);
    assert.equal(task.dueDate, null);
});

test("resolves tomorrow when a createTask date expression is supplied", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    let insertedDocument;

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "create", async (document) => {
        insertedDocument = document;
        return { ...document, _id: new mongoose.Types.ObjectId(), isNew: false };
    });

    await executeFunctionCall(
        "createTask",
        { title: "Practice linked list", dateExpression: "tomorrow" },
        userId,
        "Create a task to practice linked list tomorrow",
        new Date("2026-11-23T06:30:00.000Z")
    );

    assert.equal(insertedDocument.dueDate.toISOString(), "2026-11-24T00:00:00.000Z");
});

test("resolves an explicit calendar date for createTask", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    let insertedDocument;

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "create", async (document) => {
        insertedDocument = document;
        return { ...document, _id: new mongoose.Types.ObjectId(), isNew: false };
    });

    await executeFunctionCall(
        "createTask",
        { title: "Practice linked list", dateExpression: "December 15, 2026" },
        userId,
        "Create a task to practice linked list on December 15, 2026",
        new Date("2026-11-23T06:30:00.000Z")
    );

    assert.equal(insertedDocument.dueDate.toISOString(), "2026-12-15T00:00:00.000Z");
});

test("rejects an invalid supplied createTask date before insertion", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    let insertAttempted = false;

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "create", async () => {
        insertAttempted = true;
        return { _id: new mongoose.Types.ObjectId(), isNew: false };
    });

    await assert.rejects(
        executeFunctionCall(
            "createTask",
            { title: "Practice linked list", dateExpression: "February 30, 2026" },
            userId,
            "Create a task to practice linked list on February 30, 2026",
            new Date("2026-11-23T06:30:00.000Z")
        ),
        /valid calendar date/
    );
    assert.equal(insertAttempted, false);
});

test("corrects a Gemini date that conflicts with the original request before insertion", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    let insertedDocument;

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "create", async (document) => {
        insertedDocument = document;
        return {
            ...document,
            _id: new mongoose.Types.ObjectId(),
            isNew: false
        };
    });

    const task = await executeFunctionCall(
        "createTask",
        { title: "Revise DBMS", dateExpression: "May 18, 2024" },
        userId,
        "Create a task to revise DBMS tomorrow.",
        new Date("2026-11-23T06:30:00.000Z")
    );

    assert.equal(insertedDocument.dueDate.toISOString(), "2026-11-24T00:00:00.000Z");
    assert.equal(task.dueDate.toISOString(), "2026-11-24T00:00:00.000Z");
});

test("does not insert a task when its date expression is ambiguous", async (t) => {
    let insertAttempted = false;
    t.mock.method(User, "exists", async () => ({ _id: new mongoose.Types.ObjectId() }));
    t.mock.method(Task, "create", async () => {
        insertAttempted = true;
        return {};
    });

    await assert.rejects(
        executeFunctionCall(
            "createTask",
            { title: "Revise DBMS", dateExpression: "tomorrow" },
            new mongoose.Types.ObjectId(),
            "Create a task for tomorrow or next Friday.",
            new Date("2026-11-23T06:30:00.000Z")
        ),
        /more than one possible date/
    );
    assert.equal(insertAttempted, false);
});

test("reports MongoDB insertion failure without returning a created task", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "create", async () => {
        throw new Error("simulated database write failure");
    });

    await assert.rejects(
        executeFunctionCall(
            "createTask",
            { title: "Revise DBMS", dateExpression: "tomorrow" },
            userId,
            "Create a task to revise DBMS tomorrow.",
            new Date("2026-11-23T06:30:00.000Z")
        ),
        /Task could not be saved to MongoDB/
    );
});

for (const status of ["all", "pending", "completed"]) {
    test(`retrieves tasks with the ${status} filter`, async (t) => {
        const userId = new mongoose.Types.ObjectId();
        const tasks = [
            { _id: new mongoose.Types.ObjectId(), title: "Pending task", dueDate: new Date("2026-11-24T00:00:00.000Z"), status: "pending" },
            { _id: new mongoose.Types.ObjectId(), title: "Completed task", dueDate: new Date("2026-11-25T00:00:00.000Z"), status: "completed" }
        ];
        let queryFilter;
        let requestedSort;

        t.mock.method(User, "exists", async () => ({ _id: userId }));
        t.mock.method(Task, "find", (filter) => {
            queryFilter = filter;
            return {
                select() {
                    return this;
                },
                sort(sort) {
                    requestedSort = sort;
                    return Promise.resolve(tasks.filter((task) =>
                        status === "all" || task.status === status
                    ));
                }
            };
        });

        const result = await getTasks(status, userId);

        assert.equal(queryFilter.userId, userId);
        if (status === "all") {
            assert.equal("status" in queryFilter, false);
            assert.equal(result.length, 2);
        } else {
            assert.equal(queryFilter.status, status);
            assert.ok(result.every((task) => task.status === status));
        }
        assert.deepEqual(requestedSort, { dueDate: 1 });
    });
}

test("returns an empty array when the user has no matching tasks", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "find", () => ({
        select() {
            return this;
        },
        sort() {
            return Promise.resolve([]);
        }
    }));

    assert.deepEqual(await getTasks("pending", userId), []);
});

test("never returns tasks belonging to another user", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const tasks = [
        { _id: new mongoose.Types.ObjectId(), title: "My task", dueDate: new Date("2026-11-24T00:00:00.000Z"), status: "pending", userId },
        { _id: new mongoose.Types.ObjectId(), title: "Another user's task", dueDate: new Date("2026-11-25T00:00:00.000Z"), status: "pending", userId: otherUserId }
    ];
    let queryFilter;

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "find", (filter) => {
        queryFilter = filter;
        return {
            select() {
                return this;
            },
            sort() {
                return Promise.resolve(tasks.filter((task) =>
                    task.userId.equals(filter.userId)
                ));
            }
        };
    });

    const result = await getTasks("all", userId);

    assert.equal(queryFilter.userId, userId);
    assert.deepEqual(result.map((task) => task.title), ["My task"]);
});

test("sorts dated tasks first and undated tasks afterward", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const laterTask = {
        _id: new mongoose.Types.ObjectId(),
        title: "Later",
        dueDate: new Date("2026-12-15T00:00:00.000Z"),
        status: "pending"
    };
    const undatedTask = {
        _id: new mongoose.Types.ObjectId(),
        title: "No due date",
        dueDate: null,
        status: "pending"
    };
    const earlierTask = {
        _id: new mongoose.Types.ObjectId(),
        title: "Earlier",
        dueDate: new Date("2026-11-24T00:00:00.000Z"),
        status: "pending"
    };

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "find", () => ({
        select() {
            return this;
        },
        sort() {
            return Promise.resolve([laterTask, undatedTask, earlierTask]);
        }
    }));

    const result = await getTasks("all", userId);

    assert.deepEqual(result.map((task) => task.title), ["Earlier", "Later", "No due date"]);
});
