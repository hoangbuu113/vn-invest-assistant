import { createHash } from 'node:crypto';
import { privateSupabase } from './supabase.js';
import { parseSbvWeeklyRelease } from './regime/providers/sbv.js';
import { applyRuntimeFreshness } from './context/freshnessPolicy.js';

export const MANUAL_MONETARY_EVIDENCE_VERSION = 'manual-official-monetary-v1';
export const MONETARY_REPLAY_MODES = Object.freeze({
  AS_OPERATED: 'AS_OPERATED',
  RECONSTRUCTED: 'RECONSTRUCTED'
});
export const MONETARY_PARSER_PROFILES = Object.freeze({
  SBV_WEEKLY_INTERBANK_V1: 'SBV_WEEKLY_INTERBANK_V1'
});

const FORBIDDEN_DIRECT_FACT_KEYS = Object.freeze(['value', 'rate', 'numericValue', 'observation', 'observations']);
const memoryVintages = new Map();

function explicitNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Manual monetary ingestion requires explicit valid now');
  return now.toISOString();
}

function officialSbvUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'sbv.gov.vn' || url.hostname.endsWith('.sbv.gov.vn'));
  } catch {
    return false;
  }
}

function normalizedVietnamese(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

function extractPublishedAt(artifactText) {
  const patterns = [
    /(?:article:published_time|datePublished)["']?\s*(?:content|:)\s*=*["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(artifactText);
    if (!match) continue;
    const ms = Date.parse(match[1]);
    if (Number.isFinite(ms) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(match[1].trim())) return new Date(ms).toISOString();
  }
  return null;
}

function assertNoDirectFactInput(payload) {
  for (const key of FORBIDDEN_DIRECT_FACT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      throw Object.assign(new Error('RAW_NUMBER_CANNOT_BECOME_OFFICIAL_EVIDENCE'), { code: 'RAW_NUMBER_CANNOT_BECOME_OFFICIAL_EVIDENCE' });
    }
  }
}

export function validateOfficialMonetaryProvenance({ sourceUrl, documentId, artifactText } = {}) {
  if (!officialSbvUrl(sourceUrl)) throw Object.assign(new Error('INVALID_OFFICIAL_MONETARY_PROVENANCE'), { code: 'INVALID_OFFICIAL_MONETARY_PROVENANCE' });
  if (typeof documentId !== 'string' || !documentId.trim()) throw Object.assign(new Error('OFFICIAL_DOCUMENT_ID_REQUIRED'), { code: 'OFFICIAL_DOCUMENT_ID_REQUIRED' });
  if (typeof artifactText !== 'string' || artifactText.trim().length < 80) throw Object.assign(new Error('OFFICIAL_SOURCE_ARTIFACT_REQUIRED'), { code: 'OFFICIAL_SOURCE_ARTIFACT_REQUIRED' });
  const normalizedArtifact = normalizedVietnamese(artifactText);
  if (!/(ngan hang nha nuoc|state bank of vietnam|\bsbv\b)/i.test(normalizedArtifact)) {
    throw Object.assign(new Error('OFFICIAL_ISSUER_NOT_VERIFIED'), { code: 'OFFICIAL_ISSUER_NOT_VERIFIED' });
  }
  const sourceAvailableAt = extractPublishedAt(artifactText);
  if (!sourceAvailableAt) throw Object.assign(new Error('TRUSTED_SOURCE_AVAILABILITY_REQUIRED'), { code: 'TRUSTED_SOURCE_AVAILABILITY_REQUIRED' });
  return Object.freeze({ originIssuer: 'SBV', publisher: 'SBV', deliveryProvider: 'MANUAL_VERIFIED_OFFICIAL_IMPORT', sourceAvailableAt });
}

export function createManualOfficialMonetaryVintage(payload = {}, { now } = {}) {
  assertNoDirectFactInput(payload);
  const acceptedAt = explicitNow(now);
  const provenance = validateOfficialMonetaryProvenance(payload);
  if (payload.attachmentUrl != null && !officialSbvUrl(payload.attachmentUrl)) {
    throw Object.assign(new Error('INVALID_OFFICIAL_MONETARY_ATTACHMENT'), { code: 'INVALID_OFFICIAL_MONETARY_ATTACHMENT' });
  }
  const parserProfileVersion = payload.parserProfileVersion;
  if (parserProfileVersion !== MONETARY_PARSER_PROFILES.SBV_WEEKLY_INTERBANK_V1) {
    throw Object.assign(new Error('MONETARY_PARSER_PROFILE_UNCONFIGURED'), { code: 'MONETARY_PARSER_PROFILE_UNCONFIGURED' });
  }
  const parsed = parseSbvWeeklyRelease(payload.artifactText, payload.sourceUrl, payload.attachmentUrl || null);
  if (!parsed) throw Object.assign(new Error('OFFICIAL_MONETARY_ARTIFACT_VALIDATION_FAILED'), { code: 'OFFICIAL_MONETARY_ARTIFACT_VALIDATION_FAILED' });

  const contentHash = createHash('sha256').update(payload.artifactText).digest('hex');
  const vintageId = `monetary_vintage:${createHash('sha256').update(`SBV:${contentHash}:${parserProfileVersion}`).digest('hex').slice(0, 32)}`;
  const sourceAvailableMs = Date.parse(provenance.sourceAvailableAt);
  const firstSeenMs = Date.parse(acceptedAt);
  const systemKnowableAt = new Date(Math.max(sourceAvailableMs, firstSeenMs)).toISOString();
  const observationId = `vn.monetary.rate.vnd_overnight:${parsed.referenceWeekEnd}:h_${contentHash.slice(0, 12)}`;

  return Object.freeze({
    vintageId,
    supersedes: typeof payload.supersedes === 'string' && payload.supersedes.trim() ? payload.supersedes.trim() : null,
    factId: 'vn.monetary.rate.vnd_overnight',
    observationId,
    value: parsed.vndOvernightRatePct,
    unit: '%',
    referencePeriod: `${parsed.referenceWeekStart}/${parsed.referenceWeekEnd}`,
    observationDate: parsed.referenceWeekEnd,
    effectiveFrom: `${parsed.referenceWeekStart}T00:00:00.000Z`,
    effectiveTo: `${parsed.referenceWeekEnd}T23:59:59.999Z`,
    originIssuer: provenance.originIssuer,
    publisher: provenance.publisher,
    deliveryProvider: provenance.deliveryProvider,
    provenanceFamily: 'OFFICIAL_SBV',
    dependencyGroup: 'OFFICIAL_SBV',
    supportScope: 'INTERBANK_CONDITIONS',
    supportPathId: payload.attachmentUrl ? 'PATH_SBV_VERIFIED_ATTACHMENT' : 'PATH_SBV_DIRECT',
    authorityLevel: 'REGULATORY_OFFICIAL',
    sourceUrl: payload.sourceUrl,
    attachmentUrl: payload.attachmentUrl || null,
    documentId: payload.documentId.trim(),
    contentHash,
    sourceAvailableAt: provenance.sourceAvailableAt,
    trustedSystemFirstSeenAt: acceptedAt,
    systemKnowableAt,
    retrievedAt: acceptedAt,
    validatedAt: acceptedAt,
    acceptedAt,
    parserProfileVersion,
    methodologyVersion: MANUAL_MONETARY_EVIDENCE_VERSION,
    replayMode: MONETARY_REPLAY_MODES.AS_OPERATED,
    artifactText: payload.artifactText
  });
}

function toRow(item) {
  return {
    vintage_id: item.vintageId,
    supersedes: item.supersedes,
    fact_id: item.factId,
    observation_id: item.observationId,
    value: item.value,
    unit: item.unit,
    reference_period: item.referencePeriod,
    observation_date: item.observationDate,
    effective_from: item.effectiveFrom,
    effective_to: item.effectiveTo,
    origin_issuer: item.originIssuer,
    publisher: item.publisher,
    delivery_provider: item.deliveryProvider,
    provenance_family: item.provenanceFamily,
    dependency_group: item.dependencyGroup,
    support_scope: item.supportScope,
    support_path_id: item.supportPathId,
    authority_level: item.authorityLevel,
    source_url: item.sourceUrl,
    attachment_url: item.attachmentUrl,
    document_id: item.documentId,
    content_hash: item.contentHash,
    source_available_at: item.sourceAvailableAt,
    system_first_seen_at: item.trustedSystemFirstSeenAt,
    system_knowable_at: item.systemKnowableAt,
    retrieved_at: item.retrievedAt,
    validated_at: item.validatedAt,
    accepted_at: item.acceptedAt,
    parser_profile_version: item.parserProfileVersion,
    methodology_version: item.methodologyVersion,
    replay_mode: item.replayMode,
    artifact_text: item.artifactText
  };
}

function fromRow(row) {
  if (!row) return null;
  return Object.freeze({
    vintageId: row.vintage_id, supersedes: row.supersedes, factId: row.fact_id,
    observationId: row.observation_id, value: Number(row.value), unit: row.unit,
    referencePeriod: row.reference_period, observationDate: row.observation_date,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
    originIssuer: row.origin_issuer, publisher: row.publisher, deliveryProvider: row.delivery_provider,
    provenanceFamily: row.provenance_family, dependencyGroup: row.dependency_group,
    supportScope: row.support_scope, supportPathId: row.support_path_id,
    authorityLevel: row.authority_level, sourceUrl: row.source_url, attachmentUrl: row.attachment_url,
    documentId: row.document_id, contentHash: row.content_hash,
    sourceAvailableAt: row.source_available_at, trustedSystemFirstSeenAt: row.system_first_seen_at,
    systemKnowableAt: row.system_knowable_at, retrievedAt: row.retrieved_at,
    validatedAt: row.validated_at, acceptedAt: row.accepted_at,
    parserProfileVersion: row.parser_profile_version, methodologyVersion: row.methodology_version,
    replayMode: row.replay_mode, artifactText: row.artifact_text
  });
}

function testMode() {
  return process.env.NODE_ENV === 'test' || process.execArgv.some((arg) => String(arg).includes('--test'));
}

function resolveClient(client) {
  if (client !== undefined) return client;
  return testMode() ? null : privateSupabase;
}

export async function importManualOfficialMonetaryEvidence(payload, { now, client } = {}) {
  const vintage = createManualOfficialMonetaryVintage(payload, { now });
  const target = resolveClient(client);
  if (!target) {
    if (!testMode()) throw Object.assign(new Error('MONETARY_EVIDENCE_REPOSITORY_UNCONFIGURED'), { code: 'MONETARY_EVIDENCE_REPOSITORY_UNCONFIGURED' });
    memoryVintages.set(vintage.vintageId, vintage);
    return Object.freeze({ vintage, isDurable: false });
  }
  const query = target.from('official_monetary_evidence_vintages').upsert(toRow(vintage), { onConflict: 'vintage_id', ignoreDuplicates: true });
  const { data, error } = typeof query?.select === 'function' ? await query.select('*') : await query;
  if (error) throw Object.assign(new Error('MONETARY_EVIDENCE_PERSISTENCE_FAILED'), { code: 'MONETARY_EVIDENCE_PERSISTENCE_FAILED', cause: error });
  return Object.freeze({ vintage: Array.isArray(data) && data[0] ? fromRow(data[0]) : vintage, isDurable: true });
}

export async function listManualOfficialMonetaryEvidence({ cutoff, client } = {}) {
  const cutoffIso = explicitNow(cutoff);
  const target = resolveClient(client);
  let items;
  if (!target) {
    if (!testMode()) throw Object.assign(new Error('MONETARY_EVIDENCE_REPOSITORY_UNCONFIGURED'), { code: 'MONETARY_EVIDENCE_REPOSITORY_UNCONFIGURED' });
    items = [...memoryVintages.values()];
  } else {
    const { data, error } = await target.from('official_monetary_evidence_vintages').select('*').lte('system_knowable_at', cutoffIso).order('system_knowable_at', { ascending: false });
    if (error) throw Object.assign(new Error('MONETARY_EVIDENCE_QUERY_FAILED'), { code: 'MONETARY_EVIDENCE_QUERY_FAILED', cause: error });
    items = (Array.isArray(data) ? data : []).map(fromRow).filter(Boolean);
  }
  return items.filter((item) => Date.parse(item.systemKnowableAt) <= Date.parse(cutoffIso)).map((item) => applyRuntimeFreshness({
    id: item.observationId,
    observationId: item.observationId,
    factId: item.factId,
    pillar: 'monetary',
    label: 'Lãi suất VND qua đêm bình quân tuần',
    value: item.value,
    unit: item.unit,
    referenceTime: item.referencePeriod,
    observedAt: item.effectiveTo,
    publishedAt: item.sourceAvailableAt,
    sourceAvailableAt: item.sourceAvailableAt,
    firstSeenAt: item.trustedSystemFirstSeenAt,
    fetchedAt: item.retrievedAt,
    source: 'SBV_MANUAL_VERIFIED',
    status: 'available',
    freshness: 'fresh',
    eventStillEffective: true,
    authorityLevel: item.authorityLevel,
    originIssuer: item.originIssuer,
    publisher: item.publisher,
    deliveryProvider: item.deliveryProvider,
    provenanceFamily: item.provenanceFamily,
    dependencyGroup: item.dependencyGroup,
    supportScope: item.supportScope,
    supportPathId: item.supportPathId,
    sourceContentHash: item.contentHash,
    provenance: Object.freeze({ sourceUrl: item.sourceUrl, attachmentUrl: item.attachmentUrl, documentId: item.documentId, vintageId: item.vintageId })
  }, cutoff));
}

export function resolveMonetaryReplayTime(vintage, replayMode = MONETARY_REPLAY_MODES.AS_OPERATED) {
  if (!Object.values(MONETARY_REPLAY_MODES).includes(replayMode)) throw new TypeError('Invalid monetary replay mode');
  return replayMode === MONETARY_REPLAY_MODES.RECONSTRUCTED ? vintage.sourceAvailableAt : vintage.systemKnowableAt;
}

export function clearManualMonetaryEvidenceForTest() {
  memoryVintages.clear();
}
