Component({
  properties: {
    vehicleId: { type: String, value: '' },
    title: { type: String, value: '' },
    image: { type: String, value: '' },
    mileageLabel: { type: String, value: '' },
    plate: { type: String, value: '' },
    hint: { type: String, value: '' }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.vehicleId })
    }
  }
})