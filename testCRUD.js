import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import connectDB from "./db.js";

import User from "./models/User.js";
import Conversation from "./models/Conversation.js";
import Message from "./models/Message.js";

const testDatabase = async () => {

    try {

        // STEP 1: Connect to MongoDB
        await connectDB();

        // STEP 2: Create a user
        const user = await User.create({
            name: "Alex",
            email: `alex${Date.now()}@gmail.com`,
            passwordHash: await bcrypt.hash(randomUUID(), 12)
        });

        console.log("User Created:", user._id);

        // STEP 3: Create a conversation for this user
        const conversation = await Conversation.create({
            title: "Learning AI",
            userId: user._id
        });

        console.log("Conversation Created:", conversation._id);

        // STEP 4: Save messages in this conversation
        await Message.insertMany([
            {
                content: "What is an LLM?",
                role: "user",
                conversationId: conversation._id
            },
            {
                content: "An LLM is a Large Language Model.",
                role: "model",
                conversationId: conversation._id
            },
            {
                content: "How does it work?",
                role: "user",
                conversationId: conversation._id
            }
        ]);

        console.log("Messages Saved!");

        // STEP 5: Retrieve all messages from this conversation
        const messages = await Message.find({
            conversationId: conversation._id
        }).sort({ createdAt: 1 });

        console.log("\nRetrieved Messages:");
        console.log(messages);

    } catch (error) {

        console.error("Error:", error.message);

    } finally {

        await mongoose.connection.close();
        console.log("Database Connection Closed.");

    }
};

testDatabase();
