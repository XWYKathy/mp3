// Load required packages
var express = require('express'),
    Task = require('../models/task'),
    response = require('./response'),
    queryParameters = require('./queryParameters'),
    referenceOperations = require('../services/referenceOperations');

var router = express.Router();

function sendServerError(res) {
    return response.send(res, 500, 'An unexpected server error occurred.', null);
}

function sendWriteError(res, err) {
    if (referenceOperations.isRequestError(err)) {
        return response.send(res, err.status, err.message, null);
    }

    if (err && (err.name === 'ValidationError' || err.name === 'CastError')) {
        return response.send(res, 400, 'The task data is invalid.', null);
    }

    return sendServerError(res);
}

function sendQueryError(res, err) {
    if (queryParameters.isQueryError(err)) {
        return response.send(res, 400, err.message, null);
    }

    if (err && err.name === 'CastError') {
        return response.send(res, 400, 'The query contains an invalid value.', null);
    }

    return sendServerError(res);
}

// /api/tasks
router.route('/')
    .get(async function (req, res) {
        try {
            var options = queryParameters.parseCollection(req.query, 100);

            if (options.count) {
                var countQuery = Task.countDocuments(options.where);

                if (options.skip !== undefined) {
                    countQuery.skip(options.skip);
                }

                if (options.limitProvided) {
                    countQuery.limit(options.limit);
                }

                var count = await countQuery;
                return response.send(res, 200, 'Tasks counted successfully.', count);
            }

            var query = Task.find(options.where);

            if (options.sort !== undefined) {
                query.sort(options.sort);
            }

            if (options.select !== undefined) {
                query.select(options.select);
            }

            if (options.skip !== undefined) {
                query.skip(options.skip);
            }

            if (options.limit !== undefined) {
                query.limit(options.limit);
            }

            var tasks = await query;
            return response.send(res, 200, 'Tasks retrieved successfully.', tasks);
        } catch (err) {
            return sendQueryError(res, err);
        }
    })
    .post(async function (req, res) {
        try {
            var task = await referenceOperations.createTask(req.body);

            return response.send(res, 201, 'Task created successfully.', task);
        } catch (err) {
            return sendWriteError(res, err);
        }
    });

// /api/tasks/:id
router.route('/:id')
    .get(async function (req, res) {
        var taskId = referenceOperations.normalizeObjectId(req.params.id);

        if (!taskId) {
            return response.send(res, 404, 'Task not found.', null);
        }

        try {
            var select = queryParameters.parseSelect(req.query.select);
            var query = Task.findById(taskId);

            if (select !== undefined) {
                query.select(select);
            }

            var task = await query;

            if (!task) {
                return response.send(res, 404, 'Task not found.', null);
            }

            return response.send(res, 200, 'Task retrieved successfully.', task);
        } catch (err) {
            return sendQueryError(res, err);
        }
    })
    .put(async function (req, res) {
        try {
            var task = await referenceOperations.updateTask(req.params.id, req.body);

            return response.send(res, 200, 'Task updated successfully.', task);
        } catch (err) {
            return sendWriteError(res, err);
        }
    })
    .delete(async function (req, res) {
        try {
            await referenceOperations.deleteTask(req.params.id);
            return res.status(204).end();
        } catch (err) {
            return sendWriteError(res, err);
        }
    });

module.exports = router;
