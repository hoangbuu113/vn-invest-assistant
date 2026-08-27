import { XMLParser } from 'fast-xml-parser';

const CAFEF_FEEDS = [
  {
    category: 'market',
    url: 'https://cafef.vn/thi-truong-chung-khoan.rss'
  },
  {
    category: 'company',
    url: 'https://cafef.vn/doanh-nghiep.rss'
  },
  {
    category: 'macro',
    url: 'https://cafef.vn/vi-mo-dau-tu.rss'
  },
  {
    category: 'global',
    url: 'https://cafef.vn/tai-chinh-quoc-te.rss'
  }
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true
});

// Non-investment topic patterns to filter out
const EXCLUSION_PATTERNS = [
  // Accidents, Natural Disasters, Fatalities
  /\b(tai nạn|lật thuyền|rơi máy bay|chìm tàu|chìm xuồng|đắm tàu|cháy nhà|hỏa hoạn|lũ quét|sạt lở|lở đất|động đất|sóng thần|mắc kẹt|bị thương|tử vong|chết người|thiệt mạng|thương vong|ngập lụt|nạn nhân)\b/i,
  // Crime, Violence, Police Blotter
  /\b(giết người|án mạng|sát hại|cướp giật|trộm cắp|hiếp dâm|bắt cóc|lừa tình|đánh ghen|ma túy|tử thi|thi thể|mất tích|huyết án|bắn chết|đâm chết|tự tử|hành hung)\b/i,
  // Entertainment, Showbiz, Pop Culture, Sports
  /\b(showbiz|hoa hậu|hoa khôi|người mẫu|diễn viên|ca sĩ|phim ảnh|rạp chiếu|gameshow|concert|sao việt|sao hàn|sao hoa ngữ|đám cưới|scandal|bóng đá|bàn thắng|vô địch|cầu thủ|madam pang|fifa|aff cup|world cup|tiền đạo|huấn luyện viên)\b/i,
  // Lifestyle, Health, Quirky Trivia, Clickbait
  /\b(tử vi|cung hoàng đạo|phong thủy|mẹo vặt|làm đẹp|giảm cân|tắm nắng|nghỉ dưỡng|món ăn|đặc sản|chữa bệnh|ung thư|bệnh viện|sức khỏe|bánh quy|rắn hổ mang|động vật hoang dã|thịt chó|quái vật|sinh vật lạ|kỳ lạ|chuyện lạ|bí ẩn|vũ trụ sâu|người ngoài hành tinh)\b/i,
  // Pure military hardware / skirmishes without economic context
  /\b(tiêm kích|xe tăng vứt xó|vận tải cơ|không chiến|bắn hạ|tên lửa phòng không|súng đạn)\b/i
];

// Strong financial signals that protect financial stories with incidental keywords
const STRONG_FINANCIAL_SIGNALS = [
  /\b(chứng khoán|cổ phiếu|trái phiếu|vn-index|vn30|hose|hnx|upcom|etf|quỹ đầu tư|lợi nhuận|doanh thu|lãi ròng|lãi suất|tỷ giá|usd|vnd|ngân hàng|tín dụng|gdp|lạm phát|fdi|oda|giá vàng|giá dầu|thương mại|xuất khẩu|nhập khẩu|thuế quan|chính sách tiền tệ|ngân sách|bất động sản)\b/i
];

// Relevant economic, corporate, policy, and global financial signals for Macro & Global feeds
const RELEVANT_MACRO_GLOBAL_SIGNALS = [
  /\b(chứng khoán|cổ phiếu|trái phiếu|etf|quỹ|cổ tức|niêm yết|ipo|m&a|sáp nhập|thâu tóm)\b/i,
  /\b(doanh nghiệp|tập đoàn|công ty|hãng|tỷ phú|lợi nhuận|doanh thu|phá sản|tài sản|vốn hóa)\b/i,
  /\b(ngân hàng|fed|ecb|boj|nhnn|lãi suất|tín dụng|tiền tệ|tỷ giá|usd|eur|cny|ngoại hối|dự trữ ngoại hối)\b/i,
  /\b(kinh tế|gdp|lạm phát|cpi|fdi|oda|xuất khẩu|nhập khẩu|thương mại|thuế quan|ngân sách|đầu tư công)\b/i,
  /\b(giá vàng|kim loại quý|giá dầu|khí đốt|năng lượng|hàng hóa|bất động sản|địa ốc|chuỗi cung ứng)\b/i,
  /\b(tỷ usd|triệu usd|nghìn tỷ|tỷ đồng|đầu tư|dự án|nhà máy|khu công nghiệp|hạ tầng|metro|sân bay|cảng biển)\b/i,
  /\b(trừng phạt kinh tế|cấm vận|thỏa thuận thương mại|hợp tác kinh tế|chính sách kinh tế)\b/i
];

/**
 * Deterministically checks whether a news item is relevant to an investment assistant.
 * @param {{ title: string, summary: string, category: string }} item
 * @returns {boolean}
 */
export function isRelevantNewsItem(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();

  // 1. Exclude obvious non-financial stories (accidents, crimes, entertainment, lifestyle)
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(text)) {
      const hasStrongFinancial = STRONG_FINANCIAL_SIGNALS.some((p) => p.test(text));
      const isPureAccidentOrCrime = /\b(lũ quét|sạt lở|chìm tàu|rơi máy bay|giết người|án mạng|hiếp dâm|bắt cóc|tắm nắng|mắc kẹt trên|thi thể|hoa hậu|showbiz|madam pang|bóng đá)\b/i.test(text);
      if (isPureAccidentOrCrime || !hasStrongFinancial) {
        return false;
      }
    }
  }

  // 2. Market & Company feeds are predominantly relevant unless caught by exclusions
  if (item.category === 'market' || item.category === 'company') {
    return true;
  }

  // 3. Macro and Global feeds must possess clear financial/economic relevance
  if (item.category === 'macro' || item.category === 'global') {
    return RELEVANT_MACRO_GLOBAL_SIGNALS.some((p) => p.test(text));
  }

  return true;
}

/**
 * Strips HTML tags and decodes common HTML entities.
 * @param {string} text
 * @returns {string}
 */
function cleanHtmlText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Parses an individual CafeF RSS feed URL.
 * Returns an array of normalized news items or an empty array on error.
 * @param {{ category: string, url: string }} feedConfig
 * @returns {Promise<Array<object>>}
 */
async function fetchSingleFeed(feedConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(feedConfig.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[News] Failed to fetch feed ${feedConfig.category} (${feedConfig.url}): HTTP ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parsed = xmlParser.parse(xml);
    let items = parsed?.rss?.channel?.item || [];

    if (!Array.isArray(items)) {
      items = items ? [items] : [];
    }

    const normalizedItems = [];

    for (const item of items) {
      const guidValue = typeof item.guid === 'object'
        ? (item.guid['#text'] || item.guid['__text'] || item.link)
        : (item.guid || item.link);

      const link = typeof item.link === 'string' ? item.link.trim() : String(guidValue || '').trim();
      const id = String(guidValue || link).trim();

      const rawTitle = typeof item.title === 'string'
        ? item.title
        : (item.title?.['#text'] || '');
      const title = cleanHtmlText(rawTitle);

      const rawDescription = typeof item.description === 'string'
        ? item.description
        : (item.description?.['#text'] || '');
      const summary = cleanHtmlText(rawDescription);

      let publishedAt = null;
      if (item.pubDate) {
        const parsedDate = new Date(item.pubDate);
        if (!isNaN(parsedDate.getTime())) {
          publishedAt = parsedDate.toISOString();
        }
      }

      const candidate = {
        id,
        title,
        summary,
        source: 'CafeF',
        category: feedConfig.category,
        publishedAt,
        url: link
      };

      // Filter out non-investment and irrelevant stories
      if (isRelevantNewsItem(candidate)) {
        normalizedItems.push(candidate);
      }
    }

    return normalizedItems;
  } catch (error) {
    clearTimeout(timeout);
    console.warn(`[News] Error fetching feed ${feedConfig.category} (${feedConfig.url}):`, error.message);
    return [];
  }
}

/**
 * Fetches, filters, deduplicates, sorts, and limits CafeF news from all 4 categories.
 * @param {Array<{ category: string, url: string }>} [feeds=CAFEF_FEEDS]
 * @param {number} [limit=30]
 * @returns {Promise<Array<object>>}
 */
export async function getNewsFeed(feeds = CAFEF_FEEDS, limit = 30) {
  const results = await Promise.allSettled(feeds.map((feed) => fetchSingleFeed(feed)));

  const allItems = [];
  const seenKeys = new Set();

  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      for (const item of result.value) {
        const uniqueKey = item.id || item.url;
        if (uniqueKey && !seenKeys.has(uniqueKey)) {
          seenKeys.add(uniqueKey);
          allItems.push(item);
        }
      }
    }
  }

  // Sort newest first
  allItems.sort((a, b) => {
    const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return timeB - timeA;
  });

  return allItems.slice(0, limit);
}
