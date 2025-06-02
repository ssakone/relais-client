// ConnectionFailureTracker tracks connection failures to implement backoff
export class ConnectionFailureTracker {
  constructor() {
    this.failures = [];
    this.maxFailuresPerMinute = 4;
    this.failureWindowSeconds = 60;
  }

  // Record a connection failure
  recordFailure() {
    const now = Date.now();
    this.failures.push(now);

    // Clean up old failures outside the window
    const cutoff = now - (this.failureWindowSeconds * 1000);
    this.failures = this.failures.filter(failure => failure > cutoff);
    
    console.log(`[FailureTracker] Recorded failure. Total recent failures: ${this.failures.length}/${this.maxFailuresPerMinute}`);
  }

  // Check if too many failures occurred recently
  shouldStopReconnecting() {
    const now = Date.now();
    const cutoff = now - (this.failureWindowSeconds * 1000);

    // Count recent failures
    const recentFailures = this.failures.filter(failure => failure > cutoff).length;
    
    const shouldStop = recentFailures >= this.maxFailuresPerMinute;
    console.log(`[FailureTracker] Checking reconnection limit: ${recentFailures}/${this.maxFailuresPerMinute} failures in last ${this.failureWindowSeconds}s. Should stop: ${shouldStop}`);
    
    return shouldStop;
  }

  // Get the delay before next retry based on failure count
  getBackoffDuration() {
    const now = Date.now();
    const cutoff = now - (this.failureWindowSeconds * 1000);

    // Count recent failures
    const recentFailures = this.failures.filter(failure => failure > cutoff).length;

    // Exponential backoff: 100ms, 500ms, 1s, 2s+
    let duration;
    switch (recentFailures) {
      case 0:
        duration = 100;
        break;
      case 1:
        duration = 500;
        break;
      case 2:
        duration = 1000;
        break;
      default:
        duration = recentFailures * 1000;
    }
    
    console.log(`[FailureTracker] Backoff duration for ${recentFailures} failures: ${duration}ms`);
    return duration;
  }

  // Reset clears all recorded failures
  reset() {
    console.log(`[FailureTracker] Resetting failure tracker`);
    this.failures = [];
  }

  // Get the number of failures in the current window
  getRecentFailureCount() {
    const now = Date.now();
    const cutoff = now - (this.failureWindowSeconds * 1000);
    return this.failures.filter(failure => failure > cutoff).length;
  }
} 