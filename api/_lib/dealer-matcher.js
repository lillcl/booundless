const SERVICE_ALIASES = new Map([
  ['機油', 'engine_oil'], ['engine oil', 'engine_oil'],
  ['機油隔', 'oil_filter'], ['機油濾芯', 'oil_filter'], ['oil filter', 'oil_filter'],
  ['波箱油', 'transmission_fluid'], ['變速箱油', 'transmission_fluid'],
  ['煞車皮', 'brake_pads'], ['剎車皮', 'brake_pads'], ['brake pads', 'brake_pads'],
  ['煞車油', 'brake_fluid'], ['剎車油', 'brake_fluid'], ['brake fluid', 'brake_fluid'],
  ['冷卻液', 'coolant'], ['防凍液', 'coolant'], ['coolant', 'coolant'],
  ['火花塞', 'spark_plugs'], ['火星塞', 'spark_plugs'], ['spark plugs', 'spark_plugs'],
  ['空氣濾芯', 'air_filter'], ['空氣濾清器', 'air_filter'], ['air filter', 'air_filter'],
  ['冷氣濾芯', 'cabin_filter'], ['塵格', 'cabin_filter'], ['cabin filter', 'cabin_filter'], ['hepa濾芯', 'cabin_filter'],
  ['12v 電瓶', 'battery_12v'], ['12v電瓶', 'battery_12v'], ['電池', 'battery_12v'],
  ['輪胎', 'tire'], ['tires', 'tire'], ['tire', 'tire'],
  ['煞車卡鉗保養', 'brake_caliper'], ['車身及底盤檢查', 'body_chassis_inspection'],
]);

export function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-Hant').replace(/[\s_\-./()（）]+/g, '');
}

export function canonicalServiceKey(value) {
  const normalized = normalize(value);
  if (!normalized) return null;
  for (const key of SERVICE_ALIASES.values()) if (normalize(key) === normalized) return key;
  for (const [alias, key] of SERVICE_ALIASES) if (normalize(alias) === normalized) return key;
  if (normalized.includes('hepa濾芯')) return 'cabin_filter';
  if (normalized.includes('冷卻液')) return 'coolant';
  return normalized;
}

export function canonicalServiceKeys(value) {
  const normalized = normalize(value);
  if (!normalized) return [];
  if (normalized.includes(normalize('機油及機油隔')) || normalized.includes('engineoilandfilter')) {
    return ['engine_oil', 'oil_filter'];
  }
  const key = canonicalServiceKey(value);
  return key ? [key] : [];
}

function sameOrEmpty(ruleValue, vehicleValue) {
  if (!ruleValue) return true;
  if (!vehicleValue) return false;
  return normalize(ruleValue) === normalize(vehicleValue);
}

export function scoreFitment(vehicle, fitment) {
  if (!fitment) return { score: 0, reasons: ['Compatibility rules not supplied'], state: 'needs_confirmation' };
  const reasons = [];
  const missing = [];
  for (const [rule, field] of [['make_norm','make'],['model_norm','model'],['variant_norm','variant'],['fuel_type_norm','fuel_type'],['engine_code','engine_code'],['market','market'],['vin_prefix','vin']]) {
    if (fitment[rule] && !vehicle[field]) missing.push(field);
  }
  if ((fitment.year_from != null || fitment.year_to != null) && !vehicle.year) missing.push('year');
  if (missing.length) {
    // Still reject known contradictions before returning an unknown match.
    const completed = { ...vehicle };
    for (const [rule, field] of [['make_norm','make'],['model_norm','model'],['variant_norm','variant'],['fuel_type_norm','fuel_type'],['engine_code','engine_code'],['market','market'],['vin_prefix','vin']]) if (!completed[field]) completed[field] = fitment[rule];
    if (!completed.year) completed.year = fitment.year_from ?? fitment.year_to;
    if (!scoreFitment(completed, fitment)) return null;
    return { score: 0, reasons: missing.map(field => `Missing vehicle ${field}`), state: 'needs_confirmation' };
  }
  if (fitment.vin_prefix) {
    if (!vehicle.vin || !normalize(vehicle.vin).startsWith(normalize(fitment.vin_prefix))) return null;
    reasons.push('VIN prefix matched');
  }
  if (!sameOrEmpty(fitment.make_norm, vehicle.make)) return null;
  if (!sameOrEmpty(fitment.model_norm, vehicle.model)) return null;
  if (fitment.make_norm) reasons.push('make matched');
  if (fitment.model_norm) reasons.push('model matched');
  if (fitment.year_from != null && (!vehicle.year || vehicle.year < fitment.year_from)) return null;
  if (fitment.year_to != null && (!vehicle.year || vehicle.year > fitment.year_to)) return null;
  if (fitment.year_from != null || fitment.year_to != null) {
    if (vehicle.year && fitment.year_from === vehicle.year && fitment.year_to === vehicle.year) reasons.push('exact year matched');
    else reasons.push('year range matched');
  }
  if (!sameOrEmpty(fitment.variant_norm, vehicle.variant)) return null;
  if (fitment.variant_norm) reasons.push('variant matched');
  if (!sameOrEmpty(fitment.fuel_type_norm, vehicle.fuel_type)) return null;
  if (fitment.fuel_type_norm) reasons.push('fuel type matched');
  if (!sameOrEmpty(fitment.engine_code, vehicle.engine_code)) return null;
  if (fitment.engine_code) reasons.push('engine code matched');
  if (!sameOrEmpty(fitment.market, vehicle.market)) return null;
  if (fitment.market) reasons.push('market matched');

  let score = 55;
  if (fitment.make_norm) score += 10;
  if (fitment.model_norm) score += 15;
  if (fitment.year_from != null || fitment.year_to != null) score += 8;
  if (fitment.variant_norm) score += 5;
  if (fitment.fuel_type_norm) score += 4;
  if (fitment.engine_code) score += 2;
  if (fitment.market) score += 1;
  if (fitment.vin_prefix) score += 2;
  if (!reasons.length) return { score: 0, reasons: ['Empty compatibility rule'], state: 'needs_confirmation' };
  return { score: Math.min(99, score), reasons, state: 'confirmed' };
}

export function matchLevel(score) {
  if (score >= 90) return 'exact';
  if (score >= 70) return 'likely';
  return 'review';
}

export function calculateDealerMatches(vehicle, statuses, catalogRows) {
  const currentItems = (statuses || []).flatMap((row) => canonicalServiceKeys(row.service_item_type_key || row.item).map((key) => ({
    ...row,
    service_item_type_key: key,
  })));
  const matches = [];
  const matchedKeys = new Set();

  for (const row of catalogRows || []) {
    const itemKey = row.service_item_type_key || canonicalServiceKey(row.name);
    const status = currentItems.find((item) => item.service_item_type_key === itemKey);
    const fitment = scoreFitment(vehicle, row.fitment);
    if (!fitment) continue;
    const score = fitment.score;
    if (status && fitment.state === 'confirmed') matchedKeys.add(itemKey);
    matches.push({
      dealer_id: row.dealer_id,
      dealer_name: row.dealer_name,
      branch_id: row.branch_id || null,
      branch_name: row.branch_name || null,
      service_item_id: row.service_item_id,
      service_item_type_key: itemKey,
      service_name: row.service_name,
      description: row.description,
      price_min: row.price_min,
      price_max: row.price_max,
      currency: row.currency,
      current_status: status ? {
        item: status.item,
        wear: status.wear,
        needs_attention: Number(status.wear) >= 80,
        last_done_km: status.last_done_km,
        last_done_at: status.last_done_at,
      } : null,
      match_score: score,
      compatibility_state: fitment.state,
      match_level: matchLevel(score),
      match_reason: { fitment: fitment.reasons, service_item: status ? 'canonical key matched' : 'available service for compatible vehicle' },
    });
  }

  const unmatchedNeeds = currentItems
    .filter((item) => Number(item.wear) >= 80 && !matchedKeys.has(item.service_item_type_key))
    .map((item) => ({ item: item.item, service_item_type_key: item.service_item_type_key, message: '車商尚未設定此項目' }));

  matches.sort((a, b) => Number(b.current_status?.needs_attention) - Number(a.current_status?.needs_attention) || b.match_score - a.match_score);
  return { matches, unmatched_needs: unmatchedNeeds };
}

// V2 ranking uses only available dimensions: coverage and specificity.
// Distance and appointment availability are not guessed from opening hours.
export function rankBranches(matches, statuses) {
  const needs = new Map();
  for (const status of statuses) {
    if (Number(status.wear) < 80 || status.wear == null) continue;
    for (const key of canonicalServiceKeys(status.service_item_type_key || status.item))
      needs.set(key,Math.max(needs.get(key)||0,Number(status.wear)>=100?3:2));
  }
  const total=[...needs.values()].reduce((a,b)=>a+b,0);
  const groups=new Map();
  for (const match of matches) {
    if (!match.branch_id) continue;
    if (!groups.has(match.branch_id)) groups.set(match.branch_id,{branch_id:match.branch_id,branch_name:match.branch_name,dealer_id:match.dealer_id,dealer_name:match.dealer_name,covered:new Map()});
    const group=groups.get(match.branch_id);
    if (match.compatibility_state==='confirmed' && needs.has(match.service_item_type_key)) {
      const previous=group.covered.get(match.service_item_type_key);
      if (!previous || previous.match_score<match.match_score) group.covered.set(match.service_item_type_key,match);
    }
  }
  return [...groups.values()].map(({covered,...branch})=>{
    const weight=[...covered.keys()].reduce((sum,key)=>sum+needs.get(key),0);
    const coverage=total?weight/total:0;
    const specificity=weight?[...covered.values()].reduce((sum,m)=>sum+m.match_score/100*needs.get(m.service_item_type_key),0)/weight:0;
    return {...branch,mode:total?'needs':'browse',score:total?Math.round(100*(.55*coverage+.25*specificity)/.8):null,
      covered_needs:[...covered.keys()],uncovered_needs:[...needs.keys()].filter(key=>!covered.has(key)),coverage,
      algorithm_version:'dealer-match-v2-coverage'};
  }).sort((a,b)=>(b.score||0)-(a.score||0)||a.branch_id.localeCompare(b.branch_id));
}
