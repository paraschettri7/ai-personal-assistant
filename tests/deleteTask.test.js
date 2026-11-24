import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Task from "../models/Task.js";
import User from "../models/User.js";
import { deleteTaskDeclaration, executeFunctionCall } from "../services/toolService.js";
import { deleteTask, getTasks } from "../services/taskService.js";

const savedTask = (taskId, userId, overrides = {}) => ({
    _id: taskId,
    userId,
    title: "Revise DBMS",
    dueDate: null,
    status: "pending",
    ...overrides
});

test("declares deleteTask with only taskId required", () => {
    assert.equal(deleteTaskDeclaration.name, "deleteTask");
    assert.deepEqual(deleteTaskDeclaration.parametersJsonSchema.required, ["taskId"]);
});

test("deletes and returns a task using both taskId and userId", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const deleted = savedTask(taskId, userId);
    let filter;
    t.mock.method(Task, "findOneAndDelete", async (query) => {
        filter = query;
        return deleted;
    });

    assert.equal(await deleteTask(taskId.toString(), userId), deleted);
    assert.deepEqual(filter, { _id: taskId.toString(), userId });
});

test("rejects an invalid task ID without attempting deletion", async (t) => {
    let deleteAttempted = false;
    t.mock.method(Task, "findOneAndDelete", async () => { deleteAttempted = true; });

    await assert.rejects(deleteTask("invalid-id", new mongoose.Types.ObjectId()), /valid task ID/);
    assert.equal(deleteAttempted, false);
});

test("returns null when no task matches the user-scoped delete", async (t) => {
    t.mock.method(Task, "findOneAndDelete", async () => null);
    assert.equal(await deleteTask(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()), null);
});

test("cannot delete a task owned by another user", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    let filter;
    t.mock.method(Task, "findOneAndDelete", async (query) => {
        filter = query;
        return null;
    });

    assert.equal(await deleteTask(taskId, userId), null);
    assert.deepEqual(filter, { _id: taskId, userId });
    assert.notEqual(filter.userId.toString(), otherUserId.toString());
});

test("executes the registered deleteTask handler with backend-supplied userId", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    let filter;
    t.mock.method(Task, "findOneAndDelete", async (query) => {
        filter = query;
        return savedTask(taskId, userId);
    });

    const result = await executeFunctionCall(
        "deleteTask",
        { taskId: taskId.toString() },
        userId,
        "Delete my DBMS task"
    );

    assert.equal(result._id, taskId);
    assert.deepEqual(filter, { _id: taskId.toString(), userId });
});

test("a deleted task no longer appears in getTasks results", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const taskId = new mongoose.Types.ObjectId();
    const task = savedTask(taskId, userId);
    const records = [task];

    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Task, "findOneAndDelete", async ({ _id, userId: requestedUser }) => {
        const index = records.findIndex((record) =>
            record._id.toString() === _id.toString() && record.userId.equals(requestedUser)
        );
        return index < 0 ? null : records.splice(index, 1)[0];
    });
    t.mock.method(Task, "find", () => ({
        select() { return this; },
        sort() { return Promise.resolve(records.slice()); }
    }));

    assert.ok(await deleteTask(taskId, userId));
    assert.deepEqual(await getTasks("all", userId), []);
});

