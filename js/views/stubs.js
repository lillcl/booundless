/* Placeholder views for Garage,, Service, Qinao, Videos, Profile.
   Each is a deliberate stub — the structure is here, content is for future iterations. */

const STUBS = {
  garage: {
    title: '我的車輛',
    body: '車庫管理介面。下一個迭代會加入車隊篩選、車輛卡片詳情、里程更新。',
  },
  service: {
    title: '服務',
    body: '服務與產品目錄。下一個迭代會加入搜尋、模式切換、描述問題流程。',
  },
  qinao: {
    title: '琴澳去玩',
    body: '琴澳路線規劃。下一個迭代會加入路線詳情、地圖、跨境提醒。',
  },
  videos: {
    title: '影片',
    body: '影片庫。下一個迭代會加入精選影片、分類、影片詳情。',
  },
  profile: {
    title: '我的',
    body: '個人資料與設定。下一個迭代會加入團隊管理、Pro 升級、設定項目。',
  },
};

export function renderStub(root, name) {
  const stub = STUBS[name];
  if (!stub) {
    root.innerHTML = `<div class="placeholder"><h2>找不到頁面</h2><p>此路由尚未實作。</p></div>`;
    return;
  }
  root.innerHTML = `
    <div class="placeholder">
      <h2>${stub.title}</h2>
      <p>${stub.body}</p>
    </div>`;
}

export const renderGarage = (root) => renderStub(root, 'garage');
export const renderService = (root) => renderStub(root, 'service');
export const renderQinao = (root) => renderStub(root, 'qinao');
export const renderVideos = (root) => renderStub(root, 'videos');
export const renderProfile = (root) => renderStub(root, 'profile');