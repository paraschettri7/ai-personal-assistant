import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import connectDB from "./db.js";
import User from "./models/User.js";
import Conversation from "./models/Conversation.js";
import generateConversationReply from "./services/chatService.js";

const testChatService = async () => {
    try {
        await connectDB();

        const user = await User.create({
            name: "Alex",
            email: `alex-${Date.now()}@example.com`,
            passwordHash: await bcrypt.hash(randomUUID(), 12)
        });

        const conversation = await Conversation.create({
            title: "Chat service test",
            userId: user._id
        });

        const firstReply = await generateConversationReply(
            conversation._id,
            "My name is Alex.",
            user._id
        );
        console.log("Gemini's first response:", firstReply);

        const secondReply = await generateConversationReply(
            conversation._id,
            "What is my name?",
            user._id
        );
        console.log("Gemini's second response:", secondReply);
    } catch (error) {
        console.error("Error testing chat service:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log("Database Connection Closed.");
    }
};

testChatService();
