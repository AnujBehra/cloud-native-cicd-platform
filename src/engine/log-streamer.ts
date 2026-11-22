import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { Response } from 'express';
import { StageName, LogMessage } from '../types/index.js';

export class LogStreamer extends EventEmitter {
  private static instance: LogStreamer;
  private wsClients: Map<string, Set<WebSocket>> = new Map(); // pipelineRunId -> Set<WebSocket>
  private sseClients: Map<string, Set<Response>> = new Map(); // pipelineRunId -> Set<Response>
  private logBuffers: Map<string, LogMessage[]> = new Map(); // pipelineRunId -> messages

  private constructor() {
    super();
  }

  public static getInstance(): LogStreamer {
    if (!LogStreamer.instance) {
      LogStreamer.instance = new LogStreamer();
    }
    return LogStreamer.instance;
  }

  public registerWebSocket(pipelineRunId: string, ws: WebSocket): void {
    if (!this.wsClients.has(pipelineRunId)) {
      this.wsClients.set(pipelineRunId, new Set());
    }
    this.wsClients.get(pipelineRunId)!.add(ws);

    // Send buffered history
    const history = this.logBuffers.get(pipelineRunId) || [];
    for (const msg of history) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'log', data: msg }));
      }
    }

    ws.on('close', () => {
      this.wsClients.get(pipelineRunId)?.delete(ws);
    });
  }

  public registerSSE(pipelineRunId: string, res: Response): void {
    if (!this.sseClients.has(pipelineRunId)) {
      this.sseClients.set(pipelineRunId, new Set());
    }
    this.sseClients.get(pipelineRunId)!.add(res);

    // Send buffered history
    const history = this.logBuffers.get(pipelineRunId) || [];
    for (const msg of history) {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    }

    res.on('close', () => {
      this.sseClients.get(pipelineRunId)?.delete(res);
    });
  }

  public appendLog(pipelineRunId: string, stageName: StageName, message: string, level: 'info' | 'warn' | 'error' | 'success' | 'debug' = 'info'): void {
    const logItem: LogMessage = {
      pipelineRunId,
      stageName,
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    // Buffer in memory
    if (!this.logBuffers.has(pipelineRunId)) {
      this.logBuffers.set(pipelineRunId, []);
    }
    this.logBuffers.get(pipelineRunId)!.push(logItem);

    // Emit event
    this.emit('log', logItem);

    // Broadcast to WebSockets
    const clients = this.wsClients.get(pipelineRunId);
    if (clients) {
      const payload = JSON.stringify({ type: 'log', data: logItem });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }

    // Broadcast to SSE
    const sseSet = this.sseClients.get(pipelineRunId);
    if (sseSet) {
      const ssePayload = `data: ${JSON.stringify(logItem)}\n\n`;
      for (const res of sseSet) {
        res.write(ssePayload);
      }
    }
  }

  public broadcastStatus(pipelineRunId: string, data: any): void {
    const clients = this.wsClients.get(pipelineRunId);
    if (clients) {
      const payload = JSON.stringify({ type: 'status_change', data });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }

    const sseSet = this.sseClients.get(pipelineRunId);
    if (sseSet) {
      const ssePayload = `event: status_change\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of sseSet) {
        res.write(ssePayload);
      }
    }
  }

  public getLogs(pipelineRunId: string): LogMessage[] {
    return this.logBuffers.get(pipelineRunId) || [];
  }
}
