# Relais

A Node.js client for the relay tunnel service, allowing you to expose local services to the Internet.

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
- `-s, --server <address>` : Relay server address (default: 162.250.189.217:1080)
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

# With all parameters
relais tunnel -s server:1080 -h localhost -p 3000 -k mytoken -d mysite.example.com -r 8080 -t http -v
