/**
 * Which service answers Jev requests: the classification provider.
 *
 * - `off`: nothing. Jev sees conversation excerpts, so it is off until the
 *   user picks a source.
 * - `zen-promo`: OpenCode Zen's free promotional model, no credential.
 * - `zen-key`: the paid model on the same endpoint, with a Zen API key the user
 *   saved in OpenCode.
 * - `typesafe`: TypeSafe's own API with a key saved in OpenChamber.
 *
 * The user picks one. A pick that cannot be used right now (the promotion
 * ended, the key was removed) falls back to the first usable key, so Jev
 * stays available while the user has one. The promotion needs no credential,
 * so it is never a fallback: only a pick sends anything there. No usable
 * source at all means no Jev: the safety net and Auto are not offered.
 *
 * Fork scope note: upstream also has `openrouter`/`vercel` (segb 0b936476e,
 * batch B4) and `custom` (enterprise, separate commit) sources; this module is
 * shaped so those extend `CLASSIFIER_SOURCES` and `classifierEndpoint` only.
 *
 * Upstream: segb 1bc709ed0 + cd51cb09c.
 */
import {
  JEV_API_ORIGIN,
  JEV_API_PATH,
  JEV_MODEL,
  ZEN_CLIENT_ID,
  ZEN_JEV_API_URL,
  ZEN_JEV_MODEL,
  ZEN_JEV_PAID_MODEL,
} from './defaults.js';

export const CLASSIFIER_SOURCES = ['off', 'zen-promo', 'zen-key', 'typesafe'];
// What the user set up in OpenChamber for Jev comes before keys borrowed from OpenCode.
const FALLBACK_ORDER = ['typesafe', 'zen-key'];

/**
 * `selected` is the stored pick or null. Before the pick existed a saved
 * TypeSafe key always won, so that stays the default when one is present;
 * otherwise nothing is sent anywhere until the user picks.
 */
export const resolveClassifier = ({ selected, typesafeKey, zenKey, zenPromotionActive }) => {
  const chosen = selected ?? (typesafeKey ? 'typesafe' : 'off');
  const usable = {
    off: true,
    'zen-promo': Boolean(zenPromotionActive),
    'zen-key': Boolean(zenKey),
    typesafe: Boolean(typesafeKey),
  };
  const effective = chosen === 'off'
    ? null
    : usable[chosen] ? chosen : FALLBACK_ORDER.find((source) => usable[source]) ?? null;
  return {
    selected: chosen,
    effective,
    sources: CLASSIFIER_SOURCES.map((id) => ({ id, usable: usable[id] })),
  };
};

/** The sources clients parse when they predate the `off` source; the rest read the legacy shape. */
const LEGACY_SOURCES = ['zen-promo', 'zen-key', 'typesafe'];

/**
 * `classifier` as clients from before `off` read it: their schema knows only
 * the first three sources and rejects the whole routing state on any other id,
 * which would hide Auto and the safety net on an older phone app connected to
 * a newer server. With Off in play they get null and show the provider page
 * as unavailable; the features keep working.
 */
export const legacyClassifier = (classifier) => {
  const legacy = (source) => source === null || LEGACY_SOURCES.includes(source);
  if (!legacy(classifier.selected) || !legacy(classifier.effective)) return null;
  return { ...classifier, sources: classifier.sources.filter((source) => LEGACY_SOURCES.includes(source.id)) };
};

/** The request target for a usable source. */
export const classifierEndpoint = (source, { typesafeKey, zenKey }) => {
  if (source === 'typesafe') {
    return { url: JEV_API_ORIGIN + JEV_API_PATH, model: JEV_MODEL, headers: { authorization: `Bearer ${typesafeKey}` } };
  }
  // Every Zen call names OpenChamber, so zen can see or throttle it.
  if (source === 'zen-key') {
    return { url: ZEN_JEV_API_URL, model: ZEN_JEV_PAID_MODEL, headers: { authorization: `Bearer ${zenKey}`, 'x-opencode-client': ZEN_CLIENT_ID } };
  }
  return { url: ZEN_JEV_API_URL, model: ZEN_JEV_MODEL, headers: { 'x-opencode-client': ZEN_CLIENT_ID } };
};
