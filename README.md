# Relais Node.js Client v1.1.0

A Node.js client for the relay tunnel service, allowing you to expose local services to the Internet with enhanced connection stability.

## 🆕 What's New in v1.1.0

- ✨ **Heartbeat Management**: Proper handling of server heartbeats for stable connections
- 🔄 **Connection Monitoring**: Automatic detection of dead connections
- ⏱️ **Optimized Timeouts**: Synchronized with server settings (60s keep-alive, 120s data timeouts)
- 🐛 **Fixed Disconnections**: No more disconnections every 30-45 seconds
- 🚀 **Better Reconnection**: Improved auto-reconnect logic

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

### Connection Stability
- **TCP Keep-Alive**: Increased from 30s to 60s
- **Data Timeouts**: Increased from 60s to 120s
- **Control Timeout**: Set to 180s (3 minutes)
- **Heartbeat Monitoring**: 30s interval for connection health

### Error Handling
- Better propagation of authentication errors
- Automatic reconnection on network failures
- Graceful handling of server disconnections

## Requirements

- Node.js 18.20.3 or higher
- npm or yarn

## Troubleshooting

If you experience connection issues:
1. Enable verbose logging with `-v` flag
2. Check your network connectivity
3. Verify your token is valid
4. Make sure the local service is running on the specified port

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.
