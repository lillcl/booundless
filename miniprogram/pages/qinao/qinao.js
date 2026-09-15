Page({
  data: {
    routes: [
      {
        id: 'hengqin',
        title: '橫琴粵澳深度合作區',
        subtitle: '從拱北口岸經友誼大橋',
        image: '/images/scenic/hengqin-skyline.png',
        distance_km: 28,
        duration_min: 45,
        crossings: '橫琴口岸'
      },
      {
        id: 'macau',
        title: '澳門歷史城區',
        subtitle: '拱北 → 大三巴 → 議事亭前地',
        image: '/images/scenic/macau-skyline.png',
        distance_km: 12,
        duration_min: 25,
        crossings: '關閘口岸'
      },
      {
        id: 'bridge',
        title: '港珠澳大橋自駕',
        subtitle: '珠海 → 香港 / 澳門',
        image: '/images/scenic/qinao-bridge-drive.png',
        distance_km: 55,
        duration_min: 60,
        crossings: '大橋口岸'
      }
    ],
    tips: [
      { icon: '🛂', title: '證件齊備', text: '港澳通行證 + 駕照 + 車輛牌照（兩地牌）' },
      { icon: '⛽', title: '油量充足', text: '過橋前確保油量足夠，澳門加油站較少' },
      { icon: '🅿️', title: '停車預訂', text: '熱門景點停車場週六日較緊張，建議預訂' },
      { icon: '🛣️', title: '靠左行駛', text: '進入澳門後靠左行駛，留意單行道' }
    ]
  },

  onRouteTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showToast({ title: '「' + id + '」行程詳情即將推出', icon: 'none' })
  },

  onAskAi() {
    wx.navigateTo({ url: '/pages/ai-chat/ai-chat?preset=trip' })
  }
})