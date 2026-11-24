import mongoose from "mongoose";
import Task from "../models/Task.js";
import User from "../models/User.js";

const createTask = async (title, dueDate, userId) => {
    if (typeof title !== "string" || title.trim() === "") {
        throw new TypeError("Task title must be a non-empty string.");
    }

    let parsedDueDate = null;
    if (dueDate !== null && dueDate !== undefined) {
        if (
            typeof dueDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
        ) {
            throw new TypeError("Due date must use YYYY-MM-DD format.");
        }

        parsedDueDate = new Date(`${dueDate}T00:00:00.000Z`);
        if (
            Number.isNaN(parsedDueDate.getTime()) ||
            parsedDueDate.toISOString().slice(0, 10) !== dueDate
        ) {
            throw new TypeError("Due date must be a valid calendar date.");
        }
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new TypeError("A valid user ID is required to create a task.");
    }

    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
        throw new Error("The task's user does not exist.");
    }

    try {
        const task = await Task.create({
            title: title.trim(),
            dueDate: parsedDueDate,
            userId
        });

        if (!task?._id || task.isNew === true) {
            throw new Error("MongoDB did not confirm that the task was saved.");
        }

        return task;
    } catch (error) {
        throw new Error("Task could not be saved to MongoDB.", {
            cause: error
        });
    }
};

const getTasks = async (status, userId) => {
    if (!["all", "pending", "completed"].includes(status)) {
        throw new TypeError("Task status must be all, pending, or completed.");
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new TypeError("A valid user ID is required to retrieve tasks.");
    }

    let userExists;
    try {
        userExists = await User.exists({ _id: userId });
    } catch (error) {
        throw new Error("Tasks could not be retrieved from MongoDB.", {
            cause: error
        });
    }

    if (!userExists) {
        throw new Error("The task's user does not exist.");
    }

    const filter = { userId };
    if (status !== "all") {
        filter.status = status;
    }

    try {
        const tasks = await Task.find(filter)
            .select("title dueDate status")
            .sort({ dueDate: 1 });

        return tasks.sort((firstTask, secondTask) => {
            if (!firstTask.dueDate && !secondTask.dueDate) return 0;
            if (!firstTask.dueDate) return 1;
            if (!secondTask.dueDate) return -1;
            return firstTask.dueDate - secondTask.dueDate;
        });
    } catch (error) {
        throw new Error("Tasks could not be retrieved from MongoDB.", {
            cause: error
        });
    }
};

const updateTask = async (taskId, userId, updates) => {
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        throw new TypeError("A valid task ID is required to update a task.");
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new TypeError("A valid user ID is required to update a task.");
    }

    if (updates === null || typeof updates !== "object" || Array.isArray(updates)) {
        throw new TypeError("Task updates must be an object.");
    }

    const allowedFields = new Set(["title", "dueDate", "status"]);
    if (Object.keys(updates).some((field) => !allowedFields.has(field))) {
        throw new TypeError("Task updates contain unsupported fields.");
    }

    const fieldsToUpdate = {};
    if (Object.hasOwn(updates, "title")) {
        if (typeof updates.title !== "string" || updates.title.trim() === "") {
            throw new TypeError("Task title must be a non-empty string.");
        }
        fieldsToUpdate.title = updates.title.trim();
    }

    if (Object.hasOwn(updates, "dueDate")) {
        if (updates.dueDate === null) {
            fieldsToUpdate.dueDate = null;
        } else {
            if (
                typeof updates.dueDate !== "string" ||
                !/^\d{4}-\d{2}-\d{2}$/.test(updates.dueDate)
            ) {
                throw new TypeError("Due date must use YYYY-MM-DD format or be null.");
            }

            const parsedDueDate = new Date(`${updates.dueDate}T00:00:00.000Z`);
            if (
                Number.isNaN(parsedDueDate.getTime()) ||
                parsedDueDate.toISOString().slice(0, 10) !== updates.dueDate
            ) {
                throw new TypeError("Due date must be a valid calendar date.");
            }
            fieldsToUpdate.dueDate = parsedDueDate;
        }
    }

    if (Object.hasOwn(updates, "status")) {
        if (!["pending", "completed"].includes(updates.status)) {
            throw new TypeError("Task status must be pending or completed.");
        }
        fieldsToUpdate.status = updates.status;
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
        throw new TypeError("At least one task field must be provided for an update.");
    }

    try {
        return await Task.findOneAndUpdate(
            { _id: taskId, userId },
            { $set: fieldsToUpdate },
            { new: true, runValidators: true }
        );
    } catch (error) {
        throw new Error("Task could not be updated in MongoDB.", { cause: error });
    }
};

const deleteTask = async (taskId, userId) => {
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        throw new TypeError("A valid task ID is required to delete a task.");
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new TypeError("A valid user ID is required to delete a task.");
    }

    try {
        return await Task.findOneAndDelete({ _id: taskId, userId });
    } catch (error) {
        throw new Error("Task could not be deleted from MongoDB.", { cause: error });
    }
};

export { createTask, getTasks, updateTask, deleteTask };
