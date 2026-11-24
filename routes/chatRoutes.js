import { Router } from "express";
import generateConversationReply from "../services/chatService.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.post("/", async (req, res) => {
    const { conversationId, message } = req.body ?? {};

    if (
        typeof conversationId !== "string" ||
        conversationId.trim() === "" ||
        typeof message !== "string" ||
        message.trim() === ""
    ) {
        return res.status(400).json({
            error: "conversationId and a non-empty message are required."
        });
    }

    try {
        const reply = await generateConversationReply(conversationId, message, req.user._id);
        return res.json({ reply });
    } catch (error) {
        if (error instanceof TypeError) {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "CONVERSATION_NOT_FOUND") {
            return res.status(404).json({ error: "Conversation not found." });
        }

        console.error("Chat request failed:", error.message);
        return res.status(500).json({ error: "Failed to generate a reply." });
    }
});

export default router;
