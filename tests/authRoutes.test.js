import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import authRoutes from "../routes/authRoutes.js";
import chatRoutes from "../routes/chatRoutes.js";
import conversationRoutes from "../routes/conversationRoutes.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

const startTestServer = async (t) => {
    const app = express();
    app.use(express.json());
    app.use(session({
        name: "assistant.sid",
        secret: "test-session-secret-that-is-long-enough",
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: "lax", secure: false }
    }));
    app.use("/api/auth", authRoutes);
    app.use("/api/conversations", conversationRoutes);
    app.use("/api/chat", chatRoutes);

    const server = createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));
    return `http://127.0.0.1:${server.address().port}`;
};

const requestJson = (baseUrl, path, options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {})
    }
});

const cookieFrom = (response) => response.headers.get("set-cookie")?.split(";")[0];
const userId = new mongoose.Types.ObjectId();

const mockUserModel = (t, records = new Map()) => {
    t.mock.method(User, "create", async (fields) => {
        if (records.has(fields.email)) {
            throw Object.assign(new Error("Duplicate"), { code: 11000 });
        }
        const user = { _id: new mongoose.Types.ObjectId(), ...fields };
        records.set(user.email, user);
        return user;
    });
    t.mock.method(User, "findOne", (filter) => ({
        select: async () => records.get(filter.email) ?? null
    }));
    t.mock.method(User, "findById", (id) => ({
        select: async () => [...records.values()].find((user) => user._id.toString() === id.toString()) ?? null
    }));
    return records;
};

test("registers with a normalized email and password hash, maintains a session, and logs out", async (t) => {
    const records = mockUserModel(t);
    const baseUrl = await startTestServer(t);
    const registration = await requestJson(baseUrl, "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: "A User", email: "  PERSON@Example.COM ", password: "correct horse" })
    });
    const registrationData = await registration.json();
    const storedUser = records.get("person@example.com");

    assert.equal(registration.status, 201);
    assert.equal(storedUser.email, "person@example.com");
    assert.notEqual(storedUser.passwordHash, "correct horse");
    assert.equal(await bcrypt.compare("correct horse", storedUser.passwordHash), true);
    assert.equal("passwordHash" in registrationData.user, false);
    assert.match(registration.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(registration.headers.get("set-cookie"), /SameSite=Lax/i);

    const firstCookie = cookieFrom(registration);
    const currentUser = await requestJson(baseUrl, "/api/auth/me", {
        headers: { Cookie: firstCookie }
    });
    assert.equal(currentUser.status, 200);
    assert.deepEqual(await currentUser.json(), {
        user: {
            id: storedUser._id.toString(),
            name: "A User",
            email: "person@example.com"
        }
    });

    const wrongPassword = await requestJson(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "person@example.com", password: "wrong password" })
    });
    assert.equal(wrongPassword.status, 401);

    const login = await requestJson(baseUrl, "/api/auth/login", {
        method: "POST",
        headers: { Cookie: firstCookie },
        body: JSON.stringify({ email: "PERSON@example.com", password: "correct horse" })
    });
    assert.equal(login.status, 200);
    const loginCookie = cookieFrom(login);
    assert.ok(loginCookie);
    assert.notEqual(loginCookie, firstCookie, "login regenerates the session cookie");

    const logout = await requestJson(baseUrl, "/api/auth/logout", {
        method: "POST",
        headers: { Cookie: loginCookie }
    });
    assert.equal(logout.status, 200);
    const afterLogout = await requestJson(baseUrl, "/api/auth/me", {
        headers: { Cookie: loginCookie }
    });
    assert.equal(afterLogout.status, 401);
});

test("rejects invalid registration fields and duplicate email addresses", async (t) => {
    const records = mockUserModel(t);
    const existing = {
        _id: new mongoose.Types.ObjectId(),
        name: "Existing",
        email: "taken@example.com",
        passwordHash: await bcrypt.hash("password123", 4)
    };
    records.set(existing.email, existing);
    const baseUrl = await startTestServer(t);

    const invalid = await requestJson(baseUrl, "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: "A", email: "a@example.com", password: "short" })
    });
    assert.equal(invalid.status, 400);

    const duplicate = await requestJson(baseUrl, "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: "Other", email: "TAKEN@example.com", password: "password123" })
    });
    assert.equal(duplicate.status, 409);
});

test("blocks unauthenticated conversation and chat requests", async (t) => {
    mockUserModel(t);
    t.mock.method(Conversation, "find", () => {
        throw new Error("Protected conversation handler should not run.");
    });
    const baseUrl = await startTestServer(t);

    const conversations = await requestJson(baseUrl, "/api/conversations");
    assert.equal(conversations.status, 401);
    const chat = await requestJson(baseUrl, "/api/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: userId.toString(), message: "Hello" })
    });
    assert.equal(chat.status, 401);
});

test("scopes conversation lists and message access to the authenticated user", async (t) => {
    const records = mockUserModel(t);
    const account = {
        _id: userId,
        name: "Account",
        email: "account@example.com",
        passwordHash: await bcrypt.hash("password123", 4)
    };
    records.set(account.email, account);
    let listFilter;
    let messageFilter;
    let messagesRead = false;
    t.mock.method(Conversation, "find", (filter) => {
        listFilter = filter;
        return {
            select() { return this; },
            sort: async () => []
        };
    });
    t.mock.method(Conversation, "findOne", (filter) => {
        messageFilter = filter;
        return { select: async () => null };
    });
    t.mock.method(Message, "find", () => {
        messagesRead = true;
        throw new Error("Unowned conversation messages must not be read.");
    });
    const baseUrl = await startTestServer(t);
    const login = await requestJson(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: account.email, password: "password123" })
    });
    const cookie = cookieFrom(login);

    const conversations = await requestJson(baseUrl, "/api/conversations", {
        headers: { Cookie: cookie }
    });
    assert.equal(conversations.status, 200);
    assert.deepEqual(listFilter, { userId });

    const foreignConversationId = new mongoose.Types.ObjectId().toString();
    const foreignMessages = await requestJson(
        baseUrl,
        `/api/conversations/${foreignConversationId}/messages`,
        { headers: { Cookie: cookie } }
    );
    assert.equal(foreignMessages.status, 404);
    assert.deepEqual(messageFilter, { _id: foreignConversationId, userId });
    assert.equal(messagesRead, false);

    const foreignChat = await requestJson(baseUrl, "/api/chat", {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ conversationId: new mongoose.Types.ObjectId().toString(), message: "Hello" })
    });
    assert.equal(foreignChat.status, 404);
    assert.equal(messageFilter.userId.toString(), userId.toString());
});
