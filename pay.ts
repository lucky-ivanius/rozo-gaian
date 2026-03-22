/**
 * Gaian Network - Full Payment Lifecycle Script (Testnet/Sandbox)
 *
 * Usage: bun run pay.ts
 *
 * Flow:
 *   1. Create order → shows order details (orderId, crypto amount, transfer address)
 *   2. You pay on-chain and paste the tx hash
 *   3. Script verifies the tx and polls status until completion
 */

const BASE_URL = "https://dev-payments.gaian-dev.network";

const SANDBOX_QR: Record<string, string> = {
	VND: "00020101021126400010vn.zalopay0115uvsgayNI4Xsrqwz020300238620010A00000072701320006970454011899ZP24250M421803650208QRIBFTTA5204739953037045802VN63041428",
	PHP: "00020101021127590012com.p2pqrpay0111UBPHPHMMXXX02089996440304121096459500755204601653036085802PH5925Sophia Marie Chavez Dever6009SAN PEDRO63043708",
};

const SUPPORTED_CHAINS = [
	"Solana",
	"Ethereum",
	"Polygon",
	"Arbitrum",
	"Base",
] as const;

// ─── Types ───

interface CryptoTransferInfo {
	chain: string;
	fromAddress: string;
	toAddress: string;
	token: string;
	amount: number;
	encodedTransaction?: string;
}

interface QrInfo {
	encodedString: string;
	providerInfo: string;
	bankInfo: string;
	additionalData: string;
	beneficiaryName: string;
	countryCode: string;
}

interface PlaceOrderResponse {
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
	transactionReference: string;
}

interface VerifyOrderResponse {
	orderId: string;
	status: string;
	transactionHash: string;
	message: string;
	bankTransferStatus: string;
}

interface OrderStatusResponse {
	id: number;
	orderId: string;
	status: string;
	fiatAmount: number;
	fiatCurrency: string;
	cryptoAmount: number;
	cryptoCurrency: string;
	exchangeRate: number;
	pollCount: number;
	lastChecked: string;
	bankTransferStatus?: string;
	bankTransactionReference?: {
		requestId: string;
		requestDate: string;
	};
}

// ─── Helpers ───

function prompt(message: string): string {
	process.stdout.write(message);
	return (readlineSync() ?? "").trim();
}

function readlineSync(): string | null {
	const buf = Buffer.alloc(1024);
	let input = "";
	const fd = 0; // stdin
	try {
		while (true) {
			const bytesRead = require("fs").readSync(fd, buf, 0, 1, null);
			if (bytesRead === 0) break;
			const char = buf.toString("utf8", 0, bytesRead);
			input += char;
			if (char.includes("\n")) break;
		}
	} catch {
		// EOF or error
	}
	return input.replace(/\n$/, "");
}

async function apiPost<T>(
	path: string,
	body: Record<string, unknown>,
	apiKey: string,
): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify(body),
	});
	const data = await res.json();
	if (!res.ok) {
		throw new Error(
			`API ${path} failed (${res.status}): ${JSON.stringify(data)}`,
		);
	}
	return data as T;
}

async function apiGet<T>(
	path: string,
	params: Record<string, string>,
	apiKey: string,
): Promise<T> {
	const qs = new URLSearchParams(params).toString();
	const res = await fetch(`${BASE_URL}${path}?${qs}`, {
		headers: { "x-api-key": apiKey },
	});
	const data = await res.json();
	if (!res.ok) {
		throw new Error(
			`API ${path} failed (${res.status}): ${JSON.stringify(data)}`,
		);
	}
	return data as T;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Steps ───

async function createOrder(apiKey: string): Promise<PlaceOrderResponse> {
	console.log("\n━━━ Step 1: Create Order ━━━\n");

	const fiatCurrency = prompt("Fiat currency (VND / PHP): ").toUpperCase();
	if (!SANDBOX_QR[fiatCurrency]) {
		throw new Error(`Unsupported currency: ${fiatCurrency}. Use VND or PHP.`);
	}

	const amount = prompt("Fiat amount (e.g. 50000 for VND, 100 for PHP): ");
	if (!amount || isNaN(Number(amount))) {
		throw new Error("Invalid amount.");
	}

	console.log(`\nAvailable chains: ${SUPPORTED_CHAINS.join(", ")}`);
	const chain = prompt("Chain: ");
	if (!SUPPORTED_CHAINS.includes(chain as any)) {
		throw new Error(`Unsupported chain: ${chain}`);
	}

	const fromAddress = prompt("Your wallet address (fromAddress): ");
	if (!fromAddress) {
		throw new Error("Wallet address is required.");
	}

	const qrString = SANDBOX_QR[fiatCurrency]!;

	console.log("\nCreating order...");
	const order = await apiPost<PlaceOrderResponse>(
		"/api/v1/placeOrder",
		{
			qrString,
			amount: Number(amount),
			fiatCurrency,
			cryptoCurrency: "USDC",
			chain,
			fromAddress,
		},
		apiKey,
	);

	console.log("\n┌─────────────────────────────────────");
	console.log("│ ORDER CREATED");
	console.log("├─────────────────────────────────────");
	console.log(`│ Order ID:        ${order.orderId}`);
	console.log(`│ Status:          ${order.status}`);
	console.log(`│ Fiat:            ${order.fiatAmount} ${order.fiatCurrency}`);
	console.log(
		`│ Crypto:          ${order.cryptoAmount} ${order.cryptoCurrency}`,
	);
	console.log(`│ Exchange Rate:   ${order.exchangeRate}`);
	if (order.cryptoTransferInfo) {
		console.log("├─────────────────────────────────────");
		console.log("│ TRANSFER DETAILS");
		console.log(`│ Chain:           ${order.cryptoTransferInfo.chain}`);
		console.log(`│ To Address:      ${order.cryptoTransferInfo.toAddress}`);
		console.log(`│ Token:           ${order.cryptoTransferInfo.token}`);
		console.log(`│ Amount:          ${order.cryptoTransferInfo.amount}`);
	}
	if (order.cryptoTransferInfo?.encodedTransaction) {
		console.log("├─────────────────────────────────────");
		console.log("│ Encoded TX (use to sign & send):");
		console.log(`│ ${order.cryptoTransferInfo.encodedTransaction}`);
	}
	console.log("└─────────────────────────────────────\n");

	return order;
}

async function verifyTransaction(
	orderId: string,
	apiKey: string,
): Promise<VerifyOrderResponse> {
	console.log("\n━━━ Step 2: Verify Transaction ━━━\n");

	const txHash = prompt("Paste your transaction hash (proof): ");
	if (!txHash) {
		throw new Error("Transaction hash is required.");
	}

	console.log("\nVerifying transaction...");
	const result = await apiPost<VerifyOrderResponse>(
		"/api/v1/verifyOrder",
		{ orderId, transactionProof: txHash },
		apiKey,
	);

	console.log("\n┌─────────────────────────────────────");
	console.log("│ VERIFICATION RESULT");
	console.log("├─────────────────────────────────────");
	console.log(`│ Order ID:        ${result.orderId}`);
	console.log(`│ Status:          ${result.status}`);
	console.log(`│ Message:         ${result.message}`);
	console.log(`│ Bank Transfer:   ${result.bankTransferStatus}`);
	console.log("└─────────────────────────────────────\n");

	return result;
}

async function pollStatus(
	orderId: string,
	apiKey: string,
): Promise<OrderStatusResponse | undefined> {
	console.log("\n━━━ Step 3: Polling Order Status ━━━\n");

	const TERMINAL_STATUSES = ["completed", "failed"];
	const MAX_POLLS = 60;
	const POLL_INTERVAL = 5000; // 5s

	for (let i = 1; i <= MAX_POLLS; i++) {
		const result = await apiGet<OrderStatusResponse>(
			"/api/v1/status",
			{ orderId },
			apiKey,
		);
		const status = result.status;

		console.log(
			`  [${i}/${MAX_POLLS}] Status: ${status}${result.bankTransferStatus ? ` | Bank: ${result.bankTransferStatus}` : ""}`,
		);

		if (TERMINAL_STATUSES.includes(status)) {
			console.log("\n┌─────────────────────────────────────");
			console.log("│ FINAL STATUS");
			console.log("├─────────────────────────────────────");
			console.log(`│ Order ID:        ${result.orderId}`);
			console.log(`│ Status:          ${result.status}`);
			if (result.bankTransferStatus) {
				console.log(`│ Bank Transfer:   ${result.bankTransferStatus}`);
			}
			if (result.bankTransactionReference) {
				console.log(
					`│ Bank Ref ID:     ${result.bankTransactionReference.requestId}`,
				);
				console.log(
					`│ Bank Ref Date:   ${result.bankTransactionReference.requestDate}`,
				);
			}
			console.log("└─────────────────────────────────────\n");
			return result;
		}

		await sleep(POLL_INTERVAL);
	}

	console.log(
		"\nMax polls reached. Check status manually with orderId:",
		orderId,
	);
}

// ─── Main ───

async function main() {
	console.log("╔═══════════════════════════════════════╗");
	console.log("║       Gaian Network Payment           ║");
	console.log("╚═══════════════════════════════════════╝\n");

	const apiKey = prompt("Enter your API key: ");
	if (!apiKey) {
		throw new Error("API key is required.");
	}

	// Step 1: Create order
	const order = await createOrder(apiKey);

	// Step 2: Wait for user to pay, then verify
	console.log("Now send the crypto payment using the transfer details above.");
	const doPay = prompt("Have you sent the payment? (y/n): ");
	if (doPay.toLowerCase() !== "y") {
		console.log("Exiting. Your order ID is:", order.orderId);
		console.log("You can resume verification later.\n");
		return;
	}

	const verification = await verifyTransaction(order.orderId, apiKey);

	// Print order summary before polling
	console.log("┌─────────────────────────────────────");
	console.log("│ ORDER SUMMARY");
	console.log("├─────────────────────────────────────");
	console.log(`│ Order ID:        ${order.orderId}`);
	console.log(`│ Fiat:            ${order.fiatAmount} ${order.fiatCurrency}`);
	console.log(
		`│ Crypto:          ${order.cryptoAmount} ${order.cryptoCurrency}`,
	);
	console.log(`│ Exchange Rate:   ${order.exchangeRate}`);
	console.log(`│ TX Hash:         ${verification.transactionHash}`);
	console.log(`│ Verify Status:   ${verification.status}`);
	console.log(`│ Bank Transfer:   ${verification.bankTransferStatus}`);
	console.log("└─────────────────────────────────────");

	// Step 3: Poll status
	await pollStatus(order.orderId, apiKey);
}

main().catch((err) => {
	console.error("\nError:", err.message);
	process.exit(1);
});
