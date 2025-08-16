// ConnectionFailureTracker tracks connection failures to implement backoff
export class ConnectionFailureTracker {
  constructor() {
    this.serverClosures = []; // Track server-initiated closures
    this.networkErrors = []; // Track network errors (EHOSTUNREACH, etc.)
    this.maxServerClosuresPerMinute = 4;
    this.failureWindowSeconds = 60;
    this.maxBackoffDuration = 30000; // Cap backoff at 30 seconds
  }

  // Record a server-initiated connection closure
  recordServerClosure() {
    const now = Date.now();
    this.serverClosures.push(now);

    // Clean up old failures outside the window
    const cutoff = now - (this.failureWindowSeconds * 1000);
    this.serverClosures = this.serverClosures.filter(failure => failure > cutoff);
    
    // Verbose only
    if (process.env.DEBUG) {
      console.log(`[FailureTracker] Recorded server closure. Total recent closures: ${this.serverClosures.length}/${this.maxServerClosuresPerMinute}`);
    }
  }

  // Record a network error (these don't count toward stopping reconnection)
  recordNetworkError() {
    const now = Date.now();
    this.networkErrors.push(now);

    // Clean up old errors outside the window  
    const cutoff = now - (this.failureWindowSeconds * 1000);
    this.networkErrors = this.networkErrors.filter(error => error > cutoff);
    
    if (process.env.DEBUG) {
      console.log(`[FailureTracker] Recorded network error. Total recent network errors: ${this.networkErrors.length}`);
    }
  }

  // Check if too many server closures occurred recently (only server closures count)
  shouldStopReconnecting() {
    const now = Date.now();
    const cutoff = now - (this.failureWindowSeconds * 1000);

    // Count recent server closures only
    const recentClosures = this.serverClosures.filter(closure => closure > cutoff).length;
    
    const shouldStop = recentClosures >= this.maxServerClosuresPerMinute;
    if (process.env.DEBUG) {
      console.log(`[FailureTracker] Checking reconnection limit: ${recentClosures}/${this.maxServerClosuresPerMinute} server closures in last ${this.failureWindowSeconds}s. Should stop: ${shouldStop}`);
    }
    
    return shouldStop;
  }

  // Get the delay before next retry based on failure count (includes both types)
  getBackoffDuration() {
    const now = Date.now();
    const cutoff = now - (this.failureWindowSeconds * 1000);

    // Count all recent failures for backoff calculation
    const recentServerClosures = this.serverClosures.filter(closure => closure > cutoff).length;
    const recentNetworkErrors = this.networkErrors.filter(error => error > cutoff).length;
    const totalRecentFailures = recentServerClosures + recentNetworkErrors;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    let duration;
    if (totalRecentFailures === 0) {
      duration = 1000; // 1 second minimum
    } else {
      duration = Math.min(1000 * Math.pow(2, totalRecentFailures - 1), this.maxBackoffDuration);
    }
    
    if (process.env.DEBUG) {
      console.log(`[FailureTracker] Backoff duration for ${totalRecentFailures} total failures (${recentServerClosures} server + ${recentNetworkErrors} network): ${duration}ms`);
    }
    return duration;
  }

  // Reset clears all recorded failures
  reset() {
    if (process.env.DEBUG) {
      console.log(`[FailureTracker] Resetting failure tracker`);
    }
    this.serverClosures = [];
    this.networkErrors = [];
  }

  // Get the number of failures in the current window
  getRecentFailureCount() {
    const now = Date.now();
    const cutoff = now - (this.failureWindowSeconds * 1000);
    const recentServerClosures = this.serverClosures.filter(closure => closure > cutoff).length;
    const recentNetworkErrors = this.networkErrors.filter(error => error > cutoff).length;
    return {
      serverClosures: recentServerClosures,
      networkErrors: recentNetworkErrors,
      total: recentServerClosures + recentNetworkErrors
    };
  }

  // Check if an error is a network connectivity error
  isNetworkError(error) {
    const networkErrorCodes = [
      'EHOSTUNREACH',  // Host unreachable
      'ENETUNREACH',   // Network unreachable
      'ECONNREFUSED',  // Connection refused
      'ETIMEDOUT',     // Connection timeout
      'ENOTFOUND',     // DNS resolution failed
      'EAI_AGAIN'      // DNS temporary failure
    ];
    
    return networkErrorCodes.some(code => error.message.includes(code) || error.code === code);
  }

  // Record a successful connection to reset primary server failure count
  recordSuccessfulConnection() {
    if (process.env.DEBUG) {
      console.log(`[FailureTracker] Successful connection`);
    }
  }
  
}
 