import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import { offlineShell } from "./build/offlineShell.js";

const webRoot = import.meta.dirname;
const repositoryRoot = resolve(webRoot, "../..");
const archiveSpecPath = resolve(webRoot, "asset-archive-spec.md");
const codeModApiPath = resolve(repositoryRoot, "docs/code-mod-api.md");
const webAppManifestPath = resolve(webRoot, "app.webmanifest");
const gameProxyPort = process.env["DIB_GAME_PROXY_PORT"] ?? "8788";
const gameProxyTarget = `http://127.0.0.1:${gameProxyPort}`;
const localDownloadPaths = new Map<string, string>();


export default defineConfig(({ command }) => ({
  publicDir: false,
  plugins: [webAppShellResources(), assetArchiveResources(), offlineShell(), ...(command === "serve" ? [developmentCsp()] : [])],
  server: {
    proxy: {
      "/api/game": {
        target: gameProxyTarget,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest) => {
            // The browser request is same-origin with Vite. Do not turn the internal hop to the
            // loopback game service into a synthetic cross-origin request; direct cross-origin
            // clients still pass through the game server's exact allowlist.
            proxyRequest.removeHeader("origin");
          });
        },
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(webRoot, "index.html"),
        moddingGuide: resolve(webRoot, "modding.html"),
      },
    },
  },
}));

/** Stable root URLs are required by installed web apps; publicDir remains disabled so this emits
 * only the two reviewed engine-shell resources instead of opening a path for packaged content. */
function webAppShellResources(): Plugin {
  const resources = new Map([
    ["/app.webmanifest", { path: webAppManifestPath, contentType: "application/manifest+json" }],
    ["/app-icon-192.png", { path: resolve(webRoot, "app-icon-192.png"), contentType: "image/png" }],
    ["/app-icon-512.png", { path: resolve(webRoot, "app-icon-512.png"), contentType: "image/png" }],
    [
      "/app-icon-maskable-512.png",
      { path: resolve(webRoot, "app-icon-maskable-512.png"), contentType: "image/png" },
    ],
    [
      "/apple-touch-icon.png",
      { path: resolve(webRoot, "apple-touch-icon.png"), contentType: "image/png" },
    ],
    ["/favicon-32.png", { path: resolve(webRoot, "favicon-32.png"), contentType: "image/png" }],
  ]);
  return {
    name: "web-app-shell-resources",
    // Inject after Vite's asset pass so the stable manifest URL is not rewritten to a hashed
    // assets/ location. Manifest start_url, scope, and icon URLs are intentionally relative to
    // this stable root document.
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const icon = {
          tag: "link",
          attrs: { rel: "icon", type: "image/png", sizes: "32x32", href: "./favicon-32.png" },
          injectTo: "head",
        } as const;
        // The modding guide shares the stable favicon; a literal <link> in its markup would be
        // hashed into assets/ and rejected by check-content-boundary's exact-path PNG allowlist.
        if (context.path === "/modding.html") return [icon];
        if (context.path !== "/index.html") return [];
        return [
          {
            tag: "link",
            attrs: { rel: "manifest", href: "./app.webmanifest" },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: { rel: "icon", type: "image/png", sizes: "32x32", href: "./favicon-32.png" },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: { rel: "apple-touch-icon", sizes: "180x180", href: "./apple-touch-icon.png" },
            injectTo: "head",
          },
        ];
      },
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://engine-shell.local").pathname;
        const resource = resources.get(pathname);
        if (resource === undefined) {
          next();
          return;
        }
        void readFile(resource.path)
          .then((bytes) => {
            response.statusCode = 200;
            response.setHeader("Content-Type", resource.contentType);
            response.setHeader("Content-Length", String(bytes.byteLength));
            response.end(bytes);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      for (const [url, resource] of resources) {
        this.emitFile({
          type: "asset",
          fileName: url.slice(1),
          source: await readFile(resource.path),
        });
      }
    },
  };
}

/** The Markdown contract is part of the engine documentation. The example binaries remain outside
 * the Vite build and are only exposed by local development/preview servers; a deployment can
 * publish the same download paths from separate release storage. */
function assetArchiveResources(): Plugin {
  return {
    name: "asset-archive-resources",
    configureServer(server) {
      installAssetArchiveRoutes(server);
    },
    configurePreviewServer(server) {
      installAssetArchiveRoutes(server);
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "asset-archive-spec.md",
        source: await readFile(archiveSpecPath),
      });
      this.emitFile({
        type: "asset",
        fileName: "code-mod-api.md",
        source: await readFile(codeModApiPath),
      });
    },
  };
}

function installAssetArchiveRoutes(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://asset-archive.local").pathname;
    const localDownload = localDownloadPaths.get(pathname);
    const resourcePath = pathname === "/asset-archive-spec.md" ? archiveSpecPath
      : pathname === "/code-mod-api.md" ? codeModApiPath : localDownload;
    if (!resourcePath) {
      next();
      return;
    }

    // Availability probes must not read the separately published archives into memory.
    const payload = request.method === "HEAD"
      ? stat(resourcePath).then((info) => ({ size: info.size, bytes: undefined }))
      : readFile(resourcePath).then((bytes) => ({ size: bytes.byteLength, bytes }));
    void payload
      .then(({ size, bytes }) => {
        const isMarkdown = pathname.endsWith(".md");
        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          isMarkdown ? "text/markdown; charset=utf-8" : "application/zip",
        );
        if (!isMarkdown) {
          response.setHeader(
            "Content-Disposition",
            `attachment; filename="${pathname.slice(pathname.lastIndexOf("/") + 1)}"`,
          );
        }
        response.setHeader("Content-Length", String(size));
        response.end(bytes);
      })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("This separately published Asset Archive download is not available on this host.\n");
          return;
        }
        next(error);
      });
  });
}

/** Vite HMR needs a same-origin websocket in local development. Production keeps the stricter
 * `connect-src blob: data:` policy from index.html: `data:` is required only for Pixi's
 * image-decoder worker capability probe, while HTTP(S), websocket, and beacon upload destinations
 * remain blocked at the document boundary. */
function developmentCsp(): Plugin {
  return {
    name: "local-content-development-csp",
    transformIndexHtml(html) {
      return html
        .replace("connect-src 'self' blob: data:", "connect-src 'self' blob: data: ws:")
        .replace("connect-src 'none'", "connect-src 'self' ws:");
    },
  };
}
