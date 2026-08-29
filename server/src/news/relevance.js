/**
 * Deterministic multi-asset relevance matching engine for news articles.
 * Matches canonical asset UUIDs using token boundaries, asset names, and verified disambiguation aliases.
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Crypto context indicator regex (used for ambiguous symbol safety)
const CRYPTO_CONTEXT_REGEX = /(?:crypto|cryptocurrency|blockchain|token|coin|altcoin|defi|web3|tiền mã hóa|tiền điện tử|on-chain|wallet|staking|halving)/i;

// Highly ambiguous short symbols that must never be matched as raw English words without crypto context
const AMBIGUOUS_CRYPTO_SYMBOLS = new Set([
  'RAIN', 'PUMP', 'DOT', 'NEAR', 'LINK', 'POL', 'UNI', 'ATOM',
  'SOL', 'ADA', 'ETC', 'LIT', 'TRX', 'WLD', 'SHIB', 'PEPE'
]);

// USD/VND explicit pair / exchange rate context regex (prevents loose "USD" matches)
const USD_VND_EXPLICIT_REGEX = /(?:usd[\s/_-]?vnd|vnd[\s/_-]?usd|tỷ giá usd|tỷ giá đô la|tỷ giá trung tâm|đồng usd\/vnd|giá usd hôm nay|usd to vnd|vnd to usd|dự trữ usd|tỷ giá ngoại tệ usd)/i;

// Gold verified keywords and aliases
const GOLD_ALIASES = [
  'xau', 'xau/usd', 'xauusd', 'giá vàng', 'vàng miếng', 'vàng sjc',
  'vàng thế giới', 'vàng spot', 'spot gold', 'bullion gold', 'gold price', 'gold prices'
];

/**
 * Builds verified alias matchers for a canonical asset.
 * @param {object} asset Canonical asset object
 * @returns {Array<{ reason: string, pattern: RegExp }>}
 */
function buildAssetMatchers(asset) {
  const symbol = String(asset.symbol || '').trim();
  const name = String(asset.name || '').trim();
  const assetType = String(asset.asset_type || asset.assetType || '').toLowerCase();
  const matchers = [];

  // 1. Gold Spot (XAU/USD)
  if (symbol === 'XAU/USD' || symbol === 'XAU' || assetType === 'gold') {
    for (const alias of GOLD_ALIASES) {
      const esc = escapeRegex(alias);
      matchers.push({
        reason: alias === 'xau' || alias === 'xau/usd' || alias === 'xauusd' ? 'SYMBOL_EXACT' : 'VERIFIED_ALIAS',
        pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
      });
    }
    return matchers;
  }

  // 2. Foreign Exchange (USD/VND)
  if (symbol === 'USD/VND' || symbol === 'USDVND' || assetType === 'fx') {
    matchers.push({
      reason: 'VERIFIED_ALIAS',
      pattern: USD_VND_EXPLICIT_REGEX
    });
    return matchers;
  }

  // 3. Crypto Assets
  if (assetType === 'crypto') {
    const isAmbiguous = AMBIGUOUS_CRYPTO_SYMBOLS.has(symbol.toUpperCase());

    // Symbol matcher
    if (symbol.length > 0) {
      const symEsc = escapeRegex(symbol);
      // For ultra-ambiguous symbol RAIN, require explicit token indicator
      if (symbol.toUpperCase() === 'RAIN') {
        matchers.push({
          reason: 'VERIFIED_ALIAS',
          pattern: /(?:^|[^\p{L}\p{N}])(?:rain\s+(?:coin|token|crypto)|(?:coin|token)\s+rain)(?=$|[^\p{L}\p{N}])/iu
        });
      } else {
        matchers.push({
          reason: 'SYMBOL_EXACT',
          isAmbiguous,
          pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${symEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
        });
      }
    }

    // Name matcher
    if (name.length > 0 && name.toUpperCase() !== symbol.toUpperCase()) {
      const nameEsc = escapeRegex(name);
      matchers.push({
        reason: 'NAME_EXACT',
        pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${nameEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
      });
    }

    // Specific crypto aliases (e.g. BTC -> Bitcoin, ETH -> Ethereum, SOL -> Solana)
    const cryptoAliases = {
      BTC: ['bitcoin'],
      ETH: ['ethereum', 'ether'],
      SOL: ['solana'],
      ADA: ['cardano'],
      DOT: ['polkadot'],
      DOGE: ['dogecoin'],
      AVAX: ['avalanche'],
      LINK: ['chainlink'],
      XRP: ['ripple'],
      LTC: ['litecoin'],
      BCH: ['bitcoin cash'],
      ATOM: ['cosmos hub', 'cosmos atom'],
      NEAR: ['near protocol'],
      UNI: ['uniswap'],
      GRAM: ['toncoin', 'the open network']
    };

    if (cryptoAliases[symbol.toUpperCase()]) {
      for (const alias of cryptoAliases[symbol.toUpperCase()]) {
        if (alias.toUpperCase() !== name.toUpperCase()) {
          const aliasEsc = escapeRegex(alias);
          matchers.push({
            reason: 'VERIFIED_ALIAS',
            pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${aliasEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
          });
        }
      }
    }

    return matchers;
  }

  // 4. Vietnamese Stocks & ETFs (VN_EXCHANGE)
  if (symbol.length > 0) {
    const symEsc = escapeRegex(symbol);
    matchers.push({
      reason: 'SYMBOL_EXACT',
      pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${symEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
    });
  }

  if (name.length > 0 && name.toUpperCase() !== symbol.toUpperCase()) {
    const nameEsc = escapeRegex(name);
    matchers.push({
      reason: 'NAME_EXACT',
      pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${nameEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
    });

    // Parenthesized name e.g. "... (Vietcombank)"
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch && parenMatch[1]) {
      const parenTerm = parenMatch[1].trim();
      if (
        parenTerm.length >= 2 &&
        parenTerm.toUpperCase() !== symbol.toUpperCase() &&
        parenTerm.toUpperCase() !== name.toUpperCase()
      ) {
        const parenEsc = escapeRegex(parenTerm);
        matchers.push({
          reason: 'VERIFIED_ALIAS',
          pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${parenEsc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
        });
      }
    }
  }

  return matchers;
}

/**
 * Matches an article against a list of canonical assets.
 * Returns relatedAssets array with canonical assetId, symbol, name, and relevanceReason.
 * @param {object} article
 * @param {Array<object>} canonicalAssets
 * @returns {Array<{ assetId: string, symbol: string, name: string, relevanceReason: string }>}
 */
export function matchArticleAssets(article, canonicalAssets = []) {
  if (!article || !Array.isArray(canonicalAssets) || canonicalAssets.length === 0) {
    return [];
  }

  const text = `${article.title || ''} ${article.summary || ''}`.normalize('NFC');
  const sourceId = String(article.sourceId || article.source?.id || '').toLowerCase();
  const isCryptoSource = sourceId === 'coindesk' || article.category === 'crypto';
  const hasCryptoContext = isCryptoSource || CRYPTO_CONTEXT_REGEX.test(text);

  const matched = [];
  const seenAssetIds = new Set();

  for (const asset of canonicalAssets) {
    if (!asset || !asset.id) continue;
    const assetId = String(asset.id);
    if (seenAssetIds.has(assetId)) continue;

    const matchers = buildAssetMatchers(asset);
    let matchedReason = null;

    for (const matcher of matchers) {
      // If matcher is ambiguous crypto symbol and we lack crypto context, skip it
      if (matcher.isAmbiguous && !hasCryptoContext) {
        continue;
      }

      if (matcher.pattern.test(text)) {
        matchedReason = matcher.reason;
        break;
      }
    }

    if (matchedReason) {
      seenAssetIds.add(assetId);
      matched.push({
        assetId,
        symbol: asset.symbol,
        name: asset.name || asset.symbol,
        relevanceReason: matchedReason
      });
    }
  }

  return matched;
}

/**
 * Attaches relatedAssets array to a list of articles using the canonical assets list.
 * @param {Array<object>} articles
 * @param {Array<object>} canonicalAssets
 * @returns {Array<object>}
 */
export function attachRelatedAssets(articles = [], canonicalAssets = []) {
  if (!Array.isArray(articles)) return [];
  return articles.map((article) => {
    const relatedAssets = matchArticleAssets(article, canonicalAssets);
    return {
      ...article,
      relatedAssets
    };
  });
}

