// Re-export individual models to avoid "Cannot overwrite model" error
const Resource = require('./Resource');
const Payment = require('./Payment');
const Job = require('./Job');

module.exports = { Resource, Payment, Job };
