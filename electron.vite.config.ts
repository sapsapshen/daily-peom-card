import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const runtimeRoot = resolve(".daily_runtime");

const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
};

const serveRuntimeAssets = () => ({
  name: "serve-runtime-assets",
  configureServer(server: { middlewares: { use: (path: string, handler: (req: { url?: string; method?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (chunk?: string) => void }) => void | Promise<void>) => void } }) {
    const attachRuntimeMiddleware = (middlewareServer: typeof server) => {
      middlewareServer.middlewares.use("/__daily_runtime", async (req, res) => {
        const requestedPath = decodeURIComponent(req.url ?? "/");
        const targetPath = normalize(resolve(runtimeRoot, `.${requestedPath}`));
        if (!targetPath.startsWith(runtimeRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        try {
          await access(targetPath);
        } catch {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        res.statusCode = 200;
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Content-Type", mimeTypes[extname(targetPath).toLowerCase()] ?? "application/octet-stream");

        if (req.method === "HEAD") {
          res.end();
          return;
        }

        createReadStream(targetPath).pipe(res as never);
      });
    };

    attachRuntimeMiddleware(server);
  },
  configurePreviewServer(server: { middlewares: { use: (path: string, handler: (req: { url?: string; method?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (chunk?: string) => void }) => void | Promise<void>) => void } }) {
    const attachRuntimeMiddleware = (middlewareServer: typeof server) => {
      middlewareServer.middlewares.use("/__daily_runtime", async (req, res) => {
        const requestedPath = decodeURIComponent(req.url ?? "/");
        const targetPath = normalize(resolve(runtimeRoot, `.${requestedPath}`));
        if (!targetPath.startsWith(runtimeRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        try {
          await access(targetPath);
        } catch {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        res.statusCode = 200;
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Content-Type", mimeTypes[extname(targetPath).toLowerCase()] ?? "application/octet-stream");

        if (req.method === "HEAD") {
          res.end();
          return;
        }

        createReadStream(targetPath).pipe(res as never);
      });
    };

    attachRuntimeMiddleware(server);
  },
});

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), serveRuntimeAssets()],
    build: {
      outDir: "out/renderer",
    },
  },
});