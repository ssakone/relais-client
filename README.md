# Relais Node.js Client v1.2.0

A Node.js client for the relay tunnel service, allowing you to expose local services to the Internet with persistent agent mode for maximum network resilience.

## 🆕 What's New in v1.2.0

- 🤖 **Agent Mode Always On**: Persistent reconnection for network errors - never gives up!
- 🔄 **Smart Error Handling**: Distinguishes between network errors (retry forever) and server issues
- ⏱️ **Improved Backoff**: Exponential backoff (1s → 2s → 4s → 8s → 16s → 30s max) for better resource usage
- 🛡️ **Network Resilience**: Continues trying indefinitely when network is down or unreachable
- 🔍 **Enhanced Logging**: Better error categorization and debugging information
- ⏰ **Periodic Restart**: Automatically restarts the tunnel every 30 minutes for a fresh connection

## Installation

### Quick Install (Recommended)
```bash
git clone <this-repo>
cd node-client
./install.sh
```

### Manual Installation
```bash
npm install -g relais
```

## Usage

### Save a token

```bash
relais set-token <your-token>
```

### Check your saved token

```bash
relais check-token
```

### Debug configuration (Linux troubleshooting)

```bash
relais debug-config
```

### Create a tunnel

```bash
relais tunnel [options]
```

Available options:
- `-s, --server <address>` : Relay server address (default: 104.168.64.151:1080)
- `-h, --host <host>` : Local service host (default: localhost)
- `-p, --port <port>` : Local service port (required)
- `-k, --token <token>` : Authentication token (optional, required for some services)
- `-d, --domain <domain>` : Custom domain
- `-r, --remote <port>` : Desired remote port
- `-t, --type <type>` : Protocol type (http or tcp) (default: http)
- `--timeout <seconds>` : Tunnel establishment timeout in seconds (default: 30)
- `-v, --verbose` : Enable detailed logging

## Examples

```bash
# Expose a local web service on port 3000
relais tunnel -p 3000

# With a custom domain
relais tunnel -p 3000 -d mysite.example.com

# For a service requiring authentication
relais tunnel -p 3000 -k mytoken

# With custom timeout (60 seconds instead of default 30)
relais tunnel -p 3000 --timeout 60

# With all parameters and verbose logging
relais tunnel -s server:1080 -h localhost -p 3000 -k mytoken -d mysite.example.com -r 8080 -t http --timeout 60 -v
```

## 🔧 Technical Improvements

### Agent Mode & Connection Management
- **Persistent Agent**: Never stops trying to connect for network errors (EHOSTUNREACH, ETIMEDOUT, etc.)
- **Smart Error Classification**: Distinguishes network errors from server/authentication issues
- **Exponential Backoff**: 1s → 2s → 4s → 8s → 16s → 30s max delay between attempts
- **TCP Keep-Alive**: 60s for stable connections
- **Heartbeat Monitoring**: 30s interval for connection health

### Network Resilience
- **Infinite Retry**: Continues attempting connection when network is down
- **Resource Efficient**: Capped backoff prevents excessive resource usage
- **Connection Recovery**: Automatically resets failure tracking on successful connection
- **Error Categorization**: Separate tracking for network vs server errors

### Token & Configuration
- **Secure Storage**: Token files with 600 permissions (owner read/write only)
- **Permission Validation**: Automatic checking of config directory access
- **Cross-platform Config**: Proper paths for Windows, macOS, and Linux
- **Diagnostic Tools**: Built-in troubleshooting commands

### Error Handling
- **Detailed Error Messages**: Clear distinction between different error types
- **Linux Compatibility**: Enhanced support for various Linux environments
- **Token Validation**: Post-save verification and corruption detection

## Requirements

- Node.js 18.20.3 or higher
- npm or yarn

## Troubleshooting

### Connection Issues
1. Enable verbose logging with `-v` flag
2. Agent mode ensures continuous retry for network issues - no manual intervention needed
3. Check that your local service is running on the specified port
4. For persistent connection issues, check server status and authentication

### Token Issues (Linux)
1. Run `relais check-token` to verify token status
2. Use `relais debug-config` for detailed diagnostics
3. Check config directory permissions: `ls -la ~/.config/relais-client/`
4. Ensure home directory is writable

### Common Fixes
- **Permission Denied**: Run `chmod 755 ~/.config` and `chmod 755 ~/.config/relais-client`
- **Token Not Found**: Re-run `relais set-token <your-token>`
- **Config Directory Issues**: Check output of `relais debug-config`

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.
