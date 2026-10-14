import http from "node:http";
import mongoose from "mongoose";
import { createApp, allowedOrigins } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { closeRedis, getRedis } from "./config/redis.js";
import { closeSocket, initSocket } from "./events/socket.js";
import { startOrchestrationWorker, stopOrchestrationWorker } from "./services/orchestration/worker.js";
import { startDispatchWorker, stopDispatchWorker } from "./services/dispatch/worker.js";

const startServer = async () => {
  await connectDb();
  getRedis(); // starts connecting if REDIS_URL is set; the API works without it

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server, allowedOrigins);

  startDispatchWorker();
  startOrchestrationWorker();

  server.listen(env.PORT, () => {
    console.log(`✅ Server started at: ${env.PORT}`);
    console.log(`✅ Allowed origins: ${allowedOrigins.join(", ")}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    stopDispatchWorker();
    await stopOrchestrationWorker();
    await closeSocket();
    await closeRedis();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

startServer().catch((error: unknown) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
