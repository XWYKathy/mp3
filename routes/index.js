/*
 * Connect all of your endpoints together here.
 */
var response = require('./response');

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api/users', require('./users.js'));
    app.use('/api/tasks', require('./tasks.js'));

    // Return JSON instead of Express's default HTML for unknown endpoints.
    app.use(function (req, res) {
        return response.send(res, 404, 'Endpoint not found.', null);
    });

    // Keep parsing failures and unexpected errors independent of Express.
    app.use(function (err, req, res, next) {
        if (err && err.type === 'entity.parse.failed') {
            return response.send(res, 400, 'The request body contains invalid JSON.', null);
        }

        return response.send(res, 500, 'An unexpected server error occurred.', null);
    });
};
