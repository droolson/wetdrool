/**
 * First-hit-anchored fixed window. All state changes and the returned decision
 * occur inside one Redis EVAL, so concurrent callers cannot over-admit.
 *
 * KEYS[1] is already HMAC-derived. ARGV contains only numeric policy/time data.
 */
export const REDIS_FIXED_WINDOW_CONSUME_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

if not window_ms or window_ms < 1 or not limit or limit < 0 or not now_ms or now_ms < 0 then
  return redis.error_reply('invalid rate-limit arguments')
end

local stored = redis.call('GET', key)
local count
local ttl
if not stored then
  -- SET with PX establishes the first count and its expiry in one command.
  -- If a later ACL/capability check fails, the new key remains bounded.
  redis.call('SET', key, '1', 'PX', window_ms)
  count = 1
  ttl = redis.call('PTTL', key)
else
  ttl = redis.call('PTTL', key)
  if ttl == -1 then
    -- Repair legacy state before incrementing it. A denied PEXPIRE therefore
    -- cannot create or further mutate an immortal counter.
    local repaired = redis.call('PEXPIRE', key, window_ms)
    if repaired ~= 1 then
      return redis.error_reply('failed to repair rate-limit expiry')
    end
    ttl = redis.call('PTTL', key)
  end
  if ttl < 0 then
    return redis.error_reply('rate-limit key expiry is unavailable')
  end
  count = redis.call('INCR', key)
end
if ttl < 0 then
  return redis.error_reply('rate-limit key expiry is unavailable')
end

local allowed = 0
if count <= limit then
  allowed = 1
end

local remaining = limit - count
if remaining < 0 then
  remaining = 0
end

local reset_at = now_ms + ttl
return {allowed, count, reset_at, remaining}
`.trim();

/**
 * Counter-preserving bucket read used by the Fastify adapter. Healthy state is
 * non-mutating; a legacy key without expiry retains its count and gains a
 * conservative expiry instead of being deleted and reopening admission.
 */
export const REDIS_FIXED_WINDOW_READ_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

if not window_ms or window_ms < 1 or not limit or limit < 0 or not now_ms or now_ms < 0 then
  return redis.error_reply('invalid rate-limit arguments')
end

local stored = redis.call('GET', key)
if not stored then
  return {1, 0, now_ms, limit}
end

local ttl = redis.call('PTTL', key)
if ttl == -1 then
  local repaired = redis.call('PEXPIRE', key, window_ms)
  if repaired ~= 1 then
    return redis.error_reply('failed to repair rate-limit expiry')
  end
  ttl = redis.call('PTTL', key)
end
if ttl < 0 then
  return redis.error_reply('rate-limit key expiry is unavailable')
end

local count = tonumber(stored)
local allowed = 0
if count <= limit then
  allowed = 1
end

local remaining = limit - count
if remaining < 0 then
  remaining = 0
end

local reset_at = now_ms + ttl
return {allowed, count, reset_at, remaining}
`.trim();

/**
 * Active readiness probe. The caller supplies a stable HMAC-derived key. SET
 * creates it with an expiry atomically before any later capability can fail,
 * so denied PEXPIRE/DEL commands cannot leak unbounded probe keys.
 */
export const REDIS_RATE_LIMIT_READINESS_LUA = `
local key = KEYS[1]
local probe_ttl_ms = tonumber(ARGV[1])

if not probe_ttl_ms or probe_ttl_ms < 1 then
  return redis.error_reply('invalid rate-limit readiness arguments')
end

redis.call('SET', key, '0', 'PX', probe_ttl_ms)
local count = redis.call('INCR', key)
local expiry_set = redis.call('PEXPIRE', key, probe_ttl_ms)
local ttl = redis.call('PTTL', key)
local stored = redis.call('GET', key)
local deleted = redis.call('DEL', key)

return {count, expiry_set, ttl, stored, deleted}
`.trim();
