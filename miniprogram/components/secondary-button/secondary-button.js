Component({
  properties: {
    block: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      if (this.data.disabled) return
      this.triggerEvent('tap')
    }
  }
})