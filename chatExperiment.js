import "dotenv/config";
import { ai, modelName } from "./config/gemini.js";

// Previous conversation (simulating messages retrieved from MongoDB)
const previousMessages = [
    {
        role: "user",
        parts: [{ text: "My name is Alex." }]
    },
    {
        role: "model",
        parts: [{ text: "Nice to meet you, Alex!" }]
    }
];

// Create a NEW chat session with previous history
const chat = ai.chats.create({
    model: modelName,
    history: previousMessages
});

// Send a new message
const response = await chat.sendMessage({
    message: "What is my name?"
});

console.log("Gemini's response:", response.text);

// Inspect the complete conversation
console.log("\nUpdated conversation history:");

console.log(
    JSON.stringify(chat.getHistory(), null, 2)
);
