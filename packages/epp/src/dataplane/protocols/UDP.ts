import dgram from "dgram";

////
// UDP is interesting, errors coming back can slow down processing
// Also, having a connected socket helps, but if it is not connected
//   then occasional efforts should be made to reconnect
// The design of this sender is:
//   Top level sets the address
//   Top level does attempt to connect...
//     this is a fair starting point but not the be-all / end-all;
//   Top level issues sends - we deliver those as we can
//     After the sends are called, top level gets a batch object
//     This can be awaited

export type SendBatch =  {
    sender: UdpClient,
    batchClosed: boolean,
    nSent: number,
    nSCBs: number,
    nECBs: number,
    err?: unknown,
    promise: Promise<void>,
    resolve: ()=>void,
    reject: (err: unknown)=>void, // Not used
    cb?: ((err: Error | null, bytes: number)=>void),
    isComplete: ()=>boolean,
  };

export class UdpClient {
  readonly type: "udp4" | "udp6" = "udp4";
  readonly address: string;
  readonly port: number;
  readonly sendBufSize?: number;

  private socket: dgram.Socket | undefined;
  private _isConnected = false;
  private _connAttemptInProgress = false;
  private _suspended = false;

  // Global counters
  nSent: number = 0;
  bytesSent: number = 0;
  nSkipped: number = 0;
  nErrors: number = 0;
  lastError: string| undefined = undefined;

  resetStats() {
    this.nSent = 0;
    this.bytesSent = 0;
    this.nSkipped = 0;
    this.nErrors = 0;
    this.lastError = "";
  }

  getStats() {
    return {
      isConnected: this._isConnected,
      nSent: this.nSent,
      bytesSent: this.bytesSent,
      nErrors: this.nErrors,
      lastError: this.lastError,
    }
  }

  constructor(type: "udp4" | "udp6", address: string, port: number, sendBufSize?: number) {
    this.type = type;
    this.address = address;
    this.sendBufSize = sendBufSize;
    this.port = port;
  }

  isConnected() { return this._isConnected; }

  suspend() { this._suspended = true; }
  resume() { this._suspended = false; }

  /**
   * Resolves a hostname and connects the socket.
   */
  async connect(): Promise<void> {
    if (this._connAttemptInProgress) return;
    if (this._isConnected) return;
    try {
      this._connAttemptInProgress = true;
      this.socket = dgram.createSocket(this.type);

      if (this.sendBufSize) {
        try {
          this.socket.setSendBufferSize(this.sendBufSize);
        }
        catch (e) {
          const err = e as Error;
          this.lastError = err.message;
        }
      }

      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          this.socket?.off("connect", onConnect); // Cleanup listeners
          this.lastError = err.message;
          reject(err);
        };

        const onConnect = () => {
          this.socket?.off("error", onError); // Cleanup listeners
          this._isConnected = true;
          this.lastError = undefined;
          this._connAttemptInProgress = false;
          resolve();
        };

        this.socket?.once("error", onError); // Handle errors
        this.socket?.once("connect", onConnect); // Handle successful connection

        this.socket?.connect(this.port, this.address);
      });
    } catch (e) {
      const error = e as Error;
      this.lastError = error.message;
      throw error;
    }
    finally {
      this._connAttemptInProgress = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this._connAttemptInProgress) return;
    this._connAttemptInProgress = true;
    if (!this._isConnected) return;
    await this.close();
    this.socket = undefined;
    this._isConnected = false;
    this._connAttemptInProgress = false;
  }

  private sendBatch: SendBatch | undefined;

  startSendBatch() {
    if (this.sendBatch) throw new Error("Already sending");
    let resolve: ()=>void = ()=>{};
    let reject: (err: unknown)=>void = ()=>{};
    let p = new Promise<void>((res: ()=>void, rej)=>{resolve = res; reject = rej});

    const sendBatch: SendBatch = {
      sender: this,
      batchClosed: false,
      nSent: 0,
      nSCBs: 0,
      nECBs: 0,
      promise: p,
      reject,
      resolve,
      cb: undefined,
      isComplete: ()=>false,
    }
    sendBatch.cb = (err: Error | null, _bytes: number)=>{
      if (err) {
        sendBatch.err = err;
        ++sendBatch.nECBs;
      }
      else {
        ++sendBatch.nSCBs;
      }
      if (sendBatch.batchClosed && sendBatch.nSCBs + sendBatch.nECBs === sendBatch.nSent) sendBatch.resolve();
    }
    sendBatch.isComplete = ()=> sendBatch.batchClosed && sendBatch.nSCBs + sendBatch.nECBs === sendBatch.nSent;
    this.sendBatch = sendBatch;
  }
  endSendBatch() {
    const sb = this.sendBatch;
    if (!sb) return sb;
    sb.batchClosed = true;
    if (sb.isComplete()) sb.resolve();
    this.sendBatch = undefined;
    return sb;
  }

  /**
   * Adds a UDP packet to the batch
   *  Note that `data` must be kept valid until batch end
   */
  addSendToBatch(data: Uint8Array | Uint8Array[]): void {
    if (this._suspended || !this.sendBatch || this._connAttemptInProgress || !this._isConnected || !this.socket) return;
    ++this.sendBatch.nSent;
    this.countSend(data);
    this.socket.send(data, this.sendBatch.cb!)
  }

  private countSend(data: Uint8Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike>[]) {
    ++this.nSent;
    if (Array.isArray(data)) {
      for (const d of data) this.bytesSent += data.length;
    }
    else {
      this.bytesSent += data.length;
    }
  }

  /**
   * Sends a UDP packet - stored connection info
   */
  send(data: Uint8Array | Uint8Array[]): Promise<number> {
    if (this._suspended || this._connAttemptInProgress || !this._isConnected || !this.socket) return Promise.resolve(0);
    this.countSend(data);
    return new Promise((resolve, reject) => {
      if (this._isConnected && this.socket) {
        this.socket.send(data, (err, bytes) => (err ? reject(err) : resolve(bytes)));
      } else {
        reject(new Error("Socket not connected."));
      }
    });
  }

/**
   * Closes the socket gracefully.
   */
  private close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.close(() => {
          this._isConnected = false;
          resolve();
        });
      }
      else {
        this._isConnected = false;
        resolve();
      }
    });
  }
}
