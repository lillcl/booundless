Component({
  properties: {
    items: { type: Array, value: [] }, // [{key, label}]
    activeIndex: { type: Number, value: 0 }
  },
  methods: {
    onTap(e) {
      const index = e.currentTarget.dataset.index
      this.triggerEvent('change', { index: index, item: this.data.items[index] })
    }
  }
})