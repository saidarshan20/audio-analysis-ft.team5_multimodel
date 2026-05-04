/**
 * audio-quality.ts — Derives perceptual audio quality scores from raw
 * waveform / spectrogram data (or uses backend-supplied values when available).
 */

import { AudioAnalysisResult } from '../services';

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export const avg = (arr: number[]) =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

export const mapToScore = (v: number, lo: number, hi: number) =>
  clamp(((v - lo) / (hi - lo)) * 100, 0, 100);

export const percentile = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor((p / 100) * (sorted.length - 1))];
};

export interface AudioQualityView {
  score: number;
  baseScore: number | null;
  adjustedScore: number | null;
  noisePenaltyPoints: number;
  dominantNoiseCauses: string[];
  rating: string;
  summary: string;
  snrDb: number;
  compositePercent: number;
  confidence: number;
  source: 'backend' | 'estimated';
  showEstimatedBadge: boolean;
  contentType: string;
  metrics: { snr: number; loudness: number; clarity: number; cleanliness: number };
}

export function deriveAudioQuality(result: AudioAnalysisResult): AudioQualityView {
  // Use backend quality only when payload is complete and scored.
  if (
    result.audio_quality &&
    result.audio_quality.overall_score !== null &&
    result.audio_quality.overall_score !== undefined &&
    !!result.audio_quality.score_version
  ) {
    const q = result.audio_quality;
    const baseScore = q.overall_score ?? null;
    const rawAdjustedScore = q.adjusted_overall_score ?? baseScore;
    const rawDominantCauses =
      q.background_noise?.dominant_causes ||
      q.score_components?.dominant_causes ||
      [];
    const rawPenalty = q.noise_penalty_points ?? q.score_components?.noise_penalty_points ?? 0;
    const hasHighSnrSpeech = (q.snr_db ?? 0) > 25 && (q.speech_frame_ratio ?? 0) > 0.5;
    const isSilenceCause = (v: string) => /\bsilence\b|\bsilent\b/i.test(v || '');
    const isCrowdVoicesCause = (v: string) => /\bcrowd\b|\bvoices?\b/i.test(v || '');
    const shouldSuppressCause = (cause: string) =>
      isSilenceCause(cause) || (hasHighSnrSpeech && isCrowdVoicesCause(cause));
    const dominantCauses = rawDominantCauses.filter(c => !shouldSuppressCause(c));

    const topNoiseClasses = q.background_noise?.top_background_classes ?? [];
    const classWeight = (c: { penalty_weight: number; time_share: number; confidence: number }) =>
      Math.max(c.penalty_weight ?? 0, 0) * Math.max(c.time_share ?? 0, 0) * Math.max(c.confidence ?? 0, 0);
    const isSuppressedClass = (c: { label: string; category: string }) => {
      const txt = `${c.category || ''} ${c.label || ''}`;
      if (/\bsilence\b|\bsilent\b/i.test(txt)) return true;
      if (hasHighSnrSpeech && /\bcrowd\b|\bvoices?\b/i.test(txt)) return true;
      return false;
    };
    const totalWeight = topNoiseClasses.reduce((sum, c) => sum + classWeight(c), 0);
    const suppressedWeight = topNoiseClasses
      .filter(isSuppressedClass)
      .reduce((sum, c) => sum + classWeight(c), 0);
    const computedPenalty =
      totalWeight > 0
        ? rawPenalty * (1 - clamp(suppressedWeight / totalWeight, 0, 1))
        : (rawDominantCauses.length > 0 && dominantCauses.length === 0 ? 0 : rawPenalty);
    const penalty = Math.max(0, computedPenalty);
    const adjustedScore = baseScore !== null ? clamp(Math.round(baseScore - penalty), 0, 100) : rawAdjustedScore;
    const rawMetrics = q.metrics ?? { snr: null, loudness: null, clarity: null, cleanliness: null };
    const confidence = q.confidence ?? 1;
    return {
      score:            adjustedScore ?? 0,
      baseScore,
      adjustedScore,
      noisePenaltyPoints: penalty,
      dominantNoiseCauses: dominantCauses,
      rating:           q.rating        ?? 'Unknown',
      summary:          q.summary       ?? '',
      snrDb:            q.snr_db        ?? 0,
      compositePercent: q.composite_percent ?? (q.overall_score ?? 0),
      confidence,
      source: 'backend',
      showEstimatedBadge: confidence < 0.6,
      contentType: q.content_type ?? 'speech',
      metrics: {
        snr:         rawMetrics.snr ?? 0,
        loudness:    rawMetrics.loudness ?? 0,
        clarity:     rawMetrics.clarity ?? 0,
        cleanliness: rawMetrics.cleanliness ?? 0,
      },
    };
  }

  // Derive from raw waveform / spectrogram
  const amps = result.features?.waveform?.amplitudes   ?? [];
  const rms  = result.features?.energy?.rms_values     ?? [];
  const spec = result.features?.spectrogram?.magnitude_db ?? [];

  const rmsAvg        = avg(rms);
  const loudnessScore = mapToScore(rmsAvg, 0, 0.3);

  const p95       = percentile(amps.map(Math.abs), 95);
  const p50       = percentile(amps.map(Math.abs), 50);
  const snrLinear = p50 > 0.001 ? p95 / p50 : 1;
  const snrDb     = 20 * Math.log10(Math.max(snrLinear, 1));
  const snrScore  = mapToScore(snrDb, 0, 30);

  const flatRows        = spec.flatMap(row => row);
  const highEnergyFrac  = flatRows.length > 0
    ? flatRows.filter(v => v > -40).length / flatRows.length
    : 0.5;
  const clarityScore    = mapToScore(highEnergyFrac, 0.2, 0.7);

  const lowNoiseRms    = percentile(rms, 10);
  const cleanlinessScore = 100 - mapToScore(lowNoiseRms, 0, 0.1);

  const composite   = snrScore * 0.35 + loudnessScore * 0.25 + clarityScore * 0.25 + cleanlinessScore * 0.15;
  const overallScore = clamp(Math.round(composite), 0, 100);

  const rating =
    overallScore >= 80 ? 'Excellent' :
    overallScore >= 60 ? 'Good'      :
    overallScore >= 40 ? 'Fair'      : 'Poor';

  const summary =
    overallScore >= 80 ? 'High-quality recording with good clarity and low noise.'   :
    overallScore >= 60 ? 'Acceptable quality. Some background noise may be present.' :
    overallScore >= 40 ? 'Moderate quality. Noise or low volume detected.'            :
                         'Low quality. High noise or very low signal level.';

  return {
    score:            overallScore,
    baseScore: overallScore,
    adjustedScore: overallScore,
    noisePenaltyPoints: 0,
    dominantNoiseCauses: [],
    rating,
    summary,
    snrDb:            Math.round(snrDb * 10) / 10,
    compositePercent: Math.round(composite),
    confidence: 0.5,
    source: 'estimated',
    showEstimatedBadge: true,
    contentType: 'speech',
    metrics: {
      snr:           Math.round(snrScore),
      loudness:      Math.round(loudnessScore),
      clarity:       Math.round(clarityScore),
      cleanliness:   Math.round(cleanlinessScore),
    },
  };
}
