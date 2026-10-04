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
  private nextRequest = 1;
  private readonly pendingSaves = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

  private constructor(
    readonly worker: Worker,
    /** IndexedDB world id when the world is saved, null for a transient world. */
    readonly worldId: string | null,
  ) {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'saved') {
        const p = this.pendingSaves.get(m.id);
        this.pendingSaves.delete(m.id);
        if (m.error) p?.reject(new Error(m.error));
        else p?.resolve();
      } else if (m.type === 'packet') {
        this.transports.get(m.conn)?.onMessage?.(m.data);
        this.remotes.get(m.conn)?.(m.data);
      } else if (m.type === 'kick') {
        this.transports.get(m.conn)?.onClose?.(m.reason);
        this.remoteClosers.get(m.conn)?.(m.reason);
      }
    };
  }

  static async start(seed: bigint, scene = '', gameMode = 0, world: string | null = null): Promise<IntegratedServer> {
    const worker = new Worker(new URL('../server.worker.ts', import.meta.url), { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'started') resolve();
        else if (e.data.type === 'error') reject(new Error(e.data.message));
      };
      worker.postMessage({ type: 'start', seed: seed.toString(), scene, gameMode, world: world ?? undefined });
    });
    return new IntegratedServer(worker, world);
  }

  private request(type: 'save' | 'stop'): Promise<void> {
    const id = this.nextRequest++;
    return new Promise<void>((resolve, reject) => {
      this.pendingSaves.set(id, { resolve, reject });
      this.worker.postMessage({ type, id });
    });
  }

  /** Save the world now (no-op for a transient world). */
  save(): Promise<void> {
    return this.request('save');
  }

  /** Stop the server and save; resolves when the world is written. */
  saveAndStop(): Promise<void> {
    return this.request('stop');
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
export async function startIntegratedServer(seed: bigint, scene = '', gameMode = 0, world: string | null = null): Promise<{ server: IntegratedServer; transport: LocalTransport }> {
  const server = await IntegratedServer.start(seed, scene, gameMode, world);
  return { server, transport: server.local() };
}
