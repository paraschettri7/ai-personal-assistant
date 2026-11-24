import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import { ai, modelName } from "../config/gemini.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import getConversationHistory from "./conversationService.js";
import {
    createTaskDeclaration,
    getTasksDeclaration,
    updateTaskDeclaration,
    deleteTaskDeclaration,
    executeFunctionCall
} from "./toolService.js";
import {
    DateResolutionError,
    extractDateExpression
} from "./dateResolutionService.js";

const MAX_TOOL_CALL_ROUNDS = 4;
const TASK_CREATION_NOT_CONFIRMED = "I couldn't confirm that the task was created. Please try again.";
const TASK_DATE_CLARIFICATION = "I couldn't reliably determine the task date. What date should I use? Please provide one clear date.";
const TASK_UPDATE_CLARIFICATION = "I couldn't identify one specific task to update. Which task do you mean?";
const TASK_UPDATE_NOT_CONFIRMED = "I couldn't confirm that the task was updated. Please try again.";
const TASK_DELETE_CLARIFICATION = "I couldn't identify one specific task to delete. Which task do you mean?";
const TASK_DELETE_NOT_CONFIRMED = "I couldn't confirm that the task was deleted. Please try again.";

const isExplicitTaskCreationRequest = (message) =>
    /\b(?:create|add|make)\s+(?:me\s+)?(?:a\s+)?task\b/i.test(message) ||
    /\b(?:i want|i need)\s+to\s+(?:create|add|make)\s+(?:a\s+)?task\b/i.test(message);

const isExplicitTaskUpdateRequest = (message) =>
    /\b(?:update|edit|change|rename|reschedule|mark|complete|finish)\b.{0,80}\b(?:task|it|that)\b/i.test(message) ||
    /\btask\b.{0,80}\b(?:update|edit|change|rename|reschedule|complete|finish)\b/i.test(message);

const isExplicitTaskDeletionRequest = (message) => {
    if (/\b(?:due\s+date|deadline)\b/i.test(message)) return false;
    return /\b(?:delete|remove)\b.{0,80}(?:\btask\b|\b[a-f\d]{24}\b)/i.test(message) ||
        /\btask\b.{0,80}\b(?:delete|remove)\b/i.test(message);
};

const claimsTaskWasCreated = (text) =>
    typeof text === "string" &&
    /\b(?:i(?:'ve| have)?\s+)?(?:successfully\s+)?(?:created|added|saved|scheduled)\s+(?:the\s+)?task\b|\btask\s+(?:has been|was)\s+(?:created|added|saved|scheduled)\b/i.test(text);

const claimsTaskWasUpdated = (text) =>
    typeof text === "string" &&
    /\b(?:i(?:'ve| have)?\s+)?(?:successfully\s+)?(?:updated|changed|renamed|rescheduled|marked|completed)\s+(?:the\s+)?(?:task|it|that)\b|\b(?:task|it|that)\s+(?:(?:has been|was|is)\s+)?(?:updated|changed|renamed|rescheduled|marked|completed)\b/i.test(text);

const claimsTaskWasDeleted = (text) =>
    typeof text === "string" &&
    /\b(?:i(?:'ve| have)?\s+)?(?:successfully\s+)?(?:deleted|removed)\s+(?:the\s+)?(?:task|it|that)\b|\b(?:task|it|that)\s+(?:(?:has been|was|is)\s+)?(?:deleted|removed)\b/i.test(text);

const asksForTaskClarification = (text) =>
    typeof text === "string" &&
    (text.includes("?") || /\b(?:which|what|clarify|specify|couldn't identify|can't identify|cannot identify|multiple)\b/i.test(text));

const findTaskDescriptionCandidates = (message, tasks) => {
    const normalizedMessage = message.toLowerCase();
    const requestedStatus = /\b(?:completed|finished|done)\b/.test(normalizedMessage)
        ? "completed"
        : /\b(?:pending|unfinished|open)\b/.test(normalizedMessage)
            ? "pending"
            : null;
    const ignoredWords = new Set([
        "delete", "remove", "my", "task", "tasks", "completed", "finished",
        "done", "pending", "unfinished", "open", "please", "the", "a", "an",
        "of", "to", "with", "from", "and", "me", "this", "that", "one"
    ]);
    const descriptionWords = new Set(
        normalizedMessage.match(/[a-z0-9]+/g)?.filter((word) => word.length > 1 && !ignoredWords.has(word)) ?? []
    );

    return tasks.filter((task) => {
        if (requestedStatus && task.status !== requestedStatus) return false;
        const titleWords = task.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
        return titleWords.some((word) => descriptionWords.has(word));
    });
};

const isExplicitTaskListRequest = (message) =>
    /\b(?:show|list|display|view|see|get|retrieve|find)\s+(?:me\s+)?(?:(?:all|my|pending|completed|finished|done|open|unfinished)\s+){0,3}tasks?\b/i.test(message) ||
    /\bwhat(?:\s+are|\s+is|'s)\s+(?:(?:all|my|pending|completed|finished|done|open|unfinished)\s+){0,3}tasks?\b/i.test(message);

const logGeminiResponse = (response) => {
    const returnedFunctionCalls = response.functionCalls;
    const functionCalls = Array.isArray(returnedFunctionCalls)
        ? returnedFunctionCalls
        : [];
    const text = response.text;

    console.info("Gemini response diagnostics:", {
        functionCallsPropertyPresent: returnedFunctionCalls !== undefined,
        structuredFunctionCallCount: functionCalls.length,
        functionNames: functionCalls.map((call) => call.name ?? "<missing name>"),
        ordinaryTextWithoutFunctionCall:
            functionCalls.length === 0 && typeof text === "string" && text.trim() !== ""
    });

    return functionCalls;
};

const generateConversationReply = async (conversationId, userMessage, authenticatedUserId) => {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new TypeError("Invalid conversation ID.");
    }

    if (typeof userMessage !== "string" || userMessage.trim() === "") {
        throw new TypeError("User message must be a non-empty string.");
    }
    if (!mongoose.Types.ObjectId.isValid(authenticatedUserId)) {
        throw new TypeError("A valid authenticated user is required.");
    }

    const dateReferenceTime = new Date();

    const conversation = await Conversation.findOne({
        _id: conversationId,
        userId: authenticatedUserId
    }).select("userId");
    if (!conversation) {
        throw Object.assign(new Error("Conversation not found."), {
            code: "CONVERSATION_NOT_FOUND"
        });
    }

    const userId = authenticatedUserId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error("Conversation has no valid associated user.");
    }

    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
        throw new Error("Conversation user was not found.");
    }

    const history = await getConversationHistory(conversationId);
    const taskListRequest = !isExplicitTaskUpdateRequest(userMessage) &&
        !isExplicitTaskDeletionRequest(userMessage) &&
        isExplicitTaskListRequest(userMessage);
    const taskUpdateRequest = isExplicitTaskUpdateRequest(userMessage);
    const taskDeletionRequest = isExplicitTaskDeletionRequest(userMessage);
    const userSuppliedTaskId = /\b[a-f\d]{24}\b/i.test(userMessage);
    const forcedFunctionNames = taskListRequest
        ? ["getTasks"]
        : taskDeletionRequest
            ? (userSuppliedTaskId ? ["deleteTask"] : ["getTasks"])
        : taskUpdateRequest
            ? (userSuppliedTaskId ? ["updateTask"] : ["getTasks"])
            : null;
    const functionDeclarations = taskListRequest
        ? [getTasksDeclaration]
        : [createTaskDeclaration, getTasksDeclaration, updateTaskDeclaration, deleteTaskDeclaration];
    const chatConfig = {
        tools: [{ functionDeclarations }]
    };

    let reply;
    try {
        const chat = ai.chats.create({
            model: modelName,
            history,
            config: chatConfig
        });

        let response = await chat.sendMessage({
            message: userMessage,
            ...(forcedFunctionNames && {
                config: {
                    ...chatConfig,
                    toolConfig: {
                        functionCallingConfig: {
                            mode: "ANY",
                            allowedFunctionNames: forcedFunctionNames
                        }
                    }
                }
            })
        });
        let functionCalls = logGeminiResponse(response);
        let toolCallRounds = 0;
        let taskCreated = false;
        let taskUpdated = false;
        let taskDeleted = false;
        let taskNotFound = false;
        let taskDeleteNotFound = false;
        let taskNeedsClarification = false;
        let taskDeleteNeedsClarification = false;
        let dateNeedsClarification = false;
        const tasksReturnedByGetTasks = new Map();

        while (functionCalls.length > 0) {
            if (toolCallRounds >= MAX_TOOL_CALL_ROUNDS) {
                throw new Error("Gemini exceeded the function-call limit.");
            }
            toolCallRounds += 1;

            const functionResponseParts = [];
            for (const functionCall of functionCalls) {
                if (taskListRequest && functionCall.name !== "getTasks") {
                    throw new Error("A task-list request may only execute getTasks.");
                }

                if (functionCall.name === "updateTask") {
                    const requestedTaskId = functionCall.args?.taskId;
                    const userProvidedTaskId = typeof requestedTaskId === "string" &&
                        userMessage.includes(requestedTaskId);
                    if (!userProvidedTaskId && !tasksReturnedByGetTasks.has(requestedTaskId)) {
                        taskNeedsClarification = true;
                        break;
                    }
                }

                if (functionCall.name === "deleteTask") {
                    const requestedTaskId = functionCall.args?.taskId;
                    const userProvidedId = typeof requestedTaskId === "string" &&
                        userMessage.includes(requestedTaskId);
                    const listedTask = tasksReturnedByGetTasks.get(requestedTaskId);
                    if (!userProvidedId) {
                        if (!listedTask) {
                            taskDeleteNeedsClarification = true;
                            break;
                        }
                        const candidates = findTaskDescriptionCandidates(
                            userMessage,
                            [...tasksReturnedByGetTasks.values()]
                        );
                        if (candidates.length !== 1 || candidates[0].taskId !== requestedTaskId) {
                            taskDeleteNeedsClarification = true;
                            break;
                        }
                    }
                }

                console.info("Executing registered Gemini function:", {
                    functionName: functionCall.name ?? "<missing name>"
                });

                let toolResult;
                try {
                    const result = await executeFunctionCall(
                        functionCall.name,
                        functionCall.args,
                        userId,
                        userMessage,
                        dateReferenceTime
                    );

                    if (functionCall.name === "createTask") {
                        if (!result?._id || result.isNew === true) {
                            throw new Error("Task creation did not return a saved MongoDB document.");
                        }
                        taskCreated = true;
                        toolResult = {
                            taskId: result._id.toString(),
                            title: result.title,
                            dueDate: result.dueDate?.toISOString().slice(0, 10) ?? null,
                            status: result.status
                        };
                    } else if (functionCall.name === "getTasks") {
                        if (!Array.isArray(result)) {
                            throw new Error("Task retrieval did not return a list.");
                        }
                        for (const task of result) {
                            const taskId = task._id.toString();
                            tasksReturnedByGetTasks.set(taskId, {
                                taskId,
                                title: task.title,
                                status: task.status
                            });
                        }
                        toolResult = {
                            count: result.length,
                            tasks: result.map((task) => ({
                                taskId: task._id.toString(),
                                title: task.title,
                                dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
                                status: task.status
                            }))
                        };
                    } else if (functionCall.name === "updateTask") {
                        if (!result) {
                            taskNotFound = true;
                            toolResult = { error: "Task not found for this user." };
                        } else {
                            if (!result._id || result.isNew === true) {
                                throw new Error("Task update did not return a saved MongoDB document.");
                            }
                            taskUpdated = true;
                            toolResult = {
                                taskId: result._id.toString(),
                                title: result.title,
                                dueDate: result.dueDate?.toISOString().slice(0, 10) ?? null,
                                status: result.status
                            };
                        }
                    } else if (functionCall.name === "deleteTask") {
                        if (!result) {
                            taskDeleteNotFound = true;
                            toolResult = { error: "Task not found for this user." };
                        } else {
                            if (!result._id) {
                                throw new Error("Task deletion did not return the deleted MongoDB document.");
                            }
                            taskDeleted = true;
                            toolResult = {
                                taskId: result._id.toString(),
                                title: result.title,
                                dueDate: result.dueDate?.toISOString().slice(0, 10) ?? null,
                                status: result.status
                            };
                        }
                    }
                } catch (error) {
                    if (
                        ["createTask", "updateTask"].includes(functionCall.name) &&
                        error instanceof DateResolutionError
                    ) {
                        dateNeedsClarification = true;
                        console.info("Task date needs clarification before creation.");
                        break;
                    }

                    console.error("Gemini function execution failed:", {
                        functionName: functionCall.name ?? "<missing name>",
                        errorType: error?.name ?? "Error"
                    });
                    throw error;
                }

                functionResponseParts.push({
                    functionResponse: {
                        name: functionCall.name,
                        id: functionCall.id,
                        response: {
                            output: toolResult
                        }
                    }
                });
            }

            if (dateNeedsClarification || taskNeedsClarification || taskDeleteNeedsClarification) {
                break;
            }

            response = await chat.sendMessage({
                message: {
                    role: "user",
                    parts: functionResponseParts
                }
            });
            functionCalls = logGeminiResponse(response);
        }

        if (
            !taskCreated &&
            !dateNeedsClarification &&
            isExplicitTaskCreationRequest(userMessage)
        ) {
            try {
                extractDateExpression(userMessage);
            } catch (error) {
                if (!(error instanceof DateResolutionError)) {
                    throw error;
                }
                dateNeedsClarification = error.code === "AMBIGUOUS_DATE";
            }
        }

        const generatedText = response.text;

        if (taskDeleteNeedsClarification) {
            reply = TASK_DELETE_CLARIFICATION;
        } else if (taskDeleteNotFound) {
            reply = "I couldn't find that task in your task list, so I didn't delete anything.";
        } else if (
            !taskDeleted &&
            taskDeletionRequest &&
            (typeof generatedText !== "string" || generatedText.trim() === "" ||
                claimsTaskWasDeleted(generatedText) || !asksForTaskClarification(generatedText))
        ) {
            reply = TASK_DELETE_NOT_CONFIRMED;
        } else if (taskNeedsClarification) {
            reply = TASK_UPDATE_CLARIFICATION;
        } else if (dateNeedsClarification) {
            reply = TASK_DATE_CLARIFICATION;
        } else if (taskNotFound) {
            reply = "I couldn't find that task in your task list, so I didn't update anything.";
        } else if (
            !taskUpdated &&
            taskUpdateRequest &&
            (typeof generatedText !== "string" || generatedText.trim() === "" || claimsTaskWasUpdated(generatedText))
        ) {
            reply = TASK_UPDATE_NOT_CONFIRMED;
        } else if (
            !taskCreated &&
            (isExplicitTaskCreationRequest(userMessage) || claimsTaskWasCreated(generatedText))
        ) {
            reply = TASK_CREATION_NOT_CONFIRMED;
        } else if (typeof generatedText === "string" && generatedText.trim() !== "") {
            reply = generatedText;
        } else if (taskCreated || taskUpdated || taskDeleted) {
            reply = "The task was created and saved successfully.";
        } else {
            throw new Error("Gemini did not return a text response.");
        }
    } catch (error) {
        throw new Error("Failed to complete the Gemini chat request.", {
            cause: error
        });
    }

    try {
        await Message.insertMany([
            {
                content: userMessage,
                role: "user",
                conversationId
            },
            {
                content: reply,
                role: "model",
                conversationId
            }
        ]);
        await Conversation.updateOne(
            { _id: conversationId },
            { $set: { updatedAt: new Date() } }
        );
    } catch (error) {
        throw new Error("Gemini replied, but saving the messages failed.", {
            cause: error
        });
    }

    return reply;
};

export default generateConversationReply;
