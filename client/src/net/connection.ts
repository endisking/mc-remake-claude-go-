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

/** Starts the integrated server worker and returns a transport for the local player. */
export async function startIntegratedServer(seed: bigint): Promise<{ worker: Worker; transport: LocalTransport }> {
  const worker = new Worker(new URL('../server.worker.ts', import.meta.url), { type: 'module' });
  const transports = new Map<number, LocalTransport>();
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'packet') transports.get(m.conn)?.onMessage?.(m.data);
    else if (m.type === 'kick') transports.get(m.conn)?.onClose?.(m.reason);
  };
  await new Promise<void>((resolve) => {
    const prev = worker.onmessage!;
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'started') {
        worker.onmessage = prev;
        resolve();
      } else prev.call(worker, e);
    };
    worker.postMessage({ type: 'start', seed: seed.toString() });
  });
  const transport = new LocalTransport(worker, 0);
  transports.set(0, transport);
  worker.postMessage({ type: 'open', conn: 0 });
  return { worker, transport };
}
