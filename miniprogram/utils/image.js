// utils/image.js — 图片压缩、转 base64（替代 web 端的 prepareVehicleImage）
const format = require('./format.js')

function chooseImage(opts) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: (opts && opts.sourceType) || ['album', 'camera'],
      sizeType: ['compressed'],
      camera: 'back',
      success(res) {
        const file = res.tempFiles && res.tempFiles[0]
        if (file && file.tempFilePath) resolve(file)
        else reject(new Error('未選中圖片'))
      },
      fail(rej) { reject(rej) }
    })
  })
}

function compress(filePath, maxSize = 1200, quality = 80) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality,
      compressedWidth: maxSize,
      compressedHeight: maxSize,
      success(res) { resolve(res.tempFilePath) },
      fail(rej) { reject(rej) }
    })
  })
}

function readAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath,
      encoding: 'base64',
      success(res) { resolve(res.data) },
      fail(rej) { reject(rej) }
    })
  })
}

function detectMime(filePath) {
  const lower = (filePath || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

async function toDataUrl(filePath, maxSize = 1200) {
  const compressed = await compress(filePath, maxSize, 80)
  const b64 = await readAsBase64(compressed)
  const mime = detectMime(compressed)
  return 'data:' + mime + ';base64,' + b64
}

module.exports = { chooseImage, compress, readAsBase64, toDataUrl }