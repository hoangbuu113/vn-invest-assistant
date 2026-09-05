import {
  CLAIM_STATUS,
  CLAIM_AUTHORITY_LEVELS,
  createMarketClaim,
  buildConfidenceDimensions
} from './claimModel.js';
import {
  SOURCE_FAMILIES,
  DEPENDENCY_GROUPS,
  aggregateEvidenceSources,
  classifySourceFamily,
  isFamilyIndependent,
  isDependencyIndependent,
  resolveClaimDependency
} from './sourceFamily.js';
import { doesEvidenceSupportClaim } from './claimExtractor.js';

const EPSILON_PERCENT = 0.02;
const EPSILON_CURRENCY = 1.0;

function isNumericDifferent(valA, valB, unit) {
  if (valA === null || valB === null || valA === undefined || valB === undefined) return false;
  const tol = unit === '%' ? EPSILON_PERCENT : EPSILON_CURRENCY;
  return Math.abs(Number(valA) - Number(valB)) > tol;
}

/**
 * Reconciles candidate claims against evidence items and other claims.
 * Performs deterministic source-family independence tracking, supersession handling,
 * and contradiction detection without comparing economically distinct metrics.
 *
 * @param {Array} candidateClaims - List of MarketClaim objects or raw claim definitions
 * @param {Array} evidenceItems - Array of { evidenceId, evidenceType, sourceFamily, ...rawEvidence }
 * @returns {Array} List of reconciled, immutable MarketClaim objects
 */
export function reconcileClaims(candidateClaims = [], evidenceItems = []) {
  if (!Array.isArray(candidateClaims) || candidateClaims.length === 0) {
    return [];
  }

  // 1. Group claims by semantic metric baseline: subject + referencePeriod + scope
  const groups = new Map();
  for (const claim of candidateClaims) {
    if (!claim) continue;
    const groupKey = `${claim.subject}::${claim.referencePeriod || 'any'}::${claim.scope || 'default'}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(claim);
  }

  const reconciledClaims = [];

  for (const [groupKey, claimsInGroup] of groups.entries()) {
    // A. Check for vintage progression / supersession (e.g. preliminary vs revised/final)
    const preliminaryClaim = claimsInGroup.find(
      (c) => c.revisionMarker === 'preliminary' || c.revisionMarker === 'vn-sb'
    );
    const revisedOrFinalClaim = claimsInGroup.find(
      (c) =>
        c.revisionMarker === 'revised' ||
        c.revisionMarker === 'final' ||
        c.revisionMarker === 'vn-dc' ||
        c.revisionMarker === 'vn-ct'
    );

    // B. Reconcile each claim in group
    for (const claim of claimsInGroup) {
      // Find all supporting evidence items
      const rawSupportingEvidence = [];
      for (const ev of evidenceItems) {
        if (!ev) continue;
        if (doesEvidenceSupportClaim(ev, claim)) {
          rawSupportingEvidence.push(ev);
        }
      }

      // Aggregate independent source families & dependency groups
      let sourceCount = 0;
      let independentSourceCount = 0;
      let sourceFamilies = [];
      let independentFamilies = [];
      let supportingEvidence = [];

      if (rawSupportingEvidence.length > 0) {
        const agg = aggregateEvidenceSources(rawSupportingEvidence, {
          subject: claim.subject,
          claimType: claim.claimType
        });
        sourceCount = agg.sourceCount;
        independentSourceCount = agg.independentSourceCount;
        sourceFamilies = agg.sourceFamilies;
        independentFamilies = agg.independentFamilies;

        // Annotate each supporting evidence item with resolved dependencyGroup and truthful isIndependent flag
        const seenIndependentGroups = new Set();
        supportingEvidence = rawSupportingEvidence.map((ev) => {
          const directFamily = ev.sourceFamily || classifySourceFamily(ev);
          const depGroup =
            ev.dependencyGroup ||
            resolveClaimDependency({
              publisherFamily: directFamily,
              subject: ev.subject || claim.subject || ev.factId,
              claimType: ev.claimType || claim.claimType,
              url: ev.url,
              sourceId: ev.sourceId || ev.source,
              publisher: ev.publisher,
              title: ev.title,
              summary: ev.summary || ev.excerpt,
              text: ev.text,
              snippet: ev.snippet || ''
            });

          const isDepIndep = isDependencyIndependent(depGroup);
          let isItemIndependent = false;
          if (isDepIndep && !seenIndependentGroups.has(depGroup)) {
            seenIndependentGroups.add(depGroup);
            isItemIndependent = true;
          }

          return {
            ...ev,
            sourceFamily: directFamily,
            dependencyGroup: depGroup,
            isIndependent: isItemIndependent
          };
        });
      } else {
        sourceCount = claim.sourceCount || 1;
        independentSourceCount = claim.independentSourceCount !== undefined
          ? claim.independentSourceCount
          : (claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL ? 1 : 0);
        sourceFamilies = claim.sourceFamilies || [];
        independentFamilies = claim.independentFamilies || [];
      }

      let supportStatus = claim.supportStatus;
      let revisionOf = claim.revisionOf || null;
      let limitations = claim.limitations || null;
      let contradictionCount = claim.contradictionCount || 0;

      // 1. Check Supersession
      const isThisPreliminary = claim.revisionMarker === 'preliminary' || claim.revisionMarker === 'vn-sb';
      if (isThisPreliminary && revisedOrFinalClaim && revisedOrFinalClaim !== claim) {
        supportStatus = CLAIM_STATUS.SUPERSEDED;
        limitations = `Số liệu sơ bộ đã được thay thế bởi ấn bản điều chỉnh/chính thức (${revisedOrFinalClaim.claimId}).`;
      } else if (
        (claim.revisionMarker === 'revised' || claim.revisionMarker === 'final') &&
        preliminaryClaim &&
        preliminaryClaim !== claim
      ) {
        revisionOf = preliminaryClaim.claimId;
      }

      // 2. Check Contradiction against peers in same group
      // Exclude supersession pairs (preliminary vs revised is NOT contradiction)
      if (supportStatus !== CLAIM_STATUS.SUPERSEDED) {
        for (const peer of claimsInGroup) {
          if (peer === claim) continue;

          const isPeerSuperseded =
            peer.revisionMarker === 'preliminary' &&
            (claim.revisionMarker === 'revised' || claim.revisionMarker === 'final');
          const isClaimSuperseded =
            claim.revisionMarker === 'preliminary' &&
            (peer.revisionMarker === 'revised' || peer.revisionMarker === 'final');

          if (isPeerSuperseded || isClaimSuperseded) {
            // Legitimate revision progression, not a contradiction
            continue;
          }

          // Same subject, period, scope: check numeric difference
          if (isNumericDifferent(claim.numericValue, peer.numericValue, claim.unit)) {
            contradictionCount++;

            // Check authority hierarchy: Official outranks secondary media
            const isClaimOfficial = claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL;
            const isPeerOfficial = peer.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL;

            if (isClaimOfficial && !isPeerOfficial) {
              // Official claim maintains authority, notes contradiction
              limitations = `Tồn tại báo cáo thứ cấp đưa số liệu mâu thuẫn (${peer.numericValue} ${peer.unit || ''}); ưu tiên số liệu chính thức.`;
            } else if (!isClaimOfficial && isPeerOfficial) {
              // Secondary media contradicts official source
              supportStatus = CLAIM_STATUS.CONTRADICTED;
              limitations = `Số liệu khác biệt so với công bố chính thức (${peer.numericValue} ${peer.unit || ''}); không được coi là sự thật xác lập.`;
            } else {
              // Both peers have same standing
              supportStatus = CLAIM_STATUS.CONTRADICTED;
              limitations = `Tồn tại xung đột dữ liệu chưa được giải quyết giữa các nguồn công bố (${claim.numericValue} vs ${peer.numericValue}).`;
            }
          }
        }
      }

      // 3. Assign normal status if not contradicted or superseded
      if (supportStatus !== CLAIM_STATUS.SUPERSEDED && supportStatus !== CLAIM_STATUS.CONTRADICTED) {
        if (independentSourceCount >= 2) {
          supportStatus = CLAIM_STATUS.CORROBORATED;
        } else if (independentSourceCount === 1) {
          if (
            claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.PRIMARY_OFFICIAL ||
            claim.authorityLevel === CLAIM_AUTHORITY_LEVELS.MARKET_REFERENCE
          ) {
            supportStatus = CLAIM_STATUS.SUPPORTED;
          } else {
            supportStatus = CLAIM_STATUS.SINGLE_SOURCE;
          }
        } else {
          supportStatus = CLAIM_STATUS.INSUFFICIENT_EVIDENCE;
          if (!limitations) {
            limitations = 'Không có đủ bằng chứng nguồn độc lập hỗ trợ xác thực.';
          }
        }
      }

      // Build transparent confidence dimensions
      const confidenceDimensions = buildConfidenceDimensions({
        authorityLevel: claim.authorityLevel,
        publishedAt: claim.publishedAt,
        independentSourceCount,
        completeness: 'COMPLETE',
        contradictionCount,
        directVsDerived: claim.directVsDerived,
        revisionState: claim.revisionMarker || (supportStatus === CLAIM_STATUS.SUPERSEDED ? 'SUPERSEDED' : 'CURRENT')
      });

      const updatedClaim = createMarketClaim({
        ...claim,
        supportStatus,
        sourceCount: Math.max(sourceCount, 1),
        independentSourceCount,
        contradictionCount,
        revisionOf,
        confidenceDimensions,
        limitations
      });

      reconciledClaims.push({
        claim: updatedClaim,
        supportingEvidence,
        sourceFamilies,
        independentFamilies
      });
    }
  }

  return reconciledClaims;
}
