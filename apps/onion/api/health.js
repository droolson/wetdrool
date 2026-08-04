export default function handler(_req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      service: '@wetdrool/onion',
      javascript: false,
      sealedRooms: true,
    }),
  );
}
