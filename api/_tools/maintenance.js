import { getDb } from '../_lib/db.js';
import { getOwnedVehicle, id, integer, text, toolResult, newId } from '../_lib/tool-utils.js';

export const maintenanceTools = {
  get_service_history: {
    description: 'Get recent service records for one vehicle.',
    input_schema: { type: 'object', required: ['vehicle_id'], properties: { vehicle_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    readOnly: true,
    async execute({ args, user }) {
      const vehicleId = id(args.vehicle_id, 'vehicle_id'); const db = await getDb(); const vehicle = await getOwnedVehicle(db, user.id, vehicleId);
      const limit = integer(args.limit, 'limit', { min: 1, max: 50 }) ?? 20;
      const r = await db.query(`SELECT id, performed_at, kind, title, notes, cost, mileage_km FROM service_history
        WHERE vehicle_id=$1 AND (created_by_user_id=$2 OR created_by_user_id IS NULL) ORDER BY performed_at DESC LIMIT $3`, [vehicleId, user.id, limit]);
      return toolResult({ vehicle, records: r.rows }, { count: r.rowCount });
    },
  },
  get_upcoming_reminders: {
    description: 'List upcoming and overdue maintenance reminders.',
    input_schema: { type: 'object', properties: { vehicle_id: { type: 'string' } }, additionalProperties: false },
    readOnly: true,
    async execute({ args, user }) {
      const db = await getDb(); const vehicleId = args.vehicle_id ? id(args.vehicle_id, 'vehicle_id') : null;
      const params = [user.id]; let filter = '(v.created_by_user_id=$1 OR v.created_by_user_id IS NULL)';
      if (vehicleId) { params.push(vehicleId); filter += ` AND r.vehicle_id=$${params.length}`; }
      const r = await db.query(`SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.icon, r.status, v.model AS vehicle_model, v.plate AS vehicle_plate
        FROM reminders r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.status IN ('upcoming','overdue') AND v.archived_at IS NULL AND ${filter} ORDER BY r.created_at DESC`, params);
      return toolResult(r.rows, { count: r.rowCount });
    },
  },
  create_service_record: {
    description: 'Create a service record only after user confirmation.',
    write: true,
    input_schema: { type: 'object', required: ['vehicle_id', 'title', 'performed_at'], properties: {
      vehicle_id: { type: 'string' }, title: { type: 'string' }, performed_at: { type: 'string' }, kind: { type: 'string' }, notes: { type: 'string' }, cost: { type: 'string' }, mileage_km: { type: 'integer', minimum: 0 },
    }, additionalProperties: false },
    async execute({ args, user }) {
      const vehicleId = id(args.vehicle_id, 'vehicle_id'); const title = text(args.title, 'title', { required: true, max: 200 }); const performedAt = text(args.performed_at, 'performed_at', { required: true, max: 40 });
      if (Number.isNaN(Date.parse(performedAt))) throw new Error('performed_at must be a valid date');
      const mileage = integer(args.mileage_km, 'mileage_km', { min: 0, max: 2000000 }); const db = await getDb(); await getOwnedVehicle(db, user.id, vehicleId);
      const r = await db.query(`INSERT INTO service_history (id,vehicle_id,performed_at,kind,title,notes,cost,mileage_km,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,vehicle_id,performed_at,kind,title,notes,cost,mileage_km`, [newId(),vehicleId,performedAt,text(args.kind,'kind',{max:40})||'service',title,text(args.notes,'notes',{max:MAX_NOTES}),text(args.cost,'cost',{max:80}),mileage,user.id]);
      return toolResult(r.rows[0]);
    },
  },
};

const MAX_NOTES = 2000;
