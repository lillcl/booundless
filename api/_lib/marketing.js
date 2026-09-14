export const ORIGIN = 'https://www.booundless.com';
export const validPagePath=path=>['/','/demo'].includes(path)||/^\/campaigns\/[a-z0-9]+(-[a-z0-9]+)*$/.test(path);
export function validateMetadata(body) {
  const result = {};
  for (const [key, limit] of Object.entries({ title: 160, description: 500, social_title: 160, social_description: 500, image: 1000, image_alt: 200 })) {
    if (typeof body[key] !== 'string' || body[key].length > limit) throw new Error(`Invalid ${key}`);
    result[key] = body[key].trim();
  }
  if (!result.title || !result.description) throw new Error('Title and description are required');
  if (result.image) {
    const url = new URL(result.image, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password) throw new Error('Use a same-site image URL');
    result.image = url.href;
  }
  result.indexable = body.indexable === true;
  for (const [key,limit] of Object.entries({headline:160,copy:3000,cta_label:60})) {
    const value=body[key]??'';if(typeof value!=='string'||value.length>limit)throw new Error(`Invalid ${key}`);result[key]=value.trim();
  }
  return result;
}
export function renderCampaign(path,content) {
  const e=escapeHTML;
  const skeleton=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title><meta name="description" content=""><meta name="robots" content=""><link rel="canonical" href=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""><meta property="og:image" content=""><meta property="og:image:alt" content=""><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/assets/icons/booundless-car.png"><style>body{margin:0;background:#f4f8f8;color:#173747;font-family:"PingFang TC","Microsoft JhengHei",sans-serif}main{max-width:1050px;margin:auto;padding:64px 24px}a{color:inherit}h1{font-size:clamp(36px,6vw,64px);line-height:1.25;font-weight:600}p{line-height:1.9;white-space:pre-line;max-width:650px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}img{max-width:100%;border-radius:24px}.cta{display:inline-block;padding:16px 24px;background:#173747;color:white;border-radius:14px;text-decoration:none;margin:24px 0}@media(max-width:700px){.hero{grid-template-columns:1fr}}</style><script src="/assets/marketing-tracking.js" defer></script></head><body><main><a href="/">無界啟程 BOOUNDLESS</a><section class="hero"><div><h1>${e(content.headline||content.title)}</h1><p>${e(content.copy||content.description)}</p><a class="cta" href="/#/login">${e(content.cta_label||'建立我的車輛護照')}</a><p><a href="/demo">先看示範護照 →</a></p></div>${content.image?`<img src="${e(content.image)}" alt="${e(content.image_alt)}">`:''}</section></main></body></html>`;
  return renderMetadata(skeleton,path,content);
}
export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function renderMetadata(html, path, content) {
  if (!content) return html;
  // Replace rather than append, so crawlers see one authoritative value.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHTML(content.title)}</title>`);
  const values = { description: content.description, robots: content.indexable ? 'index,follow' : 'noindex,follow',
    'og:title': content.social_title || content.title, 'og:description': content.social_description || content.description,
    'og:url': ORIGIN + path, 'og:image': content.image, 'og:image:alt': content.image_alt,
    'twitter:title': content.social_title || content.title, 'twitter:description': content.social_description || content.description,
    'twitter:image': content.image };
  for (const [name,value] of Object.entries(values)) {
    const expression = new RegExp(`<meta (?:name|property)="${name}"[^>]*>`, 'g');
    const tag = `<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${escapeHTML(value)}">`;
    html = html.replace(expression, () => tag);
  }
  html = html.replace(/<meta property="og:image:(?:width|height)"[^>]*>/g, '');
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (_tag,json) => {
    const data=JSON.parse(json); data.description=content.description;
    return '<script type="application/ld+json">'+JSON.stringify(data).replace(/</g,'\\u003c')+'</script>';
  });
  html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${ORIGIN + path}">`);
  return html.replace('<html ', '<html data-published-metadata="true" ');
}
