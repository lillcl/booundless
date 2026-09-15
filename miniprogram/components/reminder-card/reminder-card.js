Component({
  properties: {
    reminderId: { type: String, value: '' },
    title: { type: String, value: '' },
    vehicleLabel: { type: String, value: '' },
    dueLabel: { type: String, value: '' },
    status: { type: String, value: 'upcoming' }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.reminderId })
    }
  }
})