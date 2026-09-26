const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const money = (minor, currency = 'MOP') => `${esc(currency)} ${(Number(minor || 0) / 100).toFixed(2)}`;
const imageStyle = (item) => {
  const url = item.primary_image_url || item.image_url || '/assets/shop-product-collection-v1.png';
  const sheet = url.startsWith('/assets/shop-catalog/sheet-');
  const productImage = url.startsWith('/assets/shop-catalog/products/');
  const position = item.image_position || '0% 0%';
  const [x, y] = position.split(' ');
  const croppedY = { '0%':'7%', '50%':'53%', '100%':'99%' }[y] || y;
  const size = productImage ? 'contain' : (sheet ? '300% auto' : '200% 200%');
  const visualPosition = productImage ? 'center' : (sheet ? `${x} ${croppedY}` : position);
  return `--image:url('${esc(url)}');--position:${esc(position)};--image-size:${size};--visual-size:${size};--visual-position:${esc(visualPosition)};--visual-ratio:${sheet ? '1.28' : '1'}`;
};
const statusLabel = { pending:'待確認',confirmed:'已確認',packing:'備貨中',ready:'可取貨／配送中',completed:'已完成',cancelled:'已取消' };
const nextStatuses = { pending:['confirmed','cancelled'],confirmed:['packing','cancelled'],packing:['ready','cancelled'],ready:['completed','cancelled'],completed:[],cancelled:[] };

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '暫時無法完成，請稍後再試。');
  return payload;
}

function productCard(product, cart) {
  const variant = product.variants?.find((item) => item.is_active !== false);
  const inCart = cart?.items?.find((item) => item.variant_id === variant?.id)?.quantity || 0;
  const stock = variant?.stock_quantity || 0;
  const compatibility = product.compatibility;
  const incompatible = compatibility?.status === 'incompatible';
  const specs = (product.specifications || []).slice(0, 2);
  return `<article class="shop-product" data-category="${esc(product.category)}">
    <div class="shop-product__visual" role="img" aria-label="${esc(product.primary_image_alt)}" style="${imageStyle(product)}">${compatibility ? `<span class="shop-fit ${esc(compatibility.status)}">${esc(compatibility.label)}</span>` : ''}</div>
    <div class="shop-product__body">
      <span class="shop-product__category">${esc(product.category)}</span>
      <h3>${esc(product.name)}</h3>
      <p>${esc(product.short_description)}</p>
      ${specs.length ? `<div class="shop-specs">${specs.map((item) => `<span>${esc(item)}</span>`).join('')}</div>` : ''}
      <div class="shop-product__meta"><span class="shop-price">${variant ? money(variant.price_minor, variant.currency) : '暫未供應'} <small>${esc(variant?.variant_name || '')}</small></span><span class="shop-stock ${stock <= (variant?.low_stock_threshold || 0) ? 'low' : ''}">${stock ? `尚餘 ${stock}` : '售罄'}</span></div>
      ${inCart && !incompatible ? `<div class="shop-qty" aria-label="${esc(product.name)} 購物車數量"><button type="button" data-shop-qty="${esc(variant?.id || '')}" data-delta="-1" aria-label="減少 ${esc(product.name)}">−</button><b>${inCart}</b><button type="button" data-shop-qty="${esc(variant?.id || '')}" data-delta="1" aria-label="增加 ${esc(product.name)}" ${inCart >= stock || inCart >= 20 ? 'disabled' : ''}>＋</button></div>` : `<button class="shop-add" type="button" data-shop-add="${esc(variant?.id || '')}" ${!variant || !stock || incompatible ? 'disabled' : ''}>${incompatible ? '不適用此車' : '加入購物車'}</button>`}
    </div>
  </article>`;
}

function cartMarkup(cart, signedIn) {
  if (!signedIn) return `<div class="shop-cart__empty">登入後即可儲存購物車、提交訂單，並在「我的訂單」查看進度。<a class="shop-signin" href="#/login">登入或建立帳號 →</a></div>`;
  if (!cart?.items?.length) return '<div class="shop-cart__empty">購物車還是空的。<br>選一件適合你的保養用品吧。</div>';
  return `${cart.items.map((item) => `<div class="shop-cart-item"><div class="shop-cart-item__image" style="${imageStyle(item)}"></div><div><b>${esc(item.name)}</b><small>${esc(item.variant_name)} · ${item.quantity} 件 · ${money(item.line_total_minor,item.currency)}</small></div><button type="button" data-shop-remove="${esc(item.variant_id)}" aria-label="從購物車移除 ${esc(item.name)}">×</button></div>`).join('')}
    <div class="shop-cart__total"><span>小計</span><b>${money(cart.subtotal_minor,cart.currency)}</b></div>
    <button class="shop-checkout" type="button" data-shop-checkout>前往結帳</button>`;
}

function shopShell(root) {
  root.innerHTML = `<div class="wrap shop-page">
    <header class="shop-head"><div class="shop-head__copy"><span class="sheet__eyebrow">無界啟程 · 商品</span><h1>汽車用品</h1><p>查看商品規格及適用車型；不確定時請先核對車主手冊。</p></div></header>
    <section class="shop-controls">
      <div class="shop-passport" data-shop-passport></div>
      <div class="shop-discovery">
        <label class="shop-search"><span class="sr-only">搜尋商品</span><input type="search" data-product-search placeholder="搜尋商品，例如：機油、Type 2、過江龍"></label>
        <label class="shop-category-select"><span>分類</span><select data-shop-categories aria-label="商品分類"><option>全部</option></select></label>
        <label class="shop-compatible-toggle" data-compatible-wrap hidden><input type="checkbox" data-compatible-only checked> 適合此車</label>
        <strong data-result-count></strong>
      </div>
    </section>
    <div class="shop-toolbar"><div><h2 data-shop-heading>全部商品</h2><p>商品圖片為示意圖，包裝及外觀可能與實物不同。請以商品規格和車主手冊為準。</p></div></div>
    <div class="shop-layout"><div class="shop-grid" data-shop-products><div class="shop-loading">正在載入商品…</div></div><aside class="shop-cart"><div class="shop-cart__head"><h2>購物車</h2><span class="shop-count" data-shop-count>0</span></div><div class="shop-cart__body" data-shop-cart></div></aside></div>
  </div>`;
}

function checkoutMarkup(cart) {
  return `<form class="shop-checkout-form" data-shop-checkout-form><div><b>完成訂購</b><p style="margin:5px 0;color:#7a8b92;font-size:12px">取貨付款；送貨另加 MOP 30.00。</p></div><label>姓名<input name="customer_name" maxlength="100" required autocomplete="name"></label><label>電話<input name="phone" maxlength="40" required autocomplete="tel"></label><label>取貨方式<select name="fulfillment_method"><option value="pickup">門市取貨</option><option value="delivery">本地配送</option></select></label><label data-address hidden>配送地址<textarea name="delivery_address" maxlength="500" autocomplete="street-address"></textarea></label><label>備註<textarea name="notes" maxlength="1000" placeholder="例如車款、年份或方便聯絡時間"></textarea></label><div class="shop-cart__total"><span>商品小計</span><b>${money(cart.subtotal_minor,cart.currency)}</b></div><div class="shop-form-actions"><button type="button" data-shop-cancel-checkout>返回</button><button class="primary" type="submit">確認訂購</button></div><p role="status" style="margin:0;color:#9a4d43;font-size:12px"></p></form>`;
}

export async function renderShop(root, context = {}) {
  shopShell(root);
  const signedIn = Boolean(context.me);
  let products = [];
  let vehicles = [];
  let selectedVehicleId = null;
  let cart = { items: [], item_count: 0, subtotal_minor: 0, currency: 'MOP' };
  let activeCategory = '全部';
  let searchQuery = '';
  let compatibleOnly = true;
  const quantityQueues = new Map();
  const desiredQuantities = new Map();
  const productsHost = root.querySelector('[data-shop-products]');
  const cartHost = root.querySelector('[data-shop-cart]');
  const countHost = root.querySelector('[data-shop-count]');
  const categoriesHost = root.querySelector('[data-shop-categories]');
  const headingHost = root.querySelector('[data-shop-heading]');
  const passportHost = root.querySelector('[data-shop-passport]');
  const resultCount = root.querySelector('[data-result-count]');
  const compatibleWrap = root.querySelector('[data-compatible-wrap]');
  const draw = () => {
    const query = searchQuery.trim().toLowerCase();
    const visible = products.filter((item) => {
      if (activeCategory !== '全部' && item.category !== activeCategory) return false;
      if (selectedVehicleId && compatibleOnly && item.compatibility?.status === 'incompatible') return false;
      if (!query) return true;
      const haystack = [item.name,item.category,item.short_description,...(item.tags||[]),...(item.specifications||[]),...(item.use_cases||[])].join(' ').toLowerCase();
      return haystack.includes(query);
    });
    productsHost.innerHTML = visible.length ? visible.map((item) => productCard(item, cart)).join('') : '<div class="shop-loading">找不到符合條件的商品。試試其他俗稱或清除篩選。</div>';
    resultCount.textContent = `${visible.length} 件商品`;
    cartHost.innerHTML = cartMarkup(cart, signedIn);
    countHost.textContent = cart.item_count || 0;
    const categories = ['全部', ...new Set(products.map((item) => item.category))];
    categoriesHost.innerHTML = categories.map((item) => `<option value="${esc(item)}" ${item === activeCategory ? 'selected' : ''}>${esc(item)}</option>`).join('');
    headingHost.textContent = activeCategory === '全部' ? '全部商品' : activeCategory;
    compatibleWrap.hidden = !selectedVehicleId;
    if (vehicles.length) {
      const selected = vehicles.find((item) => item.id === selectedVehicleId) || vehicles[0];
      passportHost.innerHTML = `<div class="shop-passport__summary"><span>正在為你的車篩選</span><b>${esc([selected.make,selected.model].filter(Boolean).join(' '))}</b><small>${esc([selected.year,selected.fuel_type,selected.mileage_label].filter(Boolean).join(' · '))}</small></div><label><span>切換車輛</span><select data-shop-vehicle>${vehicles.map((vehicle) => `<option value="${esc(vehicle.id)}" ${vehicle.id===selectedVehicleId?'selected':''}>${esc([vehicle.make,vehicle.model].filter(Boolean).join(' '))}</option>`).join('')}</select></label>`;
    } else {
      passportHost.innerHTML = signedIn ? '<div class="shop-passport__summary"><span>車輛配對</span><b>選擇車輛，查看適用資料</b></div><a href="#/garage">選擇車輛 →</a>' : '<div class="shop-passport__summary"><span>車輛配對</span><b>登入後選擇車輛以查看適用資料</b></div><a href="#/login">登入 →</a>';
    }
  };
  const loadProducts = async (vehicleId = selectedVehicleId) => {
    const query = vehicleId ? `?vehicle_id=${encodeURIComponent(vehicleId)}` : '';
    const productData = await api(`/api/shop/products${query}`);
    products = productData.products || [];
    vehicles = productData.vehicles || [];
    selectedVehicleId = productData.selected_vehicle_id || null;
  };
  try {
    await loadProducts();
    if (signedIn) cart = (await api('/api/shop/cart')).cart;
    draw();
  } catch (error) { productsHost.innerHTML = `<div class="shop-error">${esc(error.message)}</div>`; cartHost.innerHTML = cartMarkup(cart, signedIn); }

  const setLocalQuantity = (variantId, quantity) => {
    const current = cart.items?.find((item) => item.variant_id === variantId);
    if (!current) return;
    const items = quantity === 0
      ? cart.items.filter((item) => item.variant_id !== variantId)
      : cart.items.map((item) => item.variant_id === variantId
        ? { ...item, quantity, line_total_minor: Number(item.price_minor) * quantity }
        : item);
    cart = {
      ...cart,
      items,
      item_count: items.reduce((sum, item) => sum + Number(item.quantity), 0),
      subtotal_minor: items.reduce((sum, item) => sum + Number(item.line_total_minor), 0),
      currency: items[0]?.currency || cart.currency || 'MOP',
    };
  };

  const queueQuantitySync = (variantId, quantity) => {
    desiredQuantities.set(variantId, quantity);
    const previous = quantityQueues.get(variantId) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const options = quantity === 0
        ? { method: 'DELETE' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant_id: variantId, quantity }) };
      const result = await api(quantity === 0 ? `/api/shop/cart/items/${encodeURIComponent(variantId)}` : '/api/shop/cart/items', options);
      /* A newer click may already be visible. Only replace the optimistic
         state when this response represents the latest requested quantity. */
      if (desiredQuantities.get(variantId) === quantity) {
        cart = result.cart;
        desiredQuantities.delete(variantId);
        draw();
      }
    }).catch(async (error) => {
      if (desiredQuantities.get(variantId) === quantity) {
        desiredQuantities.delete(variantId);
        try { cart = (await api('/api/shop/cart')).cart; draw(); } catch { /* keep the last visible state */ }
        window.alert(error.message);
      }
    }).finally(() => {
      if (quantityQueues.get(variantId) === task) quantityQueues.delete(variantId);
    });
    quantityQueues.set(variantId, task);
  };

  root.onclick = async (event) => {
    const quantityButton = event.target.closest('[data-shop-qty]');
    if (quantityButton) {
      const variantId = quantityButton.dataset.shopQty;
      const current = cart.items?.find((item) => item.variant_id === variantId)?.quantity || 0;
      const next = Math.max(0, current + Number(quantityButton.dataset.delta || 0));
      setLocalQuantity(variantId, next);
      draw();
      queueQuantitySync(variantId, next);
      return;
    }
    const add = event.target.closest('[data-shop-add]');
    if (add) {
      if (!signedIn) { window.location.hash = '#/login'; return; }
      const variantId = add.dataset.shopAdd; const current = cart.items?.find((item) => item.variant_id === variantId)?.quantity || 0;
      add.disabled = true;
      try { cart = (await api('/api/shop/cart/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variant_id:variantId,quantity:current+1})})).cart; draw(); } catch(error) { add.disabled=false; window.alert(error.message); }
      return;
    }
    const remove = event.target.closest('[data-shop-remove]');
    if (remove) { cart = (await api(`/api/shop/cart/items/${encodeURIComponent(remove.dataset.shopRemove)}`,{method:'DELETE'})).cart; draw(); return; }
    if (event.target.closest('[data-shop-checkout]')) {
      /* Checkout must use the persisted quantities even when the owner taps
         it immediately after a fast optimistic +/− update. */
      if (quantityQueues.size) await Promise.allSettled([...quantityQueues.values()]);
      cartHost.innerHTML = checkoutMarkup(cart);
      const form=cartHost.querySelector('form');const address=form.querySelector('[data-address]');form.elements.fulfillment_method.onchange=()=>{const delivery=form.elements.fulfillment_method.value==='delivery';address.hidden=!delivery;form.elements.delivery_address.required=delivery;};
      form.onsubmit=async (submitEvent)=>{submitEvent.preventDefault();const button=form.querySelector('[type=submit]');const status=form.querySelector('[role=status]');button.disabled=true;status.textContent='';const data=Object.fromEntries(new FormData(form));data.idempotency_key=crypto.randomUUID();try{const result=await api('/api/shop/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});cart={items:[],item_count:0,subtotal_minor:0,currency:'MOP'};cartHost.innerHTML=`<div class="shop-order-success"><div class="shop-order-success__mark">✓</div><h2>訂單已收到</h2><p>訂單編號<br><b>${esc(result.order.order_number)}</b></p><a href="#/orders">查看我的訂單</a></div>`;countHost.textContent='0';}catch(error){status.textContent=error.message;button.disabled=false;}};
      return;
    }
    if(event.target.closest('[data-shop-cancel-checkout]')) draw();
  };
  root.addEventListener('input', (event) => {
    if (event.target.matches('[data-product-search]')) { searchQuery = event.target.value; draw(); }
    if (event.target.matches('[data-compatible-only]')) { compatibleOnly = event.target.checked; draw(); }
  });
  root.addEventListener('change', async (event) => {
    if (event.target.matches('[data-shop-categories]')) {
      activeCategory = event.target.value;
      draw();
      return;
    }
    if (!event.target.matches('[data-shop-vehicle]')) return;
    event.target.disabled = true;
    try { await loadProducts(event.target.value); draw(); }
    catch (error) { window.alert(error.message); event.target.disabled = false; }
  });
}

function orderCard(order, admin = false) {
  return `<article class="shop-order"><div class="shop-order__head"><div><h3>${esc(order.order_number)}</h3><small>${new Date(order.created_at).toLocaleString('zh-HK')} · ${esc(order.customer_name)}${admin ? ` · ${esc(order.email)}` : ''}</small></div><span class="shop-status ${esc(order.status)}">${esc(statusLabel[order.status] || order.status)}</span></div><div class="shop-order__items">${(order.items || []).map((item) => `<div class="shop-order__item"><span>${esc(item.product_name)} · ${esc(item.variant_name)} × ${item.quantity}</span><b>${money(item.line_total_minor,order.currency)}</b></div>`).join('')}</div><div class="shop-order__foot"><span>${order.fulfillment_method === 'delivery' ? `配送 · ${esc(order.delivery_address || '')}` : '門市取貨'} · ${esc(order.phone)}</span><b>${money(order.total_minor,order.currency)}</b></div>${admin && nextStatuses[order.status]?.length ? `<div class="shop-admin-row__actions" style="margin-top:14px"><select data-order-next="${esc(order.id)}">${nextStatuses[order.status].map((status) => `<option value="${status}">${esc(statusLabel[status])}</option>`).join('')}</select><button type="button" data-order-update="${esc(order.id)}">更新狀態</button></div>` : ''}</article>`;
}

export async function renderOrders(root) {
  root.innerHTML='<div class="wrap shop-page"><div class="top"><div><span class="sheet__eyebrow">YOUR ORDERS</span><h1>我的訂單</h1><p>查看購買內容、取貨方式與最新進度。</p></div><a class="landing__primary" href="#/shop">繼續選購</a></div><div class="shop-orders" data-orders><div class="shop-loading">正在載入訂單…</div></div></div>';
  const host=root.querySelector('[data-orders]');try{const data=await api('/api/shop/orders');host.innerHTML=data.orders?.length?data.orders.map((order)=>orderCard(order)).join(''):'<div class="shop-loading">你還未提交任何訂單。<br><a href="#/shop">前往訂購 →</a></div>';}catch(error){host.innerHTML=`<div class="shop-error">${esc(error.message)}</div>`;}
}

function adminProductRow(product) {
  const variant=product.variants?.[0];return `<div class="shop-admin-row"><div><b>${esc(product.name)}</b><small>${esc(variant?.sku||'')} · ${money(variant?.price_minor,variant?.currency)} · 庫存 ${variant?.stock_quantity ?? 0}${variant && variant.stock_quantity <= variant.low_stock_threshold ? ' · 低庫存' : ''}</small></div><div class="shop-admin-row__actions">${variant?`<button type="button" data-stock="${esc(variant.id)}" data-delta="-1">−</button><button type="button" data-stock="${esc(variant.id)}" data-delta="1">＋</button>`:''}<button type="button" data-toggle-product="${esc(product.id)}" data-active="${product.is_active}">${product.is_active?'下架':'上架'}</button></div></div>`;
}

export async function renderAdminShop(root) {
  root.innerHTML=`<div class="wrap shop-page shop-admin"><div class="top"><div><span class="sheet__eyebrow">SHOP ADMIN</span><h1>訂購管理</h1><p>查看顧客訂單、管理商品與即時庫存。</p></div><a class="landing__primary" href="#/shop">查看商店</a></div><div class="shop-admin__stats" data-stats></div><div class="shop-admin__tabs"><button class="active" data-admin-tab="orders">訂單</button><button data-admin-tab="products">商品與庫存</button></div><div data-admin-panel><div class="shop-loading">正在載入商店資料…</div></div></div>`;
  const panel=root.querySelector('[data-admin-panel]');const stats=root.querySelector('[data-stats]');let products=[];let orders=[];let tab='orders';
  const draw=()=>{const revenue=orders.filter(o=>o.status!=='cancelled').reduce((sum,o)=>sum+Number(o.total_minor||0),0);const pending=orders.filter(o=>o.status==='pending').length;const low=products.flatMap(p=>p.variants||[]).filter(v=>v.stock_quantity<=v.low_stock_threshold).length;stats.innerHTML=`<div class="shop-stat"><small>全部訂單</small><b>${orders.length}</b></div><div class="shop-stat"><small>待確認</small><b>${pending}</b></div><div class="shop-stat"><small>訂單金額</small><b>${money(revenue)}</b></div><div class="shop-stat"><small>低庫存 SKU</small><b>${low}</b></div>`;root.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===tab));if(tab==='orders'){panel.innerHTML=`<div class="shop-orders">${orders.length?orders.map(o=>orderCard(o,true)).join(''):'<div class="shop-loading">目前沒有訂單。</div>'}</div>`;}else{panel.innerHTML=`<div class="shop-admin-grid"><form class="card form-card" data-product-form><h2>新增商品</h2><label>商品名稱<input name="name" required maxlength="140" placeholder="例如：輪胎清潔劑"></label><label>網址名稱<input name="slug" required maxlength="140" placeholder="例如：tire-cleaner"></label><label>簡短說明<textarea name="short_description" maxlength="240"></textarea></label><label>分類<input name="category" required placeholder="例如：輪胎與輪圈"></label><label>適用動力<select name="powertrains"><option value="ALL">全部</option><option value="ICE,Hybrid">燃油 / Hybrid</option><option value="EV,PHEV">EV / PHEV</option><option value="MOTORCYCLE">摩托車</option></select></label><label>搜尋 Tags<input name="tags" placeholder="輪胎, tyre, tire"></label><label>規格<input name="specifications" placeholder="205/55R16, SUV"></label><label>用途<input name="use_cases" placeholder="更換, 應急"></label><label>SKU<input name="sku" maxlength="80"></label><label>價格（MOP）<input name="price" type="number" min="0" step="0.01" required></label><label>初始庫存<input name="stock_quantity" type="number" min="0" value="0" required></label><button class="primary" type="submit">建立商品</button><p role="status"></p></form><div class="shop-admin-list">${products.map(adminProductRow).join('')}</div></div>`;const form=panel.querySelector('[data-product-form]');form.onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));data.price_minor=Math.round(Number(data.price)*100);delete data.price;const status=form.querySelector('[role=status]');try{await api('/api/admin/shop/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});await load();tab='products';draw();}catch(error){status.textContent=error.message;}};}};
  const load=async()=>{const [p,o]=await Promise.all([api('/api/admin/shop/products'),api('/api/admin/shop/orders')]);products=p.products||[];orders=o.orders||[];};
  try{await load();draw();}catch(error){panel.innerHTML=`<div class="shop-error">${esc(error.message)}</div>`;}
  root.onclick=async event=>{const tabButton=event.target.closest('[data-admin-tab]');if(tabButton){tab=tabButton.dataset.adminTab;draw();return;}const update=event.target.closest('[data-order-update]');if(update){const select=panel.querySelector(`[data-order-next="${CSS.escape(update.dataset.orderUpdate)}"]`);update.disabled=true;try{await api(`/api/admin/shop/orders/${encodeURIComponent(update.dataset.orderUpdate)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:select.value})});await load();draw();}catch(error){window.alert(error.message);update.disabled=false;}return;}const stock=event.target.closest('[data-stock]');if(stock){stock.disabled=true;try{await api(`/api/admin/shop/inventory/${encodeURIComponent(stock.dataset.stock)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({quantity_delta:Number(stock.dataset.delta),reason:'Admin dashboard adjustment'})});await load();tab='products';draw();}catch(error){window.alert(error.message);stock.disabled=false;}return;}const toggle=event.target.closest('[data-toggle-product]');if(toggle){toggle.disabled=true;try{await api(`/api/admin/shop/products/${encodeURIComponent(toggle.dataset.toggleProduct)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({is_active:toggle.dataset.active!=='true'})});await load();tab='products';draw();}catch(error){window.alert(error.message);toggle.disabled=false;}}};
}
