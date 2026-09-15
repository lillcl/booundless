Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    maxHeight: { type: String, value: '80vh' }
  },
  methods: {
    noop() {},
    onMaskTap() {
      this.triggerEvent('close')
    }
  }
})