import { getDb } from '../_lib/db.js';
import { array, getOwnedVehicle, id, integer, object, text, toolResult, newId } from '../_lib/tool-utils.js';

const vehicleFields = 'id, model, make, year, fuel_type, vin, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at';

export const vehicleTools = {
  list_my_vehicles: {
    description: 'List vehicles available to the authenticated user.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    async execute({ user }) {
      const db = await getDb();
      const r = await db.query(`SELECT ${vehicleFields} FROM vehicles
        WHERE archived_at IS NULL AND (created_by_user_id = $1 OR created_by_user_id IS NULL) ORDER BY created_at ASC`, [user.id]);
      return toolResult(r.rows, { count: r.rowCount });
    },
  },
  get_vehicle_status: {
    description: 'Get one vehicle and its maintenance status.',
    input_schema: { type: 'object', required: ['vehicle_id'], properties: { vehicle_id: { type: 'string' } }, additionalProperties: false },
    readOnly: true,
    async execute({ args, user }) {
      const vehicleId = id(args.vehicle_id, 'vehicle_id');
      const db = await getDb();
      const vehicle = await getOwnedVehicle(db, user.id, vehicleId);
      const r = await db.query(`SELECT id, item, interval_km, interval_months, last_done_km,
        last_done_at, wear, display_order FROM vehicle_status WHERE vehicle_id=$1 ORDER BY display_order,id`, [vehicleId]);
      return toolResult({ vehicle, items: r.rows, attention: r.rows.filter((x) => x.wear >= 80).map((x) => x.item) });
    },
  },
  add_vehicle: {
    description: 'Add a vehicle after the user confirms the exact fields.',
    write: true,
    input_schema: { type: 'object', required: ['model'], properties: {
      model: { type: 'string' }, make: { type: 'string' }, year: { type: 'integer' }, fuel_type: { type: 'string' },
      vin: { type: 'string' }, plate: { type: 'string' }, mileage_km: { type: 'integer', minimum: 0 }, image: { type: 'string' },
    }, additionalProperties: false },
    async execute({ args, user }) {
      const model = text(args.model, 'model', { required: true, max: 200 });
      const make = text(args.make, 'make', { max: 80 });
      const year = integer(args.year, 'year', { min: 1900, max: 2100 });
      const mileage = integer(args.mileage_km, 'mileage_km', { min: 0, max: 2000000 }) ?? 0;
      const image = text(args.image, 'image', { max: 7 * 1024 * 1024 });
      if (image && !/^data:image\//.test(image) && !/^\//.test(image)) throw new Error('image must be an image data URL or local path');
      const db = await getDb();
      const r = await db.query(`INSERT INTO vehicles
        (id, model, make, year, fuel_type, vin, plate, mileage_km, mileage_label, image, owner, team, created_by_user_id, updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${vehicleFields}`,
      [newId(), model, make, year, text(args.fuel_type, 'fuel_type', { max: 60 }), text(args.vin, 'vin', { max: 80 }), text(args.plate, 'plate', { max: 40 }), mileage, `${mileage.toLocaleString()} km`, image || '/assets/vehicle-placeholder.svg', user.display_name || 'User', 'personal', user.id]);
      return toolResult(r.rows[0]);
    },
  },
  update_vehicle: {
    description: 'Update confirmed fields on an existing vehicle.',
    write: true,
    input_schema: { type: 'object', required: ['vehicle_id'], properties: {
      vehicle_id: { type: 'string' }, model: { type: 'string' }, make: { type: 'string' }, year: { type: 'integer' }, fuel_type: { type: 'string' },
      vin: { type: 'string' }, plate: { type: 'string' }, mileage_km: { type: 'integer', minimum: 0 },
    }, additionalProperties: false },
    async execute({ args, user }) {
      const vehicleId = id(args.vehicle_id, 'vehicle_id');
      const db = await getDb();
      await getOwnedVehicle(db, user.id, vehicleId);
      const changes = [];
      const values = [];
      for (const [field, value] of [['model', args.model], ['make', args.make], ['fuel_type', args.fuel_type], ['vin', args.vin], ['plate', args.plate]]) {
        if (value !== undefined) { changes.push(`${field}=$${values.length + 1}`); values.push(text(value, field, { required: field === 'model', max: 200 })); }
      }
      if (args.year !== undefined) { changes.push(`year=$${values.length + 1}`); values.push(integer(args.year, 'year', { min: 1900, max: 2100 })); }
      if (args.mileage_km !== undefined) { const mileage = integer(args.mileage_km, 'mileage_km', { min: 0, max: 2000000 }); changes.push(`mileage_km=$${values.length + 1}`, `mileage_label=$${values.length + 2}`); values.push(mileage, `${mileage.toLocaleString()} km`); }
      if (!changes.length) throw new Error('At least one field is required');
      values.push(user.id, vehicleId);
      const r = await db.query(`UPDATE vehicles SET ${changes.join(', ')}, updated_at=NOW(), updated_by_user_id=$${values.length - 1}
        WHERE id=$${values.length} AND (created_by_user_id=$${values.length - 1} OR created_by_user_id IS NULL) RETURNING ${vehicleFields}`, values);
      return toolResult(r.rows[0]);
    },
  },
  save_vehicle_specs: {
    description: 'Save researched vehicle specifications only after the user confirms the sources and values.',
    write: true,
    input_schema: { type: 'object', required: ['vehicle_id', 'specs', 'confidence', 'source_urls', 'source_names'], properties: {
      vehicle_id: { type: 'string' }, make: { type: 'string' }, model: { type: 'string' }, year: { type: 'integer' }, variant: { type: 'string' },
      specs: { type: 'object' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, source_urls: { type: 'array' }, source_names: { type: 'array' },
    }, additionalProperties: false },
    async execute({ args, user }) {
      const vehicleId = id(args.vehicle_id, 'vehicle_id'); const db = await getDb(); await getOwnedVehicle(db, user.id, vehicleId);
      const confidence = Number(args.confidence); if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence must be between 0 and 1');
      const specs = object(args.specs, 'specs'); if (JSON.stringify(specs).length > 50000) throw new Error('specs are too large');
      const urls = array(args.source_urls, 'source_urls', 20).map((value) => text(value, 'source_url', { required: true, max: 500 }));
      if (urls.some((url) => !/^https?:\/\//i.test(url))) throw new Error('source_urls must be http(s) URLs');
      const names = array(args.source_names, 'source_names', 20).map((value) => text(value, 'source_name', { required: true, max: 200 }));
      const year = integer(args.year, 'year', { min: 1900, max: 2100 });
      const r = await db.query(`INSERT INTO vehicle_specs (vehicle_id,make,model,year,variant,specs,confidence,source_urls,source_names,verified_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`, [vehicleId,text(args.make,'make',{max:80}),text(args.model,'model',{max:160}),year,text(args.variant,'variant',{max:160}),JSON.stringify(specs),confidence,JSON.stringify(urls),JSON.stringify(names)]);
      return toolResult(r.rows[0]);
    },
  },
};
