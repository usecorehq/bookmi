import type { NextFunction, Request, Response } from "express";
import type { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";

/**
 * HTTP Basic Auth in front of Bull Board (@bull-board/nestjs mounts a raw
 * Express router that skips Nest guards entirely, so we protect it here).
 *
 * If BULL_BOARD_USER / BULL_BOARD_PASS aren't set, the route responds 404 —
 * safer than leaking an unauthenticated dashboard into prod by accident.
 * Bookmi's dev docker-compose omits them by default; set both to enable.
 */
export function createBullBoardBasicAuthMiddleware(config: ConfigService) {
  const user = config.get<string>("bullBoard.user") ?? "";
  const pass = config.get<string>("bullBoard.pass") ?? "";
  const disabled = !user || !pass;

  return function bullBoardBasicAuth(req: Request, res: Response, next: NextFunction) {
    if (disabled) {
      res.status(404).send("Bull Board not enabled — set BULL_BOARD_USER and BULL_BOARD_PASS.");
      return;
    }
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) return unauthorized(res);
    const decoded = Buffer.from(header.slice(6), "base64").toString();
    const idx = decoded.indexOf(":");
    if (idx < 0) return unauthorized(res);
    const suppliedUser = decoded.slice(0, idx);
    const suppliedPass = decoded.slice(idx + 1);
    if (!safeEqual(suppliedUser, user) || !safeEqual(suppliedPass, pass)) {
      return unauthorized(res);
    }
    next();
  };
}

function unauthorized(res: Response): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="bookmi bull board"');
  res.status(401).send("Unauthorized");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
