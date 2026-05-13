import cors from 'cors';
import express from 'express';
import path from 'path';
import { __dirname } from './config.js';

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="VidClaw"');
  res.status(401).send('Authentication required');
}

function isValidBasicAuth(header) {
  const user = process.env.VIDCLAW_AUTH_USER;
  const password = process.env.VIDCLAW_AUTH_PASSWORD;
  if (!user && !password) return true;
  if (!user || !password) return false;
  if (!header?.startsWith('Basic ')) return false;

  let decoded;
  try {
    decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  } catch {
    return false;
  }

  const separator = decoded.indexOf(':');
  if (separator === -1) return false;
  const inputUser = decoded.slice(0, separator);
  const inputPassword = decoded.slice(separator + 1);
  return inputUser === user && inputPassword === password;
}

export function setupMiddleware(app) {
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    if (isValidBasicAuth(req.headers.authorization)) return next();
    unauthorized(res);
  });
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'dist')));
}
