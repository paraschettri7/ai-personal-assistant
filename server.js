import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import MongoStore from "connect-mongo";

import connectDB from "./db.js";
import chatRoutes from "./routes/chatRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import authRoutes from "./routes/authRoutes.js";

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
const allowedOrigins = new Set(
    (process.env.CLIENT_ORIGINS || "http://localhost:5173,http://localhost:5175")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
);

if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set in the environment.");
}

app.use(cors({
    origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true
}));
app.use(express.json());
if (isProduction) app.set("trust proxy", 1);
app.use(session({
    name: "assistant.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: "sessions",
        ttl: 7 * 24 * 60 * 60
    }),
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/conversations", conversationRoutes);

const startServer = async () => {
    try {
        await connectDB();

        app.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error.message);
        process.exitCode = 1;
    }
};

startServer();
