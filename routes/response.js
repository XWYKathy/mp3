// Keep every API response in the same shape.
function send(res, status, message, data) {
    return res.status(status).json({
        message: message,
        data: data === undefined ? null : data
    });
}

module.exports = {
    send: send
};
