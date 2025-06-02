# Relais Node.js Client v1.1.2

A Node.js client for the relay tunnel service, allowing you to expose local services to the Internet with enhanced connection stability and intelligent error handling.

## 🆕 What's New in v1.1.2

- 🛡️ **Smart Reconnection Limits**: Automatically stops after 4 server disconnections in 1 minute
- ⏱️ **Exponential Backoff**: Progressive delays (100ms → 500ms → 1s → 2s+) between reconnection attempts
- 🔍 **Token Diagnostics**: New `check-token` command to verify saved tokens
- 🐧 **Linux Support**: Enhanced Linux compatibility with permission diagnostics via `debug-config`
- 🔒 **Enhanced Security**: Secure token file permissions (600) and better error handling

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
- `-v, --verbose` : Enable detailed logging

## Examples

```bash
# Expose a local web service on port 3000
relais tunnel -p 3000

# With a custom domain
relais tunnel -p 3000 -d mysite.example.com

# For a service requiring authentication
relais tunnel -p 3000 -k mytoken

# With all parameters and verbose logging
relais tunnel -s server:1080 -h localhost -p 3000 -k mytoken -d mysite.example.com -r 8080 -t http -v
```

## 🔧 Technical Improvements

### Connection Management
- **Smart Failure Tracking**: Stops reconnection after 4 server closures in 1 minute
- **Exponential Backoff**: Intelligent delay between reconnection attempts
- **TCP Keep-Alive**: 60s for stable connections
- **Heartbeat Monitoring**: 30s interval for connection health

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
2. Check if server closes connections repeatedly (client will auto-stop after 4 closures/minute)
3. Verify your network connectivity
4. Ensure local service is running on the specified port

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
