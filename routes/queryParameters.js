function queryError(message) {
    var err = new Error(message);
    err.name = 'QueryParameterError';
    return err;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value, name) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw queryError('The "' + name + '" query parameter must be provided once.');
    }

    var parsed;

    try {
        parsed = JSON.parse(value);
    } catch (err) {
        throw queryError('The "' + name + '" query parameter contains invalid JSON.');
    }

    if (!isObject(parsed)) {
        throw queryError('The "' + name + '" query parameter must contain a JSON object.');
    }

    return parsed;
}

function parseInteger(value, name) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw queryError('The "' + name + '" query parameter must be a non-negative integer.');
    }

    var parsed = Number(value);

    if (!Number.isSafeInteger(parsed)) {
        throw queryError('The "' + name + '" query parameter is too large.');
    }

    return parsed;
}

function parseCount(value) {
    if (value === undefined || value === 'false') {
        return false;
    }

    if (value === 'true') {
        return true;
    }

    throw queryError('The "count" query parameter must be true or false.');
}

function validateSort(sort) {
    if (sort === undefined) {
        return;
    }

    Object.keys(sort).forEach(function (field) {
        if (sort[field] !== 1 && sort[field] !== -1) {
            throw queryError('Each "sort" value must be 1 or -1.');
        }
    });
}

function validateSelect(select) {
    if (select === undefined) {
        return;
    }

    Object.keys(select).forEach(function (field) {
        if (select[field] !== 1 && select[field] !== 0) {
            throw queryError('Each "select" value must be 1 or 0.');
        }
    });
}

function parseCollection(query, defaultLimit) {
    var where = parseJsonObject(query.where, 'where') || {};
    var sort = parseJsonObject(query.sort, 'sort');
    var select = parseJsonObject(query.select, 'select');
    var skip = parseInteger(query.skip, 'skip');
    var limit = parseInteger(query.limit, 'limit');
    var limitProvided = limit !== undefined;

    validateSort(sort);
    validateSelect(select);

    if (limit === undefined) {
        limit = defaultLimit;
    }

    return {
        where: where,
        sort: sort,
        select: select,
        skip: skip,
        limit: limit,
        limitProvided: limitProvided,
        count: parseCount(query.count)
    };
}

function parseSelect(value) {
    var select = parseJsonObject(value, 'select');
    validateSelect(select);
    return select;
}

function isQueryError(err) {
    return err && err.name === 'QueryParameterError';
}

module.exports = {
    parseCollection: parseCollection,
    parseSelect: parseSelect,
    isQueryError: isQueryError
};
