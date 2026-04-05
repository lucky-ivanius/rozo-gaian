# Gaian Integration Plan for Rozo

## Context

**Rozo** is a cross-chain payment aggregator where:
- Frontend handles QR code scanning
- Backend handles payment routing across chains (bridge, swap)
- Merchants configure their preferred receiving token + chain
- Example: User pays USDC on Base -> Rozo bridges -> Merchant receives USDC on Stellar

**New requirement**: Integrate **Gaian** as a crypto-to-fiat off-ramp so merchants can receive **fiat (VND or PHP)** instead of crypto. User pays crypto, merchant gets fiat deposited to their bank account via QR-based bank transfer.

**Gaian** is a crypto-to-fiat payment API that:
- Accepts USDC/USDT on Solana, Ethereum, Polygon, Arbitrum, Base
- Converts to fiat (VND, PHP, BRA) and pays out via local bank transfer
- Supports two flows: standard (user pays on-chain + verify) and **prefunded** (auto-proceeds from pre-deposited balance)

**Decision: Use Prefund Flow** because:
- Rozo acts as intermediary -- the end user never interacts with Gaian directly
- Rozo already has a prefund wallet set up
- Faster settlement (order auto-proceeds, no on-chain tx + verify step per order)
- Rozo controls the full UX

---

## Architecture Overview

```
User (any chain/token)
  |
  | 1. Pays crypto to Rozo
  v
Rozo Backend
  |
  | 2. Bridge/swap to USDC if needed (existing infra)
  | 3. Call Gaian Prefund API with merchant's bank QR
  v
Gaian API
  |
  | 4. Deducts from Rozo's prefund balance
  | 5. Sends fiat to merchant's bank via QR
  v
Merchant Bank Account (VND / PHP)
```

---

## Implementation Plan

### Phase 1: Gaian Service Module

Create a `GaianService` class that wraps all Gaian API interactions.

#### 1.1 Core API Client (`src/services/gaian/client.ts`)

- Base HTTP client with API key auth (`x-api-key` header)
- Base URL: Payment API (sandbox + production)
- Error handling with typed error responses
- Request/response logging

**Endpoints to implement:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/placeOrder/prefund` | Place prefunded order |
| GET | `/api/v1/status?orderId=X` | Poll order status |
| POST | `/api/v1/calculateExchange` | Get exchange rate |
| POST | `/api/v1/parseQr` | Parse/validate QR string |

#### 1.2 TypeScript Types (`src/services/gaian/types.ts`)

All request/response types for every endpoint. Key types:

```
- PlaceOrderPrefundRequest / PlaceOrderPrefundResponse
- OrderStatusResponse
- CalculateExchangeRequest / CalculateExchangeResponse
- ParseQrRequest / ParseQrResponse
- GaianErrorResponse
- OrderStatus enum: awaiting_crypto_transfer | verified | processing | completed | failed
- FiatCurrency enum: VND | PHP | BRA
- CryptoCurrency enum: USDC | USDT
- SupportedChain enum: Solana | Ethereum | Polygon | Arbitrum | Base
```

#### 1.3 Gaian Service (`src/services/gaian/service.ts`)

High-level service that orchestrates Gaian API calls with business logic:

- `calculateExchange(amount, country, chain, token)` - Get exchange rate quote
- `parseQr(qrString, country)` - Validate QR string
- `placePrefundOrder(params)` - Create prefunded order
- `pollOrderStatus(orderId, options?)` - Poll until terminal status with configurable interval/max attempts

---

### Phase 2: Payment Flow Integration

#### 2.1 Exchange Rate Calculation

Before showing the user the payment amount, query Gaian for the current exchange rate:

```
POST /api/v1/calculateExchange
{
  amount: <fiat_amount>,      // e.g. 500000
  country: "VN",              // or "PH"
  chain: "Solana",            // chain Rozo will use for Gaian
  token: "USDC"
}
```

Response gives: `cryptoAmount`, `exchangeRate`, `feeAmount`

This tells the user: "You need to pay X USDC to send Y VND to this merchant."

#### 2.2 QR Code Validation

When merchant provides their bank QR code, validate it:

```
POST /api/v1/parseQr
{
  qrString: "<merchant_qr>",
  country: "VN"
}
```

Response confirms: `isValid`, `beneficiaryName`, `bankBin`, `accountNumber`

Store the validated QR string in merchant config.

#### 2.3 Prefund Order Placement

When a payment is triggered:

```
POST /api/v1/placeOrder/prefund
{
  qrString: "<merchant_bank_qr>",
  amount: <fiat_amount>,
  fiatCurrency: "VND" | "PHP",
  cryptoCurrency: "USDC" | "USDT",
  fromAddress: "<rozo_prefund_wallet>",
  transactionReference: "Rozo-<internal_order_id>"
}
```

Response gives: `orderId`, `cryptoAmount`, `isPrefunded: true`

The order auto-proceeds -- no on-chain tx or verify step needed.

#### 2.4 Status Polling

Poll until terminal status:

```
GET /api/v1/status?orderId=<gaian_order_id>
```

Status progression: `awaiting_crypto_transfer` -> `processing` -> `completed` | `failed`

**Polling config:**
- Interval: 5 seconds
- Max polls: 60 (5 minutes total)
- Terminal statuses: `completed`, `failed`

#### 2.5 End-to-End Flow

```
1. User scans merchant QR at POS
2. Frontend sends payment request to Rozo backend:
   { merchantId, amount, fiatCurrency, userCryptoToken, userChain }
3. Backend checks merchant config: receiving = fiat (VND/PHP)
4. Backend calls Gaian calculateExchange to get crypto amount
5. Backend returns quote to frontend: "Pay X USDC for Y VND"
6. User confirms and sends crypto to Rozo (any chain/token)
7. Rozo receives crypto, bridges/swaps to USDC if needed (existing infra)
8. Rozo calls Gaian placeOrder/prefund with merchant's bank QR
9. Gaian deducts from Rozo prefund balance, initiates fiat payout
10. Rozo polls Gaian status until completed
11. Rozo notifies merchant: "Payment received - Y VND sent to bank"
12. Done
```

---

### Phase 3: Merchant Configuration

#### 3.1 Merchant Config Schema

Add fiat receiving option to merchant config:

```typescript
interface MerchantConfig {
  // Existing
  merchantId: string;
  receivingToken: string;     // "USDC", "USDT", "SOL", etc.
  receivingChain: string;     // "Solana", "Base", "Stellar", etc.
  recipientWallet: string;

  // New: Fiat off-ramp via Gaian
  receivingFiat?: {
    enabled: boolean;
    fiatCurrency: "VND" | "PHP";     // Target fiat
    country: "VN" | "PH";           // Country code for QR parsing
    qrString: string;                // Merchant's bank QR code
    beneficiaryName: string;         // Validated name from parseQr
    cryptoCurrency: "USDC" | "USDT"; // Crypto to use with Gaian
  };
}
```

#### 3.2 Merchant Onboarding for Fiat

1. Merchant provides their bank QR code (from their banking app)
2. Rozo validates via `parseQr` API
3. Store validated QR string + beneficiary info in merchant config
4. Merchant is ready to receive fiat payments

---

### Phase 4: Prefund Balance Management

#### 4.1 Balance Monitoring

- Track prefund balance (Gaian doesn't expose a balance API, so track locally)
- Deduct `cryptoAmount` from tracked balance on each successful order
- Alert when balance drops below threshold

#### 4.2 Replenishment

- Manual: Send USDC/USDT to Gaian prefund wallet address
- Future: Automate replenishment when balance < threshold

---

### Phase 5: Error Handling & Edge Cases

#### 5.1 Error Scenarios

| Scenario | Handling |
|----------|----------|
| Gaian API down | Retry with exponential backoff, fall back to error state |
| Order fails | Mark Rozo order as failed, refund user's crypto |
| Prefund balance insufficient | Reject order before placing, alert ops team |
| QR string invalid | Reject merchant config, show validation error |
| Exchange rate stale | Re-fetch rate if > 30s old before placing order |
| Polling timeout | Mark as "pending_manual_check", alert ops |

#### 5.2 Order Status Mapping

| Gaian Status | Rozo Status |
|-------------|-------------|
| `awaiting_crypto_transfer` | `processing` |
| `verified` | `processing` |
| `processing` | `processing` |
| `completed` | `completed` |
| `failed` | `failed` |

---

## File Structure

```
pay.ts                          # Reference only -- DO NOT MODIFY
pay-prefund.ts                  # Reference only -- DO NOT MODIFY
src/
  services/
    gaian/
      index.ts          # Barrel exports
      types.ts          # All TypeScript types/interfaces
      client.ts         # Low-level HTTP client for Gaian API
      service.ts        # High-level business logic service
      config.ts         # Environment config (URLs, API key)
```

> **Note:** `pay.ts` and `pay-prefund.ts` are working reference scripts for the Gaian API. They demonstrate the API usage patterns but are NOT part of the integration codebase. Do not modify them.

---

## Environment Variables

```env
# Gaian API
GAIAN_API_KEY=<api_key>
GAIAN_PAYMENT_URL=https://dev-payments.gaian-dev.network  # sandbox
# GAIAN_PAYMENT_URL=https://payments.gaian-dev.network     # production

# Rozo Prefund Wallet
ROZO_PREFUND_WALLET_ADDRESS=<wallet_address>
```

---

## Testing Plan (Sandbox)

1. **Parse QR**: Test with sandbox QR strings for VND and PHP
2. **Calculate Exchange**: Verify rates for different amounts
3. **Place Prefund Order**: Test with sandbox QR strings
   - VND: amount > 50,000
   - PHP: amount > 10
4. **Poll Status**: Verify polling reaches `completed`
5. **Error cases**: Test invalid QR, insufficient amount, invalid API key

### Sandbox QR Strings

| Currency | QR String |
|----------|-----------|
| VND | `00020101021126400010vn.zalopay0115uvsgayNI4Xsrqwz020300238620010A00000072701320006970454011899ZP24250M421803650208QRIBFTTA5204739953037045802VN63041428` |
| PHP | `00020101021127590012com.p2pqrpay0111UBPHPHMMXXX02089996440304121096459500755204601653036085802PH5925Sophia Marie Chavez Dever6009SAN PEDRO63043708` |
| BRA | `00020126490014br.gov.bcb.pix0127geovannamendes245@gmail.com5204000053039865802BR5924GEOVANNA MENDES SIQUEIRA6009Sao Paulo62290525REC691B4B40C700E4859304836304FB76` |
