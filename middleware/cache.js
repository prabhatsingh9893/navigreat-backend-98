const NodeCache = require('node-cache');

// Standard TTL: 5 minutes (300 seconds)
const cache = new NodeCache({ stdTTL: 300 });

const cacheMiddleware = (duration = 300) => (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
        console.log("⏩ Non-GET request, skipping cache.");
        return next();
    }

    // Cache key based on URL (e.g., /api/mentors or /api/mentors/123)
    const key = req.originalUrl || req.url;
    const cachedResponse = cache.get(key);

    if (cachedResponse) {
        // console.log(`⚡ Serving from cache: ${key}`);
        return res.json(cachedResponse);
    } else {
        // console.log(`🐢 Cache miss: ${key}`);

        // Override res.json to intercept the response
        const originalSend = res.json;
        res.json = (body) => {
            // Only cache successful responses
            if (res.statusCode === 200 && body.success) {
                cache.set(key, body, duration);
            }
            originalSend.call(res, body);
        };
        next();
    }
};

// Helper to manually clear cache (useful for future updates)
const clearCache = (key) => {
    if (key) cache.del(key);
    else cache.flushAll();
};

module.exports = { cacheMiddleware, clearCache };
