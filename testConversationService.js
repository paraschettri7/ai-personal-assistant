import "dotenv/config";
import mongoose from "mongoose";

import connectDB from "./db.js";
import getConversationHistory from "./services/conversationService.js";

// Replace this with the conversation ID printed by testCRUD.js.
const conversationId = "PASTE_CONVERSATION_ID_HERE";

const testConversationService = async () => {
    try {
        await connectDB();

        const history = await getConversationHistory(conversationId);
        console.log(JSON.stringify(history, null, 2));
    } catch (error) {
        console.error("Error retrieving conversation history:", error.message);
    } finally {
        await mongoose.connection.close();
        console.log("Database Connection Closed.");
    }
};

testConversationService();
