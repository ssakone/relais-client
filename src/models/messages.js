// Structure des messages pour la communication avec le serveur
export class TunnelRequest {
  constructor(command, localPort, domain, remotePort, token, protocol) {
    this.command = command;
    this.local_port = localPort;
    this.domain = domain || "";
    this.remote_port = remotePort || "";
    this.token = token;
    this.protocol = protocol || "http";
  }
}

export class TunnelResponse {
  constructor(status, publicAddr, error) {
    this.status = status;
    this.public_addr = publicAddr;
    this.error = error || "";
  }
}

export class NewConnectionMsg {
  constructor(command, connId, dataAddr) {
    this.command = command;
    this.conn_id = connId;
    this.data_addr = dataAddr;
  }
}

export class HeartbeatMsg {
  constructor() {
    this.command = "HEARTBEAT";
  }
}
