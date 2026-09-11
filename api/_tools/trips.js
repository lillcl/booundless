import { getDb } from '../_lib/db.js';
import { array, getOwnedVehicle, id, integer, number, text, toolResult, newId } from '../_lib/tool-utils.js';

export const tripTools = {
  get_recent_trips: {
    description: 'List recent or planned trips available to the user.',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    readOnly: true,
    async execute({ args, user }) {
      const db = await getDb(); const limit = integer(args.limit, 'limit', { min: 1, max: 50 }) ?? 20;
      const r = await db.query(`SELECT t.* FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id
        WHERE v.archived_at IS NULL AND (t.created_by_user_id=$1 OR t.created_by_user_id IS NULL OR v.created_by_user_id=$1 OR v.created_by_user_id IS NULL)
        ORDER BY t.start_at NULLS LAST,t.created_at DESC LIMIT $2`, [user.id, limit]);
      return toolResult(r.rows, { count: r.rowCount });
    },
  },
  create_trip: {
    description: 'Save a trip only after the user confirms its details.',
    write: true,
    input_schema: { type: 'object', required: ['title', 'origin', 'destination'], properties: {
      title: { type: 'string' }, origin: { type: 'string' }, destination: { type: 'string' }, vehicle_id: { type: 'string' }, distance_km: { type: 'number', minimum: 0 }, duration_min: { type: 'integer', minimum: 0 }, notes: { type: 'string' }, stops: { type: 'array' }, status: { type: 'string' }, start_at: { type: 'string' },
    }, additionalProperties: false },
    async execute({ args, user }) {
      const title = text(args.title, 'title', { required: true, max: 200 }); const origin = text(args.origin, 'origin', { required: true, max: 200 }); const destination = text(args.destination, 'destination', { required: true, max: 200 });
      const vehicleId = args.vehicle_id ? id(args.vehicle_id, 'vehicle_id') : null; const db = await getDb(); if (vehicleId) await getOwnedVehicle(db, user.id, vehicleId);
      const r = await db.query(`INSERT INTO trips (id,title,origin,destination,distance_km,duration_min,vehicle_id,notes,stops,status,start_at,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [newId(),title,origin,destination,number(args.distance_km,'distance_km')||0,integer(args.duration_min,'duration_min',{min:0})||0,vehicleId,text(args.notes,'notes',{max:2000}),JSON.stringify(array(args.stops,'stops')),text(args.status,'status',{max:30})||'planned',text(args.start_at,'start_at',{max:40}),user.id]);
      return toolResult(r.rows[0]);
    },
  },
};
