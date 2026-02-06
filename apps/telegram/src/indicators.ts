/**
 * Technical indicators computed from price history.
 * Zero npm dependencies — pure math on close prices.
 */

/**
 * Relative Strength Index (0–100).
 * RSI < 30 = oversold, RSI > 70 = overbought.
 */
export function computeRSI(closePrices: number[], period = 14): number | null {
  if (closePrices.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss over the first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closePrices[i] - closePrices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  // Smoothed average using Wilder's method
  for (let i = period + 1; i < closePrices.length; i++) {
    const change = closePrices[i] - closePrices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Simple Moving Average over `period` data points.
 */
export function computeSMA(closePrices: number[], period: number): number | null {
  if (closePrices.length < period) return null;
  const slice = closePrices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential Moving Average over `period` data points.
 */
export function computeEMA(closePrices: number[], period: number): number | null {
  if (closePrices.length < period) return null;

  // Seed with SMA of first `period` points
  const sma = closePrices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);

  let ema = sma;
  for (let i = period; i < closePrices.length; i++) {
    ema = closePrices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Momentum: rate of change over `period` data points, expressed as %.
 * Positive = price rising, negative = price falling.
 */
export function computeMomentum(closePrices: number[], period = 10): number | null {
  if (closePrices.length < period + 1) return null;
  const current = closePrices[closePrices.length - 1];
  const previous = closePrices[closePrices.length - 1 - period];
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Get signal label from RSI value.
 */
export function rsiSignal(rsi: number): string {
  if (rsi < 20) return 'Extremely Oversold';
  if (rsi < 30) return 'Oversold';
  if (rsi < 45) return 'Slightly Oversold';
  if (rsi <= 55) return 'Neutral';
  if (rsi <= 70) return 'Slightly Overbought';
  if (rsi <= 80) return 'Overbought';
  return 'Extremely Overbought';
}
