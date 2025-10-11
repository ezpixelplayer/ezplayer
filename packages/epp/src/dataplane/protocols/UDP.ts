import dgram from "dgram";

export class UdpClient {
  private socket: dgram.Socket;
  private _isConnected = false;
  address: string;
  port: number;

  lastError: string = "";

  constructor(type: "udp4" | "udp6" = "udp4", address: string, port: number, sendBufSize ?: number) {
    this.address = address;
    this.port = port;
    this.socket = dgram.createSocket(type);

    if (sendBufSize) {
      try {
        this.socket.setSendBufferSize(sendBufSize);
      }
      catch (e) {
        const err = e as Error;
        this.lastError = err.message;
      }
    }
  }

  isConnected() {return this._isConnected;}

  /**
   * Resolves a hostname and connects the socket.
   */
  async connect(): Promise<void> {
    try {
      return new Promise((resolve, reject) => {
        const onError = (err: Error) => {
          this.socket.off("connect", onConnect); // Cleanup listeners
          this.lastError = err.message;
          reject(err);
        };

        const onConnect = () => {
          this.socket.off("error", onError); // Cleanup listeners
          this._isConnected = true;
          resolve();
        };

        this.socket.once("error", onError); // Handle errors
        this.socket.once("connect", onConnect); // Handle successful connection

        this.socket.connect(this.port, this.address);
      });
    } catch (e) {
      const error = e as Error;
      this.lastError = error.message;
      throw error;
    }
  }

  /**
   * Sends a UDP packet - stored connection info
   */
  send(data: Uint8Array | Uint8Array[]): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this._isConnected) {
        this.socket.send(data, (err, bytes) => (err ? reject(err) : resolve(bytes)));
      } else {
        reject(new Error("Socket not connected."));
      }
    });
  }

  /**
   * Sends a UDP packet - direct connection info
   */
  sendOne(data: Uint8Array | Uint8Array[], port: number, address: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this._isConnected) {
        this.socket.send(data, port, address, (err, bytes) => (err ? reject(err) : resolve(bytes)));
      } else {
        reject(new Error("Socket has been given connection details."));
      }
    });
  }

  /**
   * Closes the socket gracefully.
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.close(() => {
        this._isConnected = false;
        resolve();
      });
    });
  }
}
