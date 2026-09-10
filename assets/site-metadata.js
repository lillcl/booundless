/* Hash views belong to one public document; never put fragments in canonical URLs. */
(() => {
  const titles = {
    home: '首頁', garage: '我的車', profile: '我的', service: '保養與服務',
    qinao: '琴澳行程', videos: '保養影片', login: '登入', dealer: '車商後台',
    'admin/users': '用戶管理', 'admin/assets': '所有資產',
    'admin/audit': '稽核紀錄', 'admin/dealers': '車商管理',
  };
  function update() {
    const route = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';
    document.title = `${titles[route] || '找不到頁面'}｜無界啟程 BOOUNDLESS`;
    document.querySelector('meta[name="robots"]').content = route === 'home' ? 'index,follow' : 'noindex,follow';
  }
  update();
  addEventListener('hashchange', update);
})();
