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

// Non-investment general noise exclusion patterns (accidents, crimes, celebrity, lifestyle, sports, weird trivia)
const EXCLUSION_REGEXES = [
  // Accidents, Natural Disasters, Casualties
  /tai nạn|lật thuyền|rơi máy bay|chìm tàu|chìm xuồng|đắm tàu|cháy nhà|hỏa hoạn|lũ quét|sạt lở|lở đất|động đất|sóng thần|mắc kẹt|bị thương|tử vong|chết người|thiệt mạng|thương vong|ngập lụt|nạn nhân|cứu hộ|mất tích/i,
  // Crime, Violence, Police Blotter
  /giết người|án mạng|sát hại|cướp giật|cướp tài sản|trộm cắp|hiếp dâm|bắt cóc|lừa tình|đánh ghen|ma túy|tử thi|thi thể|huyết án|bắn chết|đâm chết|tự tử|hành hung|tội phạm/i,
  // Entertainment, Showbiz, Sports
  /showbiz|hoa hậu|hoa khôi|người mẫu|diễn viên|ca sĩ|phim ảnh|rạp chiếu|gameshow|concert|sao việt|sao hàn|sao hoa ngữ|đám cưới|scandal|bóng đá|bàn thắng|vô địch|cầu thủ|madam pang|fifa|aff cup|world cup|tiền đạo|huấn luyện viên/i,
  // Lifestyle, Health, Quirky Trivia, Clickbait
  /tử vi|cung hoàng đạo|phong thủy|mẹo vặt|làm đẹp|giảm cân|tắm nắng|nghỉ dưỡng|món ăn|ẩm thực|đặc sản|chữa bệnh|ung thư|bệnh viện|sức khỏe|bánh quy|rắn hổ mang|động vật hoang dã|thịt chó|quái vật|sinh vật lạ|kỳ lạ|chuyện lạ|bí ẩn|vũ trụ sâu|người ngoài hành tinh/i,
  // Pure Military Hardware / Skirmish Trivia without economic context
  /tiêm kích|xe tăng vứt xó|vận tải cơ|không chiến|bắn hạ|tên lửa phòng không|súng đạn/i
];

// Global finance positive signals (Must contain at least one finance/economy/market concept)
const GLOBAL_FINANCIAL_REGEX = /chứng khoán|cổ phiếu|cổ phần|cổ tức|trái phiếu|lợi suất|yield|stock|shares|equity|etf|quỹ đầu tư|fund|wall street|s&p 500|nasdaq|dow jones|nikkei|ipo|m&a|sáp nhập|thâu tóm|niêm yết|vốn hóa|ngân hàng|bank|central bank|fed|cục dự trữ liên bang|ecb|boj|pbc|nhnn|lãi suất|interest rate|tín dụng|credit|chính sách tiền tệ|tiền tệ|tỷ giá|ngoại tệ|ngoại hối|forex|fx|usd|eur|jpy|cny|nhân dân tệ|đô la|dự trữ ngoại hối|kinh tế|economy|economic|gdp|lạm phát|inflation|giảm phát|deflation|suy thoái|recession|cpi|pmi|thất nghiệp|nợ công|ngân sách|tài khóa|thương mại|trade|xuất khẩu|export|nhập khẩu|import|thuế quan|tariff|fdi|chuỗi cung ứng|supply chain|cấm vận|trừng phạt kinh tế|sanction|hiệp định thương mại|giá vàng|vàng|gold|giá dầu|dầu mỏ|dầu brent|dầu wti|crude oil|khí đốt|năng lượng|hàng hóa|commodity|opec|bất động sản|real estate|doanh nghiệp|tập đoàn|công ty|hãng|tỷ phú|doanh thu|lợi nhuận|phá sản|tỷ usd|triệu usd|nghìn tỷ|đầu tư|nhà máy|bán dẫn|semiconductor|chip|công nghệ cao/i;

// Macro positive signals (Macroeconomics, infrastructure, fiscal, industry, trade)
const MACRO_FINANCIAL_REGEX = /kinh tế|gdp|lạm phát|cpi|fdi|oda|xuất khẩu|nhập khẩu|thương mại|thuế|ngân sách|đầu tư công|vốn đầu tư|lãi suất|tín dụng|ngân hàng|tỷ giá|quy hoạch|hạ tầng|khu công nghiệp|nhà máy|sân bay|cảng biển|cao tốc|metro|đường sắt|năng lượng|điện|bất động sản|địa ốc|thị trường|doanh nghiệp|tập đoàn|công ty|tỷ đồng|nghìn tỷ|triệu usd|tỷ usd|chính sách|thủ tướng|bộ tài chính|bộ công thương/i;

/**
 * Deterministically checks whether a news item is relevant to an investment assistant.
 * @param {{ title: string, summary: string, category: string }} item
 * @returns {boolean}
 */
export function isRelevantNewsItem(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();

  // 1. General exclusion check for non-investment noise (accidents, crimes, entertainment, weird trivia)
  for (const regex of EXCLUSION_REGEXES) {
    if (regex.test(text)) {
      return false;
    }
  }

  // 2. Global feed articles must have a clear financial/economic/market signal
  if (item.category === 'global') {
    return GLOBAL_FINANCIAL_REGEX.test(text);
  }

  // 3. Macro feed articles must possess economic/investment context
  if (item.category === 'macro') {
    return MACRO_FINANCIAL_REGEX.test(text);
  }

  // 4. Market and Company feed items are inherently financial unless caught by exclusions
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
