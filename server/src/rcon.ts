import { Socket } from "node:net";

export interface RconConfig {
  host: string;
  port: number;
  password: string;
}

const AUTH = 3;
const EXEC = 2;
const AUTH_RESPONSE = 2;

const packet = (id: number, type: number, body: string) => {
  const payload = Buffer.from(body, "utf8");
  const buffer = Buffer.alloc(14 + payload.length);
  buffer.writeInt32LE(10 + payload.length, 0);
  buffer.writeInt32LE(id, 4);
  buffer.writeInt32LE(type, 8);
  payload.copy(buffer, 12);
  return buffer;
};

export const sendRconCommand = (config: RconConfig, command: string, timeoutMs = 8000): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffered = Buffer.alloc(0);
    let authenticated = false;
    let output = "";
    let settleTimer: NodeJS.Timeout | undefined;

    const finish = (error?: Error) => {
      clearTimeout(timer);
      clearTimeout(settleTimer);
      socket.destroy();
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => (authenticated ? finish() : finish(new Error("RCON timeout"))), timeoutMs);

    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const size = buffered.readInt32LE(0);
        if (buffered.length < size + 4) break;
        const id = buffered.readInt32LE(4);
        const type = buffered.readInt32LE(8);
        const body = buffered.toString("utf8", 12, size + 2);
        buffered = buffered.subarray(size + 4);
        if (!authenticated && type === AUTH_RESPONSE) {
          if (id === -1) return finish(new Error("RCON authentication failed"));
          authenticated = true;
          socket.write(packet(2, EXEC, command));
          settleTimer = setTimeout(() => finish(), 1500);
        } else if (authenticated && id === 2) {
          output += body;
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => finish(), 400);
        }
      }
    });
    socket.connect(config.port, config.host, () => socket.write(packet(1, AUTH, config.password)));
  });

export const quoteArg = (value: string) => {
  if (/["\r\n;]/.test(value)) throw new Error("Unsafe RCON argument");
  return `"${value}"`;
};
