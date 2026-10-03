/** Client-side transport abstraction: local worker, WebSocket, or WebRTC data channel. */
export interface ClientTransport {
  send(data: ArrayBuffer): void;
  onMessage: ((data: ArrayBuffer) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(): void;
}

/** Connection to the in-browser server worker (single-player / LAN host). */
export class LocalTransport implements ClientTransport {
  onMessage: ((data: ArrayBuffer) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  constructor(
    private worker: Worker,
    readonly connId: number,
  ) {}
  send(data: ArrayBuffer): void {
    this.worker.postMessage({ type: 'packet', conn: this.connId, data }, [data]);
  }
  close(): void {
    this.worker.postMessage({ type: 'close', conn: this.connId });
  }
}

/**
 * The integrated server running in a worker. The local player is connection 0; LAN guests
 * (WebRTC data channels) are added as further connections.
 */
export class IntegratedServer {
  private nextConn = 1;
  private readonly transports = new Map<number, LocalTransport>();
  private readonly remotes = new Map<number, (data: ArrayBuffer) => void>();
  private readonly remoteClosers = new Map<number, (reason: string) => void>();

  private constructor(readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'packet') {
        this.transports.get(m.conn)?.onMessage?.(m.data);
        this.remotes.get(m.conn)?.(m.data);
      } else if (m.type === 'kick') {
        this.transports.get(m.conn)?.onClose?.(m.reason);
        this.remoteClosers.get(m.conn)?.(m.reason);
      }
    };
  }

  static async start(seed: bigint, scene = ''): Promise<IntegratedServer> {
    const worker = new Worker(new URL('../server.worker.ts', import.meta.url), { type: 'module' });
    await new Promise<void>((resolve) => {
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'started') resolve();
      };
      worker.postMessage({ type: 'start', seed: seed.toString(), scene });
    });
    return new IntegratedServer(worker);
  }

  /** Connection for the player on this machine. */
  local(): LocalTransport {
    const t = new LocalTransport(this.worker, 0);
    this.transports.set(0, t);
    this.worker.postMessage({ type: 'open', conn: 0 });
    return t;
  }

  /**
   * Attach a remote player (e.g. a WebRTC data channel). `send` delivers server packets to
   * them; the returned functions feed their packets in and report disconnects.
   */
  addRemote(send: (data: ArrayBuffer) => void, onKick: (reason: string) => void): { receive: (data: ArrayBuffer) => void; close: () => void } {
    const id = this.nextConn++;
    this.remotes.set(id, send);
    this.remoteClosers.set(id, onKick);
    this.worker.postMessage({ type: 'open', conn: id });
    return {
      receive: (data) => this.worker.postMessage({ type: 'packet', conn: id, data }, [data]),
      close: () => {
        this.worker.postMessage({ type: 'close', conn: id });
        this.remotes.delete(id);
        this.remoteClosers.delete(id);
      },
    };
  }
}

/** Starts the integrated server worker and returns a transport for the local player. */
export async function startIntegratedServer(seed: bigint, scene = ''): Promise<{ server: IntegratedServer; transport: LocalTransport }> {
  const server = await IntegratedServer.start(seed, scene);
  return { server, transport: server.local() };
}
