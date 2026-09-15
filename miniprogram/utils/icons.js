// utils/icons.js — 内联 SVG 字符串（替代 js/icons.js）
// 在 wxml 中以 <image src="data:image/svg+xml;utf8,..." /> 或 rich-text 渲染
// 这里导出原始 SVG 路径供需要的页面使用。

const ICONS = {
  car: '<path d="M19 17h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-2v-3zM5 17H3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h2v-3zM7 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 13l2-6h12l2 6v5H4v-5z" fill="currentColor"/>',
  reminder: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 5h-1v6l5.25 3.15.5-.86-4.75-2.84V7z" fill="currentColor"/>',
  location: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/>',
  video: '<path d="M4 6h12v12H4z" fill="currentColor"/><path d="M18 8l4-2v12l-4-2z" fill="currentColor"/>',
  profile: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 6v2h16v-2c0-4-4-6-8-6z" fill="currentColor"/>',
  arrow: '<path d="M10 17l5-5-5-5v10z" fill="currentColor"/>',
  back: '<path d="M15 17l-5-5 5-5v10z" fill="currentColor"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor"/>',
  close: '<path d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4L10.6 10.6l6.3-6.3z" fill="currentColor"/>',
  ruler: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>',
  camera: '<path d="M9 2L7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" fill="currentColor"/>',
  clipboard: '<path d="M19 2h-4.18A3 3 0 0 0 12 0a3 3 0 0 0-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" fill="currentColor"/>'
}

function svg(content, opts) {
  const size = (opts && opts.size) || 48
  const color = (opts && opts.color) || 'currentColor'
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="' + color + '">' + content + '</svg>'
}

function icon(name, opts) {
  const path = ICONS[name] || ICONS.arrow
  return svg(path, opts)
}

// data URI（用于 <image src>）。注意：image 不支持 SVG（小程序限制），通常使用 PNG；这里返回 SVG 以备 <rich-text> 使用。
function iconDataUri(name, opts) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(icon(name, opts))
}

module.exports = { ICONS, icon, iconDataUri }