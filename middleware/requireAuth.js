import User from "../models/User.js";

const requireAuth = async (req, res, next) => {
    const userId = req.session?.userId;
    if (!userId) {
        return res.status(401).json({ error: "Authentication required." });
    }

    try {
        const user = await User.findById(userId).select("name email");
        if (!user) {
            req.session.destroy(() => {});
            return res.status(401).json({ error: "Authentication required." });
        }
        req.user = user;
        return next();
    } catch (error) {
        console.error("Authentication lookup failed:", error.message);
        return res.status(500).json({ error: "Authentication could not be verified." });
    }
};

export default requireAuth;
