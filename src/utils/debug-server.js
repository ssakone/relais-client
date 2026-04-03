import { createServer } from 'http';
import { URL } from 'url';
import { debug, errorWithTimestamp } from './debug.js';

class DebugServer {
  constructor(port = 3001, host = 'localhost') {
    this.port = port;
    this.host = host;
    this.server = null;
    this.isRunning = false;
    this.connections = new Map();
    this.tunnelStats = {
      startTime: null,
      totalConnections: 0,
      activeConnections: 0,
      errors: [],
      lastHeartbeat: null
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        resolve(`Debug server already running on http://${this.host}:${this.port}`);
        return;
      }

      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          errorWithTimestamp(`Debug server port ${this.port} is already in use`);
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          errorWithTimestamp('Debug server error:', err.message);
          reject(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        this.isRunning = true;
        this.tunnelStats.startTime = new Date();
        const url = `http://${this.host}:${this.port}`;
        debug(`🐛 Debug server started on ${url}`);
        console.log(`\n📊 Debug Dashboard: ${url}`);
        console.log(`📈 Health Check: ${url}/health`);
        console.log(`📋 Stats: ${url}/stats`);
        console.log(`🔍 Logs: ${url}/logs\n`);
        resolve(url);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.isRunning || !this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.isRunning = false;
        this.server = null;
        debug('Debug server stopped');
        resolve();
      });
    });
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      switch (path) {
        case '/':
          this.serveDashboard(res);
          break;
        case '/health':
          this.serveHealth(res);
          break;
        case '/stats':
          this.serveStats(res);
          break;
        case '/logs':
          this.serveLogs(res);
          break;
        case '/api/stats':
          this.serveApiStats(res);
          break;
        default:
          this.serve404(res);
      }
    } catch (err) {
      errorWithTimestamp('Debug server request error:', err.message);
      this.serveError(res, err);
    }
  }

  serveDashboard(res) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relais Debug Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #2196F3; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat { display: inline-block; margin-right: 30px; }
        .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .stat-value { font-size: 24px; font-weight: bold; color: #2196F3; }
        .status-good { color: #4CAF50; }
        .status-bad { color: #f44336; }
        .logs { background: #1e1e1e; color: #fff; padding: 15px; border-radius: 4px; font-family: monospace; max-height: 300px; overflow-y: auto; }
        .refresh-btn { background: #2196F3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        .refresh-btn:hover { background: #1976D2; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Relais Debug Dashboard</h1>
            <p>Real-time monitoring and debugging for your tunnel service</p>
        </div>
        
        <div class="card">
            <h2>📊 Statistics</h2>
            <div id="stats">Loading...</div>
            <button class="refresh-btn" onclick="loadStats()">Refresh</button>
        </div>
        
        <div class="card">
            <h2>📋 Recent Errors</h2>
            <div id="errors">Loading...</div>
        </div>
        
        <div class="card">
            <h2>🔧 Quick Actions</h2>
            <a href="/health" target="_blank">Health Check</a> | 
            <a href="/stats" target="_blank">JSON Stats</a> | 
            <a href="/logs" target="_blank">Raw Logs</a>
        </div>
    </div>

    <script>
        function loadStats() {
            fetch('/api/stats')
                .then(response => response.json())
                .then(data => {
                    const statsHtml = \`
                        <div class="stat">
                            <div class="stat-label">Uptime</div>
                            <div class="stat-value">\${data.uptime}</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">Total Connections</div>
                            <div class="stat-value">\${data.totalConnections}</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">Active Connections</div>
                            <div class="stat-value \${data.activeConnections > 0 ? 'status-good' : 'status-bad'}">\${data.activeConnections}</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">Errors</div>
                            <div class="stat-value \${data.errorCount === 0 ? 'status-good' : 'status-bad'}">\${data.errorCount}</div>
                        </div>
                    \`;
                    document.getElementById('stats').innerHTML = statsHtml;
                    
                    const errorsHtml = data.errors.length > 0 
                        ? '<div class="logs">' + data.errors.slice(-10).map(err => \`[\${err.timestamp}] \${err.message}\`).join('<br>') + '</div>'
                        : '<p class="status-good">No recent errors 🎉</p>';
                    document.getElementById('errors').innerHTML = errorsHtml;
                })
                .catch(err => {
                    console.error('Failed to load stats:', err);
                    document.getElementById('stats').innerHTML = '<p class="status-bad">Failed to load stats</p>';
                });
        }
        
        // Load stats initially and refresh every 5 seconds
        loadStats();
        setInterval(loadStats, 5000);
    </script>
</body>
</html>
    `;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  serveHealth(res) {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      server: {
        host: this.host,
        port: this.port,
        isRunning: this.isRunning
      },
      tunnel: {
        activeConnections: this.tunnelStats.activeConnections,
        totalConnections: this.tunnelStats.totalConnections,
        lastHeartbeat: this.tunnelStats.lastHeartbeat,
        errorCount: this.tunnelStats.errors.length
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  serveStats(res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.tunnelStats, null, 2));
  }

  serveApiStats(res) {
    const stats = {
      uptime: this.getUptime(),
      totalConnections: this.tunnelStats.totalConnections,
      activeConnections: this.tunnelStats.activeConnections,
      errorCount: this.tunnelStats.errors.length,
      errors: this.tunnelStats.errors.slice(-10), // Last 10 errors
      lastHeartbeat: this.tunnelStats.lastHeartbeat,
      startTime: this.tunnelStats.startTime
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
  }

  serveLogs(res) {
    const logs = this.tunnelStats.errors.map(err => 
      `[${err.timestamp}] ${err.level}: ${err.message}`
    ).join('\n');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(logs || 'No logs available');
  }

  serve404(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  serveError(res, err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }

  getUptime() {
    if (!this.tunnelStats.startTime) return 'Not started';
    const uptime = Date.now() - this.tunnelStats.startTime.getTime();
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // Methods to update tunnel stats
  recordConnection() {
    this.tunnelStats.totalConnections++;
    this.tunnelStats.activeConnections++;
    debug(`Debug server: Connection recorded (total: ${this.tunnelStats.totalConnections}, active: ${this.tunnelStats.activeConnections})`);
  }

  recordDisconnection() {
    this.tunnelStats.activeConnections = Math.max(0, this.tunnelStats.activeConnections - 1);
    debug(`Debug server: Disconnection recorded (active: ${this.tunnelStats.activeConnections})`);
  }

  recordError(error, level = 'ERROR') {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      message: error.message || error.toString(),
      level,
      stack: error.stack
    };
    
    this.tunnelStats.errors.push(errorRecord);
    
    // Keep only last 100 errors
    if (this.tunnelStats.errors.length > 100) {
      this.tunnelStats.errors = this.tunnelStats.errors.slice(-100);
    }
    
    debug(`Debug server: Error recorded - ${errorRecord.message}`);
  }

  recordHeartbeat() {
    this.tunnelStats.lastHeartbeat = new Date().toISOString();
    debug('Debug server: Heartbeat recorded');
  }

  // Reset all stats
  reset() {
    this.tunnelStats = {
      startTime: new Date(),
      totalConnections: 0,
      activeConnections: 0,
      errors: [],
      lastHeartbeat: null
    };
    debug('Debug server: Stats reset');
  }
}

export { DebugServer };