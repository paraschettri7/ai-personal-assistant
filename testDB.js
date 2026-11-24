import "dotenv/config";
import connectDB from "./db.js";

console.log("URI exists:", !!process.env.MONGODB_URI);
console.log("URI starts correctly:", process.env.MONGODB_URI?.startsWith("mongodb+srv://"));

const startServer = async () => {
    await connectDB();
};

startServer();