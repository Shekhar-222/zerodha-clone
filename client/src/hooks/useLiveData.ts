import { useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";

type Tick = { instrument_token: number; last_price: number };

export function useLiveData(onFill?: (order: unknown) => void) {
  const [ltpByToken, setLtpByToken] = useState<Record<number, number>>({});
  const onFillRef = useRef(onFill);
  onFillRef.current = onFill;

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      socket = new WebSocket(WS_URL);

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ticks") {
            const ticks = msg.data as Tick[];
            setLtpByToken((prev) => {
              const next = { ...prev };
              for (const tick of ticks) next[tick.instrument_token] = tick.last_price;
              return next;
            });
          } else if (msg.type === "order_fill") {
            onFillRef.current?.(msg.data);
          }
        } catch {
          // ignore malformed messages
        }
      };

      socket.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { ltpByToken };
}
