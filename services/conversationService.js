import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

export const getUserConversations = async (userId) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new TypeError("A valid user ID is required.");
    }

    return Conversation.find({ userId })
        .select("title updatedAt")
        .sort({ updatedAt: -1 });
};

export const getConversationMessages = async (conversationId, userId) => {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new TypeError("Invalid conversation ID.");
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new TypeError("A valid user ID is required.");
    }

    const conversation = await Conversation.findOne({
        _id: conversationId,
        userId
    }).select("_id");

    if (!conversation) return null;

    return Message.find({ conversationId: conversation._id })
        .select("role content createdAt")
        .sort({ createdAt: 1 });
};

const getGeminiHistory = async (conversationId) => {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new TypeError("Invalid conversation ID.");
    }

    try {
        const messages = await Message.find({ conversationId })
            .sort({ createdAt: 1 });

        return messages.map((message) => ({
            role: message.role,
            parts: [{ text: message.content }]
        }));
    } catch (error) {
        throw new Error("Failed to retrieve conversation history.", {
            cause: error
        });
    }
};

export default getGeminiHistory;
