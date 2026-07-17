import { Redis } from 'ioredis'

function criarConexaoRedis() {
  const url = process.env.UPSTASH_REDIS_URL
  const token = process.env.UPSTASH_REDIS_TOKEN

  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_URL e UPSTASH_REDIS_TOKEN são obrigatórios')
  }

  const client = new Redis(url, {
    password: token,
    tls: { rejectUnauthorized: false },
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  client.on('error', (err) => console.error('[Redis] Erro:', err.message))
  client.on('connect', () => console.log('[Redis] Conectado'))

  return client
}

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) _redis = criarConexaoRedis()
  return _redis
}
