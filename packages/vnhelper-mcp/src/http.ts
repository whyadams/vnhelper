import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOLS } from "./tools.js";

interface HttpOptions {
  port: number;
  token: string;
  host?: string;
}

function buildMcpServer(): Server {
  const server = new Server(
    { name: "vnhelper", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, {
        target: "openApi3",
        $refStrategy: "none",
      }) as object,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const result = await tool.handler(
        (req.params.arguments ?? {}) as Record<string, unknown>,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${msg}` }],
      };
    }
  });

  return server;
}

function checkAuth(req: IncomingMessage, expected: string): boolean {
  const url = new URL(req.url ?? "", "http://localhost");
  const queryToken = url.searchParams.get("token");
  if (queryToken && safeEqual(queryToken, expected)) return true;
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    if (safeEqual(auth.slice("Bearer ".length).trim(), expected)) return true;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function startHttpServer(opts: HttpOptions): Promise<void> {
  // One transport+server per session. Streamable HTTP uses the
  // `Mcp-Session-Id` header to multiplex; we keep a map.
  const sessions = new Map<
    string,
    { server: Server; transport: StreamableHTTPServerTransport }
  >();

  const setCors = (res: ServerResponse) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader(
      "access-control-allow-methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "access-control-allow-headers",
      "content-type, authorization, mcp-session-id, mcp-protocol-version, accept, last-event-id",
    );
    res.setHeader("access-control-expose-headers", "mcp-session-id");
    res.setHeader("access-control-max-age", "86400");
  };

  const httpServer = createServer(async (req, res) => {
    const ts = new Date().toISOString();
    process.stderr.write(`[${ts}] ${req.method} ${req.url}\n`);
    try {
      setCors(res);

      const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);

      // CORS preflight — handle before auth.
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check (unauthenticated)
      if (req.method === "GET" && url.pathname === "/healthz") {
        res.setHeader("content-type", "text/plain");
        res.writeHead(200);
        res.end("ok");
        return;
      }

      if (url.pathname !== "/mcp") {
        res.setHeader("content-type", "text/plain");
        res.writeHead(404);
        res.end("not found");
        return;
      }

      if (!checkAuth(req, opts.token)) {
        process.stderr.write(`  ↳ 401 unauthorized\n`);
        res.setHeader("content-type", "text/plain");
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }

      const sessionId =
        (req.headers["mcp-session-id"] as string | undefined) ?? null;

      let entry:
        | { server: Server; transport: StreamableHTTPServerTransport }
        | undefined;

      if (sessionId && sessions.has(sessionId)) {
        entry = sessions.get(sessionId);
      } else if (req.method === "POST") {
        // First POST without session: spin up a new session.
        const newId = randomUUID();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newId,
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport });
          },
        });
        const server = buildMcpServer();
        await server.connect(transport);
        entry = { server, transport };
        sessions.set(newId, entry);
        transport.onclose = () => {
          sessions.delete(newId);
        };
      }

      if (!entry) {
        process.stderr.write(
          `  ↳ 400 session required (method=${req.method}, sid=${sessionId ?? "-"})\n`,
        );
        res.setHeader("content-type", "text/plain");
        res.writeHead(400);
        res.end("session required");
        return;
      }

      // Body collect for POST
      let body: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        body = raw ? JSON.parse(raw) : undefined;
      }
      await entry.transport.handleRequest(req, res, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`http error: ${msg}\n`);
      if (!res.headersSent) {
        res.setHeader("content-type", "text/plain");
        res.writeHead(500);
        res.end("internal error");
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(opts.port, opts.host ?? "127.0.0.1", () => resolve());
  });

  process.stderr.write(
    `vnhelper-mcp HTTP listening on http://${opts.host ?? "127.0.0.1"}:${opts.port}/mcp\n`,
  );
}

// Suppress unused warnings on the response param typing — kept for future per-request hooks.
export type _Unused = ServerResponse;
