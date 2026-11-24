import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import requireAuth from "../middleware/requireAuth.js";
import {
    getConversationMessages,
    getUserConversations
} from "../services/conversationService.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
    try {
        const conversations = await getUserConversations(req.user._id);
        return res.json({
            conversations: conversations.map((conversation) => ({
                conversationId: conversation._id.toString(),
                title: conversation.title
            }))
        });
    } catch (error) {
        console.error("Conversation retrieval failed:", error.message);
        return res.status(500).json({ error: "Failed to retrieve conversations." });
    }
});

router.get("/:conversationId/messages", async (req, res) => {
    const { conversationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID." });
    }

    try {
        const messages = await getConversationMessages(conversationId, req.user._id);
        if (!messages) {
            return res.status(404).json({ error: "Conversation not found." });
        }

        return res.json({
            messages: messages.map((message) => ({
                role: message.role,
                content: message.content,
                createdAt: message.createdAt
            }))
        });
    } catch (error) {
        console.error("Message retrieval failed:", error.message);
        return res.status(500).json({ error: "Failed to retrieve messages." });
    }
});

router.post("/", async (req, res) => {
    try {
        const conversation = await Conversation.create({
            userId: req.user._id
        });

        return res.status(201).json({
            conversationId: conversation._id.toString()
        });
    } catch (error) {
        console.error("Conversation creation failed:", error.message);
        return res.status(500).json({
            error: "Failed to create a conversation."
        });
    }
});

export default router;
