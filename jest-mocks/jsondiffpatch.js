// Mock implementation of jsondiffpatch for Jest tests
// This provides the basic functionality needed for tests without ES module issues

const jsondiffpatch = {
  diff: (left, right) => {
    // Simple diff implementation for testing
    if (JSON.stringify(left) === JSON.stringify(right)) {
      return undefined;
    }
    
    // Return a simple delta object
    const delta = {};
    
    // Handle simple object differences
    if (typeof left === 'object' && typeof right === 'object' && left !== null && right !== null) {
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      const allKeys = new Set([...leftKeys, ...rightKeys]);
      
      for (const key of allKeys) {
        if (!(key in left)) {
          delta[key] = [right[key]]; // Added
        } else if (!(key in right)) {
          delta[key] = [left[key], 0, 0]; // Deleted
        } else if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
          delta[key] = [left[key], right[key]]; // Modified
        }
      }
    } else {
      // For primitive values, return a simple change
      return [left, right];
    }
    
    return Object.keys(delta).length > 0 ? delta : undefined;
  },
  
  patch: (left, delta) => {
    if (!delta) return left;
    
    // Simple patch implementation
    if (Array.isArray(delta) && delta.length === 2) {
      // Simple value change
      return delta[1];
    }
    
    // Object patch
    const result = JSON.parse(JSON.stringify(left || {}));
    
    for (const [key, change] of Object.entries(delta)) {
      if (Array.isArray(change)) {
        if (change.length === 1) {
          // Added
          result[key] = change[0];
        } else if (change.length === 2) {
          // Modified
          result[key] = change[1];
        } else if (change.length === 3 && change[1] === 0 && change[2] === 0) {
          // Deleted
          delete result[key];
        }
      }
    }
    
    return result;
  },
  
  clone: (obj) => {
    return JSON.parse(JSON.stringify(obj));
  },
  
  create: (options) => {
    return jsondiffpatch;
  }
};

// Export both named and default exports to handle different import styles
export default jsondiffpatch;
export const diff = jsondiffpatch.diff;
export const patch = jsondiffpatch.patch;
export const clone = jsondiffpatch.clone;
export const create = jsondiffpatch.create;

// Also support CommonJS style exports for compatibility
module.exports = jsondiffpatch;
module.exports.default = jsondiffpatch;
module.exports.diff = jsondiffpatch.diff;
module.exports.patch = jsondiffpatch.patch;
module.exports.clone = jsondiffpatch.clone;
module.exports.create = jsondiffpatch.create;
