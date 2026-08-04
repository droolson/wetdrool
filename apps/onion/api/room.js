/**
 * JS-free sealed room: GET renders HTML; POST text or multipart media.
 * Vercel Serverless Function (Node).
 */

import { Buffer } from 'node:buffer';
import { layout, esc } from '../lib/html.mjs';
import { normalizeRoomId, openEnvelope, sealMedia, sealText } from '../lib/seal.mjs';
import { appendMessage, listMessages } from '../lib/store.mjs';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_MEDIA = 3_500_000;

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const sep = Buffer.from(`--${boundary}`);
  let start = buf.indexOf(sep) + sep.length;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headers = buf.slice(start, headerEnd).toString('utf8');
    const next = buf.indexOf(sep, headerEnd + 4);
    const end = next < 0 ? buf.length : next - 2; // strip trailing CRLF
    const body = buf.slice(headerEnd + 4, end);
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
    parts.push({
      name: nameMatch?.[1] || '',
      filename: fileMatch?.[1] || '',
      contentType: typeMatch?.[1]?.trim() || 'application/octet-stream',
      body,
    });
    start = next < 0 ? buf.length : next + sep.length;
  }
  return parts;
}

function parseUrlEncoded(buf) {
  const params = new URLSearchParams(buf.toString('utf8'));
  const o = {};
  for (const [k, v] of params.entries()) o[k] = v;
  return o;
}

function mediaKind(ct, filename) {
  const c = (ct || '').toLowerCase();
  const f = (filename || '').toLowerCase();
  if (c.includes('gif') || f.endsWith('.gif')) return 'gif';
  if (c.startsWith('video/')) return 'video';
  if (c.startsWith('image/')) return 'image';
  return 'media';
}

function renderRoom(roomId, pass, flash) {
  const sealed = listMessages(roomId);
  const items = [];
  for (const env of [...sealed].reverse()) {
    let inner = `<p class="locked">[ciphertext · unlock with passphrase]</p>`;
    if (pass) {
      try {
        const opened = openEnvelope(pass, env);
        if (env.kind === 'text' || env.contentType.startsWith('text/')) {
          inner = `<div class="body">${esc(opened.bytes.toString('utf8'))}</div>`;
        } else if (env.kind === 'image' || env.kind === 'gif' || env.contentType.startsWith('image/')) {
          const b64 = opened.bytes.toString('base64');
          inner = `<img src="data:${esc(env.contentType)};base64,${b64}" alt="">`;
        } else if (env.kind === 'video' || env.contentType.startsWith('video/')) {
          const b64 = opened.bytes.toString('base64');
          inner = `<video controls playsinline src="data:${esc(env.contentType)};base64,${b64}"></video>`;
        } else {
          inner = `<div class="body">[binary ${esc(env.contentType)} · ${opened.bytes.length} bytes]</div>`;
        }
      } catch {
        inner = `<p class="locked">decrypt failed</p>`;
      }
    }
    items.push(
      `<li><div class="meta"><span>${esc(env.kind || 'msg')}</span><time>${esc(env.createdAt)}</time></div>${inner}</li>`,
    );
  }

  const body = `
  <h1>#${esc(roomId)}</h1>
  <p class="note">JS-free sealed room · AES-256-GCM · passphrase not stored · max ~3.5MB media</p>

  <div class="card stack">
    <h2>Unlock / refresh</h2>
    <form class="stack" method="get" action="/room">
      <input type="hidden" name="room" value="${esc(roomId)}">
      <label>Passphrase
        <input type="password" name="pass" value="${esc(pass || '')}" autocomplete="off">
      </label>
      <button type="submit">Show decrypted feed</button>
    </form>
  </div>

  <ul class="feed">${items.join('') || '<li><div class="body locked">No messages yet.</div></li>'}</ul>

  <div class="card stack">
    <h2>Post text (sealed)</h2>
    <form class="stack" method="post" action="/room" accept-charset="utf-8">
      <input type="hidden" name="room" value="${esc(roomId)}">
      <input type="hidden" name="action" value="text">
      <label>Passphrase
        <input type="password" name="pass" required autocomplete="off">
      </label>
      <label>Message
        <textarea name="text" rows="3" required maxlength="8000"></textarea>
      </label>
      <button type="submit">Seal &amp; post</button>
    </form>
  </div>

  <div class="card stack">
    <h2>Share img / GIF / video (sealed)</h2>
    <form class="stack" method="post" action="/room" enctype="multipart/form-data">
      <input type="hidden" name="room" value="${esc(roomId)}">
      <input type="hidden" name="action" value="media">
      <label>Passphrase
        <input type="password" name="pass" required autocomplete="off">
      </label>
      <label>Caption (optional)
        <input type="text" name="caption" maxlength="500" autocomplete="off">
      </label>
      <label>File
        <input type="file" name="file" accept="image/*,video/*,.gif" required>
      </label>
      <button type="submit">Seal &amp; share media</button>
    </form>
    <p class="warn">Large videos over ~3.5MB will be rejected in this alpha.</p>
  </div>

  <nav class="links">
    <a href="/">home</a>
    <a href="/room?room=lobby">lobby</a>
    <a href="/room?room=shorts">shorts</a>
    <a href="https://wetdrool.com/rooms/${esc(roomId)}">clearnet JS E2EE room</a>
  </nav>
  `;

  return layout({ title: `#${roomId}`, body, flash });
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self' data:; style-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://local');
      const roomId = normalizeRoomId(url.searchParams.get('room') || 'lobby');
      if (!roomId) {
        res.statusCode = 400;
        res.end(layout({ title: 'Error', body: '<p>Invalid room id.</p>', flash: null }));
        return;
      }
      const pass = url.searchParams.get('pass') || '';
      res.statusCode = 200;
      res.end(renderRoom(roomId, pass, null));
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return;
    }

    const ctype = String(req.headers['content-type'] || '');
    const raw = await readRawBody(req);
    let room = 'lobby';
    let pass = '';
    let action = 'text';
    let text = '';
    let caption = '';
    let filePart = null;

    if (ctype.includes('multipart/form-data')) {
      const m = /boundary=(.+)$/i.exec(ctype);
      if (!m) throw new Error('missing boundary');
      const parts = parseMultipart(raw, m[1].trim());
      for (const p of parts) {
        if (p.name === 'room') room = p.body.toString('utf8');
        if (p.name === 'pass') pass = p.body.toString('utf8');
        if (p.name === 'action') action = p.body.toString('utf8');
        if (p.name === 'caption') caption = p.body.toString('utf8');
        if (p.name === 'file' && p.filename) filePart = p;
      }
    } else {
      const fields = parseUrlEncoded(raw);
      room = fields.room || 'lobby';
      pass = fields.pass || '';
      action = fields.action || 'text';
      text = fields.text || '';
    }

    const roomId = normalizeRoomId(room);
    if (!roomId || !pass) {
      res.statusCode = 400;
      res.end(layout({ title: 'Error', body: '<p>Room and passphrase required.</p>', flash: null }));
      return;
    }

    let flash = 'Posted.';
    if (action === 'media' && filePart) {
      if (filePart.body.length > MAX_MEDIA) {
        res.statusCode = 413;
        res.end(renderRoom(roomId, pass, 'File too large (max ~3.5MB).'));
        return;
      }
      if (caption.trim()) {
        appendMessage(roomId, sealText(roomId, pass, caption.trim()));
      }
      const kind = mediaKind(filePart.contentType, filePart.filename);
      appendMessage(
        roomId,
        sealMedia(roomId, pass, filePart.body, filePart.contentType, kind),
      );
      flash = `Sealed ${kind} shared.`;
    } else if (text.trim()) {
      appendMessage(roomId, sealText(roomId, pass, text.trim()));
      flash = 'Sealed text posted.';
    } else {
      flash = 'Nothing to post.';
    }

    // PRG: redirect to GET with room (pass not in URL after post — user re-enters)
    // For no-JS UX we re-render with pass still available this response only.
    res.statusCode = 200;
    res.end(renderRoom(roomId, pass, flash));
  } catch (err) {
    res.statusCode = 500;
    res.end(
      layout({
        title: 'Error',
        body: `<p>Request failed.</p><p class="note">${esc(String(err?.message || err))}</p>`,
        flash: null,
      }),
    );
  }
}
