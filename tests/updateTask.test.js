import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Task from "../models/Task.js";
import { executeFunctionCall, updateTaskDeclaration } from "../services/toolService.js";
import { updateTask } from "../services/taskService.js";

const createSavedTask = (taskId, userId, overrides = {}) => ({
    _id: taskId,
    userId,
    title: "Practice linked list",
    dueDate: null,
    status: "pending",
    isNew: false,
    ...overrides
});

const setupUpdate = (t, taskId, userId, result = undefined) => {
    let query;
    let update;
    let options;
    t.mock.method(Task, "findOneAndUpdate", async (filter, changes, settings) => {
        query = filter;
        update = changes;
        options = settings;
        return result === undefined ? createSavedTask(taskId, userId) : result;
    });
    return {
        get query() { return query; },
        get update() { return update; },
        get options() { return options; }
    };
};

test("declares updateTask with taskId required and other fields optional", () => {
    assert.deepEqual(updateTaskDeclaration.parametersJsonSchema.required, ["taskId"]);
    assert.equal(updateTaskDeclaration.parametersJsonSchema.properties.status.enum.join(","), "pending,completed");
});

test("updates only status without invoking date resolution", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const captured = setupUpdate(t, taskId, userId);

    await executeFunctionCall("updateTask", { taskId: taskId.toString(), status: "completed" }, userId, "Mark my task completed", new Date("2026-11-23T06:30:00Z"));

    assert.deepEqual(captured.update, { $set: { status: "completed" } });
});

test("updates only title", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const captured = setupUpdate(t, taskId, userId);

    await executeFunctionCall("updateTask", {
        taskId: taskId.toString(),
        title: "  Practice trees  "
    }, userId, "Rename my task to Practice trees", new Date("2026-11-23T06:30:00Z"));

    assert.deepEqual(captured.update, { $set: { title: "Practice trees" } });
});

test("updates only due date using the existing date resolver", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    let savedChanges;
    t.mock.method(Task, "findOneAndUpdate", async (_filter, changes) => {
        savedChanges = changes;
        return createSavedTask(taskId, userId, { dueDate: new Date("2026-11-24T00:00:00Z") });
    });

    await executeFunctionCall("updateTask", { taskId: taskId.toString(), dateExpression: "tomorrow" }, userId, "Move the task to tomorrow", new Date("2026-11-23T06:30:00Z"));

    assert.equal(savedChanges.$set.dueDate.toISOString(), "2026-11-24T00:00:00.000Z");
    assert.deepEqual(Object.keys(savedChanges.$set), ["dueDate"]);
});

test("resolves the original bare Friday expression before updating the due date", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    let savedChanges;
    t.mock.method(Task, "findOneAndUpdate", async (_filter, changes) => {
        savedChanges = changes;
        return createSavedTask(taskId, userId, { dueDate: new Date("2026-11-27T00:00:00Z") });
    });

    await executeFunctionCall("updateTask", {
        taskId: taskId.toString(),
        dateExpression: "Friday"
    }, userId, "Change my linked list task date to Friday.", new Date("2026-11-23T06:30:00Z"));

    assert.equal(savedChanges.$set.dueDate.toISOString(), "2026-11-27T00:00:00.000Z");
});

test("updates multiple explicitly supplied fields together", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const captured = setupUpdate(t, taskId, userId);

    await executeFunctionCall("updateTask", {
        taskId: taskId.toString(),
        title: "Practice trees",
        status: "completed",
        dateExpression: "December 15, 2026"
    }, userId, "Rename the task, complete it, and set its due date to December 15, 2026", new Date("2026-11-23T06:30:00Z"));

    assert.deepEqual(Object.keys(captured.update.$set).sort(), ["dueDate", "status", "title"]);
    assert.equal(captured.update.$set.dueDate.toISOString(), "2026-12-15T00:00:00.000Z");
});

test("clears due date only when the user explicitly asks", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const captured = setupUpdate(t, taskId, userId);

    await executeFunctionCall("updateTask", {
        taskId: taskId.toString(),
        dateExpression: "clear due date"
    }, userId, "Remove the due date from my task", new Date("2026-11-23T06:30:00Z"));

    assert.deepEqual(captured.update, { $set: { dueDate: null } });
});

test("rejects an invalid task ID", async () => {
    await assert.rejects(updateTask("invalid-id", new mongoose.Types.ObjectId(), { status: "completed" }), /valid task ID/);
});

test("returns null when the user-scoped task lookup finds no task", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const captured = setupUpdate(t, taskId, userId, null);

    const result = await updateTask(taskId, userId, { status: "completed" });

    assert.equal(result, null);
    assert.deepEqual(captured.query, { _id: taskId, userId });
});

test("a task owned by another user is not matched", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const captured = setupUpdate(t, taskId, userId, null);

    assert.equal(await updateTask(taskId, userId, { status: "completed" }), null);
    assert.notEqual(captured.query.userId.toString(), otherUserId.toString());
});

test("rejects an empty update", async () => {
    await assert.rejects(updateTask(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), {}), /At least one task field/);
});

test("returns the updated task and asks Mongoose to run validators", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const updated = createSavedTask(taskId, userId, { status: "completed" });
    const captured = setupUpdate(t, taskId, userId, updated);

    assert.equal(await updateTask(taskId, userId, { status: "completed" }), updated);
    assert.deepEqual(captured.options, { new: true, runValidators: true });
});

