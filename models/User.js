import mongoose from "mongoose";

// 1. Define the structure of a User document
const userSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },

    passwordHash: {
        type: String,
        required: true,
        select: false
    }

}, {
    timestamps: true
});

userSchema.set("toJSON", {
    transform(_document, returnedObject) {
        delete returnedObject.passwordHash;
        delete returnedObject.__v;
        return returnedObject;
    }
});

// 2. Create the User model using the schema
const User = mongoose.model("User", userSchema);

// 3. Export the model
export default User;
