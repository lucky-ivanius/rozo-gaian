# Implementation Prompt: Gaian Integration for Rozo

You are implementing the Gaian crypto-to-fiat off-ramp integration for Rozo, a cross-chain payment aggregator. This is a Bun + TypeScript project.

## What You're Building

A service module that wraps Gaian's API to enable merchants to receive fiat (VND, PHP) when users pay with crypto. Rozo uses Gaian's **prefund flow** -- Rozo has pre-deposited crypto with Gaian, so orders auto-proceed without requiring per-order on-chain transactions.

## Current Codebase

The project is at the root directory with these existing files:
- `pay.ts` -- **Reference only, DO NOT modify.** Standard (non-prefund) payment flow script demonstrating Gaian API usage.
- `pay-prefund.ts` -- **Reference only, DO NOT modify.** Prefund payment script demonstrating the prefund API flow.
- `package.json` -- Bun project, no deps besides @types/bun and typescript.
- `tsconfig.json` -- Strict mode, ESNext target, bundler module resolution, `verbatimModuleSyntax: true`.

Use `pay.ts` and `pay-prefund.ts` as API usage references to understand the Gaian API patterns, but do not touch them.

## Environment Variables

The `.env` file should have:
```
GAIAN_API_KEY=<api_key>
GAIAN_PAYMENT_URL=https://dev-payments.gaian-dev.network
ROZO_PREFUND_WALLET_ADDRESS=<wallet_address>
```

Do NOT hardcode API keys or URLs. Read from `process.env` (Bun loads `.env` automatically).

## Gaian API Reference

### Base URLs

- **Payment API** (sandbox): `https://dev-payments.gaian-dev.network`
- **Payment API** (production): `https://payments.gaian-dev.network`

All requests require header: `"x-api-key": "<api_key>"`

### Endpoints

#### Payment API Endpoints (use Payment base URL)

**POST `/api/v1/placeOrder/prefund`** -- Place prefunded order (auto-proceeds)
```
Request: {
  qrString: string,
  amount: number,                         // fiat amount
  fiatCurrency?: "VND"|"PHP"|"BRA",      // defaults to QR's currency
  cryptoCurrency: "USDC"|"USDT",
  fromAddress: string,                    // prefund wallet address
  transactionReference?: string
}
Response: {
  orderId: string, status: string,
  fiatAmount: number, fiatCurrency: string,
  cryptoAmount: number, cryptoCurrency: string, exchangeRate: number,
  qrInfo: { encodedString: string, providerInfo: object, bankInfo: object, additionalData?: string, beneficiaryName: string, countryCode?: string },
  cryptoTransferInfo: { chain: string, fromAddress: string, toAddress: string, token: string, amount: number },
  timestamp: string, isPrefunded: boolean, transactionReference: string
}
```

**GET `/api/v1/status`** -- Get order status
```
Query params: { orderId: string }
Response: {
  id: number, orderId: string,
  status: "awaiting_crypto_transfer"|"verified"|"processing"|"completed"|"failed",
  fiatAmount: number, fiatCurrency: string,
  cryptoAmount: number, cryptoCurrency: string, exchangeRate: number,
  qrInfo: QrInfo, paymentMethod: string, expiresAt: string,
  bankTransactionReference: { requestId?: string, requestDate?: string },
  createdAt: string, updatedAt: string,
  userId: number|null, transactionHash: string|null,
  pollCount: number, lastChecked: string
}
```

**POST `/api/v1/calculateExchange`** -- Get exchange rate
```
Request:  { amount: number, country: string, chain: string, token: string }
Response: {
  success: boolean,
  exchangeInfo: {
    fiatAmount: number, fiatCurrency: string,
    cryptoAmount: string, cryptoCurrency: string, exchangeRate: string,
    chain: string, token: string, timestamp: string, feeAmount: string
  }
}
```

**POST `/api/v1/parseQr`** -- Parse/validate QR string
```
Request:  { qrString: string, country: string }
Response: {
  success: boolean,
  qrInfo: {
    isValid: boolean, encodedString: string, country: string,
    qrProvider?: string, bankBin?: string, accountNumber?: string,
    amount?: number, currency?: string, purpose?: string, nation?: string,
    beneficiaryName: string, detailedQrInfo: any
  },
  timestamp: string
}
```

### Sandbox QR Strings (for testing)

| Currency | Min Amount | QR String |
|----------|-----------|-----------|
| VND | 50,000 | `00020101021126400010vn.zalopay0115uvsgayNI4Xsrqwz020300238620010A00000072701320006970454011899ZP24250M421803650208QRIBFTTA5204739953037045802VN63041428` |
| PHP | 10 | `00020101021127590012com.p2pqrpay0111UBPHPHMMXXX02089996440304121096459500755204601653036085802PH5925Sophia Marie Chavez Dever6009SAN PEDRO63043708` |
| BRA | - | `00020126490014br.gov.bcb.pix0127geovannamendes245@gmail.com5204000053039865802BR5924GEOVANNA MENDES SIQUEIRA6009Sao Paulo62290525REC691B4B40C700E4859304836304FB76` |

---

## Files to Create

### 1. `src/services/gaian/types.ts` -- All TypeScript Types

Define every type used in the Gaian API integration. Use the exact field names from the API.

```typescript
// ─── Enums / Unions ───

export type FiatCurrency = "VND" | "PHP" | "BRA";
export type CryptoCurrency = "USDC" | "USDT";
export type SupportedChain = "Solana" | "Ethereum" | "Polygon" | "Arbitrum" | "Base";
export type OrderStatus = "awaiting_crypto_transfer" | "verified" | "processing" | "completed" | "failed";

// ─── Calculate Exchange ───

export interface CalculateExchangeRequest {
  amount: number;
  country: string;
  chain: SupportedChain;
  token: string;
}

export interface ExchangeInfo {
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: string;
  cryptoCurrency: string;
  exchangeRate: string;
  chain: string;
  token: string;
  timestamp: string;
  feeAmount: string;
}

export interface CalculateExchangeResponse {
  success: boolean;
  exchangeInfo: ExchangeInfo;
}

// ─── Parse QR ───

export interface ParseQrRequest {
  qrString: string;
  country: string;
}

export interface QrPayInfo {
  isValid: boolean;
  encodedString: string;
  country: string;
  qrProvider?: string;
  bankBin?: string;
  accountNumber?: string;
  amount?: number;
  currency?: string;
  purpose?: string;
  nation?: string;
  beneficiaryName: string;
  detailedQrInfo: any;
}

export interface ParseQrResponse {
  success: boolean;
  qrInfo: QrPayInfo;
  timestamp: string;
}

// ─── Place Order (Prefund) ───

export interface PlaceOrderPrefundRequest {
  qrString: string;
  amount: number;
  fiatCurrency?: FiatCurrency;
  cryptoCurrency: CryptoCurrency;
  fromAddress: string;
  transactionReference?: string;
}

export interface CryptoTransferInfo {
  chain: string;
  fromAddress: string;
  toAddress: string;
  token: string;
  amount: number;
}

export interface QrInfo {
  encodedString: string;
  providerInfo: Record<string, any>;
  bankInfo: Record<string, any>;
  additionalData?: string;
  beneficiaryName: string;
  countryCode?: string;
}

export interface PlaceOrderPrefundResponse {
  orderId: string;
  status: string;
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
  cryptoCurrency: string;
  exchangeRate: number;
  qrInfo: QrInfo;
  cryptoTransferInfo: CryptoTransferInfo;
  timestamp: string;
  isPrefunded: boolean;
  transactionReference: string;
}

// ─── Order Status ───

export interface OrderStatusResponse {
  id: number;
  orderId: string;
  status: OrderStatus;
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
  cryptoCurrency: string;
  exchangeRate: number;
  qrInfo: QrInfo;
  paymentMethod: string;
  expiresAt: string;
  bankTransactionReference: {
    requestId?: string;
    requestDate?: string;
  };
  createdAt: string;
  updatedAt: string;
  userId: number | null;
  transactionHash: string | null;
  pollCount: number;
  lastChecked: string;
}

// ─── Error ───

export interface GaianApiError {
  error?: string;
  message: string;
  statusCode?: number;
  success?: boolean;
}
```

### 2. `src/services/gaian/config.ts` -- Environment Config

```typescript
export interface GaianConfig {
  apiKey: string;
  paymentUrl: string;
  prefundWalletAddress: string;
}

export function loadGaianConfig(): GaianConfig {
  const apiKey = process.env.GAIAN_API_KEY;
  const paymentUrl = process.env.GAIAN_PAYMENT_URL;
  const prefundWalletAddress = process.env.ROZO_PREFUND_WALLET_ADDRESS;

  if (!apiKey) throw new Error("GAIAN_API_KEY is required");
  if (!paymentUrl) throw new Error("GAIAN_PAYMENT_URL is required");
  if (!prefundWalletAddress) throw new Error("ROZO_PREFUND_WALLET_ADDRESS is required");

  return { apiKey, paymentUrl, prefundWalletAddress };
}
```

### 3. `src/services/gaian/client.ts` -- Low-Level HTTP Client

Create a `GaianClient` class that handles all HTTP communication with the Gaian API.

**Requirements:**
- Constructor takes `GaianConfig`
- Base URL: `paymentUrl` (for payment endpoints)
- All requests include `x-api-key` header and `Content-Type: application/json`
- Private methods: `post<T>(path, body)` and `get<T>(path, params?)`
- On non-ok response, throw a descriptive error including status code and response body
- Use native `fetch` (available in Bun)

**Implement these public methods that map to Gaian API endpoints:**

```typescript
class GaianClient {
  placePrefundOrder(req: PlaceOrderPrefundRequest): Promise<PlaceOrderPrefundResponse>
  getOrderStatus(orderId: string): Promise<OrderStatusResponse>
  calculateExchange(req: CalculateExchangeRequest): Promise<CalculateExchangeResponse>
  parseQr(req: ParseQrRequest): Promise<ParseQrResponse>
}
```

**API path mapping:**
- `placePrefundOrder` -> POST `{paymentUrl}/api/v1/placeOrder/prefund`
- `getOrderStatus` -> GET `{paymentUrl}/api/v1/status` (with query param orderId)
- `calculateExchange` -> POST `{paymentUrl}/api/v1/calculateExchange`
- `parseQr` -> POST `{paymentUrl}/api/v1/parseQr`

### 4. `src/services/gaian/service.ts` -- High-Level Service

Create a `GaianService` class that wraps `GaianClient` with business logic.

**Requirements:**
- Constructor takes `GaianConfig`, creates a `GaianClient` internally
- Provides higher-level methods with better ergonomics

**Key methods:**

```typescript
class GaianService {
  // Exchange & QR
  async getExchangeRate(amount: number, country: string, chain: SupportedChain, token: string): Promise<ExchangeInfo>
  async validateQr(qrString: string, country: string): Promise<QrPayInfo>

  // Orders
  async placePrefundOrder(params: {
    qrString: string;
    amount: number;
    fiatCurrency?: FiatCurrency;
    cryptoCurrency: CryptoCurrency;
    transactionReference?: string;
  }): Promise<PlaceOrderPrefundResponse>
  // ^ Uses config.prefundWalletAddress as fromAddress automatically

  async waitForCompletion(orderId: string, opts?: {
    intervalMs?: number;    // default 5000
    maxAttempts?: number;   // default 60
    onPoll?: (status: OrderStatusResponse, attempt: number) => void;
  }): Promise<OrderStatusResponse>
  // ^ Polls getOrderStatus until terminal status (completed/failed) or max attempts reached

  async getOrderStatus(orderId: string): Promise<OrderStatusResponse>
}
```

**`waitForCompletion` implementation details:**
- Poll every `intervalMs` (default 5000ms)
- Call `onPoll` callback on each poll if provided (for logging/progress)
- Return the response when `status` is `completed` or `failed`
- Throw an error after `maxAttempts` with a timeout message including the last known status and orderId

**`placePrefundOrder` implementation details:**
- Automatically sets `fromAddress` from `config.prefundWalletAddress`
- Passes through all other params to client's `placePrefundOrder`

### 5. `src/services/gaian/index.ts` -- Barrel Export

Re-export everything. Use `export type` for type-only exports (required by `verbatimModuleSyntax: true`):

```typescript
export { GaianClient } from "./client.js";
export { GaianService } from "./service.js";
export { loadGaianConfig } from "./config.js";
export type { GaianConfig } from "./config.js";
export type * from "./types.js";
```

---

## Implementation Rules

1. **No external dependencies** -- use only Bun built-ins and native `fetch`. No axios, node-fetch, etc.
2. **Strict TypeScript** -- the project uses `strict: true`, honor it. No `any` except where Gaian API returns untyped data (e.g. `detailedQrInfo`).
3. **`verbatimModuleSyntax: true`** -- use `export type` for type-only exports, `import type` for type-only imports.
4. **Match existing code style** -- look at `pay.ts` and `pay-prefund.ts` for patterns:
   - Sync stdin reading via `readlineSync()` for interactive prompts
   - Box-drawing characters for output formatting (┌├│└─━)
   - Console logging style
5. **DO NOT modify `pay.ts` or `pay-prefund.ts`** -- they are working reference scripts.
6. **All env vars loaded via `process.env`** -- Bun auto-loads `.env`.
7. **Error messages should be descriptive** -- include API path, status code, and response body on failures.

## Testing After Implementation

```bash
# Type check
bunx tsc --noEmit
```

## Final File Tree

```
.env
.gitignore
package.json
tsconfig.json
pay.ts                          # UNTOUCHED reference script
pay-prefund.ts                  # UNTOUCHED reference script
src/
  services/
    gaian/
      index.ts                  # Barrel exports
      types.ts                  # All TypeScript types
      config.ts                 # Environment config loader
      client.ts                 # Low-level HTTP client
      service.ts                # High-level service with business logic
```
