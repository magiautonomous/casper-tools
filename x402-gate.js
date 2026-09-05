#!/usr/bin/env node
// x402 premium-gate module for casper-tools MCP
// Gates premium tools behind x402 (USDC on Base) and declares Bazaar
// discovery metadata so the CDP Facilitator catalogs them after first
// settlement. Disabled entirely if X402_DISABLED=1.

const { x402ResourceServer, HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { bazaarResourceServerExtension, declareDiscoveryExtension } = require('@x402/extensions/bazaar');
const { createPaymentWrapper } = require('@x402/mcp');

const ENABLED = process.env.X402_DISABLED !== '1';

// --- Wallet (PAYTO recipient — server only ever needs the address, never the key) ---
const PAYTO = process.env.X402_PAYTO || '0xB90ca735c711EA07343ee8aDbc54378Af181d4E5';

// --- CDP Facilitator — the catalog that feeds CDP Bazaar / AWS AgentCore / agentic.market ---
const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

// --- USDC on Base mainnet (eip155:8453), 6 decimals ---
const ASSET_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'eip155:8453';
const PRICE_AMOUNT = process.env.X402_PRICE_AMOUNT || '10000'; // $0.01 in 1e6 units

let resourceServer = null;

function getResourceServer() {
  if (resourceServer) return resourceServer;
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const rs = new x402ResourceServer(facilitator);
  rs.register(NETWORK, new ExactEvmScheme(PAYTO));
  try {
    rs.registerExtension(bazaarResourceServerExtension);
  } catch (e) {
    console.error('[x402] bazaar extension register warning:', e.message);
  }
  resourceServer = rs;
  return rs;
}

// Premium tools: name -> (description, inputSchema, example args)
const PREMIUM = {
  text_diff: {
    description: 'Compare two texts and show added/removed/unchanged lines.',
    inputSchema: {
      type: 'object',
      properties: {
        text1: { type: 'string', description: 'The original text' },
        text2: { type: 'string', description: 'The modified text to compare against the original' },
      },
      required: ['text1', 'text2'],
    },
    example: { text1: 'hello world', text2: 'hello brave world' },
  },
  cron_parse: {
    description: 'Parse a cron expression (5 fields) and compute next run times.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Cron expression with 5 fields, e.g. "*/15 * * * *"' },
      },
      required: ['expression'],
    },
    example: { expression: '*/15 * * * *' },
  },
};

const wrapperCache = {};

// Returns the x402-payment-wrapped handler for a premium tool, or null if
// x402 is disabled. Throw is deferred to wrapTool callers.
function wrapTool(toolName) {
  const meta = PREMIUM[toolName];
  if (!meta) return null;
  if (!ENABLED) return null;
  const rs = getResourceServer();
  if (!wrapperCache[toolName]) {
    wrapperCache[toolName] = createPaymentWrapper(rs, {
      accepts: [{
        scheme: 'exact',
        network: NETWORK,
        asset: ASSET_USDC_BASE,
        amount: PRICE_AMOUNT,
        payTo: PAYTO,
        maxTimeoutSeconds: 300,
        extra: {
          asset: 'USDC',
          assetTransferMethod: 'eip3009',
          decimals: 6,
          name: 'USD Coin',
          version: '2',
          network_name: 'Base Mainnet',
          eip712Domain: {
            chainId: 8453,
            name: 'USD Coin',
            verifyingContract: ASSET_USDC_BASE,
            version: '2',
          },
        },
      }],
      resource: {
        url: 'mcp://tool/' + toolName,
        description: meta.description,
        serviceName: 'Casper Tools',
        tags: ['utilities', 'devtools', 'text', 'cron'],
      },
      extensions: declareDiscoveryExtension({
        toolName,
        description: meta.description,
        transport: 'streamable-http',
        inputSchema: meta.inputSchema,
        example: meta.example,
      }),
    });
  }
  return wrapperCache[toolName];
}

module.exports = { ENABLED, PREMIUM, wrapTool, PAYTO, FACILITATOR_URL, PRICE_AMOUNT };