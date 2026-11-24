import { createTask, getTasks, updateTask, deleteTask } from "./taskService.js";
import { resolveTaskDueDate } from "./dateResolutionService.js";

const createTaskDeclaration = {
    name: "createTask",
    description: "Create a task for the current user with a title and, when the user provides one, a due date.",
    parametersJsonSchema: {
        type: "object",
        properties: {
            title: {
                type: "string",
                description: "A short title for the task."
            },
            dateExpression: {
                type: "string",
                description: "Optional date expression from the user's message, such as tomorrow, next Monday, or December 15, 2026. Include this only when the user provides a due date; do not convert it to a calendar date."
            }
        },
        required: ["title"],
        additionalProperties: false
    }
};

const getTasksDeclaration = {
    name: "getTasks",
    description: "Retrieve the current user's tasks. Use all for every task, pending for unfinished tasks, or completed for finished tasks.",
    parametersJsonSchema: {
        type: "object",
        properties: {
            status: {
                type: "string",
                enum: ["all", "pending", "completed"],
                description: "Which task status to retrieve. Use all when the user asks for all or does not specify a status."
            }
        },
        required: ["status"],
        additionalProperties: false
    }
};

const updateTaskDeclaration = {
    name: "updateTask",
    description: "Update one of the current user's tasks. If the user identifies a task by description, call getTasks first and use its taskId. If multiple tasks could match, ask the user which one. Never guess a taskId. Set dateExpression only when changing the due date; use 'clear due date' only when the user explicitly asks to remove it.",
    parametersJsonSchema: {
        type: "object",
        properties: {
            taskId: { type: "string", description: "The task ID returned by getTasks or explicitly supplied by the user." },
            title: { type: "string", description: "Replacement task title, when requested." },
            dateExpression: { type: "string", description: "Optional new due date expression, such as tomorrow or next Monday. Use 'clear due date' only to remove an existing due date." },
            status: { type: "string", enum: ["pending", "completed"], description: "New status, when requested." }
        },
        required: ["taskId"],
        additionalProperties: false
    }
};

const deleteTaskDeclaration = {
    name: "deleteTask",
    description: "Delete one of the current user's tasks. If the user describes the task rather than providing its ID, call getTasks first and use its taskId. If more than one task could match, ask which one. Never guess a taskId.",
    parametersJsonSchema: {
        type: "object",
        properties: {
            taskId: { type: "string", description: "The task ID returned by getTasks or explicitly supplied by the user." }
        },
        required: ["taskId"],
        additionalProperties: false
    }
};

const toolHandlers = Object.freeze({
    createTask: async (args, userId, userMessage, referenceTime) => {
        if (
            args === null ||
            typeof args !== "object" ||
            Array.isArray(args)
        ) {
            throw new TypeError("Task function arguments must be an object.");
        }

        const allowedArguments = new Set(["title", "dateExpression"]);
        if (Object.keys(args).some((key) => !allowedArguments.has(key))) {
            throw new TypeError("Task function arguments contain unsupported fields.");
        }

        let dueDate = null;
        if (args.dateExpression !== undefined && args.dateExpression !== null) {
            if (typeof args.dateExpression !== "string") {
                throw new TypeError("Date expression must be a string when provided.");
            }

            if (args.dateExpression.trim() !== "") {
                dueDate = resolveTaskDueDate(
                    args.dateExpression,
                    userMessage,
                    referenceTime
                );
            }
        }

        return createTask(args.title, dueDate, userId);
    },

    getTasks: async (args, userId) => {
        if (
            args === null ||
            typeof args !== "object" ||
            Array.isArray(args)
        ) {
            throw new TypeError("Task query arguments must be an object.");
        }

        const allowedArguments = new Set(["status"]);
        if (Object.keys(args).some((key) => !allowedArguments.has(key))) {
            throw new TypeError("Task query arguments contain unsupported fields.");
        }

        return getTasks(args.status, userId);
    },

    updateTask: async (args, userId, userMessage, referenceTime) => {
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
            throw new TypeError("Task update arguments must be an object.");
        }

        const allowedArguments = new Set(["taskId", "title", "dateExpression", "status"]);
        if (Object.keys(args).some((key) => !allowedArguments.has(key))) {
            throw new TypeError("Task update arguments contain unsupported fields.");
        }

        const updates = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.status !== undefined) updates.status = args.status;

        if (args.dateExpression !== undefined) {
            if (typeof args.dateExpression !== "string" || args.dateExpression.trim() === "") {
                throw new TypeError("Date expression must be a non-empty string when provided.");
            }

            const asksToClearDate = /\b(?:clear|remove|delete)\b.{0,30}\b(?:due\s+date|deadline)\b|\b(?:due\s+date|deadline)\b.{0,30}\b(?:clear|remove|delete)\b/i.test(userMessage);
            if (/^(?:clear|remove)\s+(?:the\s+)?(?:due\s+date|deadline)$/i.test(args.dateExpression.trim())) {
                if (!asksToClearDate) {
                    throw new TypeError("The user must explicitly request clearing the due date.");
                }
                updates.dueDate = null;
            } else {
                updates.dueDate = resolveTaskDueDate(
                    args.dateExpression,
                    userMessage,
                    referenceTime
                );
            }
        }

        return updateTask(args.taskId, userId, updates);
    },

    deleteTask: async (args, userId) => {
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
            throw new TypeError("Task deletion arguments must be an object.");
        }

        const allowedArguments = new Set(["taskId"]);
        if (Object.keys(args).some((key) => !allowedArguments.has(key))) {
            throw new TypeError("Task deletion arguments contain unsupported fields.");
        }

        return deleteTask(args.taskId, userId);
    }
});

const executeFunctionCall = async (name, args, userId, userMessage, referenceTime) => {
    if (typeof name !== "string" || !Object.hasOwn(toolHandlers, name)) {
        throw new Error("Gemini requested an unsupported function.");
    }

    return toolHandlers[name](args, userId, userMessage, referenceTime);
};

export {
    createTaskDeclaration,
    getTasksDeclaration,
    updateTaskDeclaration,
    deleteTaskDeclaration,
    executeFunctionCall
};
