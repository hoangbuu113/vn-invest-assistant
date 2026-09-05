export const STRATEGIST_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
export const STRATEGIST_REASONING_EFFORT = 'low';
export const STRATEGIST_MAX_OUTPUT_TOKENS = 8192;
export const STRATEGIST_PROMPT_VERSION = 'ai-market-strategist-actionable-v3';
export const STRATEGIST_SCHEMA_VERSION = 'ai-market-strategist-actionable-v3';
export const STRATEGIST_METHODOLOGY_VERSION = 'ai-market-strategist-v3';

export const ALLOWED_STANCES = Object.freeze([
  'defensive',
  'neutral',
  'selective_risk_on',
  'risk_on'
]);

export const ALLOWED_CONVICTIONS = Object.freeze([
  'low',
  'medium',
  'high',
  'insufficient_evidence'
]);

export const ALLOWED_CONFIDENCE_STATES = Object.freeze([
  'HIGH',
  'MEDIUM',
  'LOW',
  'INSUFFICIENT_EVIDENCE'
]);

export const ALLOWED_CONCLUSION_TYPES = Object.freeze([
  'MARKET_REGIME',
  'ASSET_BIAS',
  'THEME_PREFERENCE',
  'THEME_UNDERWEIGHT',
  'ACTION_NOW',
  'RISK',
  'INVALIDATION'
]);

export const ALLOWED_SUPPORT_STATUSES = Object.freeze([
  'supported',
  'unsupported',
  'conditional'
]);

export const ALLOWED_ASSET_CLASSES = Object.freeze([
  'vietnam_equities',
  'gold',
  'usd',
  'crypto',
  'cash'
]);

export const ALLOWED_ASSET_STANCES = Object.freeze([
  'increase',
  'hold',
  'reduce',
  'avoid',
  'watch'
]);

export const ALLOWED_PRIORITIES = Object.freeze([
  'high',
  'medium',
  'low'
]);

export const ALLOWED_THEME_STANCES = Object.freeze([
  'prefer',
  'watch'
]);

export function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const result = {};
  if (schema.type) {
    result.type = schema.type.toUpperCase();
  }
  if (schema.description) {
    result.description = schema.description;
  }
  if (Array.isArray(schema.enum)) {
    result.enum = schema.enum;
  }
  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = toGeminiSchema(prop);
    }
  }
  if (Array.isArray(schema.required)) {
    result.required = schema.required;
  }
  if (schema.items) {
    result.items = toGeminiSchema(schema.items);
  }
  return result;
}

export const MARKET_STRATEGIST_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'executiveDecision',
    'assetStrategy',
    'preferredThemes',
    'avoidOrUnderweight',
    'marketOverview',
    'keyDrivers',
    'investmentOrientation',
    'risksAndInvalidation',
    'watchNext',
    'citations'
  ],
  properties: {
    executiveDecision: {
      type: 'object',
      additionalProperties: false,
      required: ['stance', 'conviction', 'confidence', 'oneLineDecision', 'actionNow'],
      properties: {
        stance: {
          type: 'string',
          enum: ALLOWED_STANCES
        },
        conviction: {
          type: 'string',
          enum: ALLOWED_CONVICTIONS
        },
        confidence: {
          type: 'string',
          enum: ALLOWED_CONFIDENCE_STATES
        },
        oneLineDecision: { type: 'string', minLength: 10, maxLength: 300 },
        actionNow: { type: 'string', minLength: 10, maxLength: 400 }
      }
    },
    assetStrategy: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assetClass', 'stance', 'priority', 'rationale', 'evidenceIds'],
        properties: {
          assetClass: {
            type: 'string',
            enum: ALLOWED_ASSET_CLASSES
          },
          stance: {
            type: 'string',
            enum: ALLOWED_ASSET_STANCES
          },
          priority: {
            type: 'string',
            enum: ALLOWED_PRIORITIES
          },
          rationale: { type: 'string', minLength: 5, maxLength: 300 },
          evidenceIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          signalIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          conclusionType: {
            type: 'string',
            enum: ALLOWED_CONCLUSION_TYPES
          },
          supportStatus: {
            type: 'string',
            enum: ALLOWED_SUPPORT_STATUSES
          },
          limitations: { type: 'string', maxLength: 300 }
        }
      }
    },
    preferredThemes: {
      type: 'array',
      minItems: 0,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['theme', 'stance', 'rationale', 'evidenceIds'],
        properties: {
          theme: { type: 'string', minLength: 2, maxLength: 100 },
          stance: {
            type: 'string',
            enum: ALLOWED_THEME_STANCES
          },
          rationale: { type: 'string', minLength: 5, maxLength: 300 },
          evidenceIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          signalIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          conclusionType: {
            type: 'string',
            enum: ALLOWED_CONCLUSION_TYPES
          },
          supportStatus: {
            type: 'string',
            enum: ALLOWED_SUPPORT_STATUSES
          },
          limitations: { type: 'string', maxLength: 300 }
        }
      }
    },
    avoidOrUnderweight: {
      type: 'array',
      minItems: 0,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['theme', 'reason', 'evidenceIds'],
        properties: {
          theme: { type: 'string', minLength: 2, maxLength: 100 },
          reason: { type: 'string', minLength: 5, maxLength: 300 },
          evidenceIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          signalIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          conclusionType: {
            type: 'string',
            enum: ALLOWED_CONCLUSION_TYPES
          },
          supportStatus: {
            type: 'string',
            enum: ALLOWED_SUPPORT_STATUSES
          },
          limitations: { type: 'string', maxLength: 300 }
        }
      }
    },
    marketOverview: {
      type: 'object',
      additionalProperties: false,
      required: ['vietnam', 'global'],
      properties: {
        vietnam: { type: 'string', minLength: 10, maxLength: 600 },
        global: { type: 'string', minLength: 10, maxLength: 600 }
      }
    },
    keyDrivers: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['driver', 'evidenceIds'],
        properties: {
          driver: { type: 'string', minLength: 5, maxLength: 300 },
          evidenceIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          },
          signalIds: {
            type: 'array',
            minItems: 0,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 }
          }
        }
      }
    },
    investmentOrientation: {
      type: 'object',
      additionalProperties: false,
      required: ['stance', 'preferredThemes', 'pressuredThemes', 'rationale', 'evidenceIds'],
      properties: {
        stance: {
          type: 'string',
          enum: ALLOWED_STANCES
        },
        preferredThemes: {
          type: 'array',
          minItems: 0,
          maxItems: 4,
          items: { type: 'string', minLength: 2, maxLength: 100 }
        },
        pressuredThemes: {
          type: 'array',
          minItems: 0,
          maxItems: 4,
          items: { type: 'string', minLength: 2, maxLength: 100 }
        },
        rationale: { type: 'string', minLength: 10, maxLength: 600 },
        evidenceIds: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        },
        signalIds: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    },
    risksAndInvalidation: {
      type: 'object',
      additionalProperties: false,
      required: ['keyRisks', 'invalidationConditions', 'evidenceIds'],
      properties: {
        keyRisks: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string', minLength: 5, maxLength: 250 }
        },
        invalidationConditions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string', minLength: 5, maxLength: 250 }
        },
        evidenceIds: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        },
        signalIds: {
          type: 'array',
          minItems: 0,
          maxItems: 8,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    },
    watchNext: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string', minLength: 5, maxLength: 200 }
    },
    citations: {
      type: 'object',
      additionalProperties: false,
      required: ['factObservationIds', 'articleIds'],
      properties: {
        factObservationIds: {
          type: 'array',
          minItems: 0,
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        },
        articleIds: {
          type: 'array',
          minItems: 0,
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        },
        signalIds: {
          type: 'array',
          minItems: 0,
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    }
  }
});

export const STRATEGIST_SYSTEM_INSTRUCTIONS = `
Bạn là AI Market Strategist (Chiến lược gia Thị trường AI) chuyên nghiệp cho thị trường tài chính Việt Nam và quốc tế.
Bạn tổng hợp góc nhìn vĩ mô và thị trường khách quan bằng TIẾNG VIỆT dựa TRÊN DUY NHẤT gói dữ kiện đóng được cung cấp.
Chu trình tư duy bắt buộc:
OBSERVED_FACT (Dữ kiện quan sát) -> DERIVED_SIGNAL (Tín hiệu phái sinh từ máy chủ) -> AI_INTERPRETATION -> TACTICAL_ORIENTATION

TRẠNG THÁI TIN CẬY (CONFIDENCE STATES):
- HIGH: Dữ kiện đầy đủ cả về vĩ mô, thị trường cơ sở và liên thị trường. Cho phép đưa ra định hướng chọn lọc rõ ràng.
- MEDIUM: Dữ kiện đáp ứng đủ các nhóm chỉ số cốt lõi. Cho phép định hướng có điều kiện.
- LOW: Dữ kiện hạn chế hoặc có biến số xung đột. CHỈ được đưa ra định hướng QUAN SÁT (WATCH) hoặc có điều kiện nghiêm ngặt.
- INSUFFICIENT_EVIDENCE: Khi thiếu dữ liệu cơ sở quan trọng (ví dụ không có dữ liệu chứng khoán hay dữ kiện vĩ mô). Trong trường hợp này:
  + stance BẮT BUỘC là 'neutral'
  + confidence BẮT BUỘC là 'INSUFFICIENT_EVIDENCE'
  + conviction BẮT BUỘC là 'insufficient_evidence'
  + assetStrategy: mọi lớp tài sản đặt stance là 'watch' hoặc 'hold' thận trọng, TUYỆT ĐỐI KHÔNG 'increase'
  + preferredThemes và avoidOrUnderweight được để trống []
  + actionNow PHẢI nêu rõ dữ liệu thị trường hiện tại chưa đầy đủ để đưa ra hành động cụ thể
  + TUYỆT ĐỐI KHÔNG bịa đặt tỷ lệ phần trăm phân bổ (như 30-40% hay 50-60%)

QUY TẮC BẮT BUỘC VỀ BẰNG CHỨNG VÀ TRÍCH DẪN:
1. TRÍCH DẪN CHÍNH XÁC:
- Chỉ trích dẫn các ID thực tế có trong availableObservationIds, availableArticleIds, và availableSignalIds được cung cấp trong gói.
- TUYỆT ĐỐI KHÔNG dùng generic factId (ví dụ "vn.market.vnindex.close") mà PHẢI dùng exact observationId (ví dụ "vn.market.vnindex.close:2026-09-04:pub_1").
- TUYỆT ĐỐI KHÔNG trích dẫn các bài báo bị loại trừ khỏi gói.
- Cổ phiếu Việt Nam (vietnam_equities = increase) KHÔNG THỂ chỉ dựa vào CPI đơn lẻ mà BẮT BUỘC phải có tín hiệu VN_MARKET_TREND hoặc dữ kiện chứng khoán.

2. AN TOÀN SỐ LIỆU (NUMERICAL INTEGRITY):
- Mọi con số bạn nhắc đến trong văn bản (chỉ số VN-Index, CPI %, DXY, tỷ giá) PHẢI KHỚP TUYỆT ĐỐI với giá trị và đơn vị lưu trong dữ kiện quan sát tương ứng.
- Tuyệt đối KHÔNG sáng tạo số liệu (ví dụ: gán CPI = 99.99% hay giá mục tiêu cổ phiếu).

3. ĐỊNH HƯỚNG KHÁCH QUAN, KHÔNG PHẢI KHUYẾN NGHỊ CÁ NHÂN:
- Tuyệt đối không dùng các từ ngữ áp đặt: "mua ngay", "bán tháo", "giá mục tiêu", "cam kết lợi nhuận", "khuyến nghị mua/bán".
- Không có dữ liệu cá nhân hay danh mục người dùng.
- Tránh câu sáo rỗng vô nghĩa.
`.trim();
