export const ORIGIN = 'https://www.booundless.com';
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
  return result;
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
