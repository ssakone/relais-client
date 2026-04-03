# Relais Node.js Client v1.6.31

A Node.js client for the relay tunnel service, allowing you to expose local services to the Internet with end-to-end encryption, persistent agent mode and automatic health monitoring.

## What's New in v1.6.31

- **Mobile Network Compatibility**: Fixed connection issues on restrictive mobile networks (DPI bypass)
- **Binary Handshake Protocol**: Handshake now uses binary encoding to work on all networks
- **Backward Compatible**: Servers support both new binary and legacy JSON clients

## Previous Versions

### v1.6.2
- DNS retry crash fix

### v1.6.1
- End-to-End Encryption by Default (ECDH P-256 + AES-256-GCM)
- Security vulnerability fixes
- Reduced dependencies (204 -> 97 packages)

### v1.6.0
- Automatic Tunnel Health Checking
- Smart Auto-Reconnection
- Waiting for Recovery Mode

## Installation

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
- `-s, --server <address>` : Relay server address (default: tcp.relais.dev:1081)
- `-h, --host <host>` : Local service host (default: localhost)
- `-p, --port <port>` : Local service port (required)
- `-k, --token <token>` : Authentication token (optional)
- `-d, --domain <domain>` : Custom domain
- `-r, --remote <port>` : Desired remote port
- `-t, --type <type>` : Protocol type (http or tcp) (default: http)
- `--timeout <seconds>` : Tunnel establishment timeout (default: 30)
- `--health-check` : Enable automatic health checking (default: enabled)
- `--no-health-check` : Disable automatic health checking
- `--health-check-interval <seconds>` : Health check interval (default: 30)
- `--insecure` : Disable encryption (not recommended)
- `-v, --verbose` : Enable detailed logging

## Examples

```bash
# Expose a local web service on port 3000 (encrypted by default)
relais tunnel -p 3000

# With a custom domain
relais tunnel -p 3000 -d mysite.example.com

# For a service requiring authentication
relais tunnel -p 3000 -k mytoken

# With custom timeout (60 seconds)
relais tunnel -p 3000 --timeout 60

# Disable encryption (not recommended)
relais tunnel -p 3000 --insecure

# With verbose logging to see encryption details
relais tunnel -p 3000 -v
```

## Security

### End-to-End Encryption (Default)

All tunnel communications are encrypted by default:

1. **Key Exchange**: ECDH P-256 (Elliptic Curve Diffie-Hellman)
2. **Encryption**: AES-256-GCM (authenticated encryption)
3. **Forward Secrecy**: New ephemeral keys for each connection

Your tokens and data are **never transmitted in plaintext**.

### Disabling Encryption

Use `--insecure` flag only if:
- You're debugging connection issues
- The server doesn't support encryption (older versions)

```bash
relais tunnel -p 3000 --insecure
```

## Technical Features

### Automatic Health Monitoring
- Tunnel Health Checker verifies connectivity
- Auto-repair when tunnel fails but relay is accessible
- Waiting for Recovery mode when relay is down

### Agent Mode & Connection Management
- Persistent Agent: Never stops trying for network errors
- Exponential Backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s max
- TCP Keep-Alive: 30s for faster dead connection detection

### Network Resilience
- Infinite Retry for network errors
- Smart Error Classification
- DNS Retry with exponential backoff

## Requirements

- Node.js 18.20.3 or higher

## Troubleshooting

### Connection Issues
1. Enable verbose logging with `-v` flag
2. Check that your local service is running
3. Try `--insecure` to test if encryption is causing issues

### Token Issues
1. Run `relais set-token <your-token>` to save token
2. Check config directory permissions

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.
