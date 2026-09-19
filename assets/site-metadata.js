/* Hash views belong to one public document; never put fragments in canonical URLs. */
(() => {
  const publishedTitle = document.title;
  const publishedRobots = document.querySelector('meta[name="robots"]').content;
  const titles = {
    landing: '建立你的車輛護照', demo: '示範車輛護照', home: '首頁', garage: '我的車', profile: '我的', service: '保養與服務',
    qinao: '琴澳行程', videos: '保養影片', login: '登入', dealer: '車商後台', shop: '訂購', orders: '我的訂單',
    'admin/users': '用戶管理', 'admin/assets': '所有資產',
    'admin/audit': '稽核紀錄', 'admin/dealers': '車商管理', 'admin/marketing': 'SEO 與分享設定', 'admin/shop': '訂購管理',
    requests:'服務請求與報價','admin/tracking':'站內商戶推廣',
  };
  function update() {
    if (document.documentElement.dataset.publishedMetadata && (!location.hash || ['#/landing','#/demo'].includes(location.hash))) {
      document.title = publishedTitle;
      document.querySelector('meta[name="robots"]').content = publishedRobots;
      return;
    }
    const hashRoute = location.hash.replace(/^#\/?/, '').split('?')[0];
    const route = hashRoute || (location.pathname.replace(/\/+$/, '') === '/demo' ? 'demo' : 'landing');
    document.title = `${titles[route] || '找不到頁面'}｜無界啟程 BOOUNDLESS`;
    document.querySelector('meta[name="robots"]').content = route === 'landing' ? 'index,follow' : 'noindex,follow';
  }
  update();
  addEventListener('hashchange', update);
})();
