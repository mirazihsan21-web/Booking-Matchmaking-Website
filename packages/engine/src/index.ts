export type * from './types';
export { createRng, type Rng } from './rng';
export { DEFAULT_CONFIG, UNDER_MIN_PENALTY, canHost, groupCapacity, resolveConfig } from './config';
export { createScorer, scoreGroups, type Scorer } from './score';
export { explainScore, type PlayerExplanation } from './explain';
export { formGroups } from './form-groups';
