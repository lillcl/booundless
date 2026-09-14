import {canonicalServiceKeys,normalize} from './dealer-matcher.js';
export async function vehicleNeeds(db,vehicle){
  const [statuses,overrides]=await Promise.all([
    db.query('SELECT item,service_item_type_key,wear,last_done_km,last_done_at FROM vehicle_status WHERE vehicle_id=$1 ORDER BY display_order,id',[vehicle.id]),
    db.query('SELECT n.*,t.display_names FROM vehicle_needs n JOIN service_item_types t ON t.key=n.service_key WHERE vehicle_id=$1',[vehicle.id])
  ]);
  const map=new Map();
  for(const row of statuses.rows){const combined=canonicalServiceKeys(row.item);for(const key of combined.length>1?combined:canonicalServiceKeys(row.service_item_type_key||row.item))map.set(key,{...row,service_item_type_key:key,source:'maintenance_status',state:row.wear==null?'unknown':'suggested'});}
  for(const row of overrides.rows){
    const previous=map.get(row.service_key)||{};
    // A newly due cycle can reopen a need resolved by a prior completed service.
    if(row.source==='merchant_completion'&&Number(previous.wear)>=80&&new Date(previous.last_done_at).getTime()>=new Date(row.updated_at).getTime()-1000)continue;
    map.set(row.service_key,{...previous,item:row.display_names?.['zh-Hant']||row.service_key,service_item_type_key:row.service_key,state:row.state,source:row.source,wear:row.state==='confirmed'?(row.urgency==='urgent'?100:row.urgency==='soon'?90:80):0});
  }
  const electric=/^(electric|bev|ev|電動|純電|纯电|純電動|纯电动)$/.test(normalize(vehicle.fuel_type));
  return [...map.values()].filter(row=>!electric||!['engine_oil','oil_filter','spark_plugs'].includes(row.service_item_type_key));
}
