import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import { ai } from "../config/gemini.js";
import generateConversationReplyService from "../services/chatService.js";

let activeUserId = new mongoose.Types.ObjectId();
const generateConversationReply = (conversationId, message) =>
    generateConversationReplyService(conversationId, message, activeUserId);

const stubChatRequest = (t, response, onChatCreated = () => {}, onConversationUpdated = () => {}) => {
    activeUserId = new mongoose.Types.ObjectId();
    t.mock.method(Conversation, "findOne", () => ({
        select: async () => ({ userId: activeUserId })
    }));
    t.mock.method(User, "exists", async () => ({ _id: new mongoose.Types.ObjectId() }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async (filter, update) => {
        onConversationUpdated(filter, update);
        return { modifiedCount: 1 };
    });
    t.mock.method(Task, "create", async () => {
        throw new Error("Task.create should not be called in this test.");
    });
    t.mock.method(ai.chats, "create", (options) => {
        onChatCreated(options);
        return { sendMessage: async () => response };
    });
};

test("replaces a text-only task success claim when no tool call occurred", async (t) => {
    let timestampUpdate;
    stubChatRequest(t, {
        functionCalls: undefined,
        text: "I've created the task."
    }, undefined, (filter, update) => { timestampUpdate = { filter, update }; });

    const conversationId = new mongoose.Types.ObjectId().toString();
    const reply = await generateConversationReply(
        conversationId,
        "Create a task to revise DBMS tomorrow."
    );

    assert.match(reply, /couldn't confirm.*created/i);
    assert.deepEqual(timestampUpdate.filter, { _id: conversationId });
    assert.ok(timestampUpdate.update.$set.updatedAt instanceof Date);
});

test("asks for a clear date when a task request is ambiguous and Gemini omits a tool call", async (t) => {
    stubChatRequest(t, {
        functionCalls: undefined,
        text: "I've created the task."
    });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Create a task to revise DBMS tomorrow or next Friday."
    );

    assert.match(reply, /couldn't reliably determine the task date/i);
    assert.match(reply, /what date should i use/i);
});

test("does not ask for a date when Gemini omits the tool call for an undated task", async (t) => {
    stubChatRequest(t, {
        functionCalls: undefined,
        text: "What date should I use?"
    });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Create a task to practice linked list"
    );

    assert.match(reply, /couldn't confirm.*created/i);
    assert.doesNotMatch(reply, /what date should i use/i);
});

test("asks for clarification instead of creating a task from an ambiguous tool call", async (t) => {
    stubChatRequest(t, {
        functionCalls: [{
            name: "createTask",
            id: "ambiguous-date-call",
            args: { title: "Revise DBMS", dateExpression: "tomorrow" }
        }],
        text: undefined
    });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Create a task to revise DBMS tomorrow or next Friday."
    );

    assert.match(reply, /couldn't reliably determine the task date/i);
});

test("does not save a success reply after task insertion fails", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    let messagesSaved = false;

    t.mock.method(Conversation, "findOne", () => ({
        select: async () => ({ userId })
    }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async () => {
        messagesSaved = true;
    });
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "create", async () => {
        throw new Error("simulated MongoDB insertion failure");
    });
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async () => ({
            functionCalls: [{
                name: "createTask",
                id: "failed-insert-call",
                args: { title: "Revise DBMS", dateExpression: "tomorrow" }
            }],
            text: undefined
        })
    }));

    await assert.rejects(
        generateConversationReply(
            new mongoose.Types.ObjectId().toString(),
            "Create a task to revise DBMS tomorrow."
        ),
        /Failed to complete the Gemini chat request/
    );
    assert.equal(messagesSaved, false);
});

test("registers getTasks but does not execute it for normal conversation", async (t) => {
    let declaredFunctionNames;
    let taskQueryCalled = false;
    stubChatRequest(
        t,
        { functionCalls: undefined, text: "Database normalization organizes data into tables." },
        ({ config }) => {
            declaredFunctionNames = config.tools[0].functionDeclarations.map(({ name }) => name);
        }
    );
    t.mock.method(Task, "find", () => {
        taskQueryCalled = true;
        throw new Error("getTasks should not run for normal chat.");
    });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Explain database normalization."
    );

    assert.equal(reply, "Database normalization organizes data into tables.");
    assert.deepEqual(declaredFunctionNames, ["createTask", "getTasks", "updateTask", "deleteTask"]);
    assert.equal(taskQueryCalled, false);
});

test("sends user-scoped getTasks results back to Gemini", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const task = {
        _id: new mongoose.Types.ObjectId(),
        title: "Revise DBMS",
        dueDate: new Date("2026-11-24T00:00:00.000Z"),
        status: "pending"
    };
    let queryFilter;
    let persistedMessages;
    const sentMessages = [];

    t.mock.method(Conversation, "findOne", () => ({
        select: async () => ({ userId })
    }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => {
        persistedMessages = messages;
        return messages;
    });
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "find", (filter) => {
        queryFilter = filter;
        return {
            select() {
                return this;
            },
            sort() {
                return Promise.resolve([task]);
            }
        };
    });
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async ({ message }) => {
            sentMessages.push(message);
            if (sentMessages.length === 1) {
                return {
                    functionCalls: [{
                        name: "getTasks",
                        id: "get-tasks-call",
                        args: { status: "pending" }
                    }],
                    text: undefined
                };
            }
            return { functionCalls: undefined, text: "You have one pending task." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "What are my pending tasks?"
    );

    assert.equal(queryFilter.userId, userId);
    assert.equal(queryFilter.status, "pending");
    assert.equal(reply, "You have one pending task.");
    assert.equal(sentMessages[1].role, "user");
    assert.deepEqual(sentMessages[1].parts[0].functionResponse.response.output, {
        count: 1,
        tasks: [{
            taskId: task._id.toString(),
            title: "Revise DBMS",
            dueDate: "2026-11-24",
            status: "pending"
        }]
    });
    assert.equal(persistedMessages.length, 2);
});

test("passes a null due date through the createTask function response", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const taskId = new mongoose.Types.ObjectId();
    const sentMessages = [];

    t.mock.method(Conversation, "findOne", () => ({
        select: async () => ({ userId })
    }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "create", async (document) => ({
        ...document,
        _id: taskId,
        isNew: false
    }));
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async ({ message }) => {
            sentMessages.push(message);
            if (sentMessages.length === 1) {
                return {
                    functionCalls: [{
                        name: "createTask",
                        id: "create-task-without-date",
                        args: { title: "Practice linked list" }
                    }],
                    text: undefined
                };
            }
            return { functionCalls: undefined, text: "Task created without a due date." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Create a task to practice linked list"
    );

    assert.equal(reply, "Task created without a due date.");
    assert.equal(sentMessages[1].parts[0].functionResponse.response.output.dueDate, null);
});

test("identifies a task with getTasks before updating and returns the saved task to Gemini", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const taskId = new mongoose.Types.ObjectId();
    const listedTask = { _id: taskId, title: "Practice linked list", dueDate: null, status: "pending" };
    const updatedTask = { ...listedTask, status: "completed", isNew: false };
    const functionResponses = [];
    let callCount = 0;
    let firstRequestConfig;

    t.mock.method(Conversation, "findOne", () => ({ select: async () => ({ userId }) }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "find", () => ({
        select() { return this; },
        sort() { return Promise.resolve([listedTask]); }
    }));
    t.mock.method(Task, "findOneAndUpdate", async (filter, changes) => {
        assert.deepEqual(filter, { _id: taskId.toString(), userId });
        assert.deepEqual(changes, { $set: { status: "completed" } });
        return updatedTask;
    });
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async ({ message, config }) => {
            callCount += 1;
            if (callCount === 1) {
                firstRequestConfig = config;
                return { functionCalls: [{ name: "getTasks", id: "list-before-update", args: { status: "all" } }] };
            }
            if (callCount === 2) {
                return { functionCalls: [{ name: "updateTask", id: "update-task", args: { taskId: taskId.toString(), status: "completed" } }] };
            }
            functionResponses.push(message.parts[0].functionResponse.response.output);
            return { functionCalls: undefined, text: "Marked Practice linked list completed." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Mark my Practice linked list task completed"
    );

    assert.equal(reply, "Marked Practice linked list completed.");
    assert.deepEqual(firstRequestConfig.toolConfig.functionCallingConfig.allowedFunctionNames, ["getTasks"]);
    assert.deepEqual(functionResponses, [{
        taskId: taskId.toString(),
        title: "Practice linked list",
        dueDate: null,
        status: "completed"
    }]);
});

test("asks which task to update when Gemini supplies an ID that was not listed or provided", async (t) => {
    let updateAttempted = false;
    stubChatRequest(t, {
        functionCalls: [{ name: "updateTask", id: "unverified-update", args: {
            taskId: new mongoose.Types.ObjectId().toString(), status: "completed"
        } }],
        text: undefined
    });
    t.mock.method(Task, "findOneAndUpdate", async () => { updateAttempted = true; });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Mark one of my tasks complete"
    );

    assert.match(reply, /which task do you mean/i);
    assert.equal(updateAttempted, false);
});

test("does not claim an update when Gemini returns text without calling the tool", async (t) => {
    stubChatRequest(t, { functionCalls: undefined, text: "The task is updated." });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Update the task title to Practice trees"
    );

    assert.match(reply, /couldn't confirm.*updated/i);
});

test("preserves a clarification response instead of replacing it with update failure text", async (t) => {
    stubChatRequest(t, { functionCalls: undefined, text: "Which DBMS task should I rename?" });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Rename my DBMS task to DBMS preparation."
    );

    assert.equal(reply, "Which DBMS task should I rename?");
});

test("does not confirm an update when the user-scoped MongoDB update returns no task", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const taskId = new mongoose.Types.ObjectId();
    let callCount = 0;

    t.mock.method(Conversation, "findOne", () => ({ select: async () => ({ userId }) }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "find", () => ({
        select() { return this; },
        sort() { return Promise.resolve([{ _id: taskId, title: "DBMS", dueDate: null, status: "pending" }]); }
    }));
    t.mock.method(Task, "findOneAndUpdate", async () => null);
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async () => {
            callCount += 1;
            if (callCount === 1) {
                return { functionCalls: [{ name: "getTasks", id: "list-for-missing-update", args: { status: "all" } }] };
            }
            if (callCount === 2) {
                return { functionCalls: [{ name: "updateTask", id: "missing-update", args: { taskId: taskId.toString(), title: "DBMS preparation" } }] };
            }
            return { functionCalls: undefined, text: "The task was updated successfully." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Rename my DBMS task to DBMS preparation."
    );

    assert.match(reply, /couldn't find that task/i);
    assert.doesNotMatch(reply, /updated successfully/i);
});

test("looks up a described task before deleting it and sends deleted details to Gemini", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const taskId = new mongoose.Types.ObjectId();
    const task = { _id: taskId, title: "Practice linked list", dueDate: null, status: "pending" };
    const sentMessages = [];
    let callCount = 0;
    let deleteFilter;

    t.mock.method(Conversation, "findOne", () => ({ select: async () => ({ userId }) }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "find", () => ({
        select() { return this; },
        sort() { return Promise.resolve([task]); }
    }));
    t.mock.method(Task, "findOneAndDelete", async (filter) => {
        deleteFilter = filter;
        return task;
    });
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async ({ message, config }) => {
            callCount += 1;
            sentMessages.push(message);
            if (callCount === 1) {
                assert.deepEqual(config.toolConfig.functionCallingConfig.allowedFunctionNames, ["getTasks"]);
                return { functionCalls: [{ name: "getTasks", id: "lookup-delete-target", args: { status: "all" } }] };
            }
            if (callCount === 2) {
                return { functionCalls: [{ name: "deleteTask", id: "delete-described-task", args: { taskId: taskId.toString() } }] };
            }
            return { functionCalls: undefined, text: "Deleted Practice linked list." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Delete my linked list task."
    );

    assert.equal(reply, "Deleted Practice linked list.");
    assert.deepEqual(deleteFilter, { _id: taskId.toString(), userId });
    assert.deepEqual(sentMessages[2].parts[0].functionResponse.response.output, {
        taskId: taskId.toString(),
        title: "Practice linked list",
        dueDate: null,
        status: "pending"
    });
});

test("allows explicit task ID deletion and forces deleteTask", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const taskId = new mongoose.Types.ObjectId();
    let firstConfig;
    let deleteFilter;
    let callCount = 0;
    const task = { _id: taskId, title: "DBMS revision", dueDate: null, status: "pending" };

    t.mock.method(Conversation, "findOne", () => ({ select: async () => ({ userId }) }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "findOneAndDelete", async (filter) => {
        deleteFilter = filter;
        return task;
    });
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async ({ config }) => {
            callCount += 1;
            if (callCount === 1) {
                firstConfig = config;
                return { functionCalls: [{ name: "deleteTask", id: "delete-explicit-task", args: { taskId: taskId.toString() } }] };
            }
            return { functionCalls: undefined, text: "Deleted the task." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        `Delete task ${taskId.toString()}`
    );

    assert.equal(reply, "Deleted the task.");
    assert.deepEqual(firstConfig.toolConfig.functionCallingConfig.allowedFunctionNames, ["deleteTask"]);
    assert.deepEqual(deleteFilter, { _id: taskId.toString(), userId });
});

test("asks for clarification and does not delete when multiple tasks match", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const firstTask = { _id: new mongoose.Types.ObjectId(), title: "Practice linked list", status: "pending", dueDate: null };
    const secondTask = { _id: new mongoose.Types.ObjectId(), title: "Revise linked list", status: "pending", dueDate: null };
    let deleteAttempted = false;
    let callCount = 0;

    t.mock.method(Conversation, "findOne", () => ({ select: async () => ({ userId }) }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "find", () => ({
        select() { return this; },
        sort() { return Promise.resolve([firstTask, secondTask]); }
    }));
    t.mock.method(Task, "findOneAndDelete", async () => { deleteAttempted = true; });
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async () => {
            callCount += 1;
            if (callCount === 1) {
                return { functionCalls: [{ name: "getTasks", id: "lookup-ambiguous-delete", args: { status: "all" } }] };
            }
            return { functionCalls: [{ name: "deleteTask", id: "ambiguous-delete", args: { taskId: firstTask._id.toString() } }] };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Delete my linked list task"
    );

    assert.match(reply, /which task do you mean/i);
    assert.equal(deleteAttempted, false);
});

test("does not claim deletion when MongoDB returns no deleted task", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    activeUserId = userId;
    const taskId = new mongoose.Types.ObjectId();
    let callCount = 0;

    t.mock.method(Conversation, "findOne", () => ({ select: async () => ({ userId }) }));
    t.mock.method(User, "exists", async () => ({ _id: userId }));
    t.mock.method(Message, "find", () => ({ sort: async () => [] }));
    t.mock.method(Message, "insertMany", async (messages) => messages);
    t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
    t.mock.method(Task, "find", () => ({
        select() { return this; },
        sort() { return Promise.resolve([{ _id: taskId, title: "DBMS revision", status: "pending", dueDate: null }]); }
    }));
    t.mock.method(Task, "findOneAndDelete", async () => null);
    t.mock.method(ai.chats, "create", () => ({
        sendMessage: async () => {
            callCount += 1;
            if (callCount === 1) {
                return { functionCalls: [{ name: "getTasks", id: "lookup-missing-delete", args: { status: "all" } }] };
            }
            if (callCount === 2) {
                return { functionCalls: [{ name: "deleteTask", id: "missing-delete", args: { taskId: taskId.toString() } }] };
            }
            return { functionCalls: undefined, text: "The task was deleted successfully." };
        }
    }));

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Delete my DBMS revision task"
    );

    assert.match(reply, /couldn't find that task/i);
    assert.doesNotMatch(reply, /deleted successfully/i);
});

test("does not imply deletion when Gemini skips the tool call", async (t) => {
    stubChatRequest(t, { functionCalls: undefined, text: "I'll delete the task now." });

    const reply = await generateConversationReply(
        new mongoose.Types.ObjectId().toString(),
        "Delete my DBMS task"
    );

    assert.match(reply, /couldn't confirm.*deleted/i);
});

const taskListRequests = [
    { message: "Show me all my tasks.", status: "all" },
    { message: "What are my pending tasks?", status: "pending" },
    { message: "Show my completed tasks.", status: "completed" }
];

for (const { message, status } of taskListRequests) {
    test(`task-list request for ${status} does not require date information`, async (t) => {
        const userId = new mongoose.Types.ObjectId();
        activeUserId = userId;
        let queryFilter;
        let chatOptions;
        let firstRequestConfig;
        let callCount = 0;

        t.mock.method(Conversation, "findOne", () => ({
            select: async () => ({ userId })
        }));
        t.mock.method(User, "exists", async () => ({ _id: userId }));
        t.mock.method(Message, "find", () => ({ sort: async () => [] }));
        t.mock.method(Message, "insertMany", async (messages) => messages);
        t.mock.method(Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
        t.mock.method(Task, "find", (filter) => {
            queryFilter = filter;
            return {
                select() {
                    return this;
                },
                sort() {
                    return Promise.resolve([]);
                }
            };
        });
        t.mock.method(ai.chats, "create", (options) => {
            chatOptions = options;
            return {
                sendMessage: async ({ config }) => {
                    callCount += 1;
                    if (callCount === 1) {
                        firstRequestConfig = config;
                        return {
                            functionCalls: [{
                                name: "getTasks",
                                id: `get-tasks-${status}`,
                                args: { status }
                            }],
                            text: undefined
                        };
                    }
                    return { functionCalls: undefined, text: "No tasks found." };
                }
            };
        });

        const reply = await generateConversationReply(
            new mongoose.Types.ObjectId().toString(),
            message
        );

        assert.equal(reply, "No tasks found.");
        assert.deepEqual(
            chatOptions.config.tools[0].functionDeclarations.map(({ name }) => name),
            ["getTasks"]
        );
        assert.equal(firstRequestConfig.toolConfig.functionCallingConfig.mode, "ANY");
        assert.deepEqual(
            firstRequestConfig.toolConfig.functionCallingConfig.allowedFunctionNames,
            ["getTasks"]
        );
        assert.equal(queryFilter.userId, userId);
        assert.equal(queryFilter.status, status === "all" ? undefined : status);
    });
}
