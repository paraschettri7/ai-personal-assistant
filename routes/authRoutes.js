import { Router } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";

const router = Router();
const BCRYPT_ROUNDS = 12;
const MAX_PASSWORD_BYTES = 72;

const publicUser = (user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email
});

const startUserSession = (req, userId) => new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
        if (error) return reject(error);
        req.session.userId = userId.toString();
        req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
});

router.post("/register", async (req, res) => {
    const { name, email, password } = req.body ?? {};
    if (
        typeof name !== "string" || name.trim() === "" || name.trim().length > 100 ||
        typeof email !== "string" || email.trim() === "" ||
        email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== "string" || password.length < 8 ||
        Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
    ) {
        return res.status(400).json({
            error: "A name, valid email, and password of 8 to 72 bytes are required."
        });
    }

    try {
        const normalizedEmail = email.trim().toLowerCase();
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const user = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            passwordHash
        });
        await startUserSession(req, user._id);
        return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ error: "An account with that email already exists." });
        }
        console.error("Registration failed:", error.message);
        return res.status(500).json({ error: "Could not register account." });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (
        typeof email !== "string" || email.trim() === "" ||
        typeof password !== "string" || password.length === 0
    ) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const user = await User.findOne({ email: email.trim().toLowerCase() })
            .select("+passwordHash name email");
        const passwordMatches = Boolean(user?.passwordHash) &&
            await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
            return res.status(401).json({ error: "Email or password is incorrect." });
        }

        await startUserSession(req, user._id);
        return res.json({ user: publicUser(user) });
    } catch (error) {
        console.error("Login failed:", error.message);
        return res.status(500).json({ error: "Could not log in." });
    }
});

router.post("/logout", (req, res) => {
    if (!req.session) {
        res.clearCookie("assistant.sid");
        return res.json({ message: "Logged out." });
    }

    req.session.destroy((error) => {
        if (error) {
            console.error("Logout failed:", error.message);
            return res.status(500).json({ error: "Could not log out." });
        }
        res.clearCookie("assistant.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });
        return res.json({ message: "Logged out." });
    });
});

router.get("/me", requireAuth, (req, res) => {
    return res.json({ user: publicUser(req.user) });
});

export default router;
