// Load required packages
var express = require('express'),
    User = require('../models/user'),
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

    if (err && err.code === 11000) {
        return response.send(res, 400, 'A user with that email already exists.', null);
    }

    if (err && (err.name === 'ValidationError' || err.name === 'CastError')) {
        return response.send(res, 400, 'The user data is invalid.', null);
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

// /api/users
router.route('/')
    .get(async function (req, res) {
        try {
            var options = queryParameters.parseCollection(req.query);

            if (options.count) {
                var countQuery = User.countDocuments(options.where);

                if (options.skip !== undefined) {
                    countQuery.skip(options.skip);
                }

                if (options.limitProvided) {
                    countQuery.limit(options.limit);
                }

                var count = await countQuery;
                return response.send(res, 200, 'Users counted successfully.', count);
            }

            var query = User.find(options.where);

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

            var users = await query;
            return response.send(res, 200, 'Users retrieved successfully.', users);
        } catch (err) {
            return sendQueryError(res, err);
        }
    })
    .post(async function (req, res) {
        try {
            var user = await referenceOperations.createUser(req.body);

            return response.send(res, 201, 'User created successfully.', user);
        } catch (err) {
            return sendWriteError(res, err);
        }
    });

// /api/users/:id
router.route('/:id')
    .get(async function (req, res) {
        var userId = referenceOperations.normalizeObjectId(req.params.id);

        if (!userId) {
            return response.send(res, 404, 'User not found.', null);
        }

        try {
            var select = queryParameters.parseSelect(req.query.select);
            var query = User.findById(userId);

            if (select !== undefined) {
                query.select(select);
            }

            var user = await query;

            if (!user) {
                return response.send(res, 404, 'User not found.', null);
            }

            return response.send(res, 200, 'User retrieved successfully.', user);
        } catch (err) {
            return sendQueryError(res, err);
        }
    })
    .put(async function (req, res) {
        try {
            var user = await referenceOperations.updateUser(req.params.id, req.body);

            return response.send(res, 200, 'User updated successfully.', user);
        } catch (err) {
            return sendWriteError(res, err);
        }
    })
    .delete(async function (req, res) {
        try {
            var user = await referenceOperations.deleteUser(req.params.id);
            return response.send(res, 200, 'User deleted successfully.', user);
        } catch (err) {
            return sendWriteError(res, err);
        }
    });

module.exports = router;
