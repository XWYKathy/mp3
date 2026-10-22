var mongoose = require('mongoose'),
    User = require('../models/user'),
    Task = require('../models/task');

function RequestError(status, message) {
    Error.call(this, message);
    this.name = 'RequestError';
    this.status = status;
    this.message = message;
}

RequestError.prototype = Object.create(Error.prototype);
RequestError.prototype.constructor = RequestError;

function fail(status, message) {
    throw new RequestError(status, message);
}

function normalizeObjectId(id) {
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) {
        return null;
    }

    return new mongoose.Types.ObjectId(id).toString();
}

function objectIdStringVariants(ids) {
    var variants = [];

    ids.forEach(function (id) {
        var normalized = normalizeObjectId(String(id));

        if (normalized) {
            variants.push(normalized, normalized.toUpperCase());
        }
    });

    return uniqueIds(variants);
}

function requiredString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(400, 'The "' + field + '" field must be a non-empty string.');
    }

    return value.trim();
}

function uniqueIds(ids) {
    return Array.from(new Set(ids));
}

function parseDeadline(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    var normalized = value.trim();
    var deadline = new Date(normalized);
    var dateParts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|T|\s)/);

    if (Number.isNaN(deadline.getTime())) {
        return null;
    }

    if (!dateParts) {
        return deadline;
    }

    var year = Number(dateParts[1]);
    var month = Number(dateParts[2]);
    var day = Number(dateParts[3]);
    var leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var daysPerMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    if (month < 1 || month > 12 || day < 1 || day > daysPerMonth[month - 1]) {
        return null;
    }

    return deadline;
}

function validateUser(body) {
    var pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;

    if (!Array.isArray(pendingTasks)) {
        fail(400, 'The "pendingTasks" field must be an array.');
    }

    var normalizedPendingTasks = pendingTasks.map(function (taskId) {
        var normalized = normalizeObjectId(taskId);

        if (!normalized) {
            fail(400, 'Every task id in "pendingTasks" must be a valid id.');
        }

        return normalized;
    });

    return {
        name: requiredString(body.name, 'name'),
        email: requiredString(body.email, 'email'),
        pendingTasks: uniqueIds(normalizedPendingTasks)
    };
}

function validateTask(body) {
    var description = body.description === undefined ? '' : body.description;
    var completed = body.completed === undefined ? false : body.completed;
    var assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    var assignedUserName = body.assignedUserName;
    var deadline = parseDeadline(body.deadline);

    if (typeof description !== 'string') {
        fail(400, 'The "description" field must be a string.');
    }

    if (typeof completed !== 'boolean') {
        fail(400, 'The "completed" field must be a boolean.');
    }

    if (!deadline) {
        fail(400, 'The "deadline" field must be a valid date.');
    }

    if (typeof assignedUser !== 'string') {
        fail(400, 'The "assignedUser" field must be a string.');
    }

    if (assignedUser !== '') {
        var normalizedAssignedUser = normalizeObjectId(assignedUser);

        if (!normalizedAssignedUser) {
            fail(400, 'The "assignedUser" field must contain a valid user id.');
        }

        assignedUser = normalizedAssignedUser;
    }

    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        fail(400, 'The "assignedUserName" field must be a string.');
    }

    if (assignedUser === '' && assignedUserName !== undefined && assignedUserName !== 'unassigned') {
        fail(400, 'An unassigned task must use "unassigned" as its assigned user name.');
    }

    return {
        name: requiredString(body.name, 'name'),
        description: description,
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

async function withTransaction(work) {
    var session = await mongoose.startSession();
    var result;

    try {
        await session.withTransaction(async function () {
            result = await work(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

async function ensureUniqueEmail(email, excludedUserId, session) {
    var conditions = { email: email };

    if (excludedUserId) {
        conditions._id = { $ne: excludedUserId };
    }

    var duplicate = await User.findOne(conditions).session(session);

    if (duplicate) {
        fail(400, 'A user with that email already exists.');
    }
}

async function pendingTaskDocuments(taskIds, session) {
    if (taskIds.length === 0) {
        return [];
    }

    var tasks = await Task.find({ _id: { $in: taskIds } }).session(session);

    if (tasks.length !== taskIds.length) {
        fail(404, 'One or more tasks in "pendingTasks" do not exist.');
    }

    if (tasks.some(function (task) { return task.completed; })) {
        fail(400, 'Completed tasks cannot be included in "pendingTasks".');
    }

    return tasks;
}

async function assignedUserDocument(taskData, session) {
    if (taskData.assignedUser === '') {
        taskData.assignedUserName = 'unassigned';
        return null;
    }

    var user = await User.findById(taskData.assignedUser).session(session);

    if (!user) {
        fail(404, 'The assigned user does not exist.');
    }

    if (taskData.assignedUserName !== undefined && taskData.assignedUserName !== user.name) {
        fail(400, 'The assigned user name does not match the assigned user.');
    }

    taskData.assignedUser = user._id.toString();
    taskData.assignedUserName = user.name;
    return user;
}

async function removeTasksFromOtherUsers(taskIds, userId, session) {
    if (taskIds.length === 0) {
        return;
    }

    await User.updateMany(
        { _id: { $ne: userId } },
        { $pull: { pendingTasks: { $in: objectIdStringVariants(taskIds) } } },
        { session: session }
    );
}

async function assignPendingTasks(taskIds, user, session) {
    if (taskIds.length === 0) {
        return;
    }

    await Task.updateMany(
        { _id: { $in: taskIds } },
        {
            $set: {
                assignedUser: user._id.toString(),
                assignedUserName: user.name
            }
        },
        { session: session }
    );
}

async function createUser(body) {
    var data = validateUser(body);

    return withTransaction(async function (session) {
        await ensureUniqueEmail(data.email, null, session);
        await pendingTaskDocuments(data.pendingTasks, session);

        var user = new User(data);
        await user.save({ session: session });

        await removeTasksFromOtherUsers(data.pendingTasks, user._id, session);
        await assignPendingTasks(data.pendingTasks, user, session);

        return user;
    });
}

async function updateUser(userId, body) {
    var normalizedUserId = normalizeObjectId(userId);

    if (!normalizedUserId) {
        fail(404, 'User not found.');
    }

    return withTransaction(async function (session) {
        var user = await User.findById(normalizedUserId).session(session);

        if (!user) {
            fail(404, 'User not found.');
        }

        var data = validateUser(body);
        await ensureUniqueEmail(data.email, user._id, session);
        await pendingTaskDocuments(data.pendingTasks, session);

        var newTaskIds = data.pendingTasks;
        var newTaskSet = new Set(newTaskIds);
        var oldTaskIds = user.pendingTasks.map(function (taskId) {
            return normalizeObjectId(taskId);
        }).filter(Boolean);
        var removedTaskIds = uniqueIds(oldTaskIds).filter(function (taskId) {
            return !newTaskSet.has(taskId);
        });
        var assignedUserVariants = objectIdStringVariants([user._id]);

        // A rename affects every task assigned to the user, including completed tasks.
        await Task.updateMany(
            { assignedUser: { $in: assignedUserVariants } },
            { $set: { assignedUserName: data.name } },
            { session: session }
        );

        if (removedTaskIds.length > 0) {
            await Task.updateMany(
                {
                    _id: { $in: removedTaskIds },
                    assignedUser: { $in: assignedUserVariants }
                },
                {
                    $set: {
                        assignedUser: '',
                        assignedUserName: 'unassigned'
                    }
                },
                { session: session }
            );
        }

        await removeTasksFromOtherUsers(newTaskIds, user._id, session);

        user.name = data.name;
        user.email = data.email;
        user.pendingTasks = newTaskIds;
        await user.save({ session: session });

        await assignPendingTasks(newTaskIds, user, session);
        return user;
    });
}

async function deleteUser(userId) {
    var normalizedUserId = normalizeObjectId(userId);

    if (!normalizedUserId) {
        fail(404, 'User not found.');
    }

    return withTransaction(async function (session) {
        var user = await User.findById(normalizedUserId).session(session);

        if (!user) {
            fail(404, 'User not found.');
        }

        await Task.updateMany(
            { assignedUser: { $in: objectIdStringVariants([user._id]) } },
            {
                $set: {
                    assignedUser: '',
                    assignedUserName: 'unassigned'
                }
            },
            { session: session }
        );

        await User.deleteOne({ _id: user._id }, { session: session });
        return user;
    });
}

async function createTask(body) {
    var data = validateTask(body);

    return withTransaction(async function (session) {
        var user = await assignedUserDocument(data, session);
        var task = new Task(data);
        await task.save({ session: session });

        if (user && !task.completed) {
            await User.updateOne(
                { _id: user._id },
                { $addToSet: { pendingTasks: task._id.toString() } },
                { session: session }
            );
        }

        return task;
    });
}

async function updateTask(taskId, body) {
    var normalizedTaskId = normalizeObjectId(taskId);

    if (!normalizedTaskId) {
        fail(404, 'Task not found.');
    }

    return withTransaction(async function (session) {
        var task = await Task.findById(normalizedTaskId).session(session);

        if (!task) {
            fail(404, 'Task not found.');
        }

        var data = validateTask(body);
        var user = await assignedUserDocument(data, session);
        var taskIdString = task._id.toString();
        var taskIdVariants = objectIdStringVariants([taskIdString]);

        // Removing first handles unassignment, reassignment, and completion.
        await User.updateMany(
            { pendingTasks: { $in: taskIdVariants } },
            { $pull: { pendingTasks: { $in: taskIdVariants } } },
            { session: session }
        );

        if (user && !data.completed) {
            await User.updateOne(
                { _id: user._id },
                { $addToSet: { pendingTasks: taskIdString } },
                { session: session }
            );
        }

        task.name = data.name;
        task.description = data.description;
        task.deadline = data.deadline;
        task.completed = data.completed;
        task.assignedUser = data.assignedUser;
        task.assignedUserName = data.assignedUserName;
        await task.save({ session: session });

        return task;
    });
}

async function deleteTask(taskId) {
    var normalizedTaskId = normalizeObjectId(taskId);

    if (!normalizedTaskId) {
        fail(404, 'Task not found.');
    }

    return withTransaction(async function (session) {
        var task = await Task.findById(normalizedTaskId).session(session);

        if (!task) {
            fail(404, 'Task not found.');
        }

        var taskIdString = task._id.toString();
        var taskIdVariants = objectIdStringVariants([taskIdString]);

        await User.updateMany(
            { pendingTasks: { $in: taskIdVariants } },
            { $pull: { pendingTasks: { $in: taskIdVariants } } },
            { session: session }
        );
        await Task.deleteOne({ _id: task._id }, { session: session });

        return task;
    });
}

function isRequestError(err) {
    return err && err.name === 'RequestError';
}

module.exports = {
    createUser: createUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    createTask: createTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    isRequestError: isRequestError,
    normalizeObjectId: normalizeObjectId
};
