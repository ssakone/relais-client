# Tunnel Connection Optimizations

## Summary of Optimizations Made

### 1. Configurable Restart Interval
- Added `--restart-interval` parameter to allow users to customize tunnel restart timing
- Default: 30 minutes, Range: 1-1440 minutes (1 minute to 24 hours)
- Helps maintain fresh connections and prevents long-term connection degradation

### 2. TCP Socket Optimizations
- **Comprehensive socket optimization function** (`optimizeSocket`):
  - TCP NoDelay (Nagle's algorithm disabled) for lower latency
  - Aggressive TCP keepalive (30s instead of 60s)
  - Socket timeout set to 180s for faster dead connection detection
  - Increased send/receive buffer sizes to 256KB for better throughput

### 3. Connection Establishment Improvements
- **DNS retry logic** with exponential backoff (2s, 4s, 8s) for up to 3 retries
- **TCP Fast Open** hints for supported systems
- **AllowHalfOpen** set to false for cleaner connection handling
- Better error handling during connection phase

### 4. Health Monitoring Enhancements
- **Reduced check interval**: 3 seconds (from 5 seconds) for faster detection
- **Adaptive intervals**: 
  - Normal: 3 seconds when healthy
  - Fast: 1 second when server is down
- **Reduced failure threshold**: 15 seconds (from 30 seconds) for quicker failover

### 5. Connection Pooling (Infrastructure Ready)
- Created `ConnectionPool` class for future connection reuse
- Supports health checking of pooled connections
- Statistics tracking for monitoring
- Currently not integrated but ready for future use

### 6. Performance Metrics
- Connection time logging for diagnostics
- Better timeout handling with specific error messages
- Improved debug logging for troubleshooting

## Usage Examples

### Basic usage with default settings:
```bash
relais tunnel -p 3000
```

### Custom restart interval (2 hours):
```bash
relais tunnel -p 3000 --restart-interval 120
```

### Custom timeout and restart interval:
```bash
relais tunnel -p 3000 --timeout 60 --restart-interval 60
```

### Full configuration with all optimizations:
```bash
relais tunnel -s server:1081 -h localhost -p 3000 -k mytoken \
  -d mysite.example.com -r 8080 -t http \
  --timeout 60 --restart-interval 120 -v
```

## Benefits

1. **Reliability**: More resilient connections with better error recovery
2. **Performance**: Lower latency and higher throughput
3. **Flexibility**: User-configurable parameters for different use cases
4. **Monitoring**: Better visibility into connection health
5. **Efficiency**: Optimized resource usage with adaptive checking

## Technical Details

### Socket Buffer Sizes
- Send buffer: 256KB (increased from default)
- Receive buffer: 256KB (increased from default)
- Helps with bulk data transfer and reduces syscall overhead

### Keepalive Settings
- Enabled: true
- Initial delay: 10 seconds (connection establishment)
- Interval: 30 seconds (after connection)
- Helps detect dead connections faster

### Timeout Configuration
- Connection timeout: 15 seconds
- Socket timeout: 180 seconds (3 minutes)
- Health check timeout: 10 seconds
- Establishment timeout: User configurable (default 30s)

### Error Recovery
- DNS failures: Exponential backoff with retry
- Network errors: Persistent retry with backoff
- Server closures: Smart backoff algorithm
- Health failures: Automatic reconnection