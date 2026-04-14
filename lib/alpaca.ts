import Alpaca from '@alpacahq/alpaca-trade-api'
import type { Position, TradingMode } from '@/types'

type AlpacaClient = InstanceType<typeof Alpaca>

export function createAlpacaClient(mode: 'paper' | 'live'): AlpacaClient {
  if (mode === 'paper') {
    return new Alpaca({
      keyId: process.env.ALPACA_PAPER_KEY!,
      secretKey: process.env.ALPACA_PAPER_SECRET!,
      paper: true,
    })
  }
  return new Alpaca({
    keyId: process.env.ALPACA_LIVE_KEY!,
    secretKey: process.env.ALPACA_LIVE_SECRET!,
    paper: false,
  })
}

export async function submitOrder(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  side: 'buy' | 'sell',
  type: 'market' | 'limit',
  limitPrice?: number
): Promise<{ alpacaOrderId: string; symbol: string; status: 'PENDING' }> {
  const order = await client.createOrder({
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: 'day',
    ...(type === 'limit' && limitPrice ? { limit_price: String(limitPrice) } : {}),
  })
  return {
    alpacaOrderId: order.id,
    symbol: order.symbol,
    status: 'PENDING',
  }
}

export async function getPositions(client: AlpacaClient, mode: TradingMode): Promise<Position[]> {
  const raw = await client.getPositions()
  const now = Date.now()
  return raw.map((p: Record<string, string>) => ({
    id: `${p.symbol}-${mode}`,
    symbol: p.symbol,
    quantity: parseFloat(p.qty),
    avgCost: parseFloat(p.avg_entry_price),
    currentPrice: parseFloat(p.current_price),
    unrealizedPAndL: parseFloat(p.unrealized_pl),
    mode,
    updatedAt: now,
  }))
}

export async function getAccountCash(client: AlpacaClient): Promise<number> {
  const account = await client.getAccount()
  return parseFloat(account.cash)
}

export async function cancelAllOrders(client: AlpacaClient): Promise<void> {
  await client.cancelAllOrders()
}
