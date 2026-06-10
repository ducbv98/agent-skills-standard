import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import dotenv from "dotenv";
import { createJob, getJob, listJobs, subscribeJob, onJobEnd } from "./jobs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env ở repo root — walk up 3 cấp từ src/ hoặc dist/
const rootEnv = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config();
}

// public dir nằm cạnh src (khi run dev) hoặc ngang dist (khi run built)
const publicDirs = [
  path.resolve(__dirname, "../public"),
  path.resolve(__dirname, "../../public"),
];
const publicDir = publicDirs.find((p) => fs.existsSync(p));
if (!publicDir) {
  throw new Error(`Không tìm thấy thư mục public ở: ${publicDirs.join(", ")}`);
}

const app = Fastify({ logger: { level: "info" } });

await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/",
});

// === API ===

app.post<{
  Body: { url?: string; removeSubs?: boolean; subsHeightRatio?: number };
}>("/api/jobs", async (req, reply) => {
  const url = req.body?.url?.trim();
  if (!url) {
    return reply.status(400).send({ error: "Missing url" });
  }
  const job = createJob(url, {
    removeSubs: req.body?.removeSubs === true,
    subsHeightRatio:
      typeof req.body?.subsHeightRatio === "number"
        ? req.body.subsHeightRatio
        : undefined,
  });
  return { id: job.id, url: job.url, status: job.status };
});

app.get("/api/jobs", async () => {
  return { jobs: listJobs() };
});

app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job) return reply.status(404).send({ error: "Job not found" });
  return job;
});

// SSE stream
app.get<{ Params: { id: string } }>("/api/jobs/:id/events", async (req, reply) => {
  const { id } = req.params;
  const job = getJob(id);
  if (!job) return reply.status(404).send({ error: "Job not found" });

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Heartbeat — giữ connection sống qua proxy/idle timeout
  const heartbeat = setInterval(() => {
    reply.raw.write(`: ping\n\n`);
  }, 15000);

  const writeEvent = (data: unknown): void => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = subscribeJob(id, writeEvent);
  if (!unsubscribe) {
    clearInterval(heartbeat);
    reply.raw.end();
    return;
  }

  const close = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
    // Gửi event cuối với job hiện tại để client biết status
    const final = getJob(id);
    if (final) {
      reply.raw.write(
        `event: end\ndata: ${JSON.stringify({
          status: final.status,
          outputFileName: final.outputFileName,
          error: final.error,
        })}\n\n`,
      );
    }
    reply.raw.end();
  };

  onJobEnd(id, close);
  req.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Serve output mp4
app.get<{ Params: { id: string } }>("/api/jobs/:id/video", async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job || !job.outputPath) {
    return reply.status(404).send({ error: "Video chưa sẵn sàng" });
  }
  if (!fs.existsSync(job.outputPath)) {
    return reply.status(404).send({ error: "Output file đã bị xóa" });
  }
  return reply.type("video/mp4").send(fs.createReadStream(job.outputPath));
});

const PORT = Number(process.env.WEB_PORT ?? 3000);
const HOST = process.env.WEB_HOST ?? "127.0.0.1";

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`🎬 Viet Dubber UI → http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
