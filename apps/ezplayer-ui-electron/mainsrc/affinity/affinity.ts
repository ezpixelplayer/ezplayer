// affinity/index.js
const addon = require('node-gyp-build')(__dirname); // or ./build/Release/affinity

/**
 * Pin the **calling thread** (current Worker) to specific logical CPU indices.
 * @param {number[]} cpus e.g. [1,3,5,6,7,8]
 */
function setThreadAffinity(cpus: number[]) { addon.setThreadAffinity(cpus); }

/**
 * Optionally restrict the **whole process** to a CPU set.
 * On Windows this sets a process mask; on Linux it affects the current thread group.
 * macOS: no-op.
 */
function setProcessAffinity(cpus: number[]) { addon.setProcessAffinity(cpus); }

module.exports = { setThreadAffinity, setProcessAffinity };
