import { XMLParser } from 'fast-xml-parser';
import { normalizeUrl } from '../url.js';
import { cleanPlainText } from '../text.js';
import { normalizePublishedAt } from '../time.js';

export const CAFEF_FEEDS = [
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
  /tai nạn|lật thuyền|rơi máy bay|chìm tàu|chìm xuồng|đắm tàu|cháy nhà|hỏa hoạn|lũ quét|sạt lở|lở đất|động đất|sóng thần|mắc kẹt|bị thương|tử vong|chết người|thiệt mạng|thương vong|ngập lụt|nạn nhân|cứu hộ|mất tích/i,
  /giết người|án mạng|sát hại|cướp giật|cướp tài sản|trộm cắp|hiếp dâm|bắt cóc|lừa tình|đánh ghen|ma túy|tử thi|thi thể|huyết án|bắn chết|đâm chết|tự tử|hành hung|tội phạm/i,
  /showbiz|hoa hậu|hoa khôi|người mẫu|diễn viên|ca sĩ|phim ảnh|rạp chiếu|gameshow|concert|sao việt|sao hàn|sao hoa ngữ|đám cưới|scandal|bóng đá|bàn thắng|vô địch|cầu thủ|madam pang|fifa|aff cup|world cup|tiền đạo|huấn luyện viên/i,
  /tử vi|cung hoàng đạo|phong thủy|mẹo vặt|làm đẹp|giảm cân|tắm nắng|nghỉ dưỡng|món ăn|ẩm thực|đặc sản|chữa bệnh|ung thư|bệnh viện|sức khỏe|bánh quy|rắn hổ mang|động vật hoang dã|thịt chó|quái vật|sinh vật lạ|kỳ lạ|chuyện lạ|bí ẩn|vũ trụ sâu|người ngoài hành tinh/i,
  /tiêm kích|xe tăng vứt xó|vận tải cơ|không chiến|bắn hạ|tên lửa phòng không|súng đạn/i
];

const GLOBAL_FINANCIAL_REGEX = /chứng khoán|cổ phiếu|cổ phần|cổ tức|trái phiếu|lợi suất|yield|stock|shares|equity|etf|quỹ đầu tư|fund|wall street|s&p 500|nasdaq|dow jones|nikkei|ipo|m&a|sáp nhập|thâu tóm|niêm yết|vốn hóa|ngân hàng|bank|central bank|fed|cục dự trữ liên bang|ecb|boj|pbc|nhnn|lãi suất|interest rate|tín dụng|credit|chính sách tiền tệ|tiền tệ|tỷ giá|ngoại tệ|ngoại hối|forex|fx|usd|eur|jpy|cny|nhân dân tệ|đô la|dự trữ ngoại hối|kinh tế|economy|economic|gdp|lạm phát|inflation|giảm phát|deflation|suy thoái|recession|cpi|pmi|thất nghiệp|nợ công|ngân sách|tài khóa|thương mại|trade|xuất khẩu|export|nhập khẩu|import|thuế quan|tariff|fdi|chuỗi cung ứng|supply chain|cấm vận|trừng phạt kinh tế|sanction|hiệp định thương mại|giá vàng|vàng|gold|giá dầu|dầu mỏ|dầu brent|dầu wti|crude oil|khí đốt|năng lượng|hàng hóa|commodity|opec|bất động sản|real estate|doanh nghiệp|tập đoàn|công ty|hãng|tỷ phú|doanh thu|lợi nhuận|phá sản|tỷ usd|triệu usd|nghìn tỷ|đầu tư|nhà máy|bán dẫn|semiconductor|chip|công nghệ cao/i;

const MACRO_FINANCIAL_REGEX = /kinh tế|gdp|lạm phát|cpi|fdi|oda|xuất khẩu|nhập khẩu|thương mại|thuế|ngân sách|đầu tư công|vốn đầu tư|lãi suất|tín dụng|ngân hàng|tỷ giá|quy hoạch|hạ tầng|khu công nghiệp|nhà máy|sân bay|cảng biển|cao tốc|metro|đường sắt|năng lượng|điện|bất động sản|địa ốc|thị trường|doanh nghiệp|tập đoàn|công ty|tỷ đồng|nghìn tỷ|triệu usd|tỷ usd|chính sách|thủ tướng|bộ tài chính|bộ công thương/i;

/**
 * Deterministically checks whether a news item is relevant to an investment assistant.
 * @param {{ title: string, summary: string, category: string }} item
 * @returns {boolean}
 */
export function isRelevantNewsItem(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();

  for (const regex of EXCLUSION_REGEXES) {
    if (regex.test(text)) {
      return false;
    }
  }

  if (item.category === 'global') {
    return GLOBAL_FINANCIAL_REGEX.test(text);
  }

  if (item.category === 'macro') {
    return MACRO_FINANCIAL_REGEX.test(text);
  }

  return true;
}

/**
 * Parses raw XML text from CafeF RSS.
 * @param {string} xml
 * @param {string} category
 * @returns {{ items: Array<object>, skippedCount: number }}
 */
export function parseCafeFRss(xml, category = 'market') {
  if (!xml || typeof xml !== 'string') {
    return { items: [], skippedCount: 0 };
  }

  const parsed = xmlParser.parse(xml);
  let rawItems = parsed?.rss?.channel?.item || [];
  if (!Array.isArray(rawItems)) {
    rawItems = rawItems ? [rawItems] : [];
  }

  const items = [];
  let skippedCount = 0;

  for (const item of rawItems) {
    const guidVal = typeof item.guid === 'object'
      ? (item.guid['#text'] || item.guid['__text'] || item.link)
      : (item.guid || item.link);

    const rawLink = typeof item.link === 'string' ? item.link.trim() : String(guidVal || '').trim();
    const normalizedLink = normalizeUrl(rawLink);

    const rawTitle = typeof item.title === 'string' ? item.title : (item.title?.['#text'] || '');
    const title = cleanPlainText(rawTitle);

    const rawDesc = typeof item.description === 'string' ? item.description : (item.description?.['#text'] || '');
    const summary = cleanPlainText(rawDesc) || null;

    const publishedAt = normalizePublishedAt(item.pubDate);

    // Validation: title non-empty, URL valid http(s), publishedAt trustworthy
    if (!title || !normalizedLink || !publishedAt) {
      skippedCount++;
      continue;
    }

    const candidate = {
      id: String(guidVal || normalizedLink).trim(),
      title,
      summary,
      url: normalizedLink,
      source: 'CafeF',
      sourceId: 'cafef',
      language: 'vi',
      category,
      publishedAt
    };

    if (isRelevantNewsItem(candidate)) {
      items.push(candidate);
    }
  }

  return { items, skippedCount };
}

/**
 * Fetches and aggregates news from all 4 CafeF feeds.
 * @param {object} [options]
 * @param {Array<{ category: string, url: string }>} [options.feeds=CAFEF_FEEDS]
 * @param {number} [options.timeoutMs=8000]
 * @param {Function} [options.fetchFn=fetch]
 * @returns {Promise<object>}
 */
export async function fetchCafeFNews({
  feeds = CAFEF_FEEDS,
  timeoutMs = 8000,
  fetchFn = fetch
} = {}) {
  const feedResults = await Promise.allSettled(
    feeds.map(async (feed) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetchFn(feed.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
          }
        });
        clearTimeout(timeout);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const text = await res.text();
        return parseCafeFRss(text, feed.category);
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    })
  );

  const successfulFeedItems = [];
  let totalSkipped = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const res of feedResults) {
    if (res.status === 'fulfilled') {
      successCount++;
      successfulFeedItems.push(...res.value.items);
      totalSkipped += res.value.skippedCount;
    } else {
      failureCount++;
    }
  }

  const fetchedAt = new Date().toISOString();

  if (successCount === 0) {
    return {
      sourceId: 'cafef',
      name: 'CafeF',
      language: 'vi',
      status: 'error',
      fetchedAt,
      items: [],
      articleCount: 0,
      skippedCount: totalSkipped,
      errorCode: 'SOURCE_FETCH_FAILED'
    };
  }

  const status = failureCount > 0
    ? 'degraded'
    : (successfulFeedItems.length === 0 ? 'empty' : 'ok');

  return {
    sourceId: 'cafef',
    name: 'CafeF',
    language: 'vi',
    status,
    fetchedAt,
    items: successfulFeedItems,
    articleCount: successfulFeedItems.length,
    skippedCount: totalSkipped,
    errorCode: null
  };
}

