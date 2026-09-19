import { randomUUID } from 'node:crypto';
import { getDb } from '../_lib/db.js';
import { audit, readSession, requireAdmin, requireUser } from '../_lib/auth.js';
import { readBody, sendError, sendJSON } from '../_lib/http.js';

const ORDER_TRANSITIONS = {
  pending: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['packing', 'cancelled']),
  packing: new Set(['ready', 'cancelled']),
  ready: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const money = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function calculateCheckoutTotals(items, fulfillmentMethod = 'pickup') {
  const subtotalMinor = items.reduce((sum, item) => {
    const price = Number(item.price_minor);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) throw new Error('Invalid checkout item');
    return sum + price * quantity;
  }, 0);
  const deliveryMinor = fulfillmentMethod === 'delivery' ? 3000 : 0;
  return { subtotalMinor, deliveryMinor, totalMinor: subtotalMinor + deliveryMinor };
}

function pathOf(req) {
  return new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
}

async function listProducts(db, { admin = false } = {}) {
  const result = await db.query(`
    SELECT p.*,
      COALESCE(json_agg(json_build_object(
        'id',v.id,'sku',v.sku,'variant_name',v.variant_name,'attributes',v.attributes,
        'price_minor',v.price_minor,'currency',v.currency,'stock_quantity',v.stock_quantity,
        'low_stock_threshold',v.low_stock_threshold,'is_active',v.is_active,'version',v.version
      ) ORDER BY v.created_at) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
    FROM shop_products p
    LEFT JOIN shop_product_variants v ON v.product_id=p.id ${admin ? '' : 'AND v.is_active=TRUE'}
    ${admin ? '' : 'WHERE p.is_active=TRUE'}
    GROUP BY p.id
    ORDER BY p.is_featured DESC, p.created_at, p.name
  `);
  return result.rows;
}

async function activeCart(db, userId, create = false) {
  let result = await db.query("SELECT * FROM shop_carts WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [userId]);
  if (result.rowCount || !create) return result.rows[0] || null;
  await db.query("INSERT INTO shop_carts(user_id,status) VALUES($1,'active') ON CONFLICT DO NOTHING", [userId]);
  result = await db.query("SELECT * FROM shop_carts WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [userId]);
  return result.rows[0] || null;
}

async function cartPayload(db, userId, create = false) {
  const cart = await activeCart(db, userId, create);
  if (!cart) return { id: null, items: [], subtotal_minor: 0, currency: 'MOP', item_count: 0 };
  const items = await db.query(`
    SELECT ci.quantity,v.id AS variant_id,v.sku,v.variant_name,v.price_minor,v.currency,v.stock_quantity,
      p.id AS product_id,p.slug,p.name,p.short_description,p.primary_image_url,p.primary_image_alt,p.image_position
    FROM shop_cart_items ci
    JOIN shop_product_variants v ON v.id=ci.variant_id
    JOIN shop_products p ON p.id=v.product_id
    WHERE ci.cart_id=$1 AND p.is_active=TRUE AND v.is_active=TRUE
    ORDER BY ci.created_at
  `, [cart.id]);
  const subtotal = items.rows.reduce((sum, item) => sum + item.price_minor * item.quantity, 0);
  return {
    id: cart.id,
    items: items.rows.map((item) => ({ ...item, line_total_minor: item.price_minor * item.quantity })),
    subtotal_minor: subtotal,
    currency: items.rows[0]?.currency || 'MOP',
    item_count: items.rows.reduce((sum, item) => sum + item.quantity, 0),
  };
}

async function ordersFor(db, { userId = null, admin = false, status = null } = {}) {
  const values = [];
  const conditions = [];
  if (!admin) { values.push(userId); conditions.push(`o.user_id=$${values.length}`); }
  if (status) { values.push(status); conditions.push(`o.status=$${values.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query(`
    SELECT o.*,u.email,u.display_name,
      COALESCE((SELECT json_agg(json_build_object(
        'id',i.id,'product_name',i.product_name,'variant_name',i.variant_name,'sku',i.sku,
        'image_url',i.image_url,'image_alt',i.image_alt,'image_position',i.image_position,
        'unit_price_minor',i.unit_price_minor,'quantity',i.quantity,'line_total_minor',i.line_total_minor
      ) ORDER BY i.product_name) FROM shop_order_items i WHERE i.order_id=o.id),'[]') AS items,
      COALESCE((SELECT json_agg(json_build_object(
        'from_status',e.from_status,'to_status',e.to_status,'note',e.note,'created_at',e.created_at
      ) ORDER BY e.created_at) FROM shop_order_events e WHERE e.order_id=o.id),'[]') AS events
    FROM shop_orders o JOIN users u ON u.id=o.user_id
    ${where}
    ORDER BY o.created_at DESC LIMIT 200
  `, values);
  return result.rows;
}

async function handleProducts(req, res, db, path) {
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  const products = await listProducts(db);
  const slug = decodeURIComponent(path.split('/').pop() || '');
  if (path !== '/api/shop/products') {
    const product = products.find((item) => item.slug === slug);
    return product ? sendJSON(res, 200, { product }) : sendError(res, 404, 'not_found', 'Product not found');
  }
  return sendJSON(res, 200, { products });
}

async function handleCart(req, res, db, path) {
  const user = await requireUser(req, res); if (!user) return;
  if (req.method === 'GET' && path === '/api/shop/cart') return sendJSON(res, 200, { cart: await cartPayload(db, user.id, true) });
  if (req.method === 'POST' && path === '/api/shop/cart/items') {
    const body = await readBody(req);
    const variantId = clean(body.variant_id, 120);
    const quantity = Number(body.quantity);
    if (!variantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return sendError(res, 422, 'invalid_item', 'Choose a quantity from 1 to 20');
    const variant = await db.query(`SELECT v.id,v.stock_quantity FROM shop_product_variants v JOIN shop_products p ON p.id=v.product_id WHERE v.id=$1 AND v.is_active=TRUE AND p.is_active=TRUE`, [variantId]);
    if (!variant.rowCount) return sendError(res, 404, 'not_found', 'Product variant not found');
    if (variant.rows[0].stock_quantity < quantity) return sendError(res, 409, 'insufficient_stock', 'Not enough stock');
    const cart = await activeCart(db, user.id, true);
    await db.query(`INSERT INTO shop_cart_items(cart_id,variant_id,quantity) VALUES($1,$2,$3)
      ON CONFLICT(cart_id,variant_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=NOW()`, [cart.id, variantId, quantity]);
    await db.query('UPDATE shop_carts SET updated_at=NOW() WHERE id=$1', [cart.id]);
    return sendJSON(res, 200, { cart: await cartPayload(db, user.id) });
  }
  const itemMatch = path.match(/^\/api\/shop\/cart\/items\/([^/]+)$/);
  if (req.method === 'DELETE' && itemMatch) {
    const cart = await activeCart(db, user.id);
    if (cart) await db.query('DELETE FROM shop_cart_items WHERE cart_id=$1 AND variant_id=$2', [cart.id, decodeURIComponent(itemMatch[1])]);
    return sendJSON(res, 200, { cart: await cartPayload(db, user.id) });
  }
  return sendError(res, 405, 'method_not_allowed', 'Unsupported cart operation');
}

async function handleCheckout(req, res, db) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  const user = await requireUser(req, res); if (!user) return;
  const body = await readBody(req);
  const customerName = clean(body.customer_name, 100);
  const phone = clean(body.phone, 40);
  const fulfillment = body.fulfillment_method === 'delivery' ? 'delivery' : 'pickup';
  const address = clean(body.delivery_address, 500);
  const notes = clean(body.notes, 1000);
  const key = clean(body.idempotency_key, 120);
  if (!customerName || !phone || !key || (fulfillment === 'delivery' && !address)) return sendError(res, 422, 'invalid_checkout', 'Name, phone, delivery details and request key are required');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const duplicate = await client.query('SELECT id FROM shop_orders WHERE user_id=$1 AND idempotency_key=$2', [user.id, key]);
    if (duplicate.rowCount) {
      await client.query('ROLLBACK');
      const existing = (await ordersFor(db, { userId: user.id })).find((order) => String(order.id) === String(duplicate.rows[0].id));
      return sendJSON(res, 200, { order: existing, duplicate: true });
    }
    const cartResult = await client.query("SELECT * FROM shop_carts WHERE user_id=$1 AND status='active' FOR UPDATE", [user.id]);
    if (!cartResult.rowCount) { await client.query('ROLLBACK'); return sendError(res, 409, 'empty_cart', 'Your cart is empty'); }
    const cart = cartResult.rows[0];
    const items = await client.query(`
      SELECT ci.quantity,v.*,p.name,p.primary_image_url,p.primary_image_alt,p.image_position,p.service_item_type_key
      FROM shop_cart_items ci
      JOIN shop_product_variants v ON v.id=ci.variant_id
      JOIN shop_products p ON p.id=v.product_id
      WHERE ci.cart_id=$1 AND p.is_active=TRUE AND v.is_active=TRUE
      ORDER BY ci.created_at FOR UPDATE OF v
    `, [cart.id]);
    if (!items.rowCount) { await client.query('ROLLBACK'); return sendError(res, 409, 'empty_cart', 'Your cart is empty'); }
    for (const item of items.rows) if (item.stock_quantity < item.quantity) { await client.query('ROLLBACK'); return sendError(res, 409, 'insufficient_stock', `${item.name} does not have enough stock`); }
    const { subtotalMinor: subtotal, deliveryMinor, totalMinor } = calculateCheckoutTotals(items.rows, fulfillment);
    const orderId = randomUUID();
    const orderNumber = `BO-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${orderId.slice(0,6).toUpperCase()}`;
    const order = await client.query(`INSERT INTO shop_orders
      (id,order_number,user_id,status,fulfillment_method,customer_name,phone,delivery_address,notes,currency,subtotal_minor,delivery_minor,total_minor,idempotency_key)
      VALUES($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [orderId,orderNumber,user.id,fulfillment,customerName,phone,fulfillment === 'delivery' ? address : null,notes || null,items.rows[0].currency,subtotal,deliveryMinor,totalMinor,key]);
    for (const item of items.rows) {
      const lineTotal = item.price_minor * item.quantity;
      await client.query(`INSERT INTO shop_order_items
        (order_id,product_id,variant_id,product_name,variant_name,sku,image_url,image_alt,image_position,service_item_type_key,unit_price_minor,quantity,line_total_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [orderId,item.product_id,item.id,item.name,item.variant_name,item.sku,item.primary_image_url,item.primary_image_alt,item.image_position,item.service_item_type_key,item.price_minor,item.quantity,lineTotal]);
      await client.query('UPDATE shop_product_variants SET stock_quantity=stock_quantity-$1,version=version+1,updated_at=NOW() WHERE id=$2', [item.quantity,item.id]);
      await client.query(`INSERT INTO shop_inventory_movements(variant_id,order_id,actor_user_id,quantity_delta,reason) VALUES($1,$2,$3,$4,'order_placed')`, [item.id,orderId,user.id,-item.quantity]);
    }
    await client.query("UPDATE shop_carts SET status='converted',updated_at=NOW() WHERE id=$1", [cart.id]);
    await client.query(`INSERT INTO shop_order_events(order_id,actor_user_id,from_status,to_status,note) VALUES($1,$2,NULL,'pending','Order placed')`, [orderId,user.id]);
    await client.query('COMMIT');
    await audit({ actor: user, action: 'shop.order.create', targetType: 'shop_order', targetId: orderId, payload: { order_number: orderNumber, total_minor: totalMinor }, req });
    return sendJSON(res, 201, { order: { ...order.rows[0], items: items.rows.map((item) => ({ product_name:item.name,variant_name:item.variant_name,quantity:item.quantity,unit_price_minor:item.price_minor,line_total_minor:item.price_minor*item.quantity })) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return sendError(res, 500, 'checkout_failed', error.message);
  } finally { client.release(); }
}

async function handleOrders(req, res, db, path) {
  const user = await requireUser(req, res); if (!user) return;
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  const orders = await ordersFor(db, { userId: user.id });
  const match = path.match(/^\/api\/shop\/orders\/([^/]+)$/);
  if (match) {
    const order = orders.find((item) => String(item.id) === decodeURIComponent(match[1]));
    return order ? sendJSON(res, 200, { order }) : sendError(res, 404, 'not_found', 'Order not found');
  }
  return sendJSON(res, 200, { orders });
}

async function handleAdmin(req, res, db, path) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  if (path === '/api/admin/shop/products' && req.method === 'GET') return sendJSON(res, 200, { products: await listProducts(db, { admin: true }) });
  if (path === '/api/admin/shop/products' && req.method === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 140); const slug = clean(body.slug, 140).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const price = money(body.price_minor); const stock = Number(body.stock_quantity);
    if (!name || !slug || price === null || !Number.isInteger(stock) || stock < 0) return sendError(res, 422, 'invalid_product', 'Name, slug, price and stock are required');
    const productId=`prod-${randomUUID()}`; const variantId=`var-${randomUUID()}`; const sku=clean(body.sku,80)||`SKU-${randomUUID().slice(0,8).toUpperCase()}`;
    const client=await db.connect();
    try { await client.query('BEGIN');
      await client.query(`INSERT INTO shop_products(id,slug,name,short_description,description,category,primary_image_url,primary_image_alt,image_position,is_active,is_featured)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10)`,[productId,slug,name,clean(body.short_description,240),clean(body.description,2000),clean(body.category,80)||'其他',clean(body.primary_image_url,500)||'/assets/shop-product-collection-v1.png',clean(body.primary_image_alt,240)||name,clean(body.image_position,30)||'0% 0%',Boolean(body.is_featured)]);
      await client.query(`INSERT INTO shop_product_variants(id,product_id,sku,variant_name,price_minor,stock_quantity) VALUES($1,$2,$3,$4,$5,$6)`,[variantId,productId,sku,clean(body.variant_name,100)||'標準款',price,stock]);
      await client.query('COMMIT');
    } catch(error){await client.query('ROLLBACK');return sendError(res,409,'product_create_failed',error.message);} finally{client.release();}
    await audit({actor:admin,action:'shop.product.create',targetType:'shop_product',targetId:productId,payload:{name,sku},req});
    return sendJSON(res,201,{product:(await listProducts(db,{admin:true})).find(p=>p.id===productId)});
  }
  const productMatch=path.match(/^\/api\/admin\/shop\/products\/([^/]+)$/);
  if(productMatch&&req.method==='PATCH'){
    const body=await readBody(req);const id=decodeURIComponent(productMatch[1]);
    const result=await db.query(`UPDATE shop_products SET name=COALESCE($1,name),short_description=COALESCE($2,short_description),description=COALESCE($3,description),category=COALESCE($4,category),is_active=COALESCE($5,is_active),is_featured=COALESCE($6,is_featured),version=version+1,updated_at=NOW() WHERE id=$7 RETURNING *`,[body.name===undefined?null:clean(body.name,140),body.short_description===undefined?null:clean(body.short_description,240),body.description===undefined?null:clean(body.description,2000),body.category===undefined?null:clean(body.category,80),body.is_active===undefined?null:Boolean(body.is_active),body.is_featured===undefined?null:Boolean(body.is_featured),id]);
    if(!result.rowCount)return sendError(res,404,'not_found','Product not found');
    await audit({actor:admin,action:'shop.product.update',targetType:'shop_product',targetId:id,payload:{fields:Object.keys(body)},req});return sendJSON(res,200,{product:result.rows[0]});
  }
  if(path==='/api/admin/shop/orders'&&req.method==='GET'){
    const status=new URL(req.url||'','http://localhost').searchParams.get('status');return sendJSON(res,200,{orders:await ordersFor(db,{admin:true,status:status||null})});
  }
  const orderMatch=path.match(/^\/api\/admin\/shop\/orders\/([^/]+)$/);
  if(orderMatch&&req.method==='PATCH'){
    const body=await readBody(req);const next=clean(body.status,30);const orderId=decodeURIComponent(orderMatch[1]);const client=await db.connect();
    try{await client.query('BEGIN');const current=(await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];if(!current){await client.query('ROLLBACK');return sendError(res,404,'not_found','Order not found');}if(!ORDER_TRANSITIONS[current.status]?.has(next)){await client.query('ROLLBACK');return sendError(res,409,'invalid_transition',`Cannot move ${current.status} to ${next}`);}if(next==='cancelled'){
        const items=await client.query('SELECT variant_id,quantity FROM shop_order_items WHERE order_id=$1 AND variant_id IS NOT NULL',[orderId]);for(const item of items.rows){await client.query('UPDATE shop_product_variants SET stock_quantity=stock_quantity+$1,version=version+1,updated_at=NOW() WHERE id=$2',[item.quantity,item.variant_id]);await client.query(`INSERT INTO shop_inventory_movements(variant_id,order_id,actor_user_id,quantity_delta,reason) VALUES($1,$2,$3,$4,'order_cancelled')`,[item.variant_id,orderId,admin.id,item.quantity]);}}
      const updated=await client.query('UPDATE shop_orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[next,orderId]);await client.query('INSERT INTO shop_order_events(order_id,actor_user_id,from_status,to_status,note) VALUES($1,$2,$3,$4,$5)',[orderId,admin.id,current.status,next,clean(body.note,500)||null]);await client.query('COMMIT');await audit({actor:admin,action:'shop.order.status',targetType:'shop_order',targetId:orderId,payload:{from:current.status,to:next},req});return sendJSON(res,200,{order:updated.rows[0]});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});return sendError(res,500,'order_update_failed',error.message);}finally{client.release();}
  }
  const inventoryMatch=path.match(/^\/api\/admin\/shop\/inventory\/([^/]+)$/);
  if(inventoryMatch&&req.method==='POST'){
    const body=await readBody(req);const delta=Number(body.quantity_delta);const reason=clean(body.reason,200);const variantId=decodeURIComponent(inventoryMatch[1]);if(!Number.isInteger(delta)||delta===0||!reason)return sendError(res,422,'invalid_adjustment','A non-zero quantity and reason are required');
    const client=await db.connect();try{await client.query('BEGIN');const updated=await client.query('UPDATE shop_product_variants SET stock_quantity=stock_quantity+$1,version=version+1,updated_at=NOW() WHERE id=$2 AND stock_quantity+$1>=0 RETURNING *',[delta,variantId]);if(!updated.rowCount){await client.query('ROLLBACK');return sendError(res,409,'invalid_stock','Adjustment would make stock negative');}await client.query('INSERT INTO shop_inventory_movements(variant_id,actor_user_id,quantity_delta,reason) VALUES($1,$2,$3,$4)',[variantId,admin.id,delta,reason]);await client.query('COMMIT');await audit({actor:admin,action:'shop.inventory.adjust',targetType:'shop_variant',targetId:variantId,payload:{delta,reason},req});return sendJSON(res,200,{variant:updated.rows[0]});}catch(error){await client.query('ROLLBACK').catch(()=>{});return sendError(res,500,'inventory_failed',error.message);}finally{client.release();}
  }
  return sendError(res,405,'method_not_allowed','Unsupported admin shop operation');
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const path = pathOf(req);
    if (path.startsWith('/api/admin/shop')) return handleAdmin(req, res, db, path);
    if (path.startsWith('/api/shop/products')) return handleProducts(req, res, db, path);
    if (path.startsWith('/api/shop/cart')) return handleCart(req, res, db, path);
    if (path === '/api/shop/checkout') return handleCheckout(req, res, db);
    if (path.startsWith('/api/shop/orders')) return handleOrders(req, res, db, path);
    const session = await readSession(req);
    return sendError(res, session ? 404 : 401, session ? 'not_found' : 'unauthorized', session ? 'Shop endpoint not found' : 'Sign in required');
  } catch (error) {
    return sendError(res, 500, 'internal_error', error.message);
  }
}

export { ORDER_TRANSITIONS };
