Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: 'notice' }, // notice | confirm | input
    title: { type: String, value: '' },
    message: { type: String, value: '' },
    placeholder: { type: String, value: '請輸入' },
    confirmText: { type: String, value: '確認' },
    cancelText: { type: String, value: '取消' }
  },
  data: {
    inputValue: ''
  },
  methods: {
    noop() {},
    onInput(e) {
      this.setData({ inputValue: e.detail.value })
    },
    onCancel() {
      this.triggerEvent('cancel', { value: this.data.mode === 'input' ? null : false })
    },
    onConfirm() {
      const payload = this.data.mode === 'input' ? this.data.inputValue : true
      this.triggerEvent('confirm', { value: payload })
    },
    onMaskTap() {
      if (this.data.mode === 'notice') {
        this.triggerEvent('confirm', { value: true })
      } else {
        this.triggerEvent('cancel')
      }
    }
  }
})