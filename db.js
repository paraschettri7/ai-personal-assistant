import mongoose from "mongoose";
import "dotenv/config";
import dns from "node:dns";

// Use public DNS servers instead of the default resolver
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        console.log("MongoDB Connected Successfully!");
    } catch (error) {
        console.error("MongoDB Connection Failed:", error.message);
        process.exit(1);
    }
};

export default connectDB;