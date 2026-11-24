import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({

    content: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ["user", "model"],
        required: true
    },

    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true
    }

}, {
    timestamps: true
});

const Message = mongoose.model("Message", messageSchema);

export default Message;