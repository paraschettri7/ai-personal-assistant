import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import {
    getConversationMessages,
    getUserConversations
} from "../services/conversationService.js";

const sortedQuery = (result, onSelect, onSort) => ({
    select(fields) {
        onSelect?.(fields);
        return this;
    },
    sort(fields) {
        onSort?.(fields);
        return Promise.resolve(result);
    }
});

test("retrieves the authenticated user's conversations sorted by most recently updated", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const conversations = [{ _id: new mongoose.Types.ObjectId(), title: "Earlier" }];
    let conversationFilter;
    let sortFields;

    t.mock.method(Conversation, "find", (filter) => {
        conversationFilter = filter;
        return sortedQuery(conversations, undefined, (sort) => { sortFields = sort; });
    });

    assert.deepEqual(await getUserConversations(userId), conversations);
    assert.deepEqual(conversationFilter, { userId });
    assert.deepEqual(sortFields, { updatedAt: -1 });
});

test("retrieves only the owned conversation's messages in chronological order", async (t) => {
    const userId = new mongoose.Types.ObjectId();
    const conversationId = new mongoose.Types.ObjectId();
    const conversation = { _id: conversationId };
    const messages = [{ role: "user", content: "Hello" }, { role: "model", content: "Hi" }];
    let ownershipFilter;
    let messageFilter;
    let sortFields;

    t.mock.method(Conversation, "findOne", (filter) => {
        ownershipFilter = filter;
        return { select: async () => conversation };
    });
    t.mock.method(Message, "find", (filter) => {
        messageFilter = filter;
        return sortedQuery(messages, undefined, (sort) => { sortFields = sort; });
    });

    assert.deepEqual(await getConversationMessages(conversationId.toString(), userId), messages);
    assert.deepEqual(ownershipFilter, { _id: conversationId.toString(), userId });
    assert.deepEqual(messageFilter, { conversationId });
    assert.deepEqual(sortFields, { createdAt: 1 });
});

test("rejects malformed conversation IDs before querying MongoDB", async () => {
    await assert.rejects(getConversationMessages("invalid-id", new mongoose.Types.ObjectId()), {
        name: "TypeError",
        message: "Invalid conversation ID."
    });
});

test("returns no messages when the conversation is not owned by the authenticated user", async (t) => {
    t.mock.method(Conversation, "findOne", () => ({ select: async () => null }));
    t.mock.method(Message, "find", () => {
        throw new Error("Messages must not be queried for an unowned conversation.");
    });

    assert.equal(
        await getConversationMessages(
            new mongoose.Types.ObjectId().toString(),
            new mongoose.Types.ObjectId()
        ),
        null
    );
});
