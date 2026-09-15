Component({
  properties: {
    label: { type: String, value: '' },
    wear: { type: Number, value: 0 }
  },
  data: {
    tone: 'green',
    width: 0
  },
  observers: {
    'wear': function (wear) {
      const w = Math.max(0, Math.min(100, wear || 0))
      this.setData({
        width: w,
        tone: w >= 100 ? 'red' : (w >= 80 ? 'amber' : 'green')
      })
    }
  },
  lifetimes: {
    attached() {
      const w = Math.max(0, Math.min(100, this.data.wear || 0))
      this.setData({ width: w, tone: w >= 100 ? 'red' : (w >= 80 ? 'amber' : 'green') })
    }
  }
})