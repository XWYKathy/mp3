var response = require('./response');

module.exports = function (router) {

    var homeRoute = router.route('/');

    homeRoute.get(function (req, res) {
        var connectionString = process.env.TOKEN;
        return response.send(res, 200, 'API is running.', {
            token: connectionString
        });
    });

    return router;
}
