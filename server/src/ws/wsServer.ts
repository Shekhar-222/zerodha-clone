import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { tickerEvents, Tick } from "../kite/ticker";
import { orderEvents } from "../services/ordersService";

export function attachWsServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  function broadcast(payload: unknown) {
    const message = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  tickerEvents.on("ticks", (ticks: Tick[]) => {
    broadcast({ type: "ticks", data: ticks });
  });

  orderEvents.on("fill", (order) => {
    broadcast({ type: "order_fill", data: order });
  });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected" }));
  });

  return wss;
}
